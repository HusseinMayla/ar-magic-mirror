export class CameraManager {
  private videoElement: HTMLVideoElement;
  private stream: MediaStream | null = null;

  // Fired when the browser ends the video track (camera unplugged, device taken by another app).
  // Not fired by stopCamera(): MediaStreamTrack.stop() doesn't dispatch "ended".
  public onTrackEnded: (() => void) | null = null;

  constructor(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
  }

  public async startCamera(targetWidth: number = 1280, targetHeight: number = 720): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Browser API navigator.mediaDevices.getUserMedia not supported");
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: targetWidth },
          height: { ideal: targetHeight },
          facingMode: "user"
        }
      });

      this.videoElement.srcObject = this.stream;
      this.watchForDisconnect();

      return new Promise<void>((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
    } catch (err) {
      // A lower resolution won't help if permission was refused or no camera exists
      if (err instanceof DOMException && ["NotAllowedError", "SecurityError", "NotFoundError"].includes(err.name)) {
        throw err;
      }
      console.warn("High-res video request failed, attempting fallback to standard 640x480 resolution", err);
      // Fallback
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user"
        }
      });

      this.videoElement.srcObject = this.stream;
      this.watchForDisconnect();

      return new Promise<void>((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
    }
  }

  private watchForDisconnect(): void {
    this.stream?.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => this.onTrackEnded?.());
    });
  }

  public stopCamera(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
