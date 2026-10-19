// Garment patterns drawn at runtime into small canvas textures (no image
// files, so no licensing questions). One texture per pattern and colour,
// shared by every character wearing it. UVs on garments are in metres / 0.1,
// so one tile is 10 cm on every body.

import * as THREE from "three";
import { mixHex, shadeHex } from "@padova/shared";

const SIZE = 128;
const textures = new Map<string, THREE.Texture>();

/** Readable contrast colour for a base colour: light on dark, dark on light. */
function contrast(base: string): string {
  const value = Number.parseInt(base.slice(1), 16);
  const luminance = (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luminance > 0.55 ? shadeHex(base, -0.32) : mixHex(base, "#fbf6ec", 0.78);
}

function draw(ctx: CanvasRenderingContext2D, pattern: string, base: string): void {
  const accent = contrast(base);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = accent;
  switch (pattern) {
    case "stripes":
      for (let y = 0; y < SIZE; y += 32) ctx.fillRect(0, y, SIZE, 12);
      break;
    case "checks": {
      ctx.globalAlpha = 0.55;
      for (let x = 0; x < SIZE; x += 32) ctx.fillRect(x, 0, 14, SIZE);
      for (let y = 0; y < SIZE; y += 32) ctx.fillRect(0, y, SIZE, 14);
      ctx.globalAlpha = 1;
      break;
    }
    case "dots":
      for (let y = 0; y < SIZE; y += 32) {
        for (let x = 0; x < SIZE; x += 32) {
          const offset = (y / 32) % 2 === 0 ? 0 : 16;
          ctx.beginPath();
          ctx.arc(x + offset + 8, y + 16, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case "geometric": {
      // A bold repeating print: diamonds and triangles in two accent colours.
      const second = mixHex(base, "#d4a12e", 0.65);
      for (let y = 0; y < SIZE; y += 64) {
        for (let x = 0; x < SIZE; x += 64) {
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.moveTo(x + 32, y + 4);
          ctx.lineTo(x + 60, y + 32);
          ctx.lineTo(x + 32, y + 60);
          ctx.lineTo(x + 4, y + 32);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = second;
          ctx.beginPath();
          ctx.moveTo(x + 32, y + 18);
          ctx.lineTo(x + 46, y + 32);
          ctx.lineTo(x + 32, y + 46);
          ctx.lineTo(x + 18, y + 32);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = shadeHex(base, -0.18);
          for (const [tx, ty] of [[0, 0], [64, 0], [0, 64], [64, 64]] as const) {
            ctx.beginPath();
            ctx.moveTo(x + tx - 10, y + ty);
            ctx.lineTo(x + tx, y + ty - 10);
            ctx.lineTo(x + tx + 10, y + ty);
            ctx.lineTo(x + tx, y + ty + 10);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

export function patternTexture(pattern: string, base: string): THREE.Texture {
  const key = `${pattern}:${base}`;
  let texture = textures.get(key);
  if (!texture) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx, pattern, base);
    texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    textures.set(key, texture);
  }
  return texture;
}
