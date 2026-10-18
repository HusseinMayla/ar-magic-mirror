// MediaPipe runs fully offline: the engine and models are served from public/mediapipe, so the
// booth works without internet. The wasm files are copied from node_modules/@mediapipe/tasks-vision/wasm
// and must match the version in package.json (1.0.1) — re-copy them when bumping the package.
export const MEDIAPIPE_WASM_URL = "/mediapipe/wasm";

export const POSE_MODEL_URL = "/mediapipe/models/pose_landmarker_lite.task";
export const GESTURE_MODEL_URL = "/mediapipe/models/gesture_recognizer.task";
