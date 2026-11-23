/**
 * `slopweaver fleet history --json` (`src/fleet/stateHistory.ts`'s `FleetHistoryDocument`), read strictly: one row
 * that will not read refuses the whole document, because a history with a tick quietly missing reads as a fleet that
 * held steady through it.
 */
import { type Bag, bags, bool, every, instant, isBag, num, str, strings, sub } from "../../lib/bag";
import type { SeatCeiling } from "../../lib/fleetGlance";
import type { GlancePlans } from "../../lib/fleetGlancePlans";
import type { FleetHistory, HistoryCapacity, HistoryReady, HistoryTick, HistoryWorking } from "../../lib/fleetHistory";
import { readGlancePlans, readSeatCeiling } from "./readGlance";

/**
 * A field the document writes as `null` when the tick did not record it.
 *
 * @returns the number, `undefined` for a recorded `null`, or `false` when it is neither
 */
function recordedNumber({ bag, key }: { bag: Bag; key: string }): number | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return false;
  }
  if (bag[key] === null) {
    return undefined;
  }
  const value = num({ bag, key });
  if (value === undefined) {
    return false;
  }
  return value;
}

/** One row's capacity facts. */
function capacityOf(bag: Bag): HistoryCapacity | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "unavailable") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, why };
  }
  if (kind !== "read") {
    return undefined;
  }
  const hold = bool({ bag, key: "hold" });
  const holdSubjects = strings({ bag, key: "holdSubjects" });
  const load1 = num({ bag, key: "load1" });
  const loadHold = recordedNumber({ bag, key: "loadHold" });
  const observedAtIso = instant({ bag, key: "observedAtIso" });
  if (
    hold === undefined ||
    holdSubjects === undefined ||
    load1 === undefined ||
    loadHold === false ||
    observedAtIso === undefined
  ) {
    return undefined;
  }
  if (!Object.hasOwn(bag, "ceilings") || !Object.hasOwn(bag, "seatCeiling")) {
    return undefined;
  }
  let plans: GlancePlans = { kind: "absent" };
  if (bag["ceilings"] !== null) {
    plans = readGlancePlans({ payload: bag });
    if (plans.kind !== "read") {
      return undefined;
    }
  }
  let ceiling: SeatCeiling | undefined;
  if (bag["seatCeiling"] !== null) {
    ceiling = readSeatCeiling({ ceiling: bag["seatCeiling"] });
    if (ceiling === undefined) {
      return undefined;
    }
  }
  return { capacity: { hold, holdSubjects, load1, loadHold, plans }, ceiling, kind, observedAtIso };
}

/** One row's working count. */
function workingOf(bag: Bag): HistoryWorking | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "unavailable") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, why };
  }
  const working = num({ bag, key: "working" });
  if (kind !== "read" || working === undefined) {
    return undefined;
  }
  return { kind, working };
}

/** One row's open-ready count. */
function readyOf(bag: Bag): HistoryReady | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "not-recorded") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, why };
  }
  const openReadyCount = num({ bag, key: "openReadyCount" });
  if (kind !== "read" || openReadyCount === undefined) {
    return undefined;
  }
  return { kind, openReadyCount };
}

/** One tick. */
function tickOf(bag: Bag): HistoryTick | undefined {
  const tickId = str({ bag, key: "tickId" });
  const atIso = instant({ bag, key: "atIso" });
  const capacityBag = sub({ bag, key: "capacity" });
  const workingBag = sub({ bag, key: "working" });
  const readyBag = sub({ bag, key: "ready" });
  if (
    tickId === undefined ||
    atIso === undefined ||
    capacityBag === undefined ||
    workingBag === undefined ||
    readyBag === undefined
  ) {
    return undefined;
  }
  const capacity = capacityOf(capacityBag);
  const working = workingOf(workingBag);
  const ready = readyOf(readyBag);
  if (capacity === undefined || working === undefined || ready === undefined) {
    return undefined;
  }
  return { atIso, capacity, ready, tickId, working };
}

/**
 * The whole document.
 *
 * @returns the history, or `undefined` when any part of it will not read
 */
export function readFleetHistory(payload: unknown): FleetHistory | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = instant({ bag: payload, key: "observedAtIso" });
  const fromIso = instant({ bag: payload, key: "fromIso" });
  const toIso = instant({ bag: payload, key: "toIso" });
  const reachedFrom = bool({ bag: payload, key: "reachedFrom" });
  const ticks = every({ list: bags({ bag: payload, key: "rows" }), read: tickOf });
  if (
    observedAtIso === undefined ||
    fromIso === undefined ||
    toIso === undefined ||
    reachedFrom === undefined ||
    ticks === undefined
  ) {
    return undefined;
  }
  // Oldest first, whatever order the rows arrived in: the spans and the fold's newest tick both read it that way.
  const ordered = ticks.toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  return { fromIso, observedAtIso, reachedFrom, ticks: ordered, toIso };
}
