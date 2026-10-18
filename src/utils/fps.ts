export interface BenchmarkReport {
  overallFps: number;
  poseMs: number;
  gestureMs: number;
  kalidokitMs: number;
  vrmMs: number;
  downscaleMs: number;
  totalFrameMs: number;
}

export class PerformanceTracker {
  private frameCount: number = 0;
  private lastFpsUpdate: number = performance.now();
  private currentFps: number = 0;

  // Smoothing buffers for stage durations (in ms)
  private poseDurations: number[] = [];
  private gestureDurations: number[] = [];
  private kalidokitDurations: number[] = [];
  private vrmDurations: number[] = [];
  private downscaleDurations: number[] = [];
  private frameDurations: number[] = [];
  private readonly bufferSize = 30;

  public markFrame(totalFrameElapsedMs: number): void {
    this.frameCount++;
    this.frameDurations.push(totalFrameElapsedMs);
    if (this.frameDurations.length > this.bufferSize) {
      this.frameDurations.shift();
    }

    const now = performance.now();
    const elapsed = now - this.lastFpsUpdate;

    if (elapsed >= 500) {
      this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
  }

  public recordPoseTime(ms: number): void {
    this.poseDurations.push(ms);
    if (this.poseDurations.length > this.bufferSize) {
      this.poseDurations.shift();
    }
  }

  public recordGestureTime(ms: number): void {
    this.gestureDurations.push(ms);
    if (this.gestureDurations.length > this.bufferSize) {
      this.gestureDurations.shift();
    }
  }

  public recordKalidokitTime(ms: number): void {
    this.kalidokitDurations.push(ms);
    if (this.kalidokitDurations.length > this.bufferSize) {
      this.kalidokitDurations.shift();
    }
  }

  public recordVrmTime(ms: number): void {
    this.vrmDurations.push(ms);
    if (this.vrmDurations.length > this.bufferSize) {
      this.vrmDurations.shift();
    }
  }

  public recordDownscaleTime(ms: number): void {
    this.downscaleDurations.push(ms);
    if (this.downscaleDurations.length > this.bufferSize) {
      this.downscaleDurations.shift();
    }
  }

  private getAverage(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((a, b) => a + b, 0);
    return Math.round((sum / arr.length) * 10) / 10;
  }

  public getReport(): BenchmarkReport {
    const poseMs = this.getAverage(this.poseDurations);
    const gestureMs = this.getAverage(this.gestureDurations);
    const kalidokitMs = this.getAverage(this.kalidokitDurations);
    const vrmMs = this.getAverage(this.vrmDurations);
    const downscaleMs = this.getAverage(this.downscaleDurations);
    const totalFrameMs = this.getAverage(this.frameDurations);

    return {
      overallFps: this.currentFps,
      poseMs,
      gestureMs,
      kalidokitMs,
      vrmMs,
      downscaleMs,
      totalFrameMs,
    };
  }
}
