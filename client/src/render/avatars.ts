// PLACEHOLDER avatars built from primitives: an outfit-coloured body, a
// skin-toned head with eyes, and one of three hair shapes. They show every
// saved appearance option the current asset pipeline supports and are
// replaced by real characters in M6. Everything here is presentation driven
// by replicated state; nothing here decides gameplay.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { DEFAULT_APPEARANCE, catalogueOption, type Appearance } from "@padova/shared";

export interface AvatarView {
  root: THREE.Group;
  /** Meshes used for click/tap picking. Each has `userData.playerId`. */
  hitMeshes: THREE.Mesh[];
  /** Point for anchoring menus above the character. */
  anchor: THREE.Object3D;
  setName(name: string): void;
  setAway(away: boolean): void;
  setAppearance(appearance: Appearance): void;
  /** Activity from the server: "idle" | "sitting" | "studying" | "greeting". */
  setActivity(activity: string, seated: boolean): void;
  setSelected(selected: boolean): void;
  setHovered(hovered: boolean): void;
  /** Applies an interpolated pose. `moving` drives the walk bob. */
  setPose(x: number, z: number, rotation: number, moving: boolean, timeSeconds: number): void;
  dispose(): void;
}

const bodyGeometry = new THREE.CapsuleGeometry(0.3, 0.55, 6, 16);
const headGeometry = new THREE.SphereGeometry(0.22, 20, 16);
const eyeGeometry = new THREE.SphereGeometry(0.035, 10, 8);
const hairCapGeometry = new THREE.SphereGeometry(0.24, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
const hairLongGeometry = new THREE.BoxGeometry(0.42, 0.5, 0.12);
const hairBunGeometry = new THREE.SphereGeometry(0.1, 12, 10);
const ringGeometry = new THREE.RingGeometry(0.42, 0.52, 32);
const selectGeometry = new THREE.RingGeometry(0.58, 0.7, 40);

const ACTIVITY_LABEL: Record<string, string> = {
  sitting: "sitting",
  studying: "studying",
  greeting: "",
};

/** Figure height offsets: standing vs seated (the whole figure lowers). */
const STAND_Y = 0;
const SEAT_Y = -0.22;

const colourOf = (field: keyof Appearance, id: string, fallback: string) =>
  new THREE.Color(catalogueOption(field, id)?.colour ?? catalogueOption(field, DEFAULT_APPEARANCE[field])?.colour ?? fallback);

export function createAvatar(id: string, appearance: Appearance, isSelf: boolean, quality: { shadows: boolean }): AvatarView {
  const root = new THREE.Group();
  const figure = new THREE.Group(); // everything that lowers when seated
  root.add(figure);

  const outfitMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const skinMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const hairMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.3 });
  const materials = [outfitMaterial, skinMaterial, hairMaterial, eyeMaterial];

  const body = new THREE.Mesh(bodyGeometry, outfitMaterial);
  body.position.y = 0.62;
  body.castShadow = quality.shadows;
  body.userData.playerId = id;
  figure.add(body);

  const head = new THREE.Mesh(headGeometry, skinMaterial);
  head.position.y = 1.42;
  head.castShadow = quality.shadows;
  head.userData.playerId = id;
  figure.add(head);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * 0.075, 1.45, 0.2); // eyes face +Z, showing which way the character looks
    figure.add(eye);
  }

  const hairCap = new THREE.Mesh(hairCapGeometry, hairMaterial);
  hairCap.position.set(0, 1.44, -0.015);
  const hairLong = new THREE.Mesh(hairLongGeometry, hairMaterial);
  hairLong.position.set(0, 1.27, -0.15);
  const hairBun = new THREE.Mesh(hairBunGeometry, hairMaterial);
  hairBun.position.set(0, 1.67, -0.1);
  figure.add(hairCap, hairLong, hairBun);

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

  const anchor = new THREE.Object3D();
  anchor.position.y = 1.1;
  figure.add(anchor);

  const tagElement = document.createElement("div");
  tagElement.className = isSelf ? "name-tag is-self" : "name-tag";
  const nameSpan = document.createElement("span");
  const activitySpan = document.createElement("span");
  activitySpan.className = "name-tag-activity";
  tagElement.append(nameSpan, activitySpan);
  const tag = new CSS2DObject(tagElement);
  tag.position.set(0, 1.95, 0);
  figure.add(tag);

  const bubbleElement = document.createElement("div");
  bubbleElement.className = "speech-bubble";
  bubbleElement.textContent = "Ciao!";
  const bubble = new CSS2DObject(bubbleElement);
  bubble.position.set(0, 2.4, 0);
  bubble.visible = false;
  figure.add(bubble);

  let seated = false;
  let selected = false;
  let hovered = false;

  const refreshRing = () => {
    selectRing.visible = selected || hovered;
    selectMaterial.opacity = selected ? 0.95 : 0.45;
  };

  const setAppearance = (look: Appearance) => {
    outfitMaterial.color.copy(colourOf("outfit", look.outfit, "#c4623f"));
    skinMaterial.color.copy(colourOf("skinTone", look.skinTone, "#dcab84"));
    hairMaterial.color.copy(colourOf("hairColour", look.hairColour, "#3b2a22"));
    eyeMaterial.color.copy(colourOf("eyeColour", look.eyeColour, "#5a3a22"));
    hairLong.visible = look.hairStyle === "long";
    hairBun.visible = look.hairStyle === "bun";
    // Body presets differ in silhouette only, until real models exist.
    body.scale.set(look.preset === "male" ? 1.08 : 0.94, 1, look.preset === "male" ? 1 : 0.92);
  };
  setAppearance(appearance);

  return {
    root,
    hitMeshes: [body, head],
    anchor,
    setName(name) {
      nameSpan.textContent = name;
    },
    setAway(away) {
      tagElement.classList.toggle("is-away", away);
      for (const material of materials) {
        material.transparent = away;
        material.opacity = away ? 0.45 : 1;
      }
    },
    setAppearance,
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
      figure.position.y = (seated ? SEAT_Y : STAND_Y) + (moving && !seated ? Math.abs(Math.sin(timeSeconds * 10)) * 0.05 : 0);
    },
    dispose() {
      tag.removeFromParent();
      bubble.removeFromParent();
      tagElement.remove();
      bubbleElement.remove();
      for (const material of materials) material.dispose();
      selectMaterial.dispose();
      root.removeFromParent();
    },
  };
}
