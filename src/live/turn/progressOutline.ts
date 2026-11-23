/**
 * The two step lists the live card draws off the loop view — the OUTLINE above the fold and the LOOP phases
 * below it. Split from `./progressCard.ts`, which owns the whole frame and the live line, so that module
 * stays one a reader can hold; `./progressLoop.ts` derives the view both of these read.
 */

import type { TodoStep } from "../../outbound/assistant/todoBlock.js";
import { CARD_LINE_CAP, clampVisible } from "./answer.js";
import type { ProgressTimelineEvent } from "./progressLog.js";
import { boundedPhases, boundedUpdates, type LoopView } from "./progressLoop.js";

/**
 * The outline under the question: the plan's steps when the worker declared one, else the one live step.
 *
 * With a plan, every step before the live one is done and carries the latest finding filed against it, the
 * live step carries that step's latest finding and the live line as children, and every step after it is
 * pending. Without one, the latest stage IS the live step and every earlier stage lives in the loop below the
 * fold — the flat trail of past-tense ticks is exactly the card the owner asked to see replaced.
 *
 * @param finished whether the turn reached its terminal state
 * @param lastState the live step's state — running, blocked, or done once finished
 * @param liveLine the `now:` line or the blocked sentence under the live step, when there is one
 * @param view the loop view
 * @returns the outline steps, in display order
 */
export function outlineSteps({
  finished,
  lastState,
  liveLine,
  view,
}: {
  finished: boolean;
  lastState: TodoStep["state"];
  liveLine: string | undefined;
  view: LoopView;
}): readonly TodoStep[] {
  const plan = view.plan;
  if (plan === undefined) {
    const latest = view.latest;
    return [
      {
        id: `stage-${String(Math.max(0, view.updates - 1))}`,
        state: lastState,
        title: latest === undefined ? "Investigating" : clampVisible({ cap: CARD_LINE_CAP, text: latest.text }),
        ...childrenOf({ lines: [liveLine] }),
      },
    ];
  }
  return plan.steps.map((title, index): TodoStep => {
    const step = index + 1;
    const finding = plan.findings.get(step);
    const shown = finding === undefined ? undefined : clampVisible({ cap: CARD_LINE_CAP, text: finding });
    const base = { id: `plan-${String(step)}`, title: clampVisible({ cap: CARD_LINE_CAP, text: title }) };
    if (finished || step < plan.currentStep) {
      return { ...base, state: "done", ...(shown === undefined ? {} : { detail: shown }) };
    }
    if (step === plan.currentStep) {
      return { ...base, state: lastState, ...childrenOf({ lines: [shown, liveLine] }) };
    }
    return { ...base, state: "pending" };
  });
}

/**
 * The loop section's phases, below the fold — or none while the timeline holds fewer than two events, when
 * the outline above already says everything the loop would.
 *
 * The LAST phase wears the live step's state; every earlier one is done.
 *
 * @param lastState the live step's state
 * @param timeline the turn's timeline, for its length
 * @param view the loop view
 * @returns the loop steps, oldest first
 */
export function loopSteps({
  lastState,
  timeline,
  view,
}: {
  lastState: TodoStep["state"];
  timeline: readonly ProgressTimelineEvent[];
  view: LoopView;
}): readonly TodoStep[] {
  if (timeline.length < 2) {
    return [];
  }
  const { folded, shown } = boundedPhases({ phases: view.phases });
  const foldedStep: readonly TodoStep[] =
    folded === 0
      ? []
      : [{ id: "loop-folded", placement: "loop", state: "done", title: `… ${String(folded)} earlier phases` }];
  const phases = shown.map((phase, index): TodoStep => {
    const updates = boundedUpdates({ updates: phase.updates }).map((text) =>
      clampVisible({ cap: CARD_LINE_CAP, text }),
    );
    return {
      id: `loop-${String(index + folded)}`,
      placement: "loop",
      state: index === shown.length - 1 ? lastState : "done",
      title: phase.title,
      ...childrenOf({ lines: updates }),
    };
  });
  return [...foldedStep, ...phases];
}

/**
 * The `children` field for the lines that carry text, or nothing at all when none does — an empty sub-line
 * renders as a visible blank row.
 *
 * @param lines the candidate lines, in order
 * @returns `{ children }`, or an empty object
 */
function childrenOf({ lines }: { lines: readonly (string | undefined)[] }): { readonly children?: readonly string[] } {
  const children = lines.filter((line): line is string => line !== undefined && line.length > 0);
  return children.length === 0 ? {} : { children };
}
