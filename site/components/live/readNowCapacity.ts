/**
 * The capacity tile's shape and its reader for `machine capacity --json`. A sibling of `./readNow.ts`, under every
 * rule its module doc states.
 */

import { bags, bool, isBag, num, str, strings, sub } from "../../lib/bag";
import type { GlancePlans } from "../../lib/fleetGlancePlans";
import { readGlancePlans } from "./readGlance";
import {
  type CapacityCulprit,
  type CapacityDispatch,
  type CpuConsumers,
  cpuConsumersOf,
  dispatchOf,
  laterRows,
  type MemoryConsumer,
  memoryConsumerOf,
} from "./readNowConsumers";

/** What the machine can carry right now, in `machine capacity`'s own verdict. */
export interface Capacity {
  /** The verb's whole sentence — HOLD, ALERT, SUBJECT and the figures behind them. */
  readonly verdict: string;
  readonly hold: boolean;
  readonly alert: boolean;
  readonly holdSubjects: readonly string[];
  readonly graded: readonly string[];
  readonly load1: number;
  readonly load5: number;
  readonly load15: number;
  /** The 1-min load at which the verb declares a HOLD, so the meter can draw the line it is judged against. */
  readonly loadHold: number;
  readonly swapUsedGb: number;
  readonly swapTotalGb: number;
  readonly diskFreeGb: number;
  readonly diskUsedPct: number;
  /** The free GB the verb holds below; absent on a capture from before the field. */
  readonly diskHoldFreeGb: number | undefined;
  readonly fleetSessions: number;
  readonly orphanCount: number;
  readonly culprit: CapacityCulprit | undefined;
  /** Cores busy that `top` cannot attribute to a process — absent when the verb could not measure it. */
  readonly unattributedCores: number | undefined;
  /**
   * `top`'s whole-machine idle percentage, Activity Monitor's figure, which clears a load over its hold — absent
   * when the verb could not read it or on a capture from before the field existed.
   */
  readonly idlePct: number | undefined;
  /** The Claude plans' ceilings the Fleet page's glance judges the burst from. */
  readonly plans: GlancePlans;
  /** The heaviest processes by `%CPU`; absent on a capture from before the field. */
  readonly cpu: CpuConsumers | undefined;
  /** The heaviest processes by memory; absent on a capture from before the field. */
  readonly memory: readonly MemoryConsumer[] | undefined;
  /** The dispatch register at the reading; absent on a capture from before the field. */
  readonly dispatch: CapacityDispatch | undefined;
}

/**
 * Project `machine capacity --json` into the capacity tile's shape.
 *
 * @returns the reading, or `undefined` when the payload is not one
 */
export function readCapacity(payload: unknown): Capacity | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const verdict = str({ bag: payload, key: "verdict" });
  const hold = bool({ bag: payload, key: "hold" });
  const alert = bool({ bag: payload, key: "alert" });
  const holdSubjects = strings({ bag: payload, key: "holdSubjects" });
  const graded = strings({ bag: payload, key: "graded" });
  const load = sub({ bag: payload, key: "load" });
  const loadHold = num({ bag: payload, key: "loadHold" });
  const swapUsedGb = num({ bag: payload, key: "swapUsedGb" });
  const swapTotalGb = num({ bag: payload, key: "swapTotalGb" });
  const diskFreeGb = num({ bag: payload, key: "diskFreeGb" });
  const diskUsedPct = num({ bag: payload, key: "diskUsedPct" });
  const fleet = sub({ bag: payload, key: "fleet" });
  if (
    verdict === undefined ||
    hold === undefined ||
    alert === undefined ||
    holdSubjects === undefined ||
    graded === undefined ||
    load === undefined ||
    loadHold === undefined ||
    swapUsedGb === undefined ||
    swapTotalGb === undefined ||
    diskFreeGb === undefined ||
    diskUsedPct === undefined ||
    fleet === undefined
  ) {
    return undefined;
  }
  const load1 = num({ bag: load, key: "load1" });
  const load5 = num({ bag: load, key: "load5" });
  const load15 = num({ bag: load, key: "load15" });
  const sessions = bags({ bag: fleet, key: "sessions" });
  const orphanCount = num({ bag: fleet, key: "orphanCount" });
  if (
    load1 === undefined ||
    load5 === undefined ||
    load15 === undefined ||
    sessions === undefined ||
    orphanCount === undefined
  ) {
    return undefined;
  }
  const culpritBag = sub({ bag: payload, key: "culprit" });
  let culprit: CapacityCulprit | undefined;
  if (culpritBag !== undefined) {
    const subject = str({ bag: culpritBag, key: "subject" });
    const why = str({ bag: culpritBag, key: "why" });
    const kill = str({ bag: culpritBag, key: "kill" });
    if (subject === undefined || why === undefined || kill === undefined) {
      return undefined;
    }
    culprit = { kill, subject, why };
  }
  let unattributedCores: number | undefined;
  let idlePct: number | undefined;
  const hidden = sub({ bag: payload, key: "hiddenCpu" });
  if (hidden !== undefined) {
    unattributedCores = num({ bag: hidden, key: "unattributedCores" });
    idlePct = num({ bag: hidden, key: "idlePct" });
    // Optional (a capture from before the field existed has none), but one that is present must be a percentage.
    const idleOutOfRange = idlePct === undefined || idlePct < 0 || idlePct > 100;
    if (Object.hasOwn(hidden, "idlePct") && idleOutOfRange) {
      return undefined;
    }
  }
  const cpu = cpuConsumersOf({ payload });
  const memory = laterRows({ bag: payload, key: "processes", read: memoryConsumerOf });
  const dispatch = dispatchOf({ payload });
  if (cpu === false || memory === false || dispatch === false) {
    return undefined;
  }
  return {
    alert,
    cpu,
    culprit,
    dispatch,
    memory,
    diskFreeGb,
    diskHoldFreeGb: num({ bag: payload, key: "diskHoldFreeGb" }),
    diskUsedPct,
    fleetSessions: sessions.length,
    graded,
    hold,
    holdSubjects,
    idlePct,
    load1,
    load15,
    load5,
    loadHold,
    orphanCount,
    plans: readGlancePlans({ payload }),
    swapTotalGb,
    swapUsedGb,
    unattributedCores,
    verdict,
  };
}
