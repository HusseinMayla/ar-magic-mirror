/**
 * The attract screen: a "hologram" tutorial of the one thing a newcomer has to do, raise an open
 * hand and hold it, shown over the live (dimmed) camera so passers-by still see themselves.
 * The later gestures are taught where they're used (menu footer, selected card, try-on hint).
 *
 * - "attract": nobody in front of the mirror. Big title and the tutorial, centred.
 * - "coach": someone is standing there but hasn't opened the menu yet. The same tutorial,
 *   small and at the bottom, so it doesn't cover them.
 * - "off": the menu is open or a costume is on.
 *
 * All motion is CSS (transform/opacity only, cheap on an integrated GPU); this class only restarts
 * the hold animation, and its timer runs only while the tutorial is on screen.
 */

export type AttractMode = "off" | "attract" | "coach";
export type GlyphName = "palm" | "two-fingers" | "thumbs-up" | "victory";

// One play of the tutorial: the hand rises, the ring fills over 3s (the real hold in GestureFSM), it pops
const LOOP_MS = 4500;

// Filled shapes for each hand. They are drawn three times (halo, edge, dark body), and the
// dark body covers the inner edges, so overlapping shapes read as one outlined hand.
const SHAPES: Record<GlyphName, { viewBox: string; shapes: string }> = {
  palm: {
    viewBox: "0 0 64 80",
    shapes: `<rect x="14" y="34" width="36" height="34" rx="13"/>
      <rect x="15" y="12" width="8.5" height="34" rx="4.25"/><rect x="24.5" y="6" width="8.5" height="40" rx="4.25"/>
      <rect x="34" y="10" width="8.5" height="36" rx="4.25"/><rect x="43" y="20" width="7.5" height="28" rx="3.75"/>
      <rect x="6" y="36" width="9" height="26" rx="4.5" transform="rotate(-38 15 60)"/>
      <rect x="20" y="62" width="24" height="16" rx="4"/>`
  },
  "two-fingers": {
    viewBox: "0 0 64 80",
    shapes: `<rect x="14" y="34" width="36" height="34" rx="13"/>
      <rect x="15" y="10" width="8.5" height="36" rx="4.25"/><rect x="24.5" y="4" width="8.5" height="42" rx="4.25"/>
      <rect x="34" y="29" width="8.5" height="14" rx="4.25"/><rect x="43" y="32" width="7.5" height="12" rx="3.75"/>
      <rect x="8" y="42" width="9" height="18" rx="4.5" transform="rotate(-25 16 60)"/>
      <rect x="20" y="62" width="24" height="16" rx="4"/>`
  },
  victory: {
    viewBox: "0 0 64 80",
    shapes: `<rect x="14" y="34" width="36" height="34" rx="13"/>
      <rect x="15" y="10" width="8.5" height="36" rx="4.25" transform="rotate(-14 19 44)"/>
      <rect x="24.5" y="4" width="8.5" height="42" rx="4.25" transform="rotate(12 29 44)"/>
      <rect x="34" y="29" width="8.5" height="14" rx="4.25"/><rect x="43" y="32" width="7.5" height="12" rx="3.75"/>
      <rect x="8" y="42" width="9" height="18" rx="4.5" transform="rotate(-25 16 60)"/>
      <rect x="20" y="62" width="24" height="16" rx="4"/>`
  },
  "thumbs-up": {
    viewBox: "0 0 64 80",
    shapes: `<rect x="16" y="34" width="32" height="32" rx="11"/>
      <rect x="30" y="34" width="24" height="9" rx="4.5"/><rect x="30" y="43" width="24" height="9" rx="4.5"/>
      <rect x="30" y="52" width="22" height="9" rx="4.5"/><rect x="30" y="60" width="18" height="8" rx="4"/>
      <rect x="18" y="8" width="11" height="34" rx="5.5"/>
      <rect x="20" y="62" width="22" height="16" rx="4"/>`
  }
};

/** A gesture drawn as a glowing hologram (dark fill, gold edge and halo). */
export function holoGlyph(name: GlyphName): string {
  const { viewBox, shapes } = SHAPES[name];
  return `<svg class="holo-glyph" viewBox="${viewBox}" aria-hidden="true">
    <g class="holo-halo">${shapes}</g><g class="holo-edge">${shapes}</g><g class="holo-body">${shapes}</g>
  </svg>`;
}

/**
 * A small looping hologram of one gesture, for the place where that gesture is used
 * (menu footer, selected card, try-on hint). "pulse" breathes, "swipe" glides sideways.
 */
export function holoGuide(name: GlyphName, motion: "pulse" | "swipe"): string {
  return `<span class="holo-guide guide-${motion}" aria-hidden="true"><span class="holo-guide-glyph">${holoGlyph(name)}</span></span>`;
}

export class AttractLoop {
  private root: HTMLElement;
  private scene!: HTMLElement;
  private mode: AttractMode = "off";
  private timer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = `
      <div class="attract-head">
        <div class="kicker">Magic Mirror</div>
        <div class="idle-title">Try on a costume</div>
        <div class="attract-sub">No touching. Just your hands.</div>
      </div>
      <div class="attract-main">
        <div class="attract-stage">
          <div class="attract-scene">
            <svg class="attract-ring" viewBox="0 0 100 100" aria-hidden="true">
              <circle class="attract-ring-base" cx="50" cy="50" r="47" />
              <circle class="attract-ring-fill" cx="50" cy="50" r="47" pathLength="1" />
            </svg>
            <div class="attract-glyph">${holoGlyph("palm")}</div>
          </div>
        </div>
        <div class="gilded-pill attract-caption" role="status">
          <span class="attract-text">Raise an open hand and hold it</span>
          <span class="attract-note">Opens the costume menu</span>
        </div>
      </div>
    `;
    this.scene = this.root.querySelector(".attract-scene")!;
  }

  /** Called every frame; does nothing unless the mode changed. */
  public setMode(mode: AttractMode): void {
    if (mode === this.mode) return;
    this.mode = mode;

    this.root.classList.toggle("visible", mode !== "off");
    this.root.classList.toggle("coach", mode === "coach");
    this.stopTimer();
    if (mode === "off") return;

    this.replay();
    this.timer = window.setInterval(() => this.replay(), LOOP_MS);
  }

  /** Re-adding "active" after a reflow restarts the CSS animations. */
  private replay(): void {
    this.scene.classList.remove("active");
    void this.scene.offsetWidth;
    this.scene.classList.add("active");
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
