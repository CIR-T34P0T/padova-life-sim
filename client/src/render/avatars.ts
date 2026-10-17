// PLACEHOLDER avatars: a coloured capsule with a "nose" showing facing
// direction, a floating name tag, and simple poses. Replaced by VRM
// characters in M6. Everything here is presentation driven by replicated
// state; nothing here decides gameplay.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

export interface AvatarView {
  root: THREE.Group;
  /** Mesh used for click/tap picking. `userData.playerId` names the player. */
  hitMesh: THREE.Mesh;
  setName(name: string): void;
  setAway(away: boolean): void;
  /** Activity from the server: "idle" | "sitting" | "studying" | "greeting". */
  setActivity(activity: string, seated: boolean): void;
  setSelected(selected: boolean): void;
  setHovered(hovered: boolean): void;
  /** Applies an interpolated pose. `moving` drives the walk bob. */
  setPose(x: number, z: number, rotation: number, moving: boolean, timeSeconds: number): void;
  dispose(): void;
}

const bodyGeometry = new THREE.CapsuleGeometry(0.32, 0.9, 6, 16);
const noseGeometry = new THREE.ConeGeometry(0.1, 0.25, 12);
const ringGeometry = new THREE.RingGeometry(0.42, 0.52, 32);
const selectGeometry = new THREE.RingGeometry(0.58, 0.7, 40);

const ACTIVITY_LABEL: Record<string, string> = {
  sitting: "sitting",
  studying: "studying",
  greeting: "",
};

const STANDING_BODY_Y = 0.77;
const SEATED_BODY_Y = 0.55;

export function createAvatar(id: string, hue: number, isSelf: boolean, quality: { shadows: boolean }): AvatarView {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue / 360, 0.55, 0.55),
    roughness: 0.6,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = STANDING_BODY_Y;
  body.castShadow = quality.shadows;
  body.userData.playerId = id;
  root.add(body);

  const nose = new THREE.Mesh(noseGeometry, new THREE.MeshStandardMaterial({ color: 0x2b211b }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.48, 0.34);
  body.add(nose);

  if (isSelf) {
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: 0xc4623f, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);
  }

  const selectMaterial = new THREE.MeshBasicMaterial({ color: 0xc4623f, transparent: true, opacity: 0.95, depthWrite: false });
  const selectRing = new THREE.Mesh(selectGeometry, selectMaterial);
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.position.y = 0.025;
  selectRing.visible = false;
  root.add(selectRing);

  const tagElement = document.createElement("div");
  tagElement.className = isSelf ? "name-tag is-self" : "name-tag";
  const nameSpan = document.createElement("span");
  const activitySpan = document.createElement("span");
  activitySpan.className = "name-tag-activity";
  tagElement.append(nameSpan, activitySpan);
  const tag = new CSS2DObject(tagElement);
  tag.position.set(0, 1.95, 0);
  root.add(tag);

  const bubbleElement = document.createElement("div");
  bubbleElement.className = "speech-bubble";
  bubbleElement.textContent = "Ciao!";
  const bubble = new CSS2DObject(bubbleElement);
  bubble.position.set(0, 2.45, 0);
  bubble.visible = false;
  root.add(bubble);

  let seated = false;
  let selected = false;
  let hovered = false;

  const refreshRing = () => {
    selectRing.visible = selected || hovered;
    selectMaterial.opacity = selected ? 0.95 : 0.45;
  };

  return {
    root,
    hitMesh: body,
    setName(name) {
      nameSpan.textContent = name;
    },
    setAway(away) {
      tagElement.classList.toggle("is-away", away);
      bodyMaterial.transparent = away;
      bodyMaterial.opacity = away ? 0.45 : 1;
    },
    setActivity(activity, isSeated) {
      seated = isSeated;
      const label = ACTIVITY_LABEL[activity] ?? "";
      activitySpan.textContent = label ? ` · ${label}` : "";
      bubble.visible = activity === "greeting"; // CSS2DRenderer hides the element when invisible
    },
    setSelected(value) {
      selected = value;
      refreshRing();
    },
    setHovered(value) {
      hovered = value;
      refreshRing();
    },
    setPose(x, z, rotation, moving, timeSeconds) {
      root.position.set(x, 0, z);
      root.rotation.y = rotation;
      const baseY = seated ? SEATED_BODY_Y : STANDING_BODY_Y;
      body.position.y = baseY + (moving && !seated ? Math.abs(Math.sin(timeSeconds * 10)) * 0.06 : 0);
      tag.position.y = seated ? 1.7 : 1.95;
    },
    dispose() {
      tag.removeFromParent();
      bubble.removeFromParent();
      tagElement.remove();
      bubbleElement.remove();
      bodyMaterial.dispose();
      selectMaterial.dispose();
      root.removeFromParent();
    },
  };
}
