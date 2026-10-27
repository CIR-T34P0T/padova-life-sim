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
  // University (M8)
  interesting_lecture: { label: "Interesting lecture", value: 6, durationGameMinutes: 120 },
  passed_exam: { label: "Passed an exam", value: 15, durationGameMinutes: 360 },
  failed_exam: { label: "Failed an exam", value: -8, durationGameMinutes: 240 },
  // Relationships (M9)
  nice_chat: { label: "Nice chat", value: 8, durationGameMinutes: 120 },
  someone_chatted: { label: "Someone chatted with you", value: 6, durationGameMinutes: 90 },
  new_friend: { label: "New friend", value: 12, durationGameMinutes: 360 },
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
  /** Attending a lecture (M8): 2 real minutes = 20 game minutes. Counts for the course only when completed. */
  attend: {
    durationMs: 120_000,
    activity: "attending",
    needs: { energy: -6, fun: -3 },
    skills: { academic: 10 },
    skillsOnCompletion: { academic: 20 },
    moodEvent: "interesting_lecture",
    focus: true,
  },
  /** Chatting with another player (M9): 10 real seconds, standing near them. The other player's share is CHAT_EFFECTS. */
  chat: {
    durationMs: 10_000,
    activity: "chatting",
    needs: { social: 18, fun: 6 },
    skills: { communication: 6 },
    moodEvent: "nice_chat",
    focus: false,
  },
  /** Sitting the exam (M8): 3 real minutes = 30 game minutes. Graded only when completed; the mood event depends on the result. */
  exam: {
    durationMs: 180_000,
    activity: "exam",
    needs: { energy: -10, fun: -6 },
    skills: {},
    skillsOnCompletion: { academic: 20 },
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

/** What the other player gets when a chat with them completes (M9). */
export const CHAT_EFFECTS = {
  partner: { needs: { social: 12 }, moodEvent: "someone_chatted" },
} as const;

/** Shared moments that grow a relationship (M9). */
export const SHARED_MOMENT_KINDS = ["greet", "chat", "study_together", "lecture_together"] as const;
export type SharedMomentKind = (typeof SHARED_MOMENT_KINDS)[number];

/**
 * Relationships (M9): one friendship score per pair of characters, 0–100,
 * grown by shared moments; each kind counts at most a few times per pair per
 * game day, so it can't be farmed. Nothing lowers it yet (no rivalry or
 * decay in M9). Design: docs/GAME_DESIGN.md "Relationships (M9)".
 */
export const RELATIONSHIP_CONFIG = {
  maxScore: 100,
  gains: { greet: 2, chat: 5, study_together: 4, lecture_together: 4 } satisfies Record<SharedMomentKind, number>,
  dailyCaps: { greet: 2, chat: 4, study_together: 3, lecture_together: 3 } satisfies Record<SharedMomentKind, number>,
  /** Lowest score first. */
  levels: [
    { id: "acquaintance", label: "Acquaintance", from: 0 },
    { id: "friendly", label: "Friendly", from: 15 },
    { id: "friend", label: "Friend", from: 40 },
    { id: "good_friend", label: "Good friend", from: 70 },
    { id: "close_friend", label: "Close friend", from: 90 },
  ],
  /** Reaching this level writes "became friends" in both characters' stories. */
  friendLevel: "friend",
  /** Moments kept per pair (the short shared history). */
  historyLength: 20,
  /** Moments shown in the player card. */
  recentShown: 5,
} as const;

export type RelationshipLevelId = (typeof RELATIONSHIP_CONFIG.levels)[number]["id"];

/** Meaningful events in a character's private story log (M9), written by the server. */
export const STORY_KINDS = ["hired", "first_shift", "enrolled", "exam_passed", "exam_failed", "new_friend"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

export const STORY_CONFIG = {
  /** Most recent events sent to the owner and shown in the panel. */
  recentShown: 10,
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

export const COURSE_IDS = ["city-studies"] as const;
export type CourseId = (typeof COURSE_IDS)[number];

export interface CourseGrading {
  /** Lectures attended, completed study sessions and academic level that each count in full. */
  lecturesForFull: number;
  studyForFull: number;
  levelForFull: number;
  /** Shares of the score (they add up to 1). */
  weights: { attendance: number; study: number; level: number };
  /** Grade for a score of 0 and of 1; 31 is shown as "30 cum laude". */
  lowestGrade: number;
  highestGrade: number;
  /** Lowest passing grade (the Italian scale passes from 18). */
  passMark: number;
}

export interface CourseDefinition {
  label: string;
  description: string;
  /** Interactable where students enrol (on the square, beside the university hall). */
  enrolAt: string;
  /** Where lectures and exams are held: an area id (M7c) and how to name it. */
  roomId: string;
  roomLabel: string;
  /** Days with lectures (0 = Monday) and their start times in game minutes after midnight. */
  lectureDays: readonly number[];
  lectureStarts: readonly number[];
  lectureMinutes: number;
  /** A lecture can be joined until this many game minutes after it starts. */
  lateEntryMinutes: number;
  /** Exam sittings: days (0 = Monday) and the hours an exam can be started. */
  examDays: readonly number[];
  examOpensAt: number;
  examClosesAt: number;
  grading: CourseGrading;
}

/**
 * University courses (M8). Fictional: no real course names and no link to any
 * real university. Lectures run on the hour so a player finds one soon on
 * the real-time clock (a game day lasts 2.4 real hours, a game week 16.8);
 * two exam sittings a week, each open for ten game hours (one real hour).
 * Design: docs/GAME_DESIGN.md "University (M8)".
 */
export const COURSES: Record<CourseId, CourseDefinition> = {
  "city-studies": {
    label: "Introduction to City Studies",
    description: "A fictional first-year course on how cities live and work.",
    enrolAt: "noticeboard",
    roomId: "hall/lecture-room",
    roomLabel: "the university hall's lecture room",
    lectureDays: [0, 1, 2, 3, 4],
    lectureStarts: [9 * 60, 10 * 60, 11 * 60, 12 * 60, 14 * 60, 15 * 60, 16 * 60, 17 * 60],
    lectureMinutes: 50,
    lateEntryMinutes: 20,
    examDays: [2, 5],
    examOpensAt: 9 * 60,
    examClosesAt: 19 * 60,
    grading: {
      lecturesForFull: 8,
      studyForFull: 6,
      levelForFull: 4,
      weights: { attendance: 0.45, study: 0.35, level: 0.2 },
      lowestGrade: 12,
      highestGrade: 31,
      passMark: 18,
    },
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
