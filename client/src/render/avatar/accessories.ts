// Glasses and headwear (head space). Headwear that covers hair follows the
// shared visibility rules (shared/src/appearance/layers.ts): the renderer
// draws the covering, and the hair builder leaves out what is covered.

import * as THREE from "three";
import { mixHex, shadeHex, type AppearanceConfig, type HairVisibility } from "@padova/shared";
import { clamp, lerp, paintWith, rgb, ringTube, smoothstep, standardise, sweep, waves } from "./geometry.ts";
import type { FaceLayout, HeadShape } from "./head.ts";
import { shell } from "./hair.ts";
import type { BodyMetrics } from "./metrics.ts";

const elevation = (d: THREE.Vector3) => Math.asin(clamp(d.y, -1, 1));
const azimuth = (d: THREE.Vector3) => Math.atan2(d.x, d.z);
const dirFrom = (az: number, el: number) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
const headNormal = (head: HeadShape, p: THREE.Vector3) =>
  new THREE.Vector3(p.x / (head.hw * head.hw), p.y / (head.hh * head.hh), p.z / (head.hd * head.hd)).normalize();

/** Edge elevation of a hat or wrap for an azimuth: front, side, back values blended smoothly. */
function edge(front: number, side: number, back: number, d: THREE.Vector3): number {
  const a = Math.abs(azimuth(d));
  return a < Math.PI / 2 ? lerp(front, side, smoothstep(0, Math.PI / 2, a)) : lerp(side, back, smoothstep(Math.PI / 2, Math.PI, a));
}

export function buildHeadwear(
  config: AppearanceConfig,
  head: HeadShape,
  metrics: BodyMetrics,
  hairThickness: (d: THREE.Vector3) => number,
  colourHex: string,
  hair: HairVisibility,
): THREE.BufferGeometry[] {
  const kind = config.outfit.headwear;
  const base = rgb(colourHex);
  const shade = rgb(shadeHex(colourHex, -0.08));
  const pieces: THREE.BufferGeometry[] = [];
  switch (kind) {
    case "beanie": {
      pieces.push(
        shell(head, {
          weight: (d) => smoothstep(edge(0.42, 0.2, -0.3, d) - 0.03, edge(0.42, 0.2, -0.3, d) + 0.03, elevation(d)),
          thickness: (d) => {
            const rel = elevation(d) - edge(0.42, 0.2, -0.3, d);
            const cuff = rel < 0.22 ? 0.007 : 0;
            return 0.017 + cuff + 0.015 * smoothstep(0.8, 1.4, elevation(d)) * smoothstep(0.2, -0.6, d.z);
          },
          colour: (d) => {
            const rel = elevation(d) - edge(0.42, 0.2, -0.3, d);
            if (rel < 0.22) return Math.sin(azimuth(d) * 40) > 0 ? shade : base;
            return base;
          },
        }),
      );
      break;
    }
    case "cap": {
      const capEdge = (d: THREE.Vector3) => edge(0.62, 0.28, 0.0, d);
      pieces.push(
        shell(head, {
          weight: (d) => smoothstep(capEdge(d) - 0.03, capEdge(d) + 0.03, elevation(d)),
          thickness: () => 0.014,
          colour: (d) => (Math.abs(Math.sin(azimuth(d) * 3)) < 0.04 ? shade : base),
        }),
      );
      // Brim: a curved strip in front of the forehead.
      const positions: number[] = [];
      const indices: number[] = [];
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const a = lerp(-1.25, 1.25, i / n);
        const p = head.point(dirFrom(a, 0.66));
        p.addScaledVector(headNormal(head, p), 0.014);
        const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.075 * Math.cos(a * 0.85) ** 0.6 + 0.004);
        positions.push(p.x, p.y, p.z, p.x + out.x, p.y - 0.012 - 0.008 * Math.cos(a), p.z + out.z);
        if (i > 0) {
          const k = (i - 1) * 2;
          indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const brim = new THREE.BufferGeometry();
      brim.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      brim.setIndex(indices);
      brim.computeVertexNormals();
      pieces.push(paintWith(standardise(brim), () => shade));
      const top = head.point(new THREE.Vector3(0, 1, 0));
      const button = new THREE.SphereGeometry(0.008, 8, 6);
      button.translate(top.x, top.y + 0.014, top.z);
      pieces.push(paintWith(standardise(button), () => shade));
      break;
    }
    case "headwrap": {
      const wrapEdge = (d: THREE.Vector3) => edge(0.4, 0.1, -0.62, d);
      pieces.push(
        shell(head, {
          weight: (d) => smoothstep(wrapEdge(d) - 0.04, wrapEdge(d) + 0.04, elevation(d)),
          thickness: (d) => 0.02 + 0.05 * smoothstep(0.4, 1.3, elevation(d)) * smoothstep(0.5, -0.5, d.z) + 0.004 * waves(d.x, d.y, d.z, 8),
          colour: (d) => (Math.sin((d.y * 1.4 + d.x * 0.8) * 14) > 0.55 ? shade : base),
        }),
      );
      // Knot at the front of the crown.
      const p = head.point(dirFrom(0, 0.95));
      const n = headNormal(head, p);
      const knot = new THREE.IcosahedronGeometry(0.03, 1);
      knot.scale(1.25, 0.9, 0.9);
      knot.translate(p.x + n.x * 0.04, p.y + n.y * 0.04, p.z + n.z * 0.04);
      pieces.push(paintWith(standardise(knot), (q) => (q.y > p.y + 0.045 ? base : shade)));
      break;
    }
    case "headscarf": {
      // Covers the head and neck, leaving the face oval open.
      const faceOpen = (d: THREE.Vector3) => {
        const a = Math.abs(azimuth(d)) / 0.98;
        const e = (elevation(d) + 0.2) / 0.62;
        return a * a + e * e;
      };
      // Over the ears too (they stick out from the head).
      const ear = (d: THREE.Vector3) => Math.exp(-(((Math.abs(azimuth(d)) - 1.57) / 0.32) ** 2)) * Math.exp(-(((elevation(d) + 0.12) / 0.38) ** 2));
      pieces.push(
        shell(head, {
          weight: (d) => smoothstep(0.92, 1.08, faceOpen(d)),
          thickness: (d) => 0.011 + 0.008 * smoothstep(0.8, 1.4, elevation(d)) + 0.02 * ear(d),
          colour: () => base,
        }),
      );
      // Drape: hugs the chin and neck, then falls over the shoulders and chest.
      const below = (y: number) => y - metrics.headCentreY;
      const keys: [number, number, number, number][] = [
        // y (head space), rx, rz, cz
        [-head.hh * 0.92, head.hw * 0.8, head.hd * 0.74, -0.014],
        [below(metrics.chinY - 0.03), metrics.neckRadius * 1.5, metrics.neckRadius * 1.55, -0.004],
        [below(metrics.shoulderY + 0.012), metrics.shoulderHalfWidth * 0.66, metrics.chestHalfDepth * 0.82 + 0.02, 0],
        [below(metrics.shoulderY - 0.04), metrics.shoulderHalfWidth * 0.86, metrics.chestHalfDepth + metrics.bust * 0.5 + 0.026, 0.004],
        [below(metrics.shoulderY - 0.1), metrics.shoulderHalfWidth * 0.84, metrics.chestHalfDepth + metrics.bust * 0.7 + 0.03, 0.006],
      ];
      const rings = [];
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const u = (i / steps) * (keys.length - 1);
        const k = Math.min(keys.length - 2, Math.floor(u));
        const f = u - k;
        const s = f * f * (3 - 2 * f);
        const [y0, rx0, rz0, cz0] = keys[k]!;
        const [y1, rx1, rz1, cz1] = keys[k + 1]!;
        rings.push({ y: lerp(y0, y1, s), rx: lerp(rx0, rx1, s), rz: lerp(rz0, rz1, s), cz: lerp(cz0, cz1, s) });
      }
      const yTop = keys[0]![0];
      const yBottom = keys[keys.length - 1]![0];
      pieces.push(
        ringTube(rings, {
          segments: 32,
          colour: (r, angle) => (r === steps || Math.sin(angle * 6 + 0.5) > 0.88 ? shade : base),
          displace: (_r, angle, y) => 0.004 * Math.sin(angle * 6 + 0.5) * smoothstep(yTop, yBottom, y),
        }),
      );
      break;
    }
    case "headband": {
      if (hair === "hidden") break;
      const path: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const b = lerp(-1.45, 1.45, i / 16);
        const tilt = 0.32;
        const d = new THREE.Vector3(Math.sin(b), Math.cos(b) * Math.cos(tilt), Math.cos(b) * Math.sin(tilt)).normalize();
        const p = head.point(d);
        path.push(p.addScaledVector(headNormal(head, p), hairThickness(d) + 0.005));
      }
      pieces.push(sweep(path, { radial: 6, radius: () => 0.0048, flatten: 2.6, up: (i) => headNormal(head, path[i]!), colour: () => base, capStart: true, capEnd: true }));
      break;
    }
    case "hair-clips": {
      if (hair === "hidden") break;
      for (const [az, el] of [[0.75, 0.85], [0.95, 0.7]] as const) {
        const d = dirFrom(az, el);
        const p = head.point(d);
        const n = headNormal(head, p);
        p.addScaledVector(n, hairThickness(d) + 0.003);
        const clip = new THREE.CapsuleGeometry(0.0035, 0.016, 3, 6);
        clip.rotateZ(Math.PI / 2 - 0.5);
        clip.lookAt(n);
        clip.translate(p.x, p.y, p.z);
        pieces.push(paintWith(standardise(clip), () => rgb(mixHex(colourHex, "#ffffff", 0.15))));
      }
      break;
    }
    default:
      break;
  }
  return pieces;
}

export function buildGlasses(config: AppearanceConfig, head: HeadShape, layout: FaceLayout): THREE.BufferGeometry[] {
  if (config.outfit.glasses === "none") return [];
  const frame = rgb("#2a2426");
  const pieces: THREE.BufferGeometry[] = [];
  const square = config.outfit.glasses === "square";
  const halfW = layout.eyeWidth * (square ? 0.7 : 0.62);
  const halfH = square ? layout.eyeWidth * 0.48 : layout.eyeWidth * 0.6;
  const inner: THREE.Vector3[] = [];
  const outer: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const cx = side * layout.eyeX;
    const cy = layout.eyeY + layout.eyeHeight * 0.05;
    const surface = head.front(cx, cy);
    const centre = surface.position.clone().addScaledVector(surface.normal, 0.013);
    const outline: THREE.Vector3[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let x = Math.cos(a);
      let y = Math.sin(a);
      if (square) {
        // Rounded rectangle via a superellipse.
        x = Math.sign(x) * Math.abs(x) ** 0.4;
        y = Math.sign(y) * Math.abs(y) ** 0.4;
      }
      outline.push(new THREE.Vector3(centre.x + x * halfW, centre.y + y * halfH, centre.z - (x * side > 0 ? 0.004 * x * side : 0)));
    }
    pieces.push(sweep(outline, { radial: 5, radius: () => (square ? 0.0024 : 0.0019), closed: true, colour: () => frame }));
    inner.push(new THREE.Vector3(centre.x - side * halfW, centre.y + halfH * 0.2, centre.z));
    outer.push(new THREE.Vector3(centre.x + side * halfW, centre.y + halfH * 0.3, centre.z - 0.004));
  }
  // Bridge over the nose.
  const mid = inner[0]!.clone().lerp(inner[1]!, 0.5).add(new THREE.Vector3(0, 0.004, 0.006));
  pieces.push(sweep([inner[0]!, mid, inner[1]!], { radial: 5, radius: () => 0.0017, colour: () => frame }));
  // Temples back to the ears.
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const start = outer[i]!;
    const ear = head.point(new THREE.Vector3(side, -0.02, -0.15).normalize());
    ear.x += side * 0.012;
    const midPoint = head.point(new THREE.Vector3(side * 0.9, -0.0, 0.45).normalize());
    midPoint.x += side * 0.009;
    pieces.push(sweep([start, midPoint, ear], { radial: 4, radius: () => 0.0016, colour: () => frame, capEnd: true }));
  }
  return pieces;
}
