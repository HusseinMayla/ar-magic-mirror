import {
  FilesetResolver,
  GestureRecognizer,
  GestureRecognizerResult,
  NormalizedLandmark
} from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_URL, GESTURE_MODEL_URL } from "./wasm";

export interface RecognizedGesture {
  name: string;
  score: number;
  /** Which entry of `landmarks` made the gesture (the menus follow this hand). */
  handIndex: number;
  landmarks?: NormalizedLandmark[][];
  handednesses?: { categoryName: string; score: number }[][];
}

export class GestureTracker {
  private recognizer: GestureRecognizer | null = null;
  private isReady: boolean = false;
  private actualDelegate: "GPU" | "CPU" = "CPU";

  public async initialize(): Promise<void> {
    // Release the previous instance's GPU resources when re-initializing (auto-recovery)
    this.isReady = false;
    this.recognizer?.close();
    this.recognizer = null;

    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

    const modelUrl = GESTURE_MODEL_URL;

    try {
      this.recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
        minTrackingConfidence: 0.65
      });
      this.actualDelegate = "GPU";
      console.log("[GestureTracker] Initialized with delegate: GPU");
    } catch (gpuErr) {
      console.warn("[GestureTracker] GPU delegate failed, falling back to CPU:", gpuErr);
      this.recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
        minTrackingConfidence: 0.65
      });
      this.actualDelegate = "CPU";
    }

    this.isReady = true;
  }

  public detect(input: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): RecognizedGesture | null {
    if (!this.isReady || !this.recognizer) return null;

    const result: GestureRecognizerResult = this.recognizer.recognizeForVideo(input, timestampMs);

    if (result.gestures && result.gestures.length > 0) {
      // Pick the highest-scoring real gesture across all hands, so a Victory sign
      // on the second hand isn't masked by "None" on the first.
      let best: { categoryName: string; score: number } | null = null;
      let bestHand = 0;
      result.gestures.forEach((handGestures, i) => {
        const top = handGestures[0];
        if (top && top.categoryName !== "None" && (!best || top.score > best.score)) {
          best = top;
          bestHand = i;
        }
      });
      const winner = best as { categoryName: string; score: number } | null;
      return {
        name: winner ? winner.categoryName : "None",
        score: winner ? winner.score : 0,
        handIndex: bestHand,
        landmarks: result.landmarks,
        handednesses: result.handednesses
      };
    }

    if (result.landmarks && result.landmarks.length > 0) {
      return {
        name: "None",
        score: 0,
        handIndex: 0,
        landmarks: result.landmarks,
        handednesses: result.handednesses
      };
    }

    return null;
  }

  public get ready(): boolean {
    return this.isReady;
  }

  public get delegate(): "GPU" | "CPU" {
    return this.actualDelegate;
  }
}

// MediaPipe 21 Standard Hand Landmarks Connections (21 points, 21 connections)
export const HAND_CONNECTIONS: [number, number][] = [
  // Palm base to wrist
  [0, 1], [0, 5], [0, 17],
  // Thumb
  [1, 2], [2, 3], [3, 4],
  // Index
  [5, 6], [6, 7], [7, 8],
  // Middle
  [9, 10], [10, 11], [11, 12],
  // Ring
  [13, 14], [14, 15], [15, 16],
  // Pinky
  [17, 18], [18, 19], [19, 20],
  // Knuckle connecting palm
  [5, 9], [9, 13], [13, 17]
];
