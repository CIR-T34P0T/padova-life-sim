// PLACEHOLDER avatars: a coloured capsule with a "nose" showing facing
// direction and a floating name tag. Replaced by VRM characters in M6.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

export interface AvatarView {
  root: THREE.Group;
  setName(name: string): void;
  setAway(away: boolean): void;
  /** Applies an interpolated pose. `moving` drives the walk bob. */
  setPose(x: number, z: number, rotation: number, moving: boolean, timeSeconds: number): void;
  dispose(): void;
}

const bodyGeometry = new THREE.CapsuleGeometry(0.32, 0.9, 6, 16);
const noseGeometry = new THREE.ConeGeometry(0.1, 0.25, 12);

export function createAvatar(hue: number, isSelf: boolean, quality: { shadows: boolean }): AvatarView {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue / 360, 0.55, 0.55),
    roughness: 0.6,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.77;
  body.castShadow = quality.shadows;
  root.add(body);

  const nose = new THREE.Mesh(noseGeometry, new THREE.MeshStandardMaterial({ color: 0x2b211b }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.25, 0.34);
  root.add(nose);

  if (isSelf) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 32),
      new THREE.MeshBasicMaterial({ color: 0xc4623f, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);
  }

  const tagElement = document.createElement("div");
  tagElement.className = isSelf ? "name-tag is-self" : "name-tag";
  const tag = new CSS2DObject(tagElement);
  tag.position.set(0, 1.95, 0);
  root.add(tag);

  return {
    root,
    setName(name) {
      tagElement.textContent = name;
    },
    setAway(away) {
      tagElement.classList.toggle("is-away", away);
      bodyMaterial.transparent = away;
      bodyMaterial.opacity = away ? 0.45 : 1;
    },
    setPose(x, z, rotation, moving, timeSeconds) {
      root.position.set(x, 0, z);
      root.rotation.y = rotation;
      body.position.y = 0.77 + (moving ? Math.abs(Math.sin(timeSeconds * 10)) * 0.06 : 0);
    },
    dispose() {
      tag.removeFromParent();
      tagElement.remove();
      bodyMaterial.dispose();
      root.removeFromParent();
    },
  };
}
