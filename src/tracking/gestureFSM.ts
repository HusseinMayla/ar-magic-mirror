import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { RecognizedGesture } from "./gesture";

export interface GestureFSMOptions {
  minOpenPalmScore?: number;
  minVictoryScore?: number;
  minThumbUpScore?: number;
  handProximityRatio?: number;
  highFiveHoldDurationMs?: number;
  selectHoldDurationMs?: number;
  captureHoldDurationMs?: number;
}

export class GestureFSM {
  // Configurable thresholds (editable via Admin Panel)
  private minOpenPalmScore: number = 0.50; // lower so an open palm still counts from further away
  private minVictoryScore: number = 0.70; // Victory = take a photo (during try-on)
  private minThumbUpScore: number = 0.50; // Thumb_Up = select a category (in the carousel)
  private handProximityRatio: number = 0.16; // Hand height must be >= 16% of screen height
  private highFiveHoldDurationMs: number = 3000;
  private selectHoldDurationMs: number = 3000;
  private captureHoldDurationMs: number = 1000; // short hold so a passing ✌️ doesn't start the countdown

  // High-five tracking state
  private highFiveStartTime: number | null = null;
  private highFiveProgress: number = 0;
  private isHighFiveActive: boolean = false;

  // Thumbs-up selection tracking state
  private selectStartTime: number | null = null;
  private selectProgress: number = 0;
  private isSelectActive: boolean = false;

  // Victory photo-capture tracking state
  private captureStartTime: number | null = null;

  // Two-finger dial state.
  // With index and middle fingers up, every `dialStepDistance` the hand travels sideways moves the
  // menu one card that way; moving back goes back. Speed doesn't matter, so slow moves work too.
  // The anchor moves one full step per card, so a hand resting near a step edge can't flicker back and forth.
  private dialAnchorX: number | null = null;
  private readonly dialStepDistance: number = 0.08; // fraction of the frame width
  private lastTwoFingerSeenAt: number = -Infinity;
  private readonly twoFingerReleaseMs: number = 1000; // pose gone this long = hand lowered, new anchor next time

  /** Off while a student is wearing a chosen collection, so posing or waving can't reopen the menu. */
  public menuGestureEnabled: boolean = true;

  // Callbacks. Points are normalized to the (unmirrored) video frame, like MediaPipe landmarks.
  public onHighFiveProgress?: (progress: number, handCenter: { x: number; y: number } | null) => void;
  public onHighFiveTrigger?: (palm: { x: number; y: number }) => void;

  /** The two-finger dial moved one card step. */
  public onSwipe?: (direction: "left" | "right") => void;
  /** Every frame the two-finger pose is held in the menu: the point between the two fingertips. */
  public onSwipeTrack?: (fingertips: { x: number; y: number }) => void;

  public onSelectProgress?: (progress: number) => void;
  public onSelectTrigger?: (thumbTip: { x: number; y: number }) => void;

  public onCaptureTrigger?: (fingertips: { x: number; y: number }) => void;

  constructor(options?: GestureFSMOptions) {
    if (options?.minOpenPalmScore !== undefined) this.minOpenPalmScore = options.minOpenPalmScore;
    if (options?.minVictoryScore !== undefined) this.minVictoryScore = options.minVictoryScore;
    if (options?.minThumbUpScore !== undefined) this.minThumbUpScore = options.minThumbUpScore;
    if (options?.handProximityRatio !== undefined) this.handProximityRatio = options.handProximityRatio;
    if (options?.highFiveHoldDurationMs !== undefined) this.highFiveHoldDurationMs = options.highFiveHoldDurationMs;
    if (options?.selectHoldDurationMs !== undefined) this.selectHoldDurationMs = options.selectHoldDurationMs;
    if (options?.captureHoldDurationMs !== undefined) this.captureHoldDurationMs = options.captureHoldDurationMs;
  }

  public updateSettings(options: GestureFSMOptions): void {
    if (options.minOpenPalmScore !== undefined) this.minOpenPalmScore = options.minOpenPalmScore;
    if (options.minVictoryScore !== undefined) this.minVictoryScore = options.minVictoryScore;
    if (options.minThumbUpScore !== undefined) this.minThumbUpScore = options.minThumbUpScore;
    if (options.handProximityRatio !== undefined) this.handProximityRatio = options.handProximityRatio;
    if (options.highFiveHoldDurationMs !== undefined) this.highFiveHoldDurationMs = options.highFiveHoldDurationMs;
    if (options.selectHoldDurationMs !== undefined) this.selectHoldDurationMs = options.selectHoldDurationMs;
    if (options.captureHoldDurationMs !== undefined) this.captureHoldDurationMs = options.captureHoldDurationMs;
  }

  /**
   * Main update loop called every camera/gesture frame.
   * @param gestureResult Recognized gesture from MediaPipe
   * @param isOverlayOpen Whether the category carousel overlay is currently visible
   * @param now Current timestamp in ms
   */
  public update(
    gestureResult: RecognizedGesture | null,
    isOverlayOpen: boolean,
    now: number = performance.now()
  ): void {
    if (!gestureResult || !gestureResult.landmarks || gestureResult.landmarks.length === 0) {
      this.resetHighFive();
      this.resetSelect();
      this.resetCapture();
      return;
    }

    // Follow the hand that is making the gesture, not simply the first hand MediaPipe lists
    const hands = gestureResult.landmarks;
    const hand0 = hands[gestureResult.handIndex] ?? hands[0];

    if (!isOverlayOpen) {
      // OVERLAY IS CLOSED: Close-Up High-Five opens the menu (until a collection is chosen), Victory takes a photo
      if (this.menuGestureEnabled) {
        this.processHighFive(gestureResult, hand0, now);
      } else {
        this.resetHighFive();
      }
      this.processCapture(gestureResult, hand0, now);
      this.resetSelect();
      this.resetSwipe();
    } else {
      // OVERLAY IS OPEN: Check for Two-Finger Swiping and Thumbs-Up Confirmation
      this.resetHighFive();
      this.resetCapture();
      this.processTwoFingerSwipe(gestureResult, hand0, now);
      this.processThumbUpSelection(gestureResult, hand0, now);
    }
  }

  /**
   * Close-up High-Five detector:
   * Requires Open_Palm, hand height >= handProximityRatio, and 3s continuous hold.
   */
  private processHighFive(
    gestureResult: RecognizedGesture,
    hand: NormalizedLandmark[],
    now: number
  ): void {
    const isPalm = gestureResult.name === "Open_Palm" && gestureResult.score >= this.minOpenPalmScore;

    // Check hand vertical size from wrist (0) to middle tip (12)
    const wrist = hand[0];
    const middleTip = hand[12];
    const handHeight = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y);
    const isCloseEnough = handHeight >= this.handProximityRatio;

    if (isPalm && isCloseEnough) {
      if (this.highFiveStartTime === null) {
        this.highFiveStartTime = now;
      }

      const elapsed = now - this.highFiveStartTime;
      this.highFiveProgress = Math.min(1.0, elapsed / this.highFiveHoldDurationMs);

      // Center of hand (middle MCP: 9)
      const handCenter = { x: hand[9].x, y: hand[9].y };
      this.onHighFiveProgress?.(this.highFiveProgress, handCenter);

      if (this.highFiveProgress >= 1.0 && !this.isHighFiveActive) {
        this.isHighFiveActive = true;
        this.onHighFiveTrigger?.(handCenter);
        this.resetHighFive();
      }
    } else {
      this.resetHighFive();
    }
  }

  /**
   * Two-finger dial:
   * Index & middle fingers held up (MediaPipe's "Victory" label or the finger-shape check),
   * then the hand moves left or right. Each step of distance moves the menu one card.
   */
  private processTwoFingerSwipe(gestureResult: RecognizedGesture, hand: NormalizedLandmark[], now: number): void {
    if (hand.length < 21) return;

    // The classifier also recognizes a relaxed V where ring/pinky aren't tightly curled
    const isTwoFingerPose = (gestureResult.name === "Victory" || this.isTwoFingerShape(hand)) && this.areFingersUp(hand);
    if (!isTwoFingerPose) return;

    this.onSwipeTrack?.({ x: (hand[8].x + hand[12].x) * 0.5, y: (hand[8].y + hand[12].y) * 0.5 });

    // In mirrored screen, coordinate X is mirrored: screenX = 1 - rawX
    const screenX = 1 - (hand[8].x + hand[12].x) * 0.5;

    // First sight of the pose (or back after lowering the hand): the dial starts where the hand is.
    // Brief tracking loss keeps the anchor, so a blurry frame doesn't reset progress toward the next step.
    if (this.dialAnchorX === null || now - this.lastTwoFingerSeenAt > this.twoFingerReleaseMs) {
      this.dialAnchorX = screenX;
    }
    this.lastTwoFingerSeenAt = now;

    const offset = screenX - this.dialAnchorX;
    if (Math.abs(offset) >= this.dialStepDistance) {
      // Like dragging on a touch screen, the cards follow the hand: moving it left pulls the
      // next card in from the right, moving it right brings back the previous one
      const direction = offset < 0 ? "right" : "left";
      this.onSwipe?.(direction);
      this.dialAnchorX += Math.sign(offset) * this.dialStepDistance;

      // The card changed: restart the thumbs-up hold so it always counts on the card now shown
      this.resetSelect();
    }
  }

  /**
   * Index and middle fingertips point up (above their middle joints in the image).
   */
  private areFingersUp(hand: NormalizedLandmark[]): boolean {
    return hand[8].y < hand[6].y && hand[12].y < hand[10].y;
  }

  /**
   * Index & Middle fingers extended, Ring & Pinky curled.
   */
  private isTwoFingerShape(hand: NormalizedLandmark[]): boolean {
    const wrist = hand[0];
    const distFromWrist = (i: number) => Math.hypot(hand[i].x - wrist.x, hand[i].y - wrist.y);

    // Extended fingers have tips further from the wrist than their middle joints (PIPs)
    const isIndexExtended = distFromWrist(8) > distFromWrist(6) * 1.15;
    const isMiddleExtended = distFromWrist(12) > distFromWrist(10) * 1.15;
    const isRingCurled = distFromWrist(16) < distFromWrist(14) * 1.05;
    const isPinkyCurled = distFromWrist(20) < distFromWrist(18) * 1.05;

    return isIndexExtended && isMiddleExtended && isRingCurled && isPinkyCurled;
  }

  /**
   * Thumbs-Up 3-second hold detector to confirm category selection.
   */
  private processThumbUpSelection(gestureResult: RecognizedGesture, hand: NormalizedLandmark[], now: number): void {
    const isThumbUp = gestureResult.name === "Thumb_Up" && gestureResult.score >= this.minThumbUpScore;

    if (isThumbUp) {
      if (this.selectStartTime === null) {
        this.selectStartTime = now;
      }

      const elapsed = now - this.selectStartTime;
      this.selectProgress = Math.min(1.0, elapsed / this.selectHoldDurationMs);

      this.onSelectProgress?.(this.selectProgress);

      if (this.selectProgress >= 1.0 && !this.isSelectActive) {
        this.isSelectActive = true;
        this.onSelectTrigger?.({ x: hand[4].x, y: hand[4].y });
        this.resetSelect();
      }
    } else {
      this.resetSelect();
    }
  }

  /**
   * Victory sign held during try-on starts the photo countdown.
   */
  private processCapture(gestureResult: RecognizedGesture, hand: NormalizedLandmark[], now: number): void {
    const isVictory = gestureResult.name === "Victory" && gestureResult.score >= this.minVictoryScore;

    if (!isVictory) {
      this.resetCapture();
      return;
    }

    if (this.captureStartTime === null) {
      this.captureStartTime = now;
    }

    if (now - this.captureStartTime >= this.captureHoldDurationMs) {
      this.resetCapture();
      this.onCaptureTrigger?.({ x: (hand[8].x + hand[12].x) * 0.5, y: (hand[8].y + hand[12].y) * 0.5 });
    }
  }

  private resetHighFive(): void {
    if (this.highFiveStartTime !== null || this.highFiveProgress > 0) {
      this.highFiveStartTime = null;
      this.highFiveProgress = 0;
      this.isHighFiveActive = false;
      this.onHighFiveProgress?.(0, null);
    }
  }

  private resetSelect(): void {
    if (this.selectStartTime !== null || this.selectProgress > 0) {
      this.selectStartTime = null;
      this.selectProgress = 0;
      this.isSelectActive = false;
      this.onSelectProgress?.(0);
    }
  }

  private resetCapture(): void {
    this.captureStartTime = null;
  }

  private resetSwipe(): void {
    this.dialAnchorX = null;
  }
}
