export type SubsystemStatus = "healthy" | "warning" | "error" | "recovering";

export interface SubsystemHealth {
  name: string;
  status: SubsystemStatus;
  message: string;
  retryCount: number;
  lastCheckTime: number;
}

export class SystemHealthMonitor {
  private healthMap: Map<string, SubsystemHealth> = new Map();
  private listeners: ((healths: SubsystemHealth[]) => void)[] = [];
  private retryHandlers: Map<string, () => Promise<boolean>> = new Map();
  private retryTimers: Map<string, number> = new Map();

  constructor() {
    this.registerSubsystem("camera", "Webcam Device");
    this.registerSubsystem("mediapipe", "MediaPipe Vision Tasks");
  }

  public registerSubsystem(id: string, name: string): void {
    this.healthMap.set(id, {
      name,
      status: "healthy",
      message: "Ready",
      retryCount: 0,
      lastCheckTime: performance.now()
    });
  }

  public setRetryHandler(id: string, handler: () => Promise<boolean>): void {
    this.retryHandlers.set(id, handler);
  }

  public updateStatus(id: string, status: SubsystemStatus, message: string): void {
    const sub = this.healthMap.get(id);
    if (!sub) return;

    const previousStatus = sub.status;
    sub.status = status;
    sub.message = message;
    sub.lastCheckTime = performance.now();

    this.notify();

    // Trigger auto-recovery if transitioning to error
    if (status === "error" && previousStatus !== "recovering" && previousStatus !== "error") {
      this.triggerAutoRecovery(id);
    }
  }

  public getSubsystems(): SubsystemHealth[] {
    return Array.from(this.healthMap.values());
  }

  public subscribe(listener: (healths: SubsystemHealth[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.getSubsystems());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    const data = this.getSubsystems();
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  public triggerAutoRecovery(id: string): void {
    const sub = this.healthMap.get(id);
    const handler = this.retryHandlers.get(id);
    if (!sub || !handler) return;

    if (this.retryTimers.has(id)) {
      window.clearTimeout(this.retryTimers.get(id));
    }

    sub.status = "recovering";
    sub.retryCount++;
    const delay = Math.min(1000 * Math.pow(1.5, sub.retryCount - 1), 5000);
    sub.message = `Auto-retrying recovery attempt #${sub.retryCount} in ${(delay / 1000).toFixed(1)}s...`;
    this.notify();

    const timer = window.setTimeout(async () => {
      this.retryTimers.delete(id);
      sub.message = `Executing recovery attempt #${sub.retryCount}...`;
      this.notify();
      try {
        const success = await handler();
        if (success) {
          sub.status = "healthy";
          sub.message = "Recovered successfully";
          sub.retryCount = 0;
        } else {
          sub.status = "error";
          sub.message = `Recovery attempt #${sub.retryCount} failed`;
          this.triggerAutoRecovery(id);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sub.status = "error";
        sub.message = `Recovery failed: ${msg}`;
        this.triggerAutoRecovery(id);
      }
      this.notify();
    }, delay);

    this.retryTimers.set(id, timer);
  }
}
