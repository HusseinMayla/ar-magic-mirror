import { CategoryDefinition } from "./categories";

/**
 * The chosen collection's sticker sheet: a full-frame transparent PNG (1920x1080) laid over the
 * camera and costume, under the UI. The stickers sit along the left and right edges, so the student
 * in the middle stays clear.
 *
 * It is scaled to fit the screen without cropping (object-fit: contain), so stickers at the very
 * edge are never cut off on a 16:10 laptop, and it is NOT mirrored, so any text on them reads correctly.
 * drawInto() paints it into the photo with exactly the same placement.
 */
export class StickerLayer {
  private element: HTMLImageElement;
  private image: HTMLImageElement | null = null;

  constructor(container: HTMLElement) {
    this.element = document.createElement("img");
    this.element.className = "sticker-layer";
    this.element.alt = "";
    container.appendChild(this.element);
  }

  /** Switches to a collection's stickers. Call once its costumes have loaded, so both appear together. */
  public setCategory(category: CategoryDefinition): void {
    const image = new Image();
    image.src = category.stickers;
    this.image = image;
    this.element.src = category.stickers;
  }

  public setVisible(visible: boolean): void {
    this.element.classList.toggle("visible", visible && this.image !== null);
  }

  /** Paints the stickers into a canvas of the given size, placed exactly as on screen. */
  public drawInto(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const image = this.image;
    if (!image || !image.complete || image.naturalWidth === 0 || !this.element.classList.contains("visible")) return;

    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }
}
