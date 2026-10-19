// In-world avatar: a CharacterModel plus the things around it (name tag,
// greeting bubble, selection and self rings, an invisible capsule for
// picking). Replaces the M4 placeholder capsules. Driven entirely by
// replicated state; nothing here decides gameplay.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { AppearanceConfig } from "@padova/shared";
import { CharacterModel, type CharacterStats } from "./character.ts";

export interface AvatarView {
  root: THREE.Group;
  /** Meshes used for click/tap picking. Each has `userData.playerId`. */
  hitMeshes: THREE.Mesh[];
  /** Point for anchoring menus above the character. */
  anchor: THREE.Object3D;
  setName(name: string): void;
  setAway(away: boolean): void;
  setAppearance(appearance: AppearanceConfig): void;
  /** Activity from the server (idle, sitting, studying, greeting…). */
  setActivity(activity: string, seated: boolean): void;
  setSelected(selected: boolean): void;
  setHovered(hovered: boolean): void;
  /** Applies an interpolated pose. */
  setPose(x: number, z: number, rotation: number, moving: boolean, timeSeconds: number): void;
  /** Geometry statistics of the character, for the performance readout and tests. */
  stats(): CharacterStats;
  dispose(): void;
}

const ACTIVITY_LABEL: Record<string, string> = {
  sitting: "sitting",
  studying: "studying",
  sketching: "sketching",
  ordering: "ordering",
  eating: "eating",
  drinking: "drinking",
  washing: "freshening up",
  greeting: "",
};

const ringGeometry = new THREE.RingGeometry(0.42, 0.52, 32);
const selectGeometry = new THREE.RingGeometry(0.58, 0.7, 40);
const selfMaterial = new THREE.MeshBasicMaterial({ color: 0xc4623f, transparent: true, opacity: 0.8, depthWrite: false });
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

export function createAvatar(id: string, appearance: AppearanceConfig, isSelf: boolean, quality: { shadows: boolean }): AvatarView {
  const character = new CharacterModel(appearance, { shadows: quality.shadows });
  const root = new THREE.Group();
  root.add(character.root);

  // Picking uses one invisible capsule instead of the detailed meshes: cheap and forgiving on touch screens.
  const hit = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1, 4, 8), hitMaterial);
  hit.userData.playerId = id;
  character.figure.add(hit);

  if (isSelf) {
    const ring = new THREE.Mesh(ringGeometry, selfMaterial);
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
  character.figure.add(anchor);

  const tagElement = document.createElement("div");
  tagElement.className = isSelf ? "name-tag is-self" : "name-tag";
  const nameSpan = document.createElement("span");
  const activitySpan = document.createElement("span");
  activitySpan.className = "name-tag-activity";
  tagElement.append(nameSpan, activitySpan);
  const tag = new CSS2DObject(tagElement);
  character.figure.add(tag);

  const bubbleElement = document.createElement("div");
  bubbleElement.className = "speech-bubble";
  bubbleElement.textContent = "Ciao!";
  const bubble = new CSS2DObject(bubbleElement);
  bubble.visible = false;
  character.figure.add(bubble);

  /** Things placed relative to the character's height move when the body changes. */
  const fitToHeight = () => {
    const height = character.height;
    const tallest = height + (appearanceHasVolume(character.appearance) ? 0.12 : 0.04);
    hit.geometry.dispose();
    hit.geometry = new THREE.CapsuleGeometry(0.32, Math.max(0.2, height - 0.64), 4, 8);
    hit.position.y = height / 2;
    anchor.position.y = height * 0.65;
    tag.position.set(0, tallest + 0.22, 0);
    bubble.position.set(0, tallest + 0.62, 0);
  };
  fitToHeight();

  let seated = false;
  let activity = "idle";
  let selected = false;
  let hovered = false;
  const refreshRing = () => {
    selectRing.visible = selected || hovered;
    selectMaterial.opacity = selected ? 0.95 : 0.45;
  };

  return {
    root,
    hitMeshes: [hit],
    anchor,
    setName(name) {
      nameSpan.textContent = name;
    },
    setAway(away) {
      tagElement.classList.toggle("is-away", away);
      character.setAway(away);
    },
    setAppearance(next) {
      character.setAppearance(next);
      fitToHeight();
    },
    setActivity(nextActivity, isSeated) {
      seated = isSeated;
      activity = nextActivity;
      const label = ACTIVITY_LABEL[nextActivity] ?? "";
      activitySpan.textContent = label ? ` · ${label}` : "";
      bubble.visible = nextActivity === "greeting"; // CSS2DRenderer hides the element when invisible
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
      character.pose({ moving: moving && !seated, seated, activity, time: timeSeconds });
    },
    stats: () => character.stats,
    dispose() {
      tag.removeFromParent();
      bubble.removeFromParent();
      tagElement.remove();
      bubbleElement.remove();
      hit.geometry.dispose();
      selectMaterial.dispose();
      character.dispose();
      root.removeFromParent();
    },
  };
}

/** Big hair or hats add height above the head. */
function appearanceHasVolume(config: AppearanceConfig | null): boolean {
  if (!config) return false;
  return ["afro", "afro-puffs", "top-bun", "curly-top-fade"].includes(config.hair.style) || config.outfit.headwear === "headwrap";
}
