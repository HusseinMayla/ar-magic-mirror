import { CATEGORIES } from "./categories";
import { icon } from "./icons";

export interface AdminPanelCallbacks {
  onConfidenceChange: (conf: number) => void;
  onMaxPeopleChange: (max: number) => void;
  onOpenPalmScoreChange: (score: number) => void;
  onVictoryScoreChange: (score: number) => void;
  onThumbUpScoreChange: (score: number) => void;
  onProximityRatioChange: (ratio: number) => void;
  onVideoOpacityChange: (opacity: number) => void;
  onDownscaleToggle: (enabled: boolean) => void;
  onTelemetryToggle: (visible: boolean) => void;
  onSkeletonToggle: (body: boolean, hands: boolean) => void;
  onScaleChange: (scale: number) => void;
  onYOffsetChange: (offset: number) => void;
  onVisualModeChange: (mode: "full" | "ghost" | "hidden") => void;
  onForceCategory: (categoryId: string) => void;
  onRestartCamera: () => void;
  onSimulateCrash: () => void;
}

export class AdminPanel {
  private container: HTMLElement;
  private callbacks: AdminPanelCallbacks;

  private triggerBtn!: HTMLElement;
  private drawerElement!: HTMLElement;
  private isOpen: boolean = false;

  constructor(container: HTMLElement, callbacks: AdminPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.createDom();
  }

  private createDom(): void {
    // 1. Discreet Floating Trigger Button (Top-Right)
    this.triggerBtn = document.createElement("button");
    this.triggerBtn.id = "admin-trigger-btn";
    this.triggerBtn.className = "admin-trigger-btn";
    this.triggerBtn.innerHTML = icon("settings-2", 22);
    this.triggerBtn.title = "Open Admin Settings Panel";
    this.triggerBtn.setAttribute("aria-label", "Admin settings");
    this.container.appendChild(this.triggerBtn);

    // 2. Absolute Right-Hand Slide-Out Glass Panel
    this.drawerElement = document.createElement("div");
    this.drawerElement.id = "admin-drawer";
    this.drawerElement.className = "admin-drawer closed";
    this.drawerElement.innerHTML = `
      <div class="admin-drawer-header">
        <div class="admin-title">
          <span>⚙️ System Admin Suite</span>
        </div>
        <button class="admin-close-btn" id="admin-close-btn">✕</button>
      </div>

      <div class="admin-drawer-content">
        <!-- Section: Tracking & Multi-Person -->
        <div class="admin-section">
          <div class="admin-section-title">👥 Multi-Person & Pose Tracking</div>
          
          <div class="admin-control-row">
            <label>Max People Tracked:</label>
            <select id="admin-max-people" class="admin-select">
              <option value="1">1 Person</option>
              <option value="2">2 People</option>
              <option value="3">3 People</option>
              <option value="4" selected>4 People (Full)</option>
            </select>
          </div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>Pose Confidence Threshold:</label>
              <span id="val-pose-conf" class="slider-val">0.70</span>
            </div>
            <input type="range" id="admin-pose-conf" min="0.50" max="0.90" step="0.05" value="0.70" class="admin-slider" />
          </div>
        </div>

        <!-- Section: Gestures & Sensitivity -->
        <div class="admin-section">
          <div class="admin-section-title">✋ Gesture Sensitivity</div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>Open Palm Min Score:</label>
              <span id="val-palm-conf" class="slider-val">0.50</span>
            </div>
            <input type="range" id="admin-palm-conf" min="0.50" max="0.95" step="0.01" value="0.50" class="admin-slider" />
          </div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>Victory Min Score (photo):</label>
              <span id="val-victory-conf" class="slider-val">0.70</span>
            </div>
            <input type="range" id="admin-victory-conf" min="0.50" max="0.95" step="0.05" value="0.70" class="admin-slider" />
          </div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>Thumbs-Up Min Score (select):</label>
              <span id="val-thumbup-conf" class="slider-val">0.50</span>
            </div>
            <input type="range" id="admin-thumbup-conf" min="0.50" max="0.95" step="0.05" value="0.50" class="admin-slider" />
          </div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>High-Five Proximity (Hand Scale):</label>
              <span id="val-proximity-ratio" class="slider-val">0.16</span>
            </div>
            <input type="range" id="admin-proximity-ratio" min="0.10" max="0.30" step="0.02" value="0.16" class="admin-slider" />
          </div>
        </div>

        <!-- Section: Camera & Display -->
        <div class="admin-section">
          <div class="admin-section-title">📹 Camera & Pipeline</div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>Video Feed Opacity:</label>
              <span id="val-video-opacity" class="slider-val">85%</span>
            </div>
            <input type="range" id="admin-video-opacity" min="0" max="100" step="5" value="85" class="admin-slider" />
          </div>

          <div class="admin-toggle-row">
            <label>Downscale Inference (640w):</label>
            <input type="checkbox" id="admin-downscale-toggle" checked class="admin-toggle" />
          </div>

          <div class="admin-toggle-row">
            <label>Show Telemetry HUD:</label>
            <input type="checkbox" id="admin-hud-toggle" class="admin-toggle" />
          </div>

          <div class="admin-toggle-row">
            <label>Show Body Skeleton (33 pt):</label>
            <input type="checkbox" id="admin-body-skel-toggle" class="admin-toggle" />
          </div>

          <div class="admin-toggle-row">
            <label>Show Hand Skeleton (21 pt):</label>
            <input type="checkbox" id="admin-hand-skel-toggle" class="admin-toggle" />
          </div>
        </div>

        <!-- Section: 3D Calibration -->
        <div class="admin-section">
          <div class="admin-section-title">👗 Avatar & 3D Calibration</div>

          <div class="admin-control-row">
            <label>Visual Mode:</label>
            <select id="admin-visual-mode" class="admin-select">
              <option value="full" selected>Full Clothes (Opaque)</option>
              <option value="ghost">Ghost (Semi-Transparent)</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>Avatar Global Scale:</label>
              <span id="val-scale" class="slider-val">100%</span>
            </div>
            <input type="range" id="admin-scale" min="0.7" max="1.4" step="0.05" value="1.0" class="admin-slider" />
          </div>

          <div class="admin-control-row">
            <div class="label-with-val">
              <label>Avatar Vertical Offset (Y):</label>
              <span id="val-y-offset" class="slider-val">0.00 m</span>
            </div>
            <input type="range" id="admin-y-offset" min="-0.3" max="0.3" step="0.02" value="0.0" class="admin-slider" />
          </div>
        </div>

        <!-- Section: Manual Category Override -->
        <div class="admin-section">
          <div class="admin-section-title">🎭 Force Category</div>
          <div class="admin-control-row">
            <select id="admin-force-category" class="admin-select">
              <option value="" selected disabled>Choose a collection to put on…</option>
              ${CATEGORIES.map((c) => `<option value="${c.id}">${c.icon} ${c.name} (${c.models.length} outfits)</option>`).join("")}
            </select>
          </div>
        </div>

        <!-- Section: Diagnostics & Auto-Recovery -->
        <div class="admin-section">
          <div class="admin-section-title">🛡️ System Diagnostics</div>
          <div class="admin-btn-group">
            <button id="admin-restart-cam" class="admin-action-btn">Restart Camera</button>
            <button id="admin-sim-crash" class="admin-action-btn danger">Simulate Recovery</button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.drawerElement);
    this.bindEvents();
  }

  private bindEvents(): void {
    this.triggerBtn.addEventListener("click", () => this.toggle());
    this.drawerElement.querySelector("#admin-close-btn")?.addEventListener("click", () => this.close());

    // Max People
    const maxPeopleSelect = this.drawerElement.querySelector("#admin-max-people") as HTMLSelectElement;
    maxPeopleSelect.addEventListener("change", () => {
      this.callbacks.onMaxPeopleChange(parseInt(maxPeopleSelect.value, 10));
    });

    // Pose Confidence
    const poseConf = this.drawerElement.querySelector("#admin-pose-conf") as HTMLInputElement;
    const poseConfVal = this.drawerElement.querySelector("#val-pose-conf") as HTMLElement;
    poseConf.addEventListener("input", () => {
      const val = parseFloat(poseConf.value);
      poseConfVal.textContent = val.toFixed(2);
      this.callbacks.onConfidenceChange(val);
    });

    // Palm Confidence
    const palmConf = this.drawerElement.querySelector("#admin-palm-conf") as HTMLInputElement;
    const palmConfVal = this.drawerElement.querySelector("#val-palm-conf") as HTMLElement;
    palmConf.addEventListener("input", () => {
      const val = parseFloat(palmConf.value);
      palmConfVal.textContent = val.toFixed(2);
      this.callbacks.onOpenPalmScoreChange(val);
    });

    // Victory Confidence
    const victoryConf = this.drawerElement.querySelector("#admin-victory-conf") as HTMLInputElement;
    const victoryConfVal = this.drawerElement.querySelector("#val-victory-conf") as HTMLElement;
    victoryConf.addEventListener("input", () => {
      const val = parseFloat(victoryConf.value);
      victoryConfVal.textContent = val.toFixed(2);
      this.callbacks.onVictoryScoreChange(val);
    });

    // Thumbs-Up Confidence
    const thumbUpConf = this.drawerElement.querySelector("#admin-thumbup-conf") as HTMLInputElement;
    const thumbUpConfVal = this.drawerElement.querySelector("#val-thumbup-conf") as HTMLElement;
    thumbUpConf.addEventListener("input", () => {
      const val = parseFloat(thumbUpConf.value);
      thumbUpConfVal.textContent = val.toFixed(2);
      this.callbacks.onThumbUpScoreChange(val);
    });

    // Proximity Ratio
    const proxRatio = this.drawerElement.querySelector("#admin-proximity-ratio") as HTMLInputElement;
    const proxRatioVal = this.drawerElement.querySelector("#val-proximity-ratio") as HTMLElement;
    proxRatio.addEventListener("input", () => {
      const val = parseFloat(proxRatio.value);
      proxRatioVal.textContent = val.toFixed(2);
      this.callbacks.onProximityRatioChange(val);
    });

    // Video Opacity
    const vidOpacity = this.drawerElement.querySelector("#admin-video-opacity") as HTMLInputElement;
    const vidOpacityVal = this.drawerElement.querySelector("#val-video-opacity") as HTMLElement;
    vidOpacity.addEventListener("input", () => {
      const val = parseInt(vidOpacity.value, 10);
      vidOpacityVal.textContent = `${val}%`;
      this.callbacks.onVideoOpacityChange(val / 100);
    });

    // Downscale toggle
    const downscaleToggle = this.drawerElement.querySelector("#admin-downscale-toggle") as HTMLInputElement;
    downscaleToggle.addEventListener("change", () => {
      this.callbacks.onDownscaleToggle(downscaleToggle.checked);
    });

    // Telemetry HUD toggle
    const hudToggle = this.drawerElement.querySelector("#admin-hud-toggle") as HTMLInputElement;
    hudToggle.addEventListener("change", () => {
      this.callbacks.onTelemetryToggle(hudToggle.checked);
    });

    // Skeleton toggles
    const bodySkelToggle = this.drawerElement.querySelector("#admin-body-skel-toggle") as HTMLInputElement;
    const handSkelToggle = this.drawerElement.querySelector("#admin-hand-skel-toggle") as HTMLInputElement;
    const updateSkels = () => {
      this.callbacks.onSkeletonToggle(bodySkelToggle.checked, handSkelToggle.checked);
    };
    bodySkelToggle.addEventListener("change", updateSkels);
    handSkelToggle.addEventListener("change", updateSkels);

    // Visual Mode
    const visualModeSelect = this.drawerElement.querySelector("#admin-visual-mode") as HTMLSelectElement;
    visualModeSelect.addEventListener("change", () => {
      this.callbacks.onVisualModeChange(visualModeSelect.value as any);
    });

    // Scale
    const scaleInput = this.drawerElement.querySelector("#admin-scale") as HTMLInputElement;
    const scaleVal = this.drawerElement.querySelector("#val-scale") as HTMLElement;
    scaleInput.addEventListener("input", () => {
      const val = parseFloat(scaleInput.value);
      scaleVal.textContent = `${Math.round(val * 100)}%`;
      this.callbacks.onScaleChange(val);
    });

    // Y Offset
    const yOffsetInput = this.drawerElement.querySelector("#admin-y-offset") as HTMLInputElement;
    const yOffsetVal = this.drawerElement.querySelector("#val-y-offset") as HTMLElement;
    yOffsetInput.addEventListener("input", () => {
      const val = parseFloat(yOffsetInput.value);
      yOffsetVal.textContent = `${val > 0 ? "+" : ""}${val.toFixed(2)} m`;
      this.callbacks.onYOffsetChange(val);
    });

    // Force Category
    const forceCatSelect = this.drawerElement.querySelector("#admin-force-category") as HTMLSelectElement;
    forceCatSelect.addEventListener("change", () => {
      this.callbacks.onForceCategory(forceCatSelect.value);
      // Back to the placeholder, so the same collection can be forced again (a select only fires on change)
      forceCatSelect.value = "";
    });

    // Diagnostics buttons
    this.drawerElement.querySelector("#admin-restart-cam")?.addEventListener("click", () => {
      this.callbacks.onRestartCamera();
    });
    this.drawerElement.querySelector("#admin-sim-crash")?.addEventListener("click", () => {
      this.callbacks.onSimulateCrash();
    });
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public open(): void {
    this.isOpen = true;
    this.drawerElement.classList.remove("closed");
  }

  public close(): void {
    this.isOpen = false;
    this.drawerElement.classList.add("closed");
  }
}
