// The header shared by the setup, creator and review steps: a back button,
// the screen title and a step indicator (the steps really are a sequence:
// name → look → review when creating; look → review when editing).

import { el, icon } from "./dom.ts";
import { ICONS } from "./icons.ts";

export interface FlowHeaderOptions {
  title: string;
  backLabel: string;
  onBack(): void;
  steps: readonly string[];
  current: number;
}

export function flowHeader(options: FlowHeaderOptions): HTMLElement {
  const header = el("header", "flow-header");
  const back = el("button", "back-button");
  back.type = "button";
  back.dataset.action = "back";
  back.append(icon(ICONS.back), el("span", undefined, options.backLabel));
  back.addEventListener("click", () => options.onBack());
  const title = el("h1", "flow-title", options.title);
  const steps = el("ol", "stepper");
  steps.setAttribute("aria-label", "Steps");
  options.steps.forEach((label, index) => {
    const step = el("li", "step");
    step.dataset.state = index < options.current ? "done" : index === options.current ? "current" : "todo";
    if (index === options.current) step.setAttribute("aria-current", "step");
    step.append(el("span", "step-number", String(index + 1)), el("span", "step-label", label));
    steps.append(step);
  });
  header.append(back, title, steps);
  return header;
}
