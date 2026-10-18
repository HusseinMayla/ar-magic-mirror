/**
 * Gold gesture effects drawn on one 2D canvas over the mirror:
 * - trail(): a small gold marker that follows the browsing fingers and draws a thin comet trail
 *   behind them, so the student can see where their hand is moving.
 * - burst(): a spark burst and a gold ring when a gesture completes (open palm, thumbs up, peace sign).
 * - confettiShower(): paper confetti from both bottom corners and the top when a photo is taken.
 *
 * Kept cheap for the integrated GPU: 1x pixel density, pre-rendered sprites instead of
 * shadowBlur, a particle cap, and the animation loop only runs while something is visible.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  glint: boolean;
  gravity: number;
}

interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  flip: number; // tumbling phase: the piece narrows and widens like paper turning over
  flipSpeed: number;
  sway: number; // phase of the side-to-side flutter
  w: number;
  h: number;
  color: string;
  life: number;
}

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  maxRadius: number;
}

interface TrailHead {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  lastSeen: number;
}

export type BurstSize = "large" | "medium";

const MAX_PARTICLES = 160;
const MAX_CONFETTI = 220;
const CONFETTI_GRAVITY = 520; // px/s²
const CONFETTI_DRAG = 0.3; // fraction of speed left after one second (paper catches the air)
const HEAD_FADE_MS = 250; // the finger marker fades this long after the fingers were last seen
const TRAIL_MS = 400; // how far back in time the comet trail reaches
const GRAVITY = 220; // px/s², burst sparks drift down a little as they fade
const DRAG = 0.12; // fraction of speed left after one second

const BURSTS: Record<BurstSize, { count: number; minSpeed: number; maxSpeed: number; ring: number }> = {
  large: { count: 44, minSpeed: 180, maxSpeed: 520, ring: 140 },
  medium: { count: 28, minSpeed: 140, maxSpeed: 380, ring: 100 }
};

export class GestureParticles {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private glowSprite: HTMLCanvasElement;
  private glintSprite: HTMLCanvasElement;

  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private head: TrailHead | null = null;
  private trailPoints: TrailPoint[] = [];
  private confetti: Confetto[] = [];

  private running = false;
  private lastFrameTime = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gesture-fx";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.glowSprite = GestureParticles.makeGlowSprite();
    this.glintSprite = GestureParticles.makeGlintSprite();

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /**
   * Call on every frame the swiping fingers are seen, with their position in screen pixels.
   */
  public trail(x: number, y: number): void {
    const now = performance.now();
    if (!this.head || now - this.head.lastSeen > HEAD_FADE_MS) {
      this.head = { x, y, targetX: x, targetY: y, lastSeen: now };
    } else {
      this.head.targetX = x;
      this.head.targetY = y;
      this.head.lastSeen = now;
    }
    this.start();
  }

  /**
   * A spark burst and an expanding gold ring at a screen position.
   */
  public burst(x: number, y: number, size: BurstSize = "medium"): void {
    const spec = BURSTS[size];
    this.rings.push({ x, y, age: 0, maxAge: 0.6, maxRadius: spec.ring });

    if (!this.reducedMotion) {
      for (let i = 0; i < spec.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = spec.minSpeed + Math.random() * (spec.maxSpeed - spec.minSpeed);
        const life = 0.7 + Math.random() * 0.5;
        this.addParticle({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 60, // slight lift so the burst feels like it rises
          life,
          maxLife: life,
          size: 4 + Math.random() * 6,
          glint: Math.random() < 0.3,
          gravity: GRAVITY
        });
      }
    }
    this.start();
  }

  /**
   * A confetti celebration: two cannons fire up from the bottom corners and a shower falls from the top.
   * Gold, ivory and bronze from the mirror palette, plus the collection's own colour.
   */
  public confettiShower(accent?: string): void {
    if (this.reducedMotion) return;
    const colors = ["#d4a85f", "#e3b864", "#f3f2f2", "#b68235", accent ?? "#cfc8bd", accent ?? "#d4a85f"];
    const W = this.canvas.width;
    const H = this.canvas.height;
    const piece = (x: number, y: number, vx: number, vy: number): Confetto => ({
      x,
      y,
      vx,
      vy,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 12,
      flip: Math.random() * Math.PI * 2,
      flipSpeed: 6 + Math.random() * 8,
      sway: Math.random() * Math.PI * 2,
      w: 7 + Math.random() * 6,
      h: 11 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 2.6 + Math.random() * 1.2
    });

    for (const side of [-1, 1]) {
      // Cannon at a bottom corner, aimed up and inward
      const originX = side < 0 ? 70 : W - 70;
      for (let i = 0; i < 70; i++) {
        const angle = (-62 + (Math.random() - 0.5) * 30) * (Math.PI / 180);
        const speed = 900 + Math.random() * 650;
        this.addConfetto(piece(originX, H - 60, -side * Math.cos(angle) * speed, Math.sin(angle) * speed));
      }
    }
    for (let i = 0; i < 60; i++) {
      this.addConfetto(piece(Math.random() * W, -20 - Math.random() * 260, (Math.random() - 0.5) * 80, 80 + Math.random() * 160));
    }
    this.start();
  }

  private addConfetto(c: Confetto): void {
    if (this.confetti.length >= MAX_CONFETTI) this.confetti.shift();
    this.confetti.push(c);
  }

  private addParticle(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (time: number): void => {
    const dt = Math.min(0.05, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;

    this.updateHead(time);
    this.trailPoints = this.trailPoints.filter((p) => time - p.t < TRAIL_MS);
    this.updateParticles(dt);
    this.updateConfetti(dt, time);
    for (const ring of this.rings) ring.age += dt;
    this.rings = this.rings.filter((ring) => ring.age < ring.maxAge);

    this.draw(time);

    if (this.particles.length > 0 || this.rings.length > 0 || this.head || this.trailPoints.length > 0 || this.confetti.length > 0) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  };

  private updateHead(now: number): void {
    const head = this.head;
    if (!head) return;
    if (now - head.lastSeen > HEAD_FADE_MS) {
      this.head = null;
      return;
    }

    // Ease toward the latest finger position: smooths MediaPipe jitter and fills the gaps between camera frames
    const prevX = head.x;
    const prevY = head.y;
    head.x += (head.targetX - head.x) * 0.4;
    head.y += (head.targetY - head.y) * 0.4;
    this.trailPoints.push({ x: head.x, y: head.y, t: now });

    if (this.reducedMotion) return;

    // A few tiny glints left in place along the path: they twinkle on the trail instead of flying off
    const distance = Math.hypot(head.x - prevX, head.y - prevY);
    const count = Math.min(2, Math.floor(distance / 14) + (Math.random() < 0.15 ? 1 : 0));
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const life = 0.3 + Math.random() * 0.2;
      this.addParticle({
        x: prevX + (head.x - prevX) * t + (Math.random() - 0.5) * 6,
        y: prevY + (head.y - prevY) * t + (Math.random() - 0.5) * 6,
        vx: 0,
        vy: 0,
        life,
        maxLife: life,
        size: 3 + Math.random() * 4,
        glint: Math.random() < 0.4,
        gravity: 0
      });
    }
  }

  private updateParticles(dt: number): void {
    const drag = Math.pow(DRAG, dt);
    for (const p of this.particles) {
      p.vx *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private updateConfetti(dt: number, now: number): void {
    const drag = Math.pow(CONFETTI_DRAG, dt);
    for (const c of this.confetti) {
      c.vx *= drag;
      c.vy = c.vy * drag + CONFETTI_GRAVITY * dt;
      // Falling paper drifts side to side
      c.x += (c.vx + Math.sin(now / 1000 * 3 + c.sway) * 40) * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
      c.flip += c.flipSpeed * dt;
      c.life -= dt;
    }
    this.confetti = this.confetti.filter((c) => c.life > 0 && c.y < this.canvas.height + 40);
  }

  private drawConfetti(): void {
    const ctx = this.ctx;
    for (const c of this.confetti) {
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      const tumble = Math.cos(c.flip); // -1..1: the piece turns edge-on and back
      ctx.globalAlpha = Math.min(1, c.life / 0.6);
      ctx.fillStyle = c.color;
      ctx.setTransform(cos, sin, -sin * tumble, cos * tumble, c.x, c.y);
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawTrail(now);
    this.drawConfetti();

    // Normal blending, not additive: additive sparks wash out to white over a bright hall.
    // Contrast comes from the dark fringe baked into the sprites instead.
    for (const p of this.particles) {
      const fade = p.life / p.maxLife;
      const size = p.glint ? p.size * (0.6 + fade) : p.size;
      ctx.globalAlpha = fade;
      ctx.drawImage(p.glint ? this.glintSprite : this.glowSprite, p.x - size / 2, p.y - size / 2, size, size);
    }

    for (const ring of this.rings) {
      const k = ring.age / ring.maxAge;
      const eased = 1 - Math.pow(1 - k, 3);
      const radius = 12 + ring.maxRadius * eased;
      const width = 3 * (1 - k) + 1.5;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      // A faint dark under-stroke keeps the gold ring visible on a light wall
      ctx.strokeStyle = "rgba(14, 12, 10, 0.3)";
      ctx.lineWidth = width + 3;
      ctx.stroke();
      ctx.strokeStyle = "#d4a85f";
      ctx.lineWidth = width;
      ctx.stroke();
    }

    // Finger marker: a gold glow with a star at its centre, fading out once the fingers are lost
    if (this.head) {
      const fade = 1 - (now - this.head.lastSeen) / HEAD_FADE_MS;
      ctx.globalAlpha = Math.max(0, fade);
      ctx.drawImage(this.glowSprite, this.head.x - 20, this.head.y - 20, 40, 40);
      ctx.drawImage(this.glintSprite, this.head.x - 11, this.head.y - 11, 22, 22);
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Comet trail: a gold line through the recent finger positions, thick and bright at the fingers,
   * thinning and fading toward the tail. A faint dark under-stroke keeps it visible on a light wall.
   */
  private drawTrail(now: number): void {
    const pts = this.trailPoints;
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const pass of ["shadow", "gold"] as const) {
      for (let i = 1; i < pts.length; i++) {
        const k = Math.min(1, (now - pts[i].t) / TRAIL_MS); // 0 at the fingers, 1 at the tail
        const width = 1 + 4 * (1 - k);
        ctx.globalAlpha = (1 - k) * (pass === "shadow" ? 0.3 : 0.95);
        ctx.strokeStyle = pass === "shadow" ? "#0e0c0a" : "#e3b864";
        ctx.lineWidth = pass === "shadow" ? width + 3 : width;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private resize(): void {
    // 1x pixel density: the sparks are soft, and it keeps the fill cost low on the integrated GPU
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /** Soft round glow: warm white core, gold body, and a faint dark fringe so it reads on light backgrounds. */
  private static makeGlowSprite(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255, 246, 225, 1)");
    grad.addColorStop(0.22, "rgba(240, 204, 130, 1)");
    grad.addColorStop(0.45, "rgba(212, 168, 95, 0.75)");
    grad.addColorStop(0.7, "rgba(90, 62, 22, 0.22)");
    grad.addColorStop(1, "rgba(14, 12, 10, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  /** Four-point gold star glint, echoing the diamonds on the mirror frame. */
  private static makeGlintSprite(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const star = () => {
      g.beginPath();
      g.moveTo(32, 4);
      g.quadraticCurveTo(35, 29, 60, 32);
      g.quadraticCurveTo(35, 35, 32, 60);
      g.quadraticCurveTo(29, 35, 4, 32);
      g.quadraticCurveTo(29, 29, 32, 4);
    };
    // Dark soft edge, drawn once here (shadowBlur is too slow to use per frame)
    g.shadowColor = "rgba(30, 20, 6, 0.75)";
    g.shadowBlur = 6;
    g.fillStyle = "#e3b864";
    star();
    g.fill();
    g.shadowBlur = 0;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 13);
    grad.addColorStop(0, "rgba(255, 252, 240, 1)");
    grad.addColorStop(1, "rgba(255, 236, 190, 0)");
    g.fillStyle = grad;
    star();
    g.fill();
    return c;
  }
}
