// Signs and inscriptions (D-033): every sign in the district is drawn once
// into one canvas atlas at runtime (no image files), and sign quads map into
// it, so all signs share one material and one draw call per building. All
// names are fictional (no real shops or institutions). Browser only: in Node
// tests the sign quads exist but have no picture.

import * as THREE from "three";
import { P } from "./palette.ts";

interface SignStyle {
  text: string;
  background: string;
  ink: string;
  /** "carved": stone inscription; "painted": shop fascia; "clock": a clock face without hands. */
  kind: "carved" | "painted" | "clock";
}

export const SIGNS: Record<string, SignStyle> = {
  hall: { text: "PALAZZO DEGLI STUDI", background: P.stone, ink: "#6b5444", kind: "carved" },
  library: { text: "BIBLIOTECA", background: P.stone, ink: "#6b5444", kind: "carved" },
  clock: { text: "", background: P.cream, ink: "#2d2a26", kind: "clock" },
  bookshop: { text: "LIBRERIA", background: P.shutter, ink: P.cream, kind: "painted" },
  pharmacy: { text: "FARMACIA", background: "#2f7d4a", ink: "#ffffff", kind: "painted" },
  residence: { text: "RESIDENZA STUDENTI", background: P.lapis, ink: P.cream, kind: "painted" },
  gelato: { text: "GELATERIA", background: P.terracotta, ink: P.cream, kind: "painted" },
  bakery: { text: "PANIFICIO", background: P.olive, ink: P.cream, kind: "painted" },
  news: { text: "GIORNALI · LIBRI", background: P.lapis, ink: P.gold, kind: "painted" },
  osteria: { text: "OSTERIA", background: P.burgundy, ink: P.gold, kind: "painted" },
  stationer: { text: "CARTOLERIA", background: P.woodDark, ink: P.cream, kind: "painted" },
  cafe: { text: "CAFFÈ DEI PORTICI", background: P.shutter, ink: P.cream, kind: "painted" },
  notices: { text: "BACHECA", background: P.woodDark, ink: P.cream, kind: "painted" },
};

export interface AtlasRegion {
  /** UV rectangle in the atlas texture. */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Packs one region per (sign, aspect) into a square canvas and draws them.
 * Call `region` for every quad first, then `texture()` once.
 */
export class SignAtlas {
  private readonly size = 1024;
  private readonly rowHeight = 96;
  private readonly entries = new Map<string, { sign: string; x: number; y: number; w: number; h: number }>();
  private cursorX = 0;
  private cursorY = 0;
  private rowHeightUsed = 0;

  region(sign: string, aspect: number): AtlasRegion {
    const key = `${sign}:${aspect.toFixed(1)}`;
    let entry = this.entries.get(key);
    if (!entry) {
      const square = SIGNS[sign]?.kind === "clock";
      const h = square ? 192 : this.rowHeight;
      const w = Math.min(this.size, Math.round(square ? h : h * aspect));
      if (this.cursorX + w > this.size) {
        this.cursorX = 0;
        this.cursorY += this.rowHeightUsed;
        this.rowHeightUsed = 0;
      }
      entry = { sign, x: this.cursorX, y: this.cursorY, w, h };
      this.cursorX += w + 2;
      this.rowHeightUsed = Math.max(this.rowHeightUsed, h + 2);
      this.entries.set(key, entry);
    }
    const s = this.size;
    return { u0: entry.x / s, u1: (entry.x + entry.w) / s, v0: 1 - (entry.y + entry.h) / s, v1: 1 - entry.y / s };
  }

  texture(): THREE.CanvasTexture | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = this.size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (const entry of this.entries.values()) drawSign(ctx, SIGNS[entry.sign], entry.x, entry.y, entry.w, entry.h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
}

function drawSign(ctx: CanvasRenderingContext2D, style: SignStyle | undefined, x: number, y: number, w: number, h: number): void {
  if (!style) {
    ctx.fillStyle = "#888";
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (style.kind === "clock") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 - 4;
    ctx.fillStyle = P.stone;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = P.gold;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.background;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = style.ink;
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const long = k % 5 === 0;
      ctx.lineWidth = long ? 4 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r * (long ? 0.7 : 0.78), cy - Math.cos(a) * r * (long ? 0.7 : 0.78));
      ctx.lineTo(cx + Math.sin(a) * r * 0.86, cy - Math.cos(a) * r * 0.86);
      ctx.stroke();
    }
    ctx.fillStyle = style.ink;
    ctx.font = `600 ${Math.round(r * 0.2)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [label, a] of [["XII", 0], ["III", 0.25], ["VI", 0.5], ["IX", 0.75]] as const) {
      ctx.fillText(label, cx + Math.sin(a * Math.PI * 2) * r * 0.52, cy - Math.cos(a * Math.PI * 2) * r * 0.52);
    }
    ctx.restore();
    return;
  }
  ctx.fillStyle = style.background;
  ctx.fillRect(x, y, w, h);
  if (style.kind === "painted") {
    ctx.strokeStyle = style.ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.globalAlpha = 1;
  }
  const serif = style.kind === "carved";
  let size = Math.round(h * (serif ? 0.6 : 0.56));
  const family = serif ? 'Georgia, "Times New Roman", serif' : '"M PLUS Rounded 1c", "Trebuchet MS", Verdana, sans-serif';
  const weight = serif ? 600 : 800;
  ctx.font = `${weight} ${size}px ${family}`;
  const spacing = serif ? 0.12 : 0.06;
  const measure = () => ctx.measureText(style.text).width + style.text.length * size * spacing;
  while (measure() > w * 0.88 && size > 8) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cursor = x + (w - measure()) / 2 + (size * spacing) / 2;
  for (const letter of style.text) {
    if (serif) {
      // Carved letters: a pale highlight under a darker cut.
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(letter, cursor + 1.5, y + h / 2 + 2);
    }
    ctx.fillStyle = style.ink;
    ctx.fillText(letter, cursor, y + h / 2);
    cursor += ctx.measureText(letter).width + size * spacing;
  }
  ctx.restore();
}
