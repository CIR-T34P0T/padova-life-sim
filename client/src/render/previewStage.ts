// A small, self-contained 3D stage for looking at one character: the
// character creator's live preview and the character lab use it. Same light
// setup as the piazza (worldScene.ts) so colours match what players see
// in the world. Renders on demand.

import * as THREE from "three";
import type { CharacterModel } from "./avatar/index.ts";
import { NIGHT_UNIFORMS } from "./nightShading.ts";

export type PreviewView = "body" | "face" | "upper";

/** Where each named view sits on the continuous zoom scale of frameAt. */
export const VIEW_ZOOM: Record<PreviewView, number> = { body: 0, upper: 1, face: 2 };

export class PreviewStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  private readonly turntable = new THREE.Group();
  private readonly shadow: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement, options: { antialias?: boolean; background?: number | null } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: options.antialias ?? true, alpha: options.background === null, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (options.background !== null) this.scene.background = new THREE.Color(options.background ?? 0xe9dfd1);
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x7a6a58, 1.6);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(2.5, 4, 3.5);
    this.scene.add(hemi, sun, this.turntable);
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.scene.add(this.shadow);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Puts a character on the turntable (removing any other). */
  show(character: CharacterModel): void {
    this.turntable.clear();
    this.turntable.add(character.root);
  }

  /** Aims the camera at the character. `yaw` turns the character (radians). */
  frame(character: CharacterModel, view: PreviewView, yaw: number): void {
    this.frameAt(character, VIEW_ZOOM[view], yaw);
  }

  /**
   * Continuous framing for zooming: 0 = whole body, 1 = upper body, 2 = face.
   * Values in between blend target and framing, so wheel / pinch zoom moves
   * smoothly towards the face instead of into the middle of the body.
   */
  frameAt(character: CharacterModel, zoom: number, yaw: number): void {
    this.turntable.rotation.y = yaw;
    const m = character.metrics;
    const shots = [
      { y: m.height * 0.52, span: m.height + 0.35, lift: 0.1 },
      { y: (m.headCentreY + m.waistY) / 2 + 0.05, span: 0.95, lift: 0.02 },
      { y: m.headCentreY - 0.01, span: 0.42, lift: 0.02 },
    ];
    const z = THREE.MathUtils.clamp(zoom, 0, 2);
    const i = Math.min(1, Math.floor(z));
    const t = z - i;
    const a = shots[i]!;
    const b = shots[i + 1]!;
    const y = THREE.MathUtils.lerp(a.y, b.y, t);
    // Blend the span geometrically so each step of zoom feels the same size.
    const span = a.span * Math.pow(b.span / a.span, t);
    const lift = THREE.MathUtils.lerp(a.lift, b.lift, t);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = span / 2 / Math.tan(fov / 2) / Math.min(1, this.camera.aspect * 1.1);
    this.camera.position.set(0, y + lift, distance);
    this.camera.lookAt(0, y, 0);
  }

  render(): void {
    // Studio light: never the world's night self-light on characters (M7b).
    NIGHT_UNIFORMS.uCharacterLift.value = 0;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.turntable.clear();
    this.renderer.dispose();
  }
}
