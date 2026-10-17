// Third-person orbit camera that follows a target point.

import * as THREE from "three";

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Horizontal angle around the target; 0 = camera south of the player looking north. */
  yaw = 0;
  /** Vertical angle above the horizon, radians. */
  pitch = 0.62;
  distance = 11;

  private readonly focus = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private hasFocus = false;

  static readonly MIN_DISTANCE = 4;
  static readonly MAX_DISTANCE = 26;
  static readonly MIN_PITCH = 0.2;
  static readonly MAX_PITCH = 1.35;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 200);
  }

  setTarget(x: number, z: number): void {
    this.desiredFocus.set(x, 1.1, z);
    if (!this.hasFocus) {
      this.focus.copy(this.desiredFocus);
      this.hasFocus = true;
    }
  }

  rotate(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaPitch, CameraRig.MIN_PITCH, CameraRig.MAX_PITCH);
  }

  zoom(factor: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, CameraRig.MIN_DISTANCE, CameraRig.MAX_DISTANCE);
  }

  /** World-space forward and right on the ground plane, used for WASD/joystick. */
  groundAxes(): { forward: { x: number; z: number }; right: { x: number; z: number } } {
    return {
      forward: { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) },
      right: { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) },
    };
  }

  update(dtSeconds: number): void {
    // Smoothly follow the player instead of snapping.
    const follow = 1 - Math.exp(-dtSeconds * 8);
    this.focus.lerp(this.desiredFocus, follow);
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * horizontal,
      this.focus.y + Math.sin(this.pitch) * this.distance,
      this.focus.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.focus);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // Three.js FOV is vertical, so a portrait phone sees a very narrow slice
    // of the world. Widen it to keep roughly 50° horizontally, capped at 75°
    // vertically to avoid fisheye distortion.
    const horizontal = THREE.MathUtils.degToRad(50);
    const vertical = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / aspect));
    this.camera.fov = THREE.MathUtils.clamp(vertical, 50, 75);
    this.camera.updateProjectionMatrix();
  }
}
