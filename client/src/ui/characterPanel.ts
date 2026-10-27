// Character panel (M5): the player's own needs, mood (with reasons), skills,
// work (M7), university (M8), money and current action. Opened by clicking/tapping your own character
// (→ "Character") or the HUD chip. Desktop: a narrow panel on the right.
// Touch: a bottom sheet capped below half the screen height. Everything shown
// comes from the server's `life` message; nothing here is calculated as truth.

import {
  COURSES,
  JOBS,
  NEEDS_CONFIG,
  NEED_IDS,
  SKILL_CONFIG,
  SKILL_IDS,
  TRAITS,
  WEEKDAY_NAMES,
  formatEuros,
  formatGrade,
  formatTimeOfDay,
  gradeFor,
  isOpen,
  nextGradeFor,
  readClock,
  weekdayOf,
  xpForLevel,
  type LifePayload,
  type MoodLevel,
  type NeedId,
  type SkillId,
  type TraitId,
} from "@padova/shared";
import { examLine, examTimetable, expectedGrade, lectureLine, lectureTimetable } from "./university.ts";

const NEED_LABELS: Record<NeedId, string> = {
  hunger: "Hunger",
  energy: "Energy",
  hygiene: "Hygiene",
  social: "Social",
  fun: "Fun",
};

const SKILL_LABELS: Record<SkillId, string> = {
  academic: "Academic",
  communication: "Communication",
  cooking: "Cooking",
  fitness: "Fitness",
  creativity: "Creativity",
};

const MOOD_LABELS: Record<MoodLevel, string> = {
  miserable: "Miserable",
  low: "Low",
  okay: "Okay",
  good: "Good",
  great: "Great",
};

export interface CharacterPanelActions {
  onEditAppearance(): void;
  onLeaveToTitle(): void;
  onQuitJob(): void;
}

export class CharacterPanel {
  readonly mode: "side" | "sheet";
  private readonly element: HTMLElement;
  private readonly nameElement: HTMLElement;
  private readonly traitsElement: HTMLElement;
  private readonly body: HTMLElement;
  /** Kept across re-renders (the body is rebuilt on every update) so a tap on it is never lost. */
  private readonly quitButton: HTMLButtonElement;
  private life: LifePayload | null = null;
  private currentAction: string | null = null;
  private openState = false;

  constructor(root: HTMLElement, actions: CharacterPanelActions) {
    const params = new URLSearchParams(location.search);
    const forced = params.get("menu");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.mode = forced === "sheet" || (forced !== "radial" && coarse) ? "sheet" : "side";

    this.element = document.createElement("aside");
    this.element.id = "character-panel";
    this.element.className = `character-panel is-${this.mode}`;
    this.element.setAttribute("aria-label", "Your character");
    this.element.hidden = true;

    const header = document.createElement("div");
    header.className = "cp-header";
    const titles = document.createElement("div");
    this.nameElement = document.createElement("div");
    this.nameElement.className = "cp-name";
    this.traitsElement = document.createElement("div");
    this.traitsElement.className = "cp-traits";
    titles.append(this.nameElement, this.traitsElement);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cp-close";
    close.setAttribute("aria-label", "Close character panel");
    close.textContent = "✕";
    close.addEventListener("click", () => this.close());
    header.append(titles, close);

    this.body = document.createElement("div");
    this.body.className = "cp-body";
    const footer = document.createElement("div");
    footer.className = "cp-footer";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cp-action";
    edit.dataset.action = "edit-appearance";
    edit.textContent = "Edit look";
    edit.addEventListener("click", () => actions.onEditAppearance());
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "cp-action";
    leave.dataset.action = "leave-to-title";
    leave.textContent = "Back to title";
    leave.title = "Saves and takes your character out of the piazza";
    leave.addEventListener("click", () => actions.onLeaveToTitle());
    footer.append(edit, leave);
    this.quitButton = document.createElement("button");
    this.quitButton.type = "button";
    this.quitButton.className = "cp-action cp-quit";
    this.quitButton.dataset.action = "quit-job";
    this.quitButton.textContent = "Quit job";
    this.quitButton.title = "A shift in progress ends unpaid. You can ask about work again any time.";
    this.quitButton.addEventListener("click", () => actions.onQuitJob());
    this.element.append(header, this.body, footer);
    // Taps inside the panel never reach the game view.
    this.element.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    this.openState = true;
    this.element.hidden = false;
    document.body.classList.toggle("panel-sheet-open", this.mode === "sheet");
    this.render();
  }

  close(): void {
    this.openState = false;
    this.element.hidden = true;
    document.body.classList.remove("panel-sheet-open");
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  setIdentity(name: string, traits: readonly TraitId[]): void {
    this.nameElement.textContent = name;
    this.traitsElement.replaceChildren(
      ...traits.map((trait) => {
        const chip = document.createElement("span");
        chip.className = "cp-trait";
        chip.textContent = TRAITS[trait].label;
        chip.title = TRAITS[trait].description;
        return chip;
      }),
    );
  }

  update(life: LifePayload): void {
    this.life = life;
    if (this.openState) this.render();
  }

  setCurrentAction(text: string | null): void {
    if (text === this.currentAction) return;
    this.currentAction = text;
    if (this.openState) this.render();
  }

  /** Read-only snapshot for tests. */
  debugState() {
    return {
      open: this.openState,
      mode: this.mode,
      text: this.openState ? this.element.innerText : "",
    };
  }

  private render(): void {
    const life = this.life;
    if (!life) {
      this.body.replaceChildren(text("p", "cp-muted", "Loading your character…"));
      return;
    }
    this.body.replaceChildren(
      this.moodSection(life),
      this.nowSection(life),
      this.needsSection(life),
      this.skillsSection(life),
      this.workSection(life),
      this.universitySection(life),
      this.moneySection(life),
    );
  }

  private moodSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Mood");
    const row = document.createElement("div");
    row.className = `cp-mood is-${life.mood.level}`;
    row.dataset.mood = life.mood.level;
    row.append(text("span", "cp-mood-level", MOOD_LABELS[life.mood.level]), text("span", "cp-mood-score", signed(life.mood.score)));
    const reasons = document.createElement("div");
    reasons.className = "cp-reasons";
    for (const reason of life.mood.reasons.slice(0, 5)) {
      const chip = text("span", reason.value < 0 ? "cp-reason is-negative" : "cp-reason", `${reason.label} ${signed(reason.value)}`);
      reasons.append(chip);
    }
    if (life.mood.reasons.length === 0) reasons.append(text("span", "cp-muted", "Nothing much on your mind."));
    section.append(row, reasons);
    return section;
  }

  private nowSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Now");
    section.append(text("p", "cp-now", `${this.currentAction ?? "Idle"} · ${WEEKDAY_NAMES[weekdayOf(life.gameMinute)]} · ${readClock(life.gameMinute).label}`));
    return section;
  }

  private needsSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Needs");
    for (const need of NEED_IDS) {
      const value = life.needs[need];
      section.append(meter(NEED_LABELS[need], value / 100, String(Math.round(value)), value <= NEEDS_CONFIG.lowWarning, `need-${need}`));
    }
    return section;
  }

  private skillsSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Skills");
    for (const skill of SKILL_IDS) {
      const view = life.skills[skill];
      const next = view.level >= SKILL_CONFIG.maxLevel ? "max" : `${Math.floor(view.xp)}/${xpForLevel(view.level + 1)} XP`;
      section.append(meter(`${SKILL_LABELS[skill]} · Lv ${view.level}`, view.progress, next, false, `skill-${skill}`, true));
    }
    return section;
  }

  private workSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Work");
    section.dataset.testid = "work";
    if (!life.job) {
      section.append(text("p", "cp-muted", "No job yet. The café kiosk is hiring: tap the café counter and choose “Ask about work”."));
      return section;
    }
    const job = JOBS[life.job.jobId];
    const levels = Object.fromEntries(Object.entries(life.skills).map(([skill, view]) => [skill, view.level]));
    const grade = gradeFor(job, levels);
    const next = nextGradeFor(job, levels);
    section.append(text("p", "cp-job", `${job.label} · ${grade.label}`));
    const pay = `${formatEuros(grade.wageCents)} per completed shift`;
    const promotion = next?.requires ? ` · ${next.label} ${formatEuros(next.wageCents)} at ${SKILL_LABELS[next.requires.skill]} Lv ${next.requires.level}` : "";
    section.append(text("p", "cp-muted", pay + promotion));
    const hours = isOpen(job, life.gameMinute)
      ? `Open now, until ${formatTimeOfDay(job.closesAt)}`
      : `Closed · opens at ${formatTimeOfDay(job.opensAt)}`;
    const shifts = text("p", "cp-shifts", `Shifts today ${life.job.shiftsToday} of ${job.maxShiftsPerDay} · ${hours}`);
    shifts.dataset.testid = "shifts";
    section.append(shifts, this.quitButton);
    return section;
  }

  private universitySection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("University");
    section.dataset.testid = "university";
    const course = life.course;
    if (!course) {
      section.append(text("p", "cp-muted", "Not enrolled. Enrol at the University notice board beside the university hall (north-west of the square)."));
      return section;
    }
    const def = COURSES[course.courseId];
    if (course.status === "passed") {
      const passed = text("p", "cp-job", `${def.label} · Passed ${formatGrade(course.finalGrade ?? 0)}`);
      passed.dataset.testid = "course-passed";
      section.append(passed);
      return section;
    }
    section.append(text("p", "cp-job", def.label));
    section.append(text("p", "cp-muted", `Lectures ${lectureTimetable(course.courseId)}, in ${def.roomLabel}.`));
    const lecture = text("p", "cp-course-line", lectureLine(life).text);
    lecture.dataset.testid = "lecture";
    section.append(lecture);
    const g = def.grading;
    section.append(
      meter("Lectures attended", course.lecturesAttended / g.lecturesForFull, `${course.lecturesAttended} of ${g.lecturesForFull}`, false, "lectures", true),
      meter("Study sessions", course.studySessions / g.studyForFull, `${course.studySessions} of ${g.studyForFull}`, false, "study-sessions", true),
    );
    const exam = text("p", "cp-course-line", `Exam (${examTimetable(course.courseId)}): ${examLine(life).text}`);
    exam.dataset.testid = "exam";
    section.append(exam);
    const expected = text("p", "cp-muted", `If you sat it now: ${formatGrade(expectedGrade(life) ?? 0)} (${g.passMark} passes). Lectures, study and your Academic level count.`);
    expected.dataset.testid = "expected";
    section.append(expected);
    if (course.lastResult && !course.lastResult.passed) {
      section.append(text("p", "cp-muted", `Last exam: ${formatGrade(course.lastResult.grade)}, not passed. You can retake it at the next sitting.`));
    }
    return section;
  }

  private moneySection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Money");
    const balance = text("p", "cp-balance", formatEuros(life.money.balanceCents));
    balance.dataset.testid = "balance";
    section.append(balance);
    const list = document.createElement("ul");
    list.className = "cp-ledger";
    for (const entry of life.money.recent.slice(0, 3)) {
      const item = document.createElement("li");
      const amount = entry.direction === "income" ? entry.amountCents : -entry.amountCents;
      item.append(
        text("span", amount < 0 ? "cp-amount is-negative" : "cp-amount", amount < 0 ? formatEuros(amount) : `+${formatEuros(amount)}`),
        text("span", "cp-desc", entry.description),
      );
      list.append(item);
    }
    section.append(list);
    return section;
  }
}

function sectionWithTitle(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "cp-section";
  section.append(text("h2", "cp-title", title));
  return section;
}

/** A labelled bar. Stacked: label and value on one line, the bar underneath (for longer labels). */
function meter(label: string, fraction: number, valueText: string, low: boolean, testId: string, stacked = false): HTMLElement {
  const row = document.createElement("div");
  row.className = ["cp-meter", low ? "is-low" : "", stacked ? "is-stacked" : ""].filter(Boolean).join(" ");
  row.dataset.testid = testId;
  const bar = document.createElement("div");
  bar.className = "cp-bar";
  const fill = document.createElement("div");
  fill.className = "cp-fill";
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  bar.append(fill);
  if (stacked) row.append(text("span", "cp-label", label), text("span", "cp-value", valueText), bar);
  else row.append(text("span", "cp-label", label), bar, text("span", "cp-value", valueText));
  return row;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

const signed = (value: number) => (value > 0 ? `+${Math.round(value)}` : value < 0 ? `−${Math.abs(Math.round(value))}` : "0");
