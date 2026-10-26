// Tuning for the life simulation (M5). Every gameplay number lives here so
// balancing never means hunting through systems. Meanings and reasoning:
// docs/GAME_DESIGN.md ("Time model", "Life simulation").

export const NEED_IDS = ["hunger", "energy", "hygiene", "social", "fun"] as const;
export type NeedId = (typeof NEED_IDS)[number];
export type Needs = Record<NeedId, number>;

export const SKILL_IDS = ["academic", "communication", "cooking", "fitness", "creativity"] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export const TRAIT_IDS = ["organised", "sociable", "creative", "ambitious"] as const;
export type TraitId = (typeof TRAIT_IDS)[number];

/** World clock (D-021). */
export const TIME_CONFIG = {
  /** Real moment that corresponds to `anchorGameMinute`. */
  anchorRealMs: Date.UTC(2026, 9, 1, 0, 0, 0),
  /** 08:00 on Day 1. */
  anchorGameMinute: 8 * 60,
  /** Game minutes per real minute. One game day = 1440 / scale real minutes. */
  defaultScale: 10,
  minScale: 1,
  maxScale: 1440,
} as const;

export const NEEDS_CONFIG = {
  /** Values for a brand-new character. */
  initial: { hunger: 80, energy: 80, hygiene: 80, social: 70, fun: 70 } satisfies Needs,
  /** Change per game hour while standing around (negative = falls). */
  perGameHour: { hunger: -6, energy: -4, hygiene: -3, social: -4, fun: -5 } satisfies Needs,
  /** Energy per game hour while walking (replaces the standing rate). */
  walkingEnergyPerGameHour: -5,
  /** While sitting idle on a bench or at a desk: resting. */
  sittingEnergyPerGameHour: 20,
  sittingFunPerGameHour: -2,
  /** Offline catch-up (D-022). */
  offline: {
    capGameHours: 8,
    /** Fraction of the normal fall rate applied to non-energy needs. */
    decayFactor: 0.5,
    /** Offline time never pushes a need below this (needs already lower stay as they are). */
    floor: 35,
    energyPerGameHour: 20,
    energyCap: 90,
  },
  /** Below this energy, studying and sketching can't be started. */
  tooTiredEnergy: 10,
  /** Below this hygiene, greetings give half the social gain. */
  grubbyHygiene: 20,
  /** A need at or below this is shown as "low" in the panel. */
  lowWarning: 25,
} as const;

export const MOOD_CONFIG = {
  /** Contribution of one need at 0 (negative) and at 100 (positive); zero at 50. */
  needAtZero: -16,
  needAtFull: 8,
  /** Sum of event values is clamped to ±eventCap. */
  eventCap: 40,
  /** Score thresholds, checked in order. */
  levels: [
    { level: "miserable", atMost: -40 },
    { level: "low", atMost: -15 },
    { level: "okay", atMost: 14.999 },
    { level: "good", atMost: 39.999 },
    { level: "great", atMost: Infinity },
  ],
  skillMultiplier: { miserable: 0.5, low: 0.75, okay: 1, good: 1.1, great: 1.25 },
} as const;

export type MoodLevel = (typeof MOOD_CONFIG.levels)[number]["level"];

export const MOOD_EVENTS = {
  good_meal: { label: "Good meal", value: 10, durationGameMinutes: 180 },
  caffeine_boost: { label: "Caffeine boost", value: 5, durationGameMinutes: 60 },
  learned_something: { label: "Learned something", value: 8, durationGameMinutes: 120 },
  creative_flow: { label: "Creative flow", value: 8, durationGameMinutes: 120 },
  freshened_up: { label: "Freshened up", value: 5, durationGameMinutes: 90 },
  friendly_hello: { label: "Friendly hello", value: 10, durationGameMinutes: 120 },
  someone_said_hello: { label: "Someone said hello", value: 6, durationGameMinutes: 90 },
  couldnt_afford: { label: "Couldn't afford it", value: -5, durationGameMinutes: 60 },
  good_days_work: { label: "Good day's work", value: 6, durationGameMinutes: 120 },
} as const;
export type MoodEventId = keyof typeof MOOD_EVENTS;

export const SKILL_CONFIG = {
  maxLevel: 10,
  /** Level n needs levelFactor × n × (n + 1) XP in total. */
  levelFactor: 50,
  fitnessXpPerMetre: 0.1,
} as const;

/** Effects of timed actions, totals for one completed action, applied gradually. */
export const ACTION_EFFECTS = {
  study: {
    durationMs: 20_000,
    activity: "studying",
    needs: { energy: -6, fun: -4 },
    skills: { academic: 20 },
    moodEvent: "learned_something",
    focus: true,
  },
  sketch: {
    durationMs: 15_000,
    activity: "sketching",
    needs: { fun: 12, energy: -3 },
    skills: { creativity: 15 },
    moodEvent: "creative_flow",
    focus: true,
  },
  wash: {
    durationMs: 6_000,
    activity: "washing",
    needs: { hygiene: 40 },
    skills: {},
    moodEvent: "freshened_up",
    focus: false,
  },
  /** One café shift (M7): 90 real seconds = 15 game minutes at the default clock. Paid on completion only (WORK_CONFIG). */
  work: {
    durationMs: 90_000,
    activity: "working",
    needs: { energy: -8, fun: -4 },
    skills: {},
    skillsOnCompletion: { communication: 10 },
    moodEvent: "good_days_work",
    focus: true,
  },
} as const satisfies Record<string, TimedEffect>;

export interface TimedEffect {
  durationMs: number;
  activity: string;
  /** Applied gradually: stopping halfway gives half. */
  needs: Partial<Needs>;
  /** Applied gradually: stopping halfway gives half. */
  skills: Partial<Record<SkillId, number>>;
  /** Given only when the action completes (a finished shift, not half of one). */
  skillsOnCompletion?: Partial<Record<SkillId, number>>;
  moodEvent?: MoodEventId;
  /** Needs concentration: refused when too tired. */
  focus: boolean;
}

/** Greeting effects, applied when the greeting starts. */
export const GREETING_EFFECTS = {
  durationMs: 2_000,
  greeter: { needs: { social: 15, fun: 4 }, skills: { communication: 5 }, moodEvent: "friendly_hello" },
  greeted: { needs: { social: 10 }, moodEvent: "someone_said_hello" },
} as const;

/** Money (D-023). All amounts in euro cents. */
export const ECONOMY_CONFIG = {
  startingBalanceCents: 10_000,
  /** Halved from €15 when jobs arrived in M7 (D-035, Q8). */
  dailyAllowanceCents: 750,
  /** Ledger entries kept in memory and shown in the character panel. */
  recentTransactions: 5,
} as const;

export interface MenuItem {
  id: string;
  label: string;
  priceCents: number;
  /** Real time to eat or drink it. */
  consumeMs: number;
  activity: "eating" | "drinking";
  needs: Partial<Needs>;
  moodEvent?: MoodEventId;
}

/** The café counter's menu. Prices are set here, never by clients. */
export const CAFE_MENU: readonly MenuItem[] = [
  { id: "espresso", label: "Espresso", priceCents: 150, consumeMs: 5_000, activity: "drinking", needs: { energy: 15, fun: 5 }, moodEvent: "caffeine_boost" },
  { id: "cornetto", label: "Cornetto", priceCents: 180, consumeMs: 8_000, activity: "eating", needs: { hunger: 20, fun: 5 } },
  { id: "panino", label: "Panino", priceCents: 450, consumeMs: 15_000, activity: "eating", needs: { hunger: 45, energy: 5 }, moodEvent: "good_meal" },
];

export const JOB_IDS = ["cafe"] as const;
export type JobId = (typeof JOB_IDS)[number];

export interface JobGrade {
  id: string;
  label: string;
  /** Paid for each completed shift. */
  wageCents: number;
  /** Skill level needed for this grade (decided when a shift starts). */
  requires?: { skill: SkillId; level: number };
}

export interface JobDefinition {
  label: string;
  /** Interactable where the job is done; its "staff" spots are the work positions. */
  workplaceId: string;
  /** Game minutes after midnight. Shifts can start from `opensAt` until `closesAt`. */
  opensAt: number;
  closesAt: number;
  /** Completed shifts allowed per game day. */
  maxShiftsPerDay: number;
  /** Lowest grade first; the highest grade whose requirement is met applies. */
  grades: readonly JobGrade[];
}

/** Jobs (M7). Wages are set here, never by clients; see docs/GAME_DESIGN.md "Work (M7)". */
export const JOBS: Record<JobId, JobDefinition> = {
  cafe: {
    label: "Café kiosk",
    workplaceId: "cafe-counter",
    opensAt: 6 * 60,
    closesAt: 23 * 60,
    maxShiftsPerDay: 4,
    grades: [
      { id: "assistant", label: "Café assistant", wageCents: 600 },
      { id: "barista", label: "Barista", wageCents: 800, requires: { skill: "communication", level: 2 } },
    ],
  },
};

export const TRAITS: Record<TraitId, TraitDefinition> = {
  organised: {
    label: "Organised",
    description: "Learns faster from studying; stays fresh longer.",
    skillXp: { academic: 1.2 },
    needFallRate: { hygiene: 0.8 },
  },
  sociable: {
    label: "Sociable",
    description: "Gets more from company and needs it more often.",
    skillXp: { communication: 1.25 },
    needGain: { social: 1.5 },
    needFallRate: { social: 1.25 },
  },
  creative: {
    label: "Creative",
    description: "Improves creativity faster and enjoys sketching more.",
    skillXp: { creativity: 1.25 },
    actionNeedGain: { sketch: { fun: 1.5 } },
  },
  ambitious: {
    label: "Ambitious",
    description: "Every skill grows a little faster; gets bored sooner.",
    allSkillXp: 1.1,
    needFallRate: { fun: 1.15 },
  },
};

export interface TraitDefinition {
  label: string;
  description: string;
  skillXp?: Partial<Record<SkillId, number>>;
  allSkillXp?: number;
  /** Multiplies how fast a need falls (only falling rates). */
  needFallRate?: Partial<Needs>;
  /** Multiplies positive changes to a need from any action. */
  needGain?: Partial<Needs>;
  /** Multiplies positive changes to a need from one specific action. */
  actionNeedGain?: Partial<Record<keyof typeof ACTION_EFFECTS, Partial<Needs>>>;
}

export const MAX_TRAITS = 2;
