import { CameraManager } from "./camera";
import { PoseTracker, POSE_CONNECTIONS } from "./tracking/pose";
import { GestureTracker, HAND_CONNECTIONS, RecognizedGesture } from "./tracking/gesture";
import { KinematicsSolver } from "./tracking/solver";
import { PersonIdentityTracker, TrackedPerson } from "./tracking/personTracker";
import { GestureFSM } from "./tracking/gestureFSM";
import { VRMManager, AvatarVisualMode } from "./avatar/vrmManager";
import { CATEGORIES, getCategoryById, CategoryDefinition } from "./ui/categories";
import { CategoryCarousel } from "./ui/carousel";
import { AdminPanel } from "./ui/adminPanel";
import { PhotoBooth } from "./ui/photoBooth";
import { GestureParticles } from "./ui/particles";
import { StickerLayer } from "./ui/stickerLayer";
import { AttractLoop, AttractMode, holoGuide } from "./ui/attractLoop";
import { mountHealthWidget } from "./ui/healthWidget";
import { PerformanceTracker } from "./utils/fps";
import { SystemHealthMonitor } from "./utils/health";
import { NormalizedLandmark, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

// What students read on the gesture pill (MediaPipe's names use underscores)
const GESTURE_LABELS: Record<string, string> = {
  Open_Palm: "Open Palm",
  Closed_Fist: "Closed Fist",
  Pointing_Up: "Pointing Up",
  Thumb_Up: "Thumbs Up",
  Thumb_Down: "Thumbs Down",
  Victory: "Victory",
  ILoveYou: "I Love You"
};

// The full-screen tutorial plays once nobody has been tracked for this long
const IDLE_DELAY_MS = 2000;

// A student wearing a costume walked away without taking a photo: once the mirror has been empty
// this long, it resets for the next student (long enough to survive turning around or stepping back)
const ABANDONED_DELAY_MS = 10000;

// Space the "Human detected" label needs above a face box (frame inset + label height)
const FACE_LABEL_ROOM_PX = 120;

class MagicMirrorApp {
  private cameraManager: CameraManager;
  private poseTracker: PoseTracker;
  private gestureTracker: GestureTracker;
  private personTracker: PersonIdentityTracker;
  private gestureFSM: GestureFSM;
  private vrmManager: VRMManager;
  private carousel: CategoryCarousel;
  private photoBooth: PhotoBooth;
  private gestureFx: GestureParticles;
  private stickers: StickerLayer;
  private perfTracker: PerformanceTracker;
  private healthMonitor: SystemHealthMonitor;

  private videoElement: HTMLVideoElement;
  private threeCanvas: HTMLCanvasElement;
  private canvasElement: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D;

  // Offscreen canvas for downscaling inference frames
  private inferenceCanvas: HTMLCanvasElement;
  private inferenceCtx: CanvasRenderingContext2D;

  // DOM elements - Telemetry & Profiler
  private statusOverlay: HTMLElement;
  private statusText: HTMLElement;
  private perfHud: HTMLElement;
  private hudStatus: HTMLElement;
  private fpsOverall: HTMLElement;
  private hudTrackedPeople: HTMLElement;
  private hudLockState: HTMLElement;
  private fpsPose: HTMLElement;
  private fpsGesture: HTMLElement;
  private fpsKalidokit: HTMLElement;
  private fpsVrm: HTMLElement;
  private fpsDownscale: HTMLElement;
  private fpsTotalFrame: HTMLElement;
  private hudActiveCategory: HTMLElement;
  private gestureBadge: HTMLElement;
  private gestureName: HTMLElement;
  private faceBoxes: HTMLElement[];
  private attractLoop: AttractLoop;
  private nowWearing: HTMLElement;
  private nowWearingName: HTMLElement;
  private nowWearingCollection: HTMLElement;
  private lastPersonSeenAt: number = performance.now();

  // Outfits stay hidden (face boxes shown instead) until a collection is picked and loaded
  private costumeChosen: boolean = false;

  // Toggles & Settings
  private enablePose: boolean = true;
  private enableGesture: boolean = true;
  private enableBodySkeleton: boolean = false;
  private enableHandSkeleton: boolean = false;
  private enableDownscale: boolean = true;

  private lastVideoTime: number = -1;
  private canvasCssWidth: number = window.innerWidth;
  private canvasCssHeight: number = window.innerHeight;

  constructor() {
    this.videoElement = document.getElementById("webcam-video") as HTMLVideoElement;
    this.threeCanvas = document.getElementById("three-canvas") as HTMLCanvasElement;
    this.canvasElement = document.getElementById("debug-canvas") as HTMLCanvasElement;
    this.canvasCtx = this.canvasElement.getContext("2d")!;

    // Offscreen canvas for inference downscaling
    this.inferenceCanvas = document.createElement("canvas");
    this.inferenceCanvas.width = 640;
    this.inferenceCanvas.height = 480;
    this.inferenceCtx = this.inferenceCanvas.getContext("2d", { willReadFrequently: true })!;

    // Telemetry DOM
    this.statusOverlay = document.getElementById("status-overlay")!;
    this.statusText = document.getElementById("status-text")!;
    this.perfHud = document.getElementById("perf-hud")!;
    this.hudStatus = document.getElementById("hud-status")!;
    this.fpsOverall = document.getElementById("fps-overall")!;
    this.hudTrackedPeople = document.getElementById("hud-tracked-people")!;
    this.hudLockState = document.getElementById("hud-lock-state")!;
    this.faceBoxes = Array.from(document.querySelectorAll<HTMLElement>(".face-box"));
    this.fpsPose = document.getElementById("fps-pose")!;
    this.fpsGesture = document.getElementById("fps-gesture")!;
    this.fpsKalidokit = document.getElementById("fps-kalidokit")!;
    this.fpsVrm = document.getElementById("fps-vrm")!;
    this.fpsDownscale = document.getElementById("fps-downscale")!;
    this.fpsTotalFrame = document.getElementById("fps-total-frame")!;
    this.hudActiveCategory = document.getElementById("hud-active-category")!;
    this.gestureBadge = document.getElementById("gesture-badge")!;
    this.gestureName = document.getElementById("gesture-name")!;
    this.attractLoop = new AttractLoop(document.getElementById("idle-screen")!);
    document.getElementById("now-wearing-hint-icon")!.outerHTML = holoGuide("victory", "pulse");
    this.nowWearing = document.getElementById("now-wearing")!;
    this.nowWearingName = document.getElementById("now-wearing-name")!;
    this.nowWearingCollection = document.getElementById("now-wearing-collection")!;

    // Initialize Subsystems
    this.cameraManager = new CameraManager(this.videoElement);
    this.poseTracker = new PoseTracker();
    this.gestureTracker = new GestureTracker();
    this.personTracker = new PersonIdentityTracker({ minConfidence: 0.70, maxPeople: 4, gracePeriodFrames: 6 });
    this.gestureFSM = new GestureFSM({ minOpenPalmScore: 0.50, minThumbUpScore: 0.50, minVictoryScore: 0.70, handProximityRatio: 0.16 });
    this.perfTracker = new PerformanceTracker();

    // VRM Multi-Avatar Manager, preloading the first category
    const initialCategory = CATEGORIES[0];
    this.vrmManager = new VRMManager({
      canvas: this.threeCanvas,
      initialCategory: initialCategory
    });

    const mirrorContainer = document.getElementById("mirror-container")!;

    // 3D Cover Flow Carousel
    this.carousel = new CategoryCarousel({
      container: mirrorContainer,
      initialCategoryId: initialCategory.id,
      onSelectCategory: (cat: CategoryDefinition) => {
        console.log(`[MagicMirror] Category changed to: ${cat.name}`);
        this.statusText.textContent = `Loading ${cat.name}...`;
        this.statusOverlay.style.display = "flex";
        this.statusOverlay.style.opacity = "0.7";

        this.vrmManager.loadCategory(cat, () => {
          this.wearCollection(cat);
          this.statusOverlay.style.opacity = "0";
          setTimeout(() => { this.statusOverlay.style.display = "none"; }, 300);
        });

        this.hudActiveCategory.textContent = cat.name;
      }
    });

    // Gold sparks: a trail under the swiping fingers, a burst when a gesture completes
    this.gestureFx = new GestureParticles(mirrorContainer);

    // The chosen collection's sticker sheet, over the costume and into the photo
    this.stickers = new StickerLayer(mirrorContainer);

    // Gesture State Machine wiring
    this.gestureFSM.onHighFiveProgress = (progress, handCenter) => {
      this.carousel.updateHighFiveProgress(progress, handCenter ? this.toScreen(handCenter) : null);
    };

    this.gestureFSM.onHighFiveTrigger = (palm) => {
      console.log("[MagicMirror] High-Five triggered -> Opening Cover Flow Carousel");
      const p = this.toScreen(palm);
      this.gestureFx.burst(p.x, p.y, "large");
      this.carousel.open();
    };

    this.gestureFSM.onSwipe = (direction) => {
      console.log(`[MagicMirror] Two-finger swipe detected: ${direction}`);
      this.carousel.navigate(direction);
    };

    this.gestureFSM.onSwipeTrack = (fingertips) => {
      const p = this.toScreen(fingertips);
      this.gestureFx.trail(p.x, p.y);
    };

    this.gestureFSM.onSelectProgress = (progress) => {
      this.carousel.updateSelectProgress(progress);
    };

    this.gestureFSM.onSelectTrigger = (thumbTip) => {
      console.log("[MagicMirror] Thumbs-up 3s hold completed -> Selecting Category");
      const p = this.toScreen(thumbTip);
      this.gestureFx.burst(p.x, p.y, "medium");
      this.carousel.selectCurrent();
    };

    // Victory sign during try-on -> countdown and photo
    this.photoBooth = new PhotoBooth({
      container: mirrorContainer,
      captureFrame: () => this.captureMirrorFrame(),
      onCapture: () => this.gestureFx.confettiShower(this.vrmManager.category?.accentColor),
      onDone: () => this.resetForNextStudent()
    });

    this.gestureFSM.onCaptureTrigger = (fingertips) => {
      // Photos are for try-on only: a peace sign before a costume is on must not open the photo screen
      if (!this.costumeChosen) return;
      console.log("[MagicMirror] Victory hold -> Taking photo");
      const p = this.toScreen(fingertips);
      this.gestureFx.burst(p.x, p.y, "medium");
      this.photoBooth.start();
    };

    // Slide-out admin panel (staff only); it wires its own controls
    new AdminPanel(mirrorContainer, {
      onConfidenceChange: (conf) => {
        this.poseTracker.reconfigure(conf);
        this.personTracker.updateSettings({ minConfidence: conf });
      },
      onMaxPeopleChange: (max) => {
        this.poseTracker.reconfigure(undefined, max);
        this.personTracker.updateSettings({ maxPeople: max });
      },
      onOpenPalmScoreChange: (score) => {
        this.gestureFSM.updateSettings({ minOpenPalmScore: score });
      },
      onVictoryScoreChange: (score) => {
        this.gestureFSM.updateSettings({ minVictoryScore: score });
      },
      onThumbUpScoreChange: (score) => {
        this.gestureFSM.updateSettings({ minThumbUpScore: score });
      },
      onProximityRatioChange: (ratio) => {
        this.gestureFSM.updateSettings({ handProximityRatio: ratio });
      },
      onVideoOpacityChange: (opacity) => {
        this.videoElement.style.opacity = `${opacity}`;
      },
      onDownscaleToggle: (enabled) => {
        this.enableDownscale = enabled;
      },
      onTelemetryToggle: (visible) => {
        this.perfHud.style.display = visible ? "block" : "none";
      },
      onSkeletonToggle: (body, hands) => {
        this.enableBodySkeleton = body;
        this.enableHandSkeleton = hands;
        this.canvasElement.style.display = (body || hands) ? "block" : "none";
      },
      onScaleChange: (scale) => {
        this.vrmManager.setScaleModifier(scale);
      },
      onYOffsetChange: (offset) => {
        this.vrmManager.setYOffsetModifier(offset);
      },
      onVisualModeChange: (mode: AvatarVisualMode) => {
        this.vrmManager.setVisualMode(mode);
      },
      onForceCategory: (categoryId) => {
        const cat = getCategoryById(categoryId);
        // Close without selecting (selectCurrent would start loading a second category in parallel)
        if (this.carousel.visible) this.carousel.close();
        this.carousel.setCurrentCategory(cat.id);
        this.vrmManager.loadCategory(cat, () => this.wearCollection(cat));
        this.hudActiveCategory.textContent = cat.name;
      },
      onRestartCamera: async () => {
        this.cameraManager.stopCamera();
        await this.cameraManager.startCamera();
      },
      onSimulateCrash: () => {
        this.healthMonitor.updateStatus("mediapipe", "error", "Simulated crash recovery");
        setTimeout(() => {
          this.healthMonitor.updateStatus("mediapipe", "healthy", "Subsystems recovered");
        }, 1500);
      }
    });

    // Health Monitor
    this.healthMonitor = new SystemHealthMonitor();
    mountHealthWidget(this.healthMonitor);
    this.healthMonitor.setRetryHandler("camera", async () => {
      this.cameraManager.stopCamera();
      await this.cameraManager.startCamera();
      return true;
    });
    // Camera unplugged or taken by another app: show it to staff and keep retrying
    this.cameraManager.onTrackEnded = () => {
      this.healthMonitor.updateStatus("camera", "error", "Camera disconnected");
    };
    this.healthMonitor.setRetryHandler("mediapipe", async () => {
      await this.poseTracker.initialize(0.70, 4);
      await this.gestureTracker.initialize();
      return true;
    });

    window.addEventListener("resize", () => this.resizeCanvas());

    // Staff keys for the two gestures that have no button: M opens (or closes) the menu, P takes the photo.
    // e.code is the physical key, so they work on any keyboard layout.
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.photoBooth.busy) return;
      // Typing in an admin panel control must not trigger them
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      if (e.code === "KeyM") {
        if (this.carousel.visible) this.carousel.close();
        else this.carousel.open();
      } else if (e.code === "KeyP" && this.costumeChosen && !this.carousel.visible) {
        this.photoBooth.start();
      }
    });
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvasCssWidth = window.innerWidth;
    this.canvasCssHeight = window.innerHeight;

    this.canvasElement.width = Math.round(this.canvasCssWidth * dpr);
    this.canvasElement.height = Math.round(this.canvasCssHeight * dpr);
    this.canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.vrmManager.resize(this.canvasCssWidth, this.canvasCssHeight);
  }

  private getVideoRect(): { x: number; y: number; width: number; height: number } {
    const vw = this.videoElement.videoWidth || this.canvasCssWidth;
    const vh = this.videoElement.videoHeight || this.canvasCssHeight;
    const scale = Math.max(this.canvasCssWidth / vw, this.canvasCssHeight / vh);
    const width = vw * scale;
    const height = vh * scale;
    return {
      x: (this.canvasCssWidth - width) / 2,
      y: (this.canvasCssHeight - height) / 2,
      width,
      height
    };
  }

  /**
   * The chosen collection's costumes have loaded: put them on with their stickers.
   * The open-palm menu gesture switches off so posing or waving can't reopen the menu.
   */
  private wearCollection(category: CategoryDefinition): void {
    this.costumeChosen = true;
    // The walk-away timer starts now: the student just chose this, even if body tracking lost them
    // while they stood close to the camera using the menu
    this.lastPersonSeenAt = performance.now();
    this.stickers.setCategory(category);
    this.gestureFSM.menuGestureEnabled = false;
  }

  /**
   * Done on the photo screen: back to the start for the next student. Costumes and stickers hide
   * (the render loop follows costumeChosen), face boxes return, and an open palm opens the menu again.
   */
  private resetForNextStudent(): void {
    this.costumeChosen = false;
    this.gestureFSM.menuGestureEnabled = true;
  }

  /**
   * Maps a point normalized to the video frame onto the screen (the video is cropped to cover and mirrored).
   */
  private toScreen(point: { x: number; y: number }): { x: number; y: number } {
    const rect = this.getVideoRect();
    return {
      x: rect.x + (1 - point.x) * rect.width,
      y: rect.y + point.y * rect.height
    };
  }

  public async init(): Promise<void> {
    this.resizeCanvas();

    this.statusText.textContent = "Starting camera stream (720p)...";
    try {
      await this.cameraManager.startCamera();
      this.healthMonitor.updateStatus("camera", "healthy", "Streaming 720p @ 30fps");
    } catch (camErr: unknown) {
      console.error("Camera initialization error:", camErr);
      const message = camErr instanceof Error ? camErr.message : String(camErr);
      this.healthMonitor.updateStatus("camera", "error", `Webcam access denied: ${message}`);
    }

    try {
      this.statusText.textContent = "Loading Multi-Person Pose Tracker (GPU)...";
      await this.poseTracker.initialize(0.70, 4);

      this.statusText.textContent = "Loading Gesture Recognizer (GPU)...";
      await this.gestureTracker.initialize();

      this.healthMonitor.updateStatus("mediapipe", "healthy", "Pose (4 poses) + Gesture loaded (GPU)");

      const isGpu = this.poseTracker.delegate === "GPU" && this.gestureTracker.delegate === "GPU";
      this.hudStatus.textContent = isGpu ? "GPU (Active)" : "CPU (Fallback)";
      this.hudStatus.style.color = isGpu ? "#4ade80" : "#facc15";
    } catch (err: unknown) {
      console.error("MediaPipe initialization error:", err);
      const message = err instanceof Error ? err.message : String(err);
      this.healthMonitor.updateStatus("mediapipe", "error", `Init failure: ${message}`);
    }

    this.statusOverlay.style.opacity = "0";
    setTimeout(() => {
      this.statusOverlay.style.display = "none";
    }, 400);

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  private renderLoop(_timestamp: number): void {
    const video = this.videoElement;
    const now = performance.now();

    if (video.currentTime !== this.lastVideoTime && video.readyState >= 2) {
      this.lastVideoTime = video.currentTime;
      const frameStart = performance.now();

      // 1. Prepare inference frame
      let inferenceInput: HTMLCanvasElement | HTMLVideoElement = video;
      let downscaleElapsed = 0;
      if (this.enableDownscale) {
        const targetHeight = Math.round((640 * video.videoHeight) / video.videoWidth);
        if (this.inferenceCanvas.height !== targetHeight) {
          this.inferenceCanvas.height = targetHeight;
        }
        const dsStart = performance.now();
        this.inferenceCtx.drawImage(video, 0, 0, this.inferenceCanvas.width, this.inferenceCanvas.height);
        downscaleElapsed = performance.now() - dsStart;
        inferenceInput = this.inferenceCanvas;
      }
      this.perfTracker.recordDownscaleTime(downscaleElapsed);

      if (this.enableBodySkeleton || this.enableHandSkeleton) {
        this.canvasCtx.clearRect(0, 0, this.canvasCssWidth, this.canvasCssHeight);
      }

      let poseResult: PoseLandmarkerResult | null = null;
      let gestureResult: RecognizedGesture | null = null;
      let trackedPeople: TrackedPerson[] = [];

      // 2. Multi-Person Pose Tracking Stage
      if (this.enablePose && this.poseTracker.ready) {
        const poseStart = performance.now();
        poseResult = this.poseTracker.detect(inferenceInput, now);
        const poseElapsed = performance.now() - poseStart;
        this.perfTracker.recordPoseTime(poseElapsed);

        if (poseResult && poseResult.landmarks) {
          trackedPeople = this.personTracker.update(poseResult.landmarks, poseResult.worldLandmarks);
        }

        const isLocked = trackedPeople.length > 0;
        if (isLocked) this.lastPersonSeenAt = now;
        if (this.costumeChosen && !this.photoBooth.busy && now - this.lastPersonSeenAt > ABANDONED_DELAY_MS) {
          this.resetForNextStudent();
        }
        // The attract demo is only for before a collection is chosen: once a student is trying one on,
        // briefly losing tracking (turning around, stepping back) must not cover it.
        // Empty mirror: the full-screen tutorial. Someone standing there without the menu open: the same, small.
        const isIdle = now - this.lastPersonSeenAt > IDLE_DELAY_MS;
        const attractMode: AttractMode = this.costumeChosen || this.carousel.visible || this.photoBooth.busy ? "off"
          : isIdle ? "attract" : "coach";
        this.attractLoop.setMode(attractMode);
        this.stickers.setVisible(this.costumeChosen);
        this.hudLockState.textContent = isLocked ? `TRACK (${trackedPeople.length})` : "SEARCH (No Lock)";
        this.hudLockState.className = isLocked ? "badge-track" : "badge-search";
        this.hudTrackedPeople.textContent = `${trackedPeople.length} / ${this.personTracker.peopleLimit}`;
      }

      // 3. Gesture Recognizer Stage
      if (this.enableGesture && this.gestureTracker.ready) {
        const gestureStart = performance.now();
        gestureResult = this.gestureTracker.detect(inferenceInput, now);
        const gestureElapsed = performance.now() - gestureStart;
        this.perfTracker.recordGestureTime(gestureElapsed);

        // A hand in view means someone is there, even when they stand too close for body tracking
        // (as students do to use the menu): don't let the mirror think it's empty
        if (gestureResult) this.lastPersonSeenAt = now;

        if (gestureResult && gestureResult.name !== "None") {
          this.gestureName.textContent = GESTURE_LABELS[gestureResult.name] ?? gestureResult.name;
          this.gestureBadge.classList.remove("is-idle");
          if (gestureResult.name === "Victory") {
            this.gestureBadge.classList.add("active-victory");
          } else {
            this.gestureBadge.classList.remove("active-victory");
          }
        } else {
          // No gesture, or the hand left the frame (null result): fade the pill out,
          // but keep the last name so it doesn't flash "None" while fading
          this.gestureBadge.classList.add("is-idle");
          this.gestureBadge.classList.remove("active-victory");
        }

        // Feed Gesture State Machine (paused while a photo is being taken or previewed)
        if (!this.photoBooth.busy) {
          this.gestureFSM.update(gestureResult, this.carousel.visible, now);
        }
      }

      // 4. Kinematics Solving & Multi-VRM Avatar Rigging Stage
      const vrmStart = performance.now();
      const kaliStart = performance.now();
      const videoRect = this.getVideoRect();

      const activeSlotIndices = new Set<number>();

      for (const person of trackedPeople) {
        const slotIdx = person.slotIndex;
        activeSlotIndices.add(slotIdx);

        // Solve body kinematics
        let solvedPose = undefined;
        if (person.landmarks && person.worldLandmarks && person.worldLandmarks.length >= 25) {
          solvedPose = KinematicsSolver.solve(
            person.worldLandmarks,
            person.landmarks,
            video
          );
        }

        // Align and apply to this avatar slot
        this.vrmManager.updateSlotAlignment(
          slotIdx,
          person.landmarks,
          videoRect,
          this.canvasCssWidth,
          this.canvasCssHeight
        );

        if (solvedPose) {
          this.vrmManager.applySlotPose(slotIdx, solvedPose, 0.35);
        }

        // Articulated hands for person if detected
        let leftHandActive = false;
        let rightHandActive = false;
        if (gestureResult && gestureResult.landmarks && gestureResult.landmarks.length > 0) {
          const hands = gestureResult.landmarks;
          const rWrist = person.landmarks[16];
          const lWrist = person.landmarks[15];

          for (const handLms of hands) {
            const wristPt = handLms[0];
            const dRight = rWrist ? Math.hypot(wristPt.x - rWrist.x, wristPt.y - rWrist.y) : Infinity;
            const dLeft = lWrist ? Math.hypot(wristPt.x - lWrist.x, wristPt.y - lWrist.y) : Infinity;

            if (dRight < 0.20 && dRight < dLeft) {
              const solved = KinematicsSolver.solveHand(handLms, "Left"); // User physical right = Avatar Left
              if (solved) {
                this.vrmManager.applySlotHandPose(slotIdx, solved, "Left");
                leftHandActive = true;
              }
            } else if (dLeft < 0.20) {
              const solved = KinematicsSolver.solveHand(handLms, "Right");
              if (solved) {
                this.vrmManager.applySlotHandPose(slotIdx, solved, "Right");
                rightHandActive = true;
              }
            }
          }
        }

        // Smoothly relax hands that left the frame instead of freezing their last finger pose
        if (!leftHandActive) this.vrmManager.relaxSlotHandPose(slotIdx, "Left");
        if (!rightHandActive) this.vrmManager.relaxSlotHandPose(slotIdx, "Right");

        this.vrmManager.setSlotActive(slotIdx, this.costumeChosen);
      }

      this.updateFaceBoxes(this.costumeChosen ? [] : trackedPeople);
      this.updateNowWearing(trackedPeople);

      // Deactivate unused slots
      for (let s = 0; s < 4; s++) {
        if (!activeSlotIndices.has(s)) {
          this.vrmManager.setSlotActive(s, false);
        }
      }

      this.perfTracker.recordKalidokitTime(performance.now() - kaliStart);

      // Render Three.js multi-avatar scene
      this.vrmManager.render();
      this.perfTracker.recordVrmTime(performance.now() - vrmStart);

      // 5. Draw Optional Skeletons
      if (this.enableBodySkeleton && trackedPeople.length > 0) {
        for (const p of trackedPeople) {
          this.drawSkeleton(p.landmarks);
        }
      }
      if (this.enableHandSkeleton && gestureResult && gestureResult.landmarks) {
        this.drawHandSkeletons(gestureResult.landmarks);
      }

      // 6. Record Performance Report
      this.perfTracker.markFrame(performance.now() - frameStart);
      const report = this.perfTracker.getReport();
      this.fpsOverall.textContent = `${report.overallFps} FPS`;
      this.fpsOverall.className = report.overallFps >= 22 ? "hud-val" : report.overallFps >= 16 ? "hud-val warning" : "hud-val danger";
      this.fpsPose.textContent = `${report.poseMs} ms`;
      this.fpsGesture.textContent = `${report.gestureMs} ms`;
      this.fpsKalidokit.textContent = `${report.kalidokitMs} ms`;
      this.fpsVrm.textContent = `${report.vrmMs} ms`;
      this.fpsDownscale.textContent = `${report.downscaleMs} ms`;
      this.fpsTotalFrame.textContent = `${report.totalFrameMs} ms (~${Math.round(1000 / (report.totalFrameMs || 16))} FPS)`;
    } else {
      if (this.vrmManager.ready) {
        this.vrmManager.render();
      }
    }

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  /**
   * Draws what the student sees (mirrored webcam + 3D outfits) into a new canvas for the photo.
   */
  private captureMirrorFrame(): HTMLCanvasElement {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvasCssWidth;
    const h = this.canvasCssHeight;

    const frame = document.createElement("canvas");
    frame.width = Math.round(w * dpr);
    frame.height = Math.round(h * dpr);
    const ctx = frame.getContext("2d")!;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#080b12";
    ctx.fillRect(0, 0, w, h);

    // Webcam, cropped and mirrored exactly like the on-screen video (object-fit: cover + scaleX(-1))
    const rect = this.getVideoRect();
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.videoElement, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    // WebGL clears its buffer after every frame, so render right before copying it
    this.vrmManager.render();
    ctx.drawImage(this.threeCanvas, 0, 0, w, h);

    // Collection stickers on top, placed exactly as on screen
    this.stickers.drawInto(ctx, w, h);

    return frame;
  }

  /**
   * Places a gold "Human detected" box around each tracked face.
   * Pose landmarks 0-10 are the face points (nose, eyes, ears, mouth).
   */
  private updateFaceBoxes(people: TrackedPerson[]): void {
    const rect = this.getVideoRect();
    this.faceBoxes.forEach((box, i) => {
      const face = people[i]?.landmarks.slice(0, 11).filter((p) => (p.visibility ?? 1) >= 0.5);
      if (!face || face.length < 3) {
        box.style.display = "none";
        return;
      }
      // Video is mirrored on screen, so x is flipped
      const xs = face.map((p) => rect.x + (1 - p.x) * rect.width);
      const ys = face.map((p) => rect.y + p.y * rect.height);
      const width = Math.max(60, (Math.max(...xs) - Math.min(...xs)) * 1.5);
      const height = width * 1.3;
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = ys.reduce((sum, y) => sum + y, 0) / ys.length;
      const top = cy - height * 0.55;
      box.style.display = "block";
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.transform = `translate(${cx - width / 2}px, ${top}px)`;
      // Near the top edge the label would hit the mirror frame, so it moves under the box
      box.classList.toggle("label-below", top < FACE_LABEL_ROOM_PX);
    });
  }

  /**
   * Shows what is being worn at the bottom of the screen during try-on.
   * One person: their outfit, then the collection. Several people: the collection, then everyone's outfit.
   */
  private updateNowWearing(people: TrackedPerson[]): void {
    const category = this.vrmManager.category;
    const show = this.costumeChosen && category !== null && people.length > 0 &&
      !this.carousel.visible && !this.photoBooth.busy;
    this.nowWearing.classList.toggle("visible", show);
    if (!show || !category) return;

    const outfits = [...people]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((p) => category.models[p.slotIndex]?.name)
      .filter((name): name is string => !!name);
    const single = outfits.length === 1;
    const title = single ? outfits[0] : category.name;
    const subtitle = single ? category.name : outfits.join(" · ");

    // Only touch the DOM when the text changes (this runs every frame)
    if (this.nowWearingName.textContent !== title) this.nowWearingName.textContent = title;
    if (this.nowWearingCollection.textContent !== subtitle) this.nowWearingCollection.textContent = subtitle;
  }

  private drawSkeleton(landmarks: NormalizedLandmark[]): void {
    const ctx = this.canvasCtx;
    const { x: ox, y: oy, width, height } = this.getVideoRect();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";

    for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
      const p1 = landmarks[startIdx];
      const p2 = landmarks[endIdx];

      if (p1 && p2 && (p1.visibility ?? 1) >= 0.5 && (p2.visibility ?? 1) >= 0.5) {
        const x1 = ox + (1 - p1.x) * width;
        const y1 = oy + p1.y * height;
        const x2 = ox + (1 - p2.x) * width;
        const y2 = oy + p2.y * height;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    for (const lm of landmarks) {
      if ((lm.visibility ?? 1) >= 0.5) {
        const x = ox + (1 - lm.x) * width;
        const y = oy + lm.y * height;

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#38bdf8";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  private drawHandSkeletons(hands: NormalizedLandmark[][]): void {
    const ctx = this.canvasCtx;
    const { x: ox, y: oy, width, height } = this.getVideoRect();

    for (const hand of hands) {
      if (hand.length < 21) continue;

      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(74, 222, 128, 0.85)";

      for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
        const p1 = hand[startIdx];
        const p2 = hand[endIdx];

        if (p1 && p2) {
          const x1 = ox + (1 - p1.x) * width;
          const y1 = oy + p1.y * height;
          const x2 = ox + (1 - p2.x) * width;
          const y2 = oy + p2.y * height;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      for (let i = 0; i < hand.length; i++) {
        const pt = hand[i];
        const x = ox + (1 - pt.x) * width;
        const y = oy + pt.y * height;

        ctx.beginPath();
        const isFingertip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        ctx.arc(x, y, isFingertip ? 4 : 3, 0, 2 * Math.PI);
        ctx.fillStyle = isFingertip ? "#facc15" : "#4ade80";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
}

// Start application
window.addEventListener("DOMContentLoaded", () => {
  const app = new MagicMirrorApp();
  app.init();
});
