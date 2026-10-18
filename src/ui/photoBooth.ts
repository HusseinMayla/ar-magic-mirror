import QRCode from "qrcode";

export interface PhotoBoothOptions {
  container: HTMLElement;
  /** Returns the current mirror view (webcam + outfits) as a canvas. */
  captureFrame: () => HTMLCanvasElement;
  /** Called the moment the photo is taken (with the flash), e.g. for the confetti. */
  onCapture?: () => void;
  /** Called when the student presses Done on the photo screen. */
  onDone?: () => void;
}

/**
 * Touchless photo capture: 3-2-1 countdown, screen flash, then a preview of the photo
 * plus a QR code to download it.
 * The photo goes through POST /api/photo (server/photoUpload.ts), which keeps a copy on the laptop
 * and holds the cloud key. Without a download link, the screen says the photo is saved instead.
 */
export class PhotoBooth {
  private container: HTMLElement;
  private captureFrame: () => HTMLCanvasElement;
  private onCapture?: () => void;
  private onDone?: () => void;

  private countdownElement!: HTMLElement;
  private countdownNumber!: HTMLElement;
  private countdownArc!: SVGCircleElement;
  private flashElement!: HTMLElement;
  private modalElement!: HTMLElement;
  private photoElement!: HTMLImageElement;
  private qrPanelElement!: HTMLElement;
  private qrTitleElement!: HTMLElement;
  private qrImageElement!: HTMLImageElement;
  private qrStatusElement!: HTMLElement;

  private readonly countdownSeconds = 3;

  private isBusy: boolean = false;
  // Bumped per photo, so a slow upload can't put its QR on the next student's photo
  private photoId: number = 0;

  constructor(options: PhotoBoothOptions) {
    this.container = options.container;
    this.captureFrame = options.captureFrame;
    this.onCapture = options.onCapture;
    this.onDone = options.onDone;
    this.createDom();
  }

  private createDom(): void {
    this.countdownElement = document.createElement("div");
    this.countdownElement.className = "photo-countdown hidden";
    this.countdownElement.innerHTML = `
      <div class="photo-countdown-ring">
        <svg class="countdown-svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="countdown-base" cx="50" cy="50" r="48" />
          <circle class="countdown-arc" id="photo-countdown-arc" cx="50" cy="50" r="48" pathLength="1" />
        </svg>
        <span class="photo-countdown-number" id="photo-countdown-number">3</span>
      </div>
      <span class="photo-countdown-hint">Strike a pose!</span>
    `;

    this.flashElement = document.createElement("div");
    this.flashElement.className = "photo-flash";

    this.modalElement = document.createElement("div");
    this.modalElement.className = "photo-modal hidden";
    this.modalElement.innerHTML = `
      <figure class="photo-plate">
        <img class="photo-modal-image" id="photo-modal-image" alt="Your Magic Mirror photo" />
      </figure>
      <div class="photo-qr-panel">
        <h2 class="photo-qr-title" id="photo-qr-title"></h2>
        <div class="photo-qr-frame">
          <img class="photo-qr-image hidden" id="photo-qr-image" alt="QR code to download the photo" />
        </div>
        <p class="photo-qr-status" id="photo-qr-status" role="status"></p>
        <button class="photo-modal-close-btn" id="photo-modal-close-btn">Done</button>
      </div>
    `;

    this.container.appendChild(this.countdownElement);
    this.container.appendChild(this.flashElement);
    this.container.appendChild(this.modalElement);

    this.countdownNumber = this.countdownElement.querySelector("#photo-countdown-number")!;
    this.countdownArc = this.countdownElement.querySelector("#photo-countdown-arc")!;
    this.photoElement = this.modalElement.querySelector("#photo-modal-image")!;
    this.qrPanelElement = this.modalElement.querySelector(".photo-qr-panel")!;
    this.qrTitleElement = this.modalElement.querySelector("#photo-qr-title")!;
    this.qrImageElement = this.modalElement.querySelector("#photo-qr-image")!;
    this.qrStatusElement = this.modalElement.querySelector("#photo-qr-status")!;
    this.modalElement.querySelector("#photo-modal-close-btn")?.addEventListener("click", () => {
      this.close();
      this.onDone?.();
    });
  }

  /**
   * Runs the countdown, takes the photo and shows the preview. Ignored while a photo is in progress.
   */
  public async start(): Promise<void> {
    if (this.isBusy) return;
    this.isBusy = true;

    this.countdownElement.classList.remove("hidden");
    for (let n = this.countdownSeconds; n >= 1; n--) {
      this.countdownNumber.textContent = `${n}`;
      // Restart the pulse and the emptying ring for each number
      this.countdownNumber.classList.remove("pulse");
      this.countdownArc.classList.remove("tick");
      void this.countdownNumber.offsetWidth;
      this.countdownNumber.classList.add("pulse");
      this.countdownArc.classList.add("tick");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.countdownElement.classList.add("hidden");

    const photo = this.captureFrame();

    this.flashElement.classList.remove("flash");
    void this.flashElement.offsetWidth;
    this.flashElement.classList.add("flash");
    this.onCapture?.();

    const jpeg = photo.toDataURL("image/jpeg", 0.92);
    this.photoElement.src = jpeg;
    this.modalElement.classList.remove("hidden");
    this.showQrForPhoto(jpeg, ++this.photoId);
  }

  private async showQrForPhoto(jpegDataUrl: string, id: number): Promise<void> {
    this.qrPanelElement.classList.remove("no-qr");
    this.qrTitleElement.textContent = "Scan to download your photo";
    this.qrImageElement.classList.add("hidden");
    this.qrStatusElement.textContent = "Saving your photo...";

    // The server keeps a copy on this laptop even when there is no internet or no cloud set up
    let savedLocally = false;
    try {
      const blob = await (await fetch(jpegDataUrl)).blob();
      const response = await fetch("/api/photo", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob
      });
      const result = (await response.json().catch(() => ({}))) as { url?: string; savedLocally?: boolean };
      savedLocally = result.savedLocally === true;
      if (!result.url) throw new Error(`No download link (HTTP ${response.status})`);

      // Drawn at 2x the 252px display size so it stays sharp on high-DPI screens
      const qrDataUrl = await QRCode.toDataURL(result.url, { width: 504, margin: 1, errorCorrectionLevel: "M" });
      if (id !== this.photoId) return;

      this.qrImageElement.src = qrDataUrl;
      this.qrImageElement.classList.remove("hidden");
      this.qrStatusElement.textContent = "Link works for 24 hours";
    } catch (err) {
      if (id !== this.photoId) return;
      // No QR code: drop the empty frame and tell the student how to get the photo instead
      this.qrPanelElement.classList.add("no-qr");
      if (savedLocally) {
        console.info("[PhotoBooth] Photo saved on this laptop only (no download link):", err);
        this.qrTitleElement.textContent = "Photo saved";
        this.qrStatusElement.textContent = "It's saved on this computer. Ask a staff member for a copy.";
      } else {
        console.error("[PhotoBooth] Could not save the photo:", err);
        this.qrTitleElement.textContent = "Photo not saved";
        this.qrStatusElement.textContent = "Couldn't save the photo. Please ask a staff member.";
      }
    }
  }

  public close(): void {
    this.modalElement.classList.add("hidden");
    this.isBusy = false;
  }

  public get busy(): boolean {
    return this.isBusy;
  }
}
