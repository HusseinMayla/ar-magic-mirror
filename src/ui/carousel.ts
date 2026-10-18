import { CATEGORIES, CategoryDefinition } from "./categories";
import { icon } from "./icons";
import { holoGlyph, holoGuide } from "./attractLoop";

// Seconds to hold each gesture (matches the timings in GestureFSM)
const HIGH_FIVE_HOLD_S = 3;
const SELECT_HOLD_S = 3;

// Browsing turns the cards one slot over, like scrolling a touch screen. These match the
// .coverflow-card.left/.center/.right poses in index.html.
const SLOT_PX = 345; // gap between card centres
const SIDE_TILT_DEG = 18;
const SIDE_OPACITY = 0.6;
const CENTER_LIFT_PX = 46; // the cards sit a little below the middle, under the title
const SIDE_LIFT_PX = 40;
const SLIDE_MS = 420;
const SLIDE_EASING = "cubic-bezier(0.2, 0.8, 0.25, 1)"; // --ease-out

type SlotPos = -2 | -1 | 0 | 1 | 2;
const SLOT_CLASS: Record<string, SlotPos> = { left: -1, center: 0, right: 1 };

export interface CategoryCarouselOptions {
  container: HTMLElement;
  initialCategoryId?: string;
  onSelectCategory: (category: CategoryDefinition) => void;
  onClose?: () => void;
}

export class CategoryCarousel {
  private container: HTMLElement;
  private onSelectCategory: (category: CategoryDefinition) => void;
  private onClose?: () => void;

  private overlayElement!: HTMLElement;
  private cardsContainer!: HTMLElement;
  private highFiveIndicator!: HTMLElement;
  private highFiveCircle!: SVGCircleElement;
  private highFiveText!: HTMLElement;

  private currentIndex: number = 0;
  private isOpen: boolean = false;
  private currentSelectProgress: number = 0;

  constructor(options: CategoryCarouselOptions) {
    this.container = options.container;
    this.onSelectCategory = options.onSelectCategory;
    this.onClose = options.onClose;

    if (options.initialCategoryId) {
      const idx = CATEGORIES.findIndex((c) => c.id === options.initialCategoryId);
      if (idx !== -1) this.currentIndex = idx;
    }

    this.createDom();
    this.renderCards();
  }

  private createDom(): void {
    // 1. Fullscreen overlay. The arrows are always visible: they are the click alternative to swiping.
    this.overlayElement = document.createElement("div");
    this.overlayElement.id = "coverflow-overlay";
    this.overlayElement.className = "coverflow-overlay hidden";
    this.overlayElement.innerHTML = `
      <div class="coverflow-header">
        <span class="kicker">Try-On Catalog</span>
        <h2 class="coverflow-title">Choose Outfit Collection</h2>
      </div>

      <div class="coverflow-stage" id="coverflow-stage">
        <!-- Rendered 3D cards dynamically inserted here -->
      </div>

      <button class="carousel-nav-btn prev-btn" id="mouse-prev-btn" aria-label="Previous collection">${icon("chevron-left", 34)}</button>
      <button class="carousel-nav-btn next-btn" id="mouse-next-btn" aria-label="Next collection">${icon("chevron-right", 34)}</button>

      <div class="coverflow-footer">
        ${holoGuide("two-fingers", "swipe")}
        <span>Two fingers up, move left or right to browse</span>
      </div>
    `;

    // 2. High-Five Proximity Ring Indicator (visible during live mirror when holding palm)
    this.highFiveIndicator = document.createElement("div");
    this.highFiveIndicator.id = "highfive-indicator";
    this.highFiveIndicator.className = "highfive-indicator hidden";
    this.highFiveIndicator.innerHTML = `
      <svg class="highfive-svg" viewBox="0 0 100 100">
        <circle class="highfive-bg-circle" cx="50" cy="50" r="44" />
        <circle class="highfive-fg-circle" id="highfive-fg-circle" cx="50" cy="50" r="44" pathLength="1" />
      </svg>
      <div class="highfive-content">
        <span class="highfive-glyph">${holoGlyph("palm")}</span>
        <span class="highfive-text" id="highfive-text">${HIGH_FIVE_HOLD_S}s</span>
      </div>
      <span class="highfive-label">Hold to open menu</span>
    `;

    this.container.appendChild(this.overlayElement);
    this.container.appendChild(this.highFiveIndicator);

    this.cardsContainer = this.overlayElement.querySelector("#coverflow-stage")!;
    this.highFiveCircle = this.highFiveIndicator.querySelector("#highfive-fg-circle")!;
    this.highFiveText = this.highFiveIndicator.querySelector("#highfive-text")!;

    // Setup mouse button clicks
    this.overlayElement.querySelector("#mouse-prev-btn")?.addEventListener("click", () => this.navigate("left"));
    this.overlayElement.querySelector("#mouse-next-btn")?.addEventListener("click", () => this.navigate("right"));
  }

  public open(): void {
    this.isOpen = true;
    this.overlayElement.classList.remove("hidden");
    this.currentSelectProgress = 0;
    this.renderCards();
  }

  public close(): void {
    this.isOpen = false;
    this.overlayElement.classList.add("hidden");
    this.currentSelectProgress = 0;
    this.onClose?.();
  }

  public navigate(direction: "left" | "right"): void {
    if (!this.isOpen) return;
    const total = CATEGORIES.length;
    if (direction === "right") {
      this.currentIndex = (this.currentIndex + 1) % total;
    } else {
      this.currentIndex = (this.currentIndex - 1 + total) % total;
    }
    this.currentSelectProgress = 0;

    // The card on the trailing edge leaves the stage: keep it to animate it out
    const leaving = this.cardsContainer.querySelector<HTMLElement>(
      direction === "right" ? ".coverflow-card.left:not(.leaving)" : ".coverflow-card.right:not(.leaving)"
    );
    this.renderCards();
    this.slideIn(direction, leaving);
  }

  /**
   * The cards were just rebuilt one collection over. Each one starts in the pose of the slot it
   * came from (position, tilt, size, opacity) and turns into its own, so the row rotates like a
   * coverflow instead of jumping. The card that left the row turns out past the edge and fades.
   */
  private slideIn(direction: "left" | "right", leaving: HTMLElement | null): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const center = this.cardsContainer.querySelector<HTMLElement>(".coverflow-card.center");
    const side = this.cardsContainer.querySelector<HTMLElement>(".coverflow-card.left");
    if (!center || !side) return;
    const widths = { center: center.offsetWidth, side: side.offsetWidth };

    // "right" = next collection: the row moves left, so every card comes from one slot to its right
    const step = direction === "right" ? 1 : -1;
    const animate = (card: HTMLElement, from: SlotPos, to: SlotPos, fill: FillMode = "none") =>
      card.animate(
        [this.slotPose(from, card.offsetWidth, widths), this.slotPose(to, card.offsetWidth, widths)],
        { duration: SLIDE_MS, easing: SLIDE_EASING, fill }
      );

    this.cardsContainer.querySelectorAll<HTMLElement>(".coverflow-card:not(.leaving)").forEach((card) => {
      const to = SLOT_CLASS[[...card.classList].find((c) => c in SLOT_CLASS) ?? "center"];
      animate(card, (to + step) as SlotPos, to);
    });

    if (leaving) {
      // Marked so a quick next step doesn't pick it up again; the next render clears it anyway
      leaving.classList.add("leaving");
      leaving.style.pointerEvents = "none";
      this.cardsContainer.prepend(leaving); // behind the new cards
      const from = -step as SlotPos;
      animate(leaving, from, (from - step) as SlotPos, "forwards").finished.then(() => leaving.remove(), () => {});
    }
  }

  /**
   * One slot's pose for a card of the given width. Side cards are smaller than the centre card,
   * so a card in a slot of the other size is scaled to match. Slots ±2 are just off the row, invisible.
   */
  private slotPose(pos: SlotPos, cardWidth: number, widths: { center: number; side: number }): Keyframe {
    const slotWidth = pos === 0 ? widths.center : widths.side;
    const lift = pos === 0 ? CENTER_LIFT_PX : SIDE_LIFT_PX;
    const tilt = -Math.sign(pos) * SIDE_TILT_DEG;
    return {
      transform: `translate(calc(-50% + ${pos * SLOT_PX}px), calc(-50% + ${lift}px)) perspective(1200px) rotateY(${tilt}deg) scale(${slotWidth / cardWidth})`,
      opacity: pos === 0 ? 1 : Math.abs(pos) === 1 ? SIDE_OPACITY : 0
    };
  }

  public selectCurrent(): void {
    if (!this.isOpen) return;
    const selected = CATEGORIES[this.currentIndex];
    this.close();
    this.onSelectCategory(selected);
  }

  /**
   * Moves the carousel to a category without selecting it (used when the admin forces one).
   */
  public setCurrentCategory(categoryId: string): void {
    const idx = CATEGORIES.findIndex((c) => c.id === categoryId);
    if (idx === -1) return;
    this.currentIndex = idx;
    this.renderCards();
  }

  /**
   * Updates High-Five progress ring (0.0 to 1.0) on live video.
   * @param screenPos Palm position in screen pixels (already mirrored and mapped onto the video)
   */
  public updateHighFiveProgress(progress: number, screenPos: { x: number; y: number } | null): void {
    if (progress <= 0 || !screenPos || this.isOpen) {
      this.highFiveIndicator.classList.add("hidden");
      return;
    }

    this.highFiveIndicator.classList.remove("hidden");

    // Centre the 200px ring on the palm
    this.highFiveIndicator.style.transform = `translate(${screenPos.x - 100}px, ${screenPos.y - 100}px)`;

    // The ring uses pathLength="1", so the offset is simply the fraction left
    this.highFiveCircle.style.strokeDashoffset = `${1 - progress}`;
    this.highFiveText.textContent = `${Math.ceil((1 - progress) * HIGH_FIVE_HOLD_S)}s`;
  }

  /**
   * Updates the thumbs-up confirmation border progress around the center card.
   */
  public updateSelectProgress(progress: number): void {
    if (!this.isOpen) return;
    this.currentSelectProgress = progress;

    const centerCard = this.cardsContainer.querySelector(".coverflow-card.center");
    if (!centerCard) return;

    const progressSvg = centerCard.querySelector(".card-progress-border") as SVGRectElement | null;
    const progressText = centerCard.querySelector(".victory-progress-text") as HTMLElement | null;

    if (progressSvg) {
      // The border uses pathLength="1", so it fits any card size without a hand-measured perimeter
      progressSvg.style.strokeDashoffset = `${1 - progress}`;
    }

    if (progressText) {
      progressText.textContent = this.selectHintText(progress);
    }
  }

  private selectHintText(progress: number): string {
    return `Hold to select · ${Math.ceil((1 - progress) * SELECT_HOLD_S)}s`;
  }

  private renderCards(): void {
    const total = CATEGORIES.length;
    const prevIdx = (this.currentIndex - 1 + total) % total;
    const nextIdx = (this.currentIndex + 1) % total;

    const prevCat = CATEGORIES[prevIdx];
    const centerCat = CATEGORIES[this.currentIndex];
    const nextCat = CATEGORIES[nextIdx];

    const sideCard = (cat: CategoryDefinition, side: "left" | "right", idx: number) => `
      <div class="coverflow-card ${side}" data-index="${idx}" style="--accent: ${cat.accentColor};">
        <div class="card-art" aria-hidden="true">${cat.icon}</div>
        <h3 class="card-name">${cat.name}</h3>
        <div class="card-models-count">${cat.models.length} Outfits</div>
      </div>
    `;

    this.cardsContainer.innerHTML = `
      ${sideCard(prevCat, "left", prevIdx)}

      <!-- Centre card: clicking it selects, like holding thumbs up -->
      <div class="coverflow-card center" data-index="${this.currentIndex}" style="--accent: ${centerCat.accentColor};"
           role="button" tabindex="0" aria-label="Select ${centerCat.name}">
        <!-- Thumbs-up hold progress runs around this border -->
        <svg class="card-border-svg" aria-hidden="true">
          <rect class="card-base-border" />
          <rect class="card-progress-border" pathLength="1" />
        </svg>

        <div class="center-content">
          <div class="card-tag">Active Collection</div>
          <div class="card-art" aria-hidden="true">${centerCat.icon}</div>
          <h2 class="card-name-large">${centerCat.name}</h2>
          <p class="card-tagline-large">${centerCat.tagline}</p>

          <div class="models-grid">
            ${centerCat.models.map((m, i) => `
              <div class="model-item">
                <span class="chip-slot">P${i + 1}</span>
                <span class="chip-name">${m.name}</span>
              </div>
            `).join("")}
          </div>

          <div class="select-hint">
            ${holoGuide("thumbs-up", "pulse")}
            <span class="victory-progress-text">${this.selectHintText(0)}</span>
          </div>
        </div>
      </div>

      ${sideCard(nextCat, "right", nextIdx)}
    `;

    // Click on left/right card brings it to center; click on the centre card selects it
    this.cardsContainer.querySelector(".coverflow-card.left")?.addEventListener("click", () => this.navigate("left"));
    this.cardsContainer.querySelector(".coverflow-card.right")?.addEventListener("click", () => this.navigate("right"));
    const center = this.cardsContainer.querySelector<HTMLElement>(".coverflow-card.center");
    center?.addEventListener("click", () => this.selectCurrent());
    center?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.selectCurrent();
      }
    });
  }

  public get visible(): boolean {
    return this.isOpen;
  }

  public get selectProgress(): number {
    return this.currentSelectProgress;
  }

  public get currentCategory(): CategoryDefinition {
    return CATEGORIES[this.currentIndex];
  }
}
