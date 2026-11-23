/**
 * THE LOAD-DISPATCH GATE — a tick that SAW the machine holding, and neither found an investigation open nor
 * said why it was leaving one unopened, cannot be RECORDED.
 *
 * ## The thing it makes impossible
 *
 * Anomalous machine load must be structurally impossible to miss. Without this gate the owner caught it by hand:
 * a load of 45.9 with a seat's `bfs` walking `/` at three cores, five stale `nx` daemons and three parked
 * seats. The fleet was not blind to it. `machine capacity` had already published a `capacity-hold` naming a
 * stalled hook, and nothing consumed it, because a reading nobody is obliged to act on is not a mechanism.
 *
 * `./outcomes/sweepGate.ts` is the precedent and it is the exact complement: it judges a tick that had
 * capacity FREE and left the owner's outcomes uncovered, and it treats `hold === true` as CLEAN. That clean arm is
 * the hole. This gate is the other side of it.
 *
 * ## The predicate, exactly — and why it has THREE conjuncts rather than two
 *
 * It refuses when ALL of these hold:
 *
 * 1. the tick's capacity reading was taken, and says the machine WAS holding — on something other than boots in
 *    flight or the disk floor alone: boots are a pause that clears itself inside its window and whose
 *    investigation would be one more boot (`../live/machine/recentBoots.ts`), and the disk floor is
 *    `worktree prune --apply`'s to clear, never an investigation's;
 * 2. that reading carried no dispatch row COVERING it — an open row that seated a visible investigation
 *    (`machine capacity --json` reads the register itself, so this arrives on the tick's existing capture
 *    rather than through a thirteenth source). An open row whose seat the backoff suppressed or whose
 *    `cmux spawn` failed is an unanswered alert, not coverage: counting one made the case where the fleet
 *    TRIED and could not the case where the gate stopped asking (review pass r2);
 * 3. and the tick recorded no `hold-rationale` judgement whose subject is the `machine`.
 *
 * The third conjunct is not softness, it is what stops this gate wedging the supervisor outright. A row is
 * written by `slopweaver machine watch`, which is BOUNDED and FOREGROUND by doctrine rule 2 — never
 * resident — so it is usually not running between ticks. With only conjuncts 1 and 2, a real hold that no
 * watcher happened to observe would refuse every tick, with nothing the chair could do in band: the one
 * writer of rows had already missed its window. So the way out is the same two-way shape `sweepGate` uses —
 * **act, or narrate**:
 *
 * - ACT: run `slopweaver machine watch --once`. It takes a reading, writes a row if the anomaly is real,
 *   and exits clean if it is not — seconds when clear, minutes when it seats (never under a short
 *   `timeout`: `../cli/commands/machine/watchSeat.ts`) — and the gate is satisfied by evidence rather than by
 *   assertion.
 * - NARRATE: record a `hold-rationale` judgement on the `machine` subject saying why this tick is leaving
 *   the hold alone — holding off because the load is heavy is a legitimate call when it is said out loud.
 *
 * ## A gate that cannot SEE refuses too
 *
 * A capacity observation that is not `read`/`partial` is a reading this tick never took, and one carrying no
 * `hold` is a document produced before this existed. Both refuse as `unreadable`, for the reason every other
 * gate in this tree does: a check that reports clean on an input it never saw is worse than no check.
 *
 * Pure — the draft's own values in, a verdict out. No filesystem, no clock, no env;
 * `../cli/commands/supervisor/tickRecordRun.ts` reads the hatch and renders the refusal.
 */

import { isRecord } from "../lib/parsers.js";
import { machineHoldStands } from "../live/machine/recentBoots.js";

/** The judgement kind that answers for a hold by narrating it, rather than by dispatching into it. */
const HOLD_RATIONALE = "hold-rationale";

/** The subject kind a machine-level judgement carries. */
const MACHINE = "machine";

/** Why a tick is being refused for an undispatched hold, or that it is not. */
export type LoadDispatchVerdict =
  /** Nothing to answer for: the machine was not holding, an investigation is seated, or the tick said why not. */
  | { readonly kind: "clean" }
  /** The gate could not judge, and says which input it could not read. */
  | { readonly kind: "unreadable"; readonly why: string }
  /** The machine held, nothing was dispatched into it, and the tick gave no reason. */
  | {
      readonly kind: "refused";
      /** Which subjects held — `memory`, `cpu`, or both — so the refusal names what it is about. */
      readonly holdSubjects: readonly string[];
      /** The 1-minute load at the reading, so a reader can judge severity without re-reading. */
      readonly load1: number;
    };

/** A string field on a record, or "" when it is absent or not a string. */
function str({ key, on }: { key: string; on: Record<string, unknown> }): string {
  const value = on[key];
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

/** What the tick's capacity observation says about the hold, or the reason it says nothing. */
type HoldReading =
  | {
      readonly kind: "read";
      readonly hold: boolean;
      readonly holdSubjects: readonly string[];
      readonly load1: number;
      readonly dispatchCovering: number;
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Decode the capacity slice of a tick draft's sources.
 *
 * Deliberately built to the same shape as `./outcomes/sweepGate.ts#machineHeld` rather than sharing a
 * helper with it: the two gates read the same observation for opposite purposes, and a shared decoder would
 * make a change made for one silently change the other.
 */
function holdReadingOf({ sources }: { sources: unknown }): HoldReading {
  if (!isRecord(sources) || !isRecord(sources["capacity"])) {
    return { kind: "unreadable", why: "the draft carries no capacity observation at all" };
  }
  const capacity = sources["capacity"];
  const status = str({ key: "status", on: capacity });
  if (status !== "read" && status !== "partial") {
    const named = status === "" ? "malformed" : status;
    return {
      kind: "unreadable",
      why: `the draft's capacity observation is "${named}", so this tick never read whether the machine was holding`,
    };
  }
  const facts = capacity["facts"];
  if (!isRecord(facts) || typeof facts["hold"] !== "boolean") {
    return { kind: "unreadable", why: "the draft's capacity observation carries no `hold` reading" };
  }
  if (typeof facts["dispatchCovering"] !== "number") {
    return {
      kind: "unreadable",
      why:
        "the draft's capacity observation carries no `dispatchCovering` count — re-capture it with " +
        "`slopweaver machine capacity --json`, which reads the dispatch register itself",
    };
  }
  const subjects = facts["holdSubjects"];
  const load1 = facts["load1"];
  return {
    dispatchCovering: facts["dispatchCovering"],
    hold: facts["hold"],
    holdSubjects: Array.isArray(subjects) ? subjects.filter((entry: unknown) => typeof entry === "string") : [],
    kind: "read",
    load1: typeof load1 === "number" ? load1 : 0,
  };
}

/** Whether the tick recorded a hold rationale about the MACHINE — the narrate half of the way out. */
function machineRationaleRecorded({ judgements }: { judgements: unknown }): boolean {
  if (!Array.isArray(judgements)) {
    return false;
  }
  return judgements.some((judgement: unknown) => {
    if (!isRecord(judgement) || judgement["kind"] !== HOLD_RATIONALE) {
      return false;
    }
    const subject = judgement["subject"];
    return isRecord(subject) && subject["kind"] === MACHINE;
  });
}

/**
 * Judge one tick against the hold it read.
 *
 * @param sources the draft's twelve source observations, of which the capacity one is read
 * @param judgements what the tick concluded — a `hold-rationale` on the `machine` subject answers for a hold
 * @returns the verdict the recorder acts on
 */
export function judgeLoadDispatch({
  sources,
  judgements,
}: {
  sources: unknown;
  judgements: unknown;
}): LoadDispatchVerdict {
  const reading = holdReadingOf({ sources });
  if (reading.kind === "unreadable") {
    return { kind: "unreadable", why: reading.why };
  }
  if (!machineHoldStands({ hold: reading.hold, holdSubjects: reading.holdSubjects })) {
    return { kind: "clean" };
  }
  if (reading.dispatchCovering > 0) {
    return { kind: "clean" };
  }
  if (machineRationaleRecorded({ judgements })) {
    return { kind: "clean" };
  }
  return { holdSubjects: reading.holdSubjects, kind: "refused", load1: reading.load1 };
}
