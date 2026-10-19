// Body measurements from an appearance config (metres). One place that turns
// sliders and presets into joint heights and widths, so the body, clothing,
// hair and poses agree. The meanings of the sliders are documented in
// shared/src/appearance/schema.ts.

import type { AppearanceConfig, Build } from "@padova/shared";
import { fromSlider } from "./geometry.ts";

export interface BodyMetrics {
  height: number;
  /** Head size: crown to chin, and half-width/half-depth. */
  headHeight: number;
  headHalfWidth: number;
  headHalfDepth: number;
  /** Centre of the head (between the ears). */
  headCentreY: number;
  chinY: number;
  neckRadius: number;
  shoulderY: number;
  /** Half-widths (x) and half-depths (z) of the torso at key heights. */
  shoulderHalfWidth: number;
  chestY: number;
  chestHalfWidth: number;
  chestHalfDepth: number;
  bust: number;
  waistY: number;
  waistHalfWidth: number;
  waistHalfDepth: number;
  belly: number;
  hipY: number;
  hipHalfWidth: number;
  hipHalfDepth: number;
  /** Leg joints. */
  legOffsetX: number;
  kneeY: number;
  ankleY: number;
  thighRadius: number;
  kneeRadius: number;
  calfRadius: number;
  ankleRadius: number;
  /** Arms hang from the shoulder joint. */
  shoulderJointX: number;
  shoulderJointY: number;
  armLength: number;
  upperArmRadius: number;
  forearmRadius: number;
  wristRadius: number;
  /** Outward angle of the hanging arms so they clear the hips. */
  armRestAngle: number;
  footLength: number;
}

interface BuildShape {
  shoulders: number;
  chest: number;
  waist: number;
  hips: number;
  depth: number;
  limbs: number;
  thighs: number;
  belly: number;
  bust: number;
}

const BUILD_SHAPES: Record<Build, BuildShape> = {
  slim: { shoulders: 0.94, chest: 0.9, waist: 0.88, hips: 0.92, depth: 0.9, limbs: 0.88, thighs: 0.88, belly: 0, bust: 0.7 },
  average: { shoulders: 1, chest: 1, waist: 1, hips: 1, depth: 1, limbs: 1, thighs: 1, belly: 0, bust: 1 },
  athletic: { shoulders: 1.08, chest: 1.07, waist: 0.96, hips: 0.98, depth: 1.02, limbs: 1.08, thighs: 1.06, belly: 0, bust: 1 },
  curvy: { shoulders: 1, chest: 1.06, waist: 0.97, hips: 1.16, depth: 1.05, limbs: 1.04, thighs: 1.14, belly: 0.004, bust: 1.35 },
  broad: { shoulders: 1.12, chest: 1.12, waist: 1.1, hips: 1.08, depth: 1.12, limbs: 1.1, thighs: 1.1, belly: 0.008, bust: 1.1 },
  soft: { shoulders: 1.02, chest: 1.08, waist: 1.2, hips: 1.1, depth: 1.18, limbs: 1.1, thighs: 1.12, belly: 0.03, bust: 1.2 },
};

export function bodyMetrics(config: AppearanceConfig): BodyMetrics {
  const { body } = config;
  const masculine = body.frame === "masculine";
  const build = BUILD_SHAPES[body.build] ?? BUILD_SHAPES.average;
  const height = fromSlider(body.height, 1.56, 1.88);
  const scale = height / 1.72;

  // Slightly large, rounded heads: anime-inspired, still readable as adults.
  const headHeight = 0.248 * Math.sqrt(scale);
  const headHalfWidth = headHeight * (masculine ? 0.39 : 0.375);
  const headHalfDepth = headHeight * 0.44;
  const chinY = height - headHeight;
  const headCentreY = height - headHeight * 0.52;
  const shoulderY = chinY - 0.072 * scale;

  const legs = fromSlider(body.legs, 0.92, 1.08);
  const torso = fromSlider(body.torso, 0.92, 1.08);
  const legShare = 0.585 * legs;
  const torsoShare = 0.415 * torso;
  const hipY = shoulderY * (legShare / (legShare + torsoShare));
  const ankleY = 0.075 * scale;
  const kneeY = ankleY + (hipY - ankleY) * 0.5;

  const shoulderSlider = fromSlider(body.shoulders, 0.88, 1.12);
  const shoulderHalfWidth = (masculine ? 0.205 : 0.178) * build.shoulders * shoulderSlider * scale;
  const chestHalfWidth = (masculine ? 0.158 : 0.142) * build.chest * scale;
  const chestHalfDepth = (masculine ? 0.105 : 0.095) * build.depth * scale;
  const waistHalfWidth = (masculine ? 0.138 : 0.115) * build.waist * scale;
  const waistHalfDepth = (masculine ? 0.09 : 0.08) * build.depth * scale;
  const hipHalfWidth = (masculine ? 0.148 : 0.165) * build.hips * scale;
  const hipHalfDepth = (masculine ? 0.095 : 0.1) * build.depth * scale;
  const bust = (masculine ? 0 : 0.022) * build.bust * scale;

  const limbs = build.limbs * (masculine ? 1.06 : 1);
  const arms = fromSlider(body.arms, 0.92, 1.08);
  const armLength = (hipY - ankleY) * 0.55 * arms + 0.06 * scale;
  const shoulderJointX = shoulderHalfWidth - 0.035 * scale;
  const shoulderJointY = shoulderY - 0.035 * scale;
  const upperArmRadius = 0.042 * limbs * scale;
  const hipClearance = hipHalfWidth + upperArmRadius * 0.85 + 0.012;
  const armRestAngle = Math.max(0.07, Math.asin(Math.min(0.5, Math.max(0, (hipClearance - shoulderJointX) / (armLength * 0.85)))) + 0.03);

  return {
    height,
    headHeight,
    headHalfWidth,
    headHalfDepth,
    headCentreY,
    chinY,
    neckRadius: (masculine ? 0.05 : 0.043) * build.limbs * scale,
    shoulderY,
    shoulderHalfWidth,
    chestY: hipY + (shoulderY - hipY) * 0.68,
    chestHalfWidth,
    chestHalfDepth,
    bust,
    waistY: hipY + (shoulderY - hipY) * 0.36,
    waistHalfWidth,
    waistHalfDepth,
    belly: build.belly * scale,
    hipY,
    hipHalfWidth,
    hipHalfDepth,
    legOffsetX: hipHalfWidth * 0.52,
    kneeY,
    ankleY,
    thighRadius: (masculine ? 0.074 : 0.076) * build.thighs * scale,
    kneeRadius: 0.05 * build.limbs * scale,
    calfRadius: 0.055 * build.limbs * scale,
    ankleRadius: 0.034 * build.limbs * scale,
    shoulderJointX,
    shoulderJointY,
    armLength,
    upperArmRadius,
    forearmRadius: 0.035 * limbs * scale,
    wristRadius: 0.026 * limbs * scale,
    armRestAngle,
    footLength: 0.235 * scale,
  };
}
