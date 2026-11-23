/**
 * Every status `slopweaver github lap` posts, as pure functions: `pending` before its first lane, `error` when it
 * could not run its lanes at all, and the verdict each context earns from the steps that ran. Whether a lap may
 * run, its receipt and its hold reads are `./lapVerdict.ts`'s.
 */

import { LAP_CONTEXTS, type LapStep, STATUS_DESCRIPTION_MAX } from "./lapCore.js";

/** One finished step. */
export interface LapStepOutcome {
  readonly id: string;
  readonly context: string;
  readonly exitCode: number;
  readonly wallMs: number;
  /** The exit of a red first attempt the step was retried after, absent for a step that ran once. */
  readonly firstExit?: number;
}

/** The status one context gets: `pending` while a lap runs, `error` when it could not, else its verdict. */
export interface LapStatus {
  readonly context: string;
  readonly state: "pending" | "success" | "failure" | "error";
  readonly description: string;
}

/** The longest step id a description carries whole, so the facts after it always fit GitHub's cap. */
const DESCRIPTION_ID_MAX = 30;

/** The first `max` characters of `text`, counted by code point so a cut never splits a surrogate pair. */
function capText({ text, max }: { text: string; max: number }): string {
  return Array.from(text).slice(0, max).join("");
}

/** A step id cut to `DESCRIPTION_ID_MAX` characters, marked when cut. */
function clipId({ id }: { id: string }): string {
  return Array.from(id).length <= DESCRIPTION_ID_MAX ? id : `${capText({ max: DESCRIPTION_ID_MAX - 1, text: id })}…`;
}

/** Whole minutes, at least one, for a description a reader scans. */
function minutesOf({ ms }: { ms: number }): string {
  return `${String(Math.max(1, Math.round(ms / 60_000)))}m`;
}

/**
 * The statuses a lap posts BEFORE its first lane, so an earlier green on the same commit stops being current
 * the moment a rerun starts — a lap that then dies leaves `pending`, never the old green.
 *
 * @param baseTip the base commit the head was checked to contain
 * @param note a batch's note after the base (`lapBatchCore.ts`), absent for one pull request
 * @returns one `pending` status per context
 */
export function lapPendingStatuses({
  baseTip,
  note,
}: {
  baseTip: string;
  note?: string | undefined;
}): readonly LapStatus[] {
  return LAP_CONTEXTS.map((context) => ({
    context,
    description: `local lap running over base ${baseOf({ baseTip, note })}`,
    state: "pending",
  }));
}

/** The base a description names, ten characters of its sha, then a batch's note when there is one. */
function baseOf({ baseTip, note }: { baseTip: string; note: string | undefined }): string {
  return note === undefined ? baseTip.slice(0, 10) : `${baseTip.slice(0, 10)}${note}`;
}

/**
 * The statuses a lap posts when it could not run its lanes at all — a checkout or a store that would not start.
 *
 * @param baseTip the base commit the head was checked to contain
 * @param why the one-line reason, cut to fit GitHub's cap
 * @param note a batch's note after the base, absent for one pull request
 * @returns one `error` status per context
 */
export function lapErrorStatuses({
  baseTip,
  why,
  note,
}: {
  baseTip: string;
  why: string;
  note?: string | undefined;
}): readonly LapStatus[] {
  return LAP_CONTEXTS.map((context) => ({
    context,
    description: capText({
      max: STATUS_DESCRIPTION_MAX,
      text: `local lap could not run over base ${baseOf({ baseTip, note })}: ${why}`,
    }),
    state: "error",
  }));
}

/** The verdict one context earns from the steps planned and run under it. */
function contextStatus({
  context,
  planned,
  ran,
  base,
  lead,
}: {
  context: string;
  planned: number;
  ran: readonly LapStepOutcome[];
  base: string;
  /** `local lap`, or `local lap batch` for a batch, whose green `--land-only` must never read as one head's. */
  lead: string;
}): LapStatus {
  const red = ran.find((outcome) => outcome.exitCode !== 0);
  const retriedGreen = ran
    .filter((outcome) => outcome.firstExit !== undefined && outcome.exitCode === 0)
    .map((outcome) => outcome.id);
  // The only part GitHub's cap may cut is this tail's id list: its count, and every fact before it, always fit.
  const retriedTail =
    retriedGreen.length === 0 ? "" : `; ${String(retriedGreen.length)} green only on retry: ${retriedGreen.join(", ")}`;
  const fit = ({ facts }: { facts: string }): string =>
    capText({ max: STATUS_DESCRIPTION_MAX, text: `${facts}${retriedTail}` });
  if (red !== undefined) {
    const redOnRetry = red.firstExit === undefined ? "" : " on its retry";
    const facts = `${lead}: ${clipId({ id: red.id })} failed (exit ${String(red.exitCode)})${redOnRetry} over base ${base}`;
    return { context, description: fit({ facts }), state: "failure" };
  }
  if (ran.length < planned) {
    const facts = `${lead} stopped: ${String(planned - ran.length)} of ${String(planned)} steps never ran over base ${base}`;
    return { context, description: fit({ facts }), state: "failure" };
  }
  const wallMs = ran.reduce((sum, outcome) => sum + outcome.wallMs, 0);
  const facts = `${lead}: ${String(planned)} steps green in ${minutesOf({ ms: wallMs })} over base ${base}`;
  return { context, description: fit({ facts }), state: "success" };
}

/**
 * The status each context earns. A context is green only when EVERY planned step under it ran and passed: a lap
 * stopped at its first red leaves later steps unrun, and an unrun step is never evidence.
 *
 * @param plan the steps the lap planned
 * @param outcomes the steps that ran, in order
 * @param baseTip the base commit the head was checked to contain
 * @param note a batch's note after the base, absent for one pull request. A batch's statuses also open
 *   `local lap batch:`, never `local lap: `, so `--land-only` on one member never reads the batch's green as its own
 * @returns one status per context, in `LAP_CONTEXTS` order
 */
export function lapStatuses({
  plan,
  outcomes,
  baseTip,
  note,
}: {
  plan: readonly LapStep[];
  outcomes: readonly LapStepOutcome[];
  baseTip: string;
  note?: string | undefined;
}): readonly LapStatus[] {
  return LAP_CONTEXTS.map((context) =>
    contextStatus({
      base: baseOf({ baseTip, note }),
      context,
      lead: note === undefined ? "local lap" : "local lap batch",
      planned: plan.filter((step) => step.context === context).length,
      ran: outcomes.filter((outcome) => outcome.context === context),
    }),
  );
}
