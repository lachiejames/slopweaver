/**
 * One firing of an automation's schedule, and its reader. A sibling of `./readAutomations.ts`, under every rule its
 * module doc states.
 */

import { type Bag, bool, nullableNum, nullableStr, num, str } from "../../lib/bag";

/** One firing's final stored state. */
export interface Firing {
  readonly slotIso: string;
  readonly attempt: number;
  readonly outcome: string;
  readonly startedAtIso: string;
  readonly settledAtIso: string | undefined;
  readonly detail: string | undefined;
  /** The detail cut to the reason a person reads. */
  readonly reason: string | undefined;
  /** How long its run took, or has so far, by the rule the card's "how long" answer uses — absent when not timed. */
  readonly runMs: number | undefined;
  /** Its reason in plain words, the runner's framing dropped — absent when nothing was said in words. */
  readonly said: string | undefined;
  /**
   * What went wrong and what would fix it, in one sentence the visible session that ran this firing recorded
   * (`slopweaver automation explain`) — absent for a firing that did not fail, or that no session explained. When
   * present it leads, and the raw `detail` folds.
   */
  readonly plainly: string | undefined;
  /** Whether it is the run under way: an open firing behind a later run that finished is not. */
  readonly underWay: boolean;
}

/**
 * One firing.
 *
 * @returns the firing, or `undefined` when its shape moved
 */
export function firing(bag: Bag): Firing | undefined {
  const slotIso = str({ bag, key: "slotIso" });
  const attempt = num({ bag, key: "attempt" });
  const outcome = str({ bag, key: "outcome" });
  const startedAtIso = str({ bag, key: "startedAtIso" });
  const settledAtIso = nullableStr({ bag, key: "settledAtIso" });
  const detail = nullableStr({ bag, key: "detail" });
  const reason = nullableStr({ bag, key: "reason" });
  const runMs = nullableNum({ bag, key: "runMs" });
  const said = nullableStr({ bag, key: "said" });
  const plainly = nullableStr({ bag, key: "plainly" });
  const underWay = bool({ bag, key: "underWay" });
  if (slotIso === undefined || attempt === undefined || outcome === undefined || startedAtIso === undefined) {
    return undefined;
  }
  if (settledAtIso === false || detail === false || reason === false || runMs === false || said === false) {
    return undefined;
  }
  if (underWay === undefined || plainly === false) {
    return undefined;
  }
  // Only a firing that failed or died carries a plain sentence; one on any other outcome is a payload that broke the
  // contract, refused rather than drawn.
  if (plainly !== undefined && outcome !== "failed" && outcome !== "dead") {
    return undefined;
  }
  return { attempt, detail, outcome, plainly, reason, runMs, said, settledAtIso, slotIso, startedAtIso, underWay };
}
