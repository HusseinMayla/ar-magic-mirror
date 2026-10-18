import {
  FilesetResolver,
  PoseLandmarker,
  PoseLandmarkerResult
} from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_URL, POSE_MODEL_URL } from "./wasm";

export type PoseLockState = "search" | "track";

export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private isReady: boolean = false;
  private actualDelegate: "GPU" | "CPU" = "CPU";

  // Dynamic tracking confidence setting (default 0.70)
  private minTrackingConfidence: number = 0.70;
  private minPoseDetectionConfidence: number = 0.70;
  private minPosePresenceConfidence: number = 0.70;
  private maxPoses: number = 4;

  // Lock state instrumentation
  private currentState: PoseLockState = "search";
  private transitionCountLastSecond: number = 0;
  private transitionWindowStart: number = performance.now();
  private transitionsPerSec: number = 0;

  public async initialize(trackingConfidence: number = 0.70, maxPoses: number = 4): Promise<void> {
    this.minTrackingConfidence = trackingConfidence;
    this.minPoseDetectionConfidence = trackingConfidence;
    this.minPosePresenceConfidence = trackingConfidence;
    this.maxPoses = maxPoses;

    // Release the previous instance's GPU resources when re-initializing (auto-recovery)
    this.isReady = false;
    this.landmarker?.close();
    this.landmarker = null;

    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

    const modelUrl = POSE_MODEL_URL;

    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: this.maxPoses,
        minPoseDetectionConfidence: this.minPoseDetectionConfidence,
        minPosePresenceConfidence: this.minPosePresenceConfidence,
        minTrackingConfidence: this.minTrackingConfidence,
        outputSegmentationMasks: false
      });
      this.actualDelegate = "GPU";
      console.log(`[PoseTracker] Initialized with delegate: GPU, numPoses: ${this.maxPoses}, conf: ${this.minTrackingConfidence}`);
    } catch (gpuErr) {
      console.warn("[PoseTracker] GPU delegate failed, falling back to CPU:", gpuErr);
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numPoses: this.maxPoses,
        minPoseDetectionConfidence: this.minPoseDetectionConfidence,
        minPosePresenceConfidence: this.minPosePresenceConfidence,
        minTrackingConfidence: this.minTrackingConfidence,
        outputSegmentationMasks: false
      });
      this.actualDelegate = "CPU";
    }

    this.isReady = true;
  }

  public async reconfigure(conf?: number, numPoses?: number): Promise<void> {
    if (!this.landmarker) return;
    if (typeof conf === "number") {
      this.minTrackingConfidence = conf;
      this.minPoseDetectionConfidence = conf;
      this.minPosePresenceConfidence = conf;
    }
    if (typeof numPoses === "number") {
      this.maxPoses = numPoses;
    }
    await this.landmarker.setOptions({
      minPoseDetectionConfidence: this.minPoseDetectionConfidence,
      minPosePresenceConfidence: this.minPosePresenceConfidence,
      minTrackingConfidence: this.minTrackingConfidence,
      numPoses: this.maxPoses
    });
    console.log(`[PoseTracker] Reconfigured: numPoses=${this.maxPoses}, conf=${this.minTrackingConfidence}`);
  }

  public detect(input: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): PoseLandmarkerResult | null {
    if (!this.isReady || !this.landmarker) return null;

    const result = this.landmarker.detectForVideo(input, timestampMs);

    // Instrument search vs track state
    const hasLock = Boolean(result && result.landmarks && result.landmarks.length > 0 && result.landmarks[0].length >= 33);
    const newState: PoseLockState = hasLock ? "track" : "search";

    const now = performance.now();
    if (now - this.transitionWindowStart >= 1000) {
      this.transitionsPerSec = this.transitionCountLastSecond;
      this.transitionCountLastSecond = 0;
      this.transitionWindowStart = now;
    }

    if (this.currentState === "track" && newState === "search") {
      this.transitionCountLastSecond++;
      console.log(`[PoseTracker State] Transition: TRACK -> SEARCH (Lost Lock) [Transitions/sec: ${this.transitionsPerSec}]`);
    } else if (this.currentState === "search" && newState === "track") {
      console.log(`[PoseTracker State] Transition: SEARCH -> TRACK (Acquired Lock)`);
    }

    this.currentState = newState;
    return result;
  }

  public get ready(): boolean {
    return this.isReady;
  }

  public get delegate(): "GPU" | "CPU" {
    return this.actualDelegate;
  }

}

// MediaPipe 33 Landmark Connections for visual overlay
export const POSE_CONNECTIONS = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  // Left leg
  [23, 25], [25, 27], [27, 29], [27, 31],
  // Right leg
  [24, 26], [26, 28], [28, 30], [28, 32],
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10]
];
