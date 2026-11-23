/**
 * The fleet's recent states, as the supervisor's own ticks recorded them — what `slopweaver fleet history` prints and
 * the Fleet page folds under its state.
 *
 * Pure: it projects tick rows a reader already parsed (`./stateHistoryRead.ts`) into the few facts the page's
 * judgement reads — the machine's hold, the plans' ceilings, the working count and how many ready rows had nobody
 * on — and judges nothing itself. The verdict stays the page's (`site/lib/fleetGlance.ts`), so the history and the
 * badge above it cannot be worded by two different rules.
 *
 * **A fact a tick did not record is said, never filled.** An older row lacks the open-ready count,
 * so a held-below-ceiling tick without it cannot tell "nothing ready" from "picking up more"; it carries
 * `not-recorded` naming that, and the page renders it as not measured.
 */
import type { CeilingsReading } from "../capacity/ceilings.js";
import type { SupervisorTickRow, TickSeatCeiling } from "../supervisor/tickTypes.js";

/** The longest window `fleet history` reads: a week, the span the plans' own ceilings reset on. */
export const MAX_HISTORY_HOURS = 168;

/** What one tick recorded of the machine and the plans, or why it recorded nothing. */
type HistoryCapacity =
  | {
      readonly kind: "read";
      /**
       * When the tick read the machine and the plans — the instant a time-dependent judgement (the week's pace)
       * stands at, exactly as the badge judges a live reading at its own `observedAtIso`.
       */
      readonly observedAtIso: string;
      readonly hold: boolean;
      readonly holdSubjects: readonly string[];
      readonly load1: number;
      /** The 1-minute load the hold is judged at; `null` on a row from before ticks recorded it. */
      readonly loadHold: number | null;
      /** Every plan's ceiling in the same pass; `null` on a row from before ticks recorded them. */
      readonly ceilings: CeilingsReading | null;
      /** The working seats the plans' week carried; `null` when the tick captured no `fleet ceiling`. */
      readonly seatCeiling: TickSeatCeiling | null;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** How many sessions were working at the tick, or why the fleet was not read. */
type HistoryWorking =
  { readonly kind: "read"; readonly working: number } | { readonly kind: "unavailable"; readonly why: string };

/** How many ready rows had nobody on them at the tick, or why that was not recorded. */
type HistoryReady =
  { readonly kind: "read"; readonly openReadyCount: number } | { readonly kind: "not-recorded"; readonly why: string };

/** One tick's facts. */
export interface FleetHistoryRow {
  readonly tickId: string;
  /** When the tick finalised — the instant its facts stand at. */
  readonly atIso: string;
  readonly capacity: HistoryCapacity;
  readonly working: HistoryWorking;
  readonly ready: HistoryReady;
}

/** The window, oldest tick first. */
export interface FleetHistoryDocument {
  readonly observedAtIso: string;
  readonly fromIso: string;
  readonly toIso: string;
  /**
   * Whether the read reached back to `fromIso` (or the ledger's first row). `false` when the reader's byte budget ran
   * out first, so the earliest row here is where the history starts, not `fromIso`.
   */
  readonly reachedFrom: boolean;
  readonly rows: readonly FleetHistoryRow[];
}

/** Said of every row from before the tick recorded the open-ready count. */
export const READY_NOT_RECORDED = "this tick did not record whether a ready row lacked a session";

/**
 * What one tick recorded of the machine and the plans.
 *
 * @returns the capacity facts, or the tick's own reason it has none
 */
function capacityOf({ row }: { row: SupervisorTickRow }): HistoryCapacity {
  const observation = row.sources.capacity;
  if (observation.status === "unavailable") {
    return { kind: "unavailable", why: observation.diagnostic };
  }
  const { facts } = observation;
  let loadHold: number | null = null;
  if (facts.loadHold !== undefined) {
    loadHold = facts.loadHold;
  }
  let ceilings: CeilingsReading | null = null;
  if (facts.ceilings !== undefined) {
    ceilings = facts.ceilings;
  }
  let seatCeiling: TickSeatCeiling | null = null;
  if (facts.workingSeatCeiling !== undefined) {
    seatCeiling = facts.workingSeatCeiling;
  }
  return {
    ceilings,
    hold: facts.hold,
    holdSubjects: facts.holdSubjects,
    kind: "read",
    load1: facts.load1,
    loadHold,
    observedAtIso: observation.observedAtIso,
    seatCeiling,
  };
}

/**
 * How many sessions the tick's watch read as working — the same signal the page's own working count reads.
 *
 * @returns the count, or the watch's own reason it read nothing
 */
function workingOf({ row }: { row: SupervisorTickRow }): HistoryWorking {
  const observation = row.sources.watch;
  if (observation.status === "unavailable") {
    return { kind: "unavailable", why: observation.diagnostic };
  }
  return { kind: "read", working: observation.facts.rows.filter((one) => one.state === "working").length };
}

/**
 * How many ready rows had nobody on them, where the tick recorded it.
 *
 * @returns the count, or why it is not known
 */
function readyOf({ row }: { row: SupervisorTickRow }): HistoryReady {
  const observation = row.sources.reconcile;
  if (observation.status === "unavailable") {
    return { kind: "not-recorded", why: `the board was not read this tick: ${observation.diagnostic}` };
  }
  if (observation.facts.openReadyCount === undefined) {
    return { kind: "not-recorded", why: READY_NOT_RECORDED };
  }
  return { kind: "read", openReadyCount: observation.facts.openReadyCount };
}

/**
 * One tick's facts, as the history carries them.
 *
 * @returns the row
 */
function fleetHistoryRowOf({ row }: { row: SupervisorTickRow }): FleetHistoryRow {
  return {
    atIso: row.finalisedIso,
    capacity: capacityOf({ row }),
    ready: readyOf({ row }),
    tickId: row.tickId,
    working: workingOf({ row }),
  };
}

/**
 * The window's history: every tick finalised inside `[fromIso, toIso]`, oldest first, ties broken by tick id so two
 * reads of one ledger print the same document.
 *
 * @param ticks the tick rows read, in any order
 * @param reachedFrom whether the read reached back to `fromIso`
 * @returns the document
 */
export function fleetHistoryOf({
  ticks,
  fromIso,
  toIso,
  observedAtIso,
  reachedFrom,
}: {
  ticks: readonly SupervisorTickRow[];
  fromIso: string;
  toIso: string;
  observedAtIso: string;
  reachedFrom: boolean;
}): FleetHistoryDocument {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  const rows = ticks
    .filter((tick) => {
      const atMs = Date.parse(tick.finalisedIso);
      return atMs >= fromMs && atMs <= toMs;
    })
    .toSorted((a, b) => {
      const byTime = Date.parse(a.finalisedIso) - Date.parse(b.finalisedIso);
      if (byTime !== 0) {
        return byTime;
      }
      return a.tickId.localeCompare(b.tickId);
    })
    .map((tick) => fleetHistoryRowOf({ row: tick }));
  return { fromIso, observedAtIso, reachedFrom, rows, toIso };
}

/**
 * One row as a person reads it at a terminal: when, how many working, the hold and the ready count.
 *
 * @returns the line
 */
export function fleetHistoryLine({ row }: { row: FleetHistoryRow }): string {
  let working: string;
  if (row.working.kind === "read") {
    working = `${String(row.working.working)} working`;
  } else {
    working = `working not read (${row.working.why})`;
  }
  let machine: string;
  if (row.capacity.kind === "unavailable") {
    machine = `machine not read (${row.capacity.why})`;
  } else {
    let against = "";
    if (row.capacity.loadHold !== null) {
      against = ` against ${String(row.capacity.loadHold)}`;
    }
    machine = `load ${row.capacity.load1.toFixed(1)}${against}`;
    if (row.capacity.hold) {
      machine = `holding on ${row.capacity.holdSubjects.join(", ")}, ${machine}`;
    }
  }
  let ready = `ready not recorded`;
  if (row.ready.kind === "read") {
    ready = `${String(row.ready.openReadyCount)} ready with nobody on`;
  }
  return `${row.atIso}  ${working} · ${machine} · ${ready}`;
}
