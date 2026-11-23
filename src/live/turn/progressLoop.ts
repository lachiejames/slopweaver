/**
 * The planning loop, read off a turn's progress timeline — the pure half of the card's meter, outline and
 * loop section.
 *
 * ## The complaint this answers
 *
 * The owner, watching a thread whose card had become fifteen past-tense `✓` lines after three workers, a
 * re-dispatch and two review rounds, asked for a progress tracker that better illustrates the dynamic planning
 * loop. Reproduce the flat card off its own log:
 *
 * ```bash
 * grep '"kind":"stage"' "$SLOPWEAVER_HOME/live/slack/progress/C0SYN000010-1790924298.202269.jsonl" | wc -l
 * ```
 *
 * The card had no plan to measure progress against, no marker for the live step beyond "the last line", and
 * no trace of the loop itself — the re-dispatch and both review rounds were visible only in the worker's own
 * prose. So the card now carries three things, and this module derives every one of them:
 *
 * - a METER — `▰▰▱▱▱ step 3 of 5 · worker 3 · review round 2` — the job-level fraction from a declared plan;
 * - an OUTLINE — the plan's steps, done, live and pending, with only the live step expanded;
 * - the LOOP — every plan, re-plan, worker handover and review round in order, each with the updates written
 *   in it, below the fold so nothing a stage learned is lost and nothing competes with the outline.
 *
 * ## What is bounded, and where
 *
 * Above the fold is bounded BY CONSTRUCTION: `turn status --plan` refuses more than `PLAN_STEPS_MAX` steps or
 * a step longer than `PLAN_STEP_TITLE_MAX` characters (`./liveStatusCap.ts`), naming the count (`AGENTS.md` rule 7 —
 * refuse, never truncate). Below the fold the loop keeps the latest {@link LOOP_PHASE_UPDATES_MAX} updates a
 * phase and the latest {@link LOOP_PHASES_MAX} phases, each with a line counting what it folded away: those
 * are bounds on history a reader already saw, so a sixty-stage turn cannot push one `chat.update` past Slack's
 * size limits and freeze the card it exists to keep moving.
 */

import type {
  ProgressPlanEvent,
  ProgressReviewEvent,
  ProgressStageEvent,
  ProgressTimelineEvent,
} from "./progressLog.js";

/** The most updates one loop phase shows; earlier ones fold into a counted line. */
export const LOOP_PHASE_UPDATES_MAX = 6;

/** The most phases the loop section shows; earlier ones fold into a counted line. */
export const LOOP_PHASES_MAX = 12;

/**
 * What opened a phase of the loop.
 *
 * @internal
 */
export type LoopPhaseKind = "start" | "plan" | "replan" | "handover" | "review";

/** One phase of the loop: what opened it, and every update written while it stood. */
export interface LoopPhase {
  readonly kind: LoopPhaseKind;
  readonly title: string;
  readonly updates: readonly string[];
}

/**
 * The plan standing now, and where the work is in it.
 *
 * @internal
 */
export interface LoopPlan {
  /** The newest plan's steps. */
  readonly steps: readonly string[];
  /** How many times the worker re-planned — every plan after the first. */
  readonly replans: number;
  /** The 1-based step in flight: the last one a stage named since this plan, else the first. */
  readonly currentStep: number;
  /** The latest update written against each step since this plan, keyed by 1-based step. */
  readonly findings: ReadonlyMap<number, string>;
}

/** Everything the card draws, read off one timeline. */
export interface LoopView {
  readonly plan: LoopPlan | undefined;
  /** The newest stage, whatever plan it was written under. */
  readonly latest: ProgressStageEvent | undefined;
  /** How many stages the turn has written. */
  readonly updates: number;
  /** How many worker generations wrote it: one, plus a handover per change of writing session. */
  readonly workers: number;
  /** The highest review round opened, `0` with none. */
  readonly reviewRounds: number;
  readonly phases: readonly LoopPhase[];
}

/**
 * The plan standing now, or `undefined` when the worker never declared one. Pure.
 *
 * A stage that names no step is the step already in flight, so a worker that says `--step 2` once and then
 * reports three findings has filed all three against step 2. A step past the plan's end — only a hand-edited
 * log can carry one, since the verb refuses it — is read as the last step rather than as an outline with no
 * live line.
 *
 * @param timeline the turn's timeline, in file order
 * @returns the plan, or `undefined`
 */
function standingPlan({ timeline }: { timeline: readonly ProgressTimelineEvent[] }): LoopPlan | undefined {
  const plans = timeline.filter((event) => event.kind === "plan");
  const newest = plans[plans.length - 1];
  if (newest === undefined) {
    return undefined;
  }
  const since = timeline.slice(timeline.lastIndexOf(newest) + 1);
  const findings = new Map<number, string>();
  let currentStep = 1;
  for (const event of since) {
    if (event.kind !== "stage") {
      continue;
    }
    if (event.step !== undefined) {
      currentStep = Math.min(event.step, newest.steps.length);
    }
    findings.set(currentStep, event.text);
  }
  return { currentStep, findings, replans: plans.length - 1, steps: newest.steps };
}

/**
 * Walk the timeline into phases, counting worker generations and review rounds on the way. Pure.
 *
 * A new phase opens on every plan, every review round and every HANDOVER — a stage written by a different
 * session from the last one that named its writer. A stage before anything opened a phase opens the `start`
 * phase. A stage that names no writer joins the generation before it, which is what a log written before the
 * field existed reads as.
 *
 * @param timeline the turn's timeline, in file order
 * @returns the phases, the worker count and the highest round
 */
function walkPhases({ timeline }: { timeline: readonly ProgressTimelineEvent[] }): {
  readonly phases: readonly LoopPhase[];
  readonly workers: number;
  readonly reviewRounds: number;
} {
  const walk: Walk = { lastWorker: undefined, phases: [], plans: 0, reviewRounds: 0, workers: 1 };
  for (const event of timeline) {
    if (event.kind === "stage") {
      fileStage({ event, walk });
      continue;
    }
    walk.phases.push(openedPhase({ event, walk }));
  }
  return { phases: walk.phases, reviewRounds: walk.reviewRounds, workers: walk.workers };
}

/** What {@link walkPhases} carries from one event to the next. */
interface Walk {
  lastWorker: string | undefined;
  readonly phases: { kind: LoopPhaseKind; title: string; updates: string[] }[];
  plans: number;
  reviewRounds: number;
  workers: number;
}

/**
 * The phase a plan or a review round opens, counting it on the walk.
 *
 * @param event the plan or round
 * @param walk the walk so far, updated in place
 * @returns the phase it opens
 */
function openedPhase({
  event,
  walk,
}: {
  event: ProgressPlanEvent | ProgressReviewEvent;
  walk: Walk;
}): Walk["phases"][number] {
  if (event.kind === "review") {
    walk.reviewRounds = Math.max(walk.reviewRounds, event.round);
    return { kind: "review", title: `independent review, round ${String(event.round)}`, updates: [] };
  }
  walk.plans += 1;
  const count = `${String(event.steps.length)} step${event.steps.length === 1 ? "" : "s"}`;
  if (walk.plans === 1) {
    return { kind: "plan", title: `planned ${count}`, updates: [] };
  }
  return { kind: "replan", title: `re-planned to ${count}`, updates: [] };
}

/**
 * File one stage into the phase standing — opening a handover phase first when its writer changed, and the
 * `start` phase when nothing has opened one yet.
 *
 * @param event the stage
 * @param walk the walk so far, updated in place
 */
function fileStage({ event, walk }: { event: ProgressStageEvent; walk: Walk }): void {
  const worker = event.worker;
  const handover = worker !== undefined && walk.lastWorker !== undefined && worker !== walk.lastWorker;
  if (handover) {
    walk.workers += 1;
    walk.phases.push({ kind: "handover", title: `worker ${String(walk.workers)} picked up the work`, updates: [] });
  }
  if (worker !== undefined) {
    walk.lastWorker = worker;
  }
  if (walk.phases.length === 0) {
    walk.phases.push({ kind: "start", title: "started", updates: [] });
  }
  walk.phases[walk.phases.length - 1]!.updates.push(event.text);
}

/**
 * Read the whole loop off one timeline. Pure and total — an empty timeline is a turn that has not started
 * reporting, with no plan, one worker and no phase.
 *
 * @param timeline the turn's stages, plans and review rounds, in file order
 * @returns the view the card draws
 */
export function loopView({ timeline }: { timeline: readonly ProgressTimelineEvent[] }): LoopView {
  const stages = timeline.filter((event) => event.kind === "stage");
  const walked = walkPhases({ timeline });
  return {
    latest: stages[stages.length - 1],
    phases: walked.phases,
    plan: standingPlan({ timeline }),
    reviewRounds: walked.reviewRounds,
    updates: stages.length,
    workers: walked.workers,
  };
}

/**
 * The meter's bar: one filled cell per finished planned step, one hollow per step still to go.
 *
 * @param done how many planned steps are finished
 * @param total how many steps the plan holds
 * @returns the bar
 */
function meterBar({ done, total }: { done: number; total: number }): string {
  return `${"▰".repeat(done)}${"▱".repeat(Math.max(0, total - done))}`;
}

/**
 * The loop facts the meter names after the fraction — only the ones that happened.
 *
 * @param view the loop view
 * @returns the clauses, in a fixed order
 */
function loopClauses({ view }: { view: LoopView }): readonly string[] {
  const clauses: string[] = [];
  if (view.workers > 1) {
    clauses.push(`worker ${String(view.workers)}`);
  }
  if (view.reviewRounds > 0) {
    clauses.push(`review round ${String(view.reviewRounds)}`);
  }
  const replans = view.plan === undefined ? 0 : view.plan.replans;
  if (replans === 1) {
    clauses.push("re-planned");
  }
  if (replans > 1) {
    clauses.push(`re-planned ${String(replans)} times`);
  }
  return clauses;
}

/**
 * The meter line — the job-level reading of the whole turn — or `undefined` when there is nothing worth a
 * line: no plan, at most one update, one worker and no review. Pure.
 *
 * With a plan it leads with the bar and the fraction (`▰▰▱▱▱ step 3 of 5`), or `5 of 5 steps done` once the
 * turn has finished. Without one there is no fraction to honestly draw, so it counts the updates instead —
 * every one of them is in the loop section below the fold.
 *
 * @param finished whether the turn reached its terminal state
 * @param view the loop view
 * @returns the line, or `undefined`
 */
export function meterLine({ finished, view }: { finished: boolean; view: LoopView }): string | undefined {
  const clauses = loopClauses({ view });
  const plan = view.plan;
  if (plan !== undefined) {
    const total = plan.steps.length;
    const done = finished ? total : plan.currentStep - 1;
    const where = finished
      ? `${String(total)} of ${String(total)} steps done`
      : `step ${String(plan.currentStep)} of ${String(total)}`;
    return [`${meterBar({ done, total })} ${where}`, ...clauses].join(" · ");
  }
  if (view.updates <= 1 && clauses.length === 0) {
    return undefined;
  }
  const updates = `${String(view.updates)} update${view.updates === 1 ? "" : "s"} so far`;
  return [...clauses, updates].join(" · ");
}

/**
 * One phase's updates, keeping the latest {@link LOOP_PHASE_UPDATES_MAX} behind a line counting the rest.
 *
 * @param updates the phase's updates, oldest first
 * @returns the lines to show, oldest first
 */
export function boundedUpdates({ updates }: { updates: readonly string[] }): readonly string[] {
  if (updates.length <= LOOP_PHASE_UPDATES_MAX) {
    return updates;
  }
  const folded = updates.length - LOOP_PHASE_UPDATES_MAX;
  return [`… ${String(folded)} earlier update${folded === 1 ? "" : "s"}`, ...updates.slice(-LOOP_PHASE_UPDATES_MAX)];
}

/**
 * The phases the loop section shows: the latest {@link LOOP_PHASES_MAX}, and how many earlier ones it folded.
 *
 * @param phases every phase, oldest first
 * @returns the phases to show and the count folded away
 */
export function boundedPhases({ phases }: { phases: readonly LoopPhase[] }): {
  readonly folded: number;
  readonly shown: readonly LoopPhase[];
} {
  if (phases.length <= LOOP_PHASES_MAX) {
    return { folded: 0, shown: phases };
  }
  return { folded: phases.length - LOOP_PHASES_MAX, shown: phases.slice(-LOOP_PHASES_MAX) };
}
