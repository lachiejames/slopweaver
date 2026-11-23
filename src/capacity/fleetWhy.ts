/**
 * Why the fleet is running the working seats it is, and what the machine measured over the last N minutes — the
 * Fleet page's answer to the owner's ask: when the owner looks at the fleet the page must make
 * clear WHY it is not spinning more right now, and WHAT it measured of the system's resources over the last X
 * minutes that made it think it could not.
 *
 * Pure: normalised readings in, one report out. `./fleetWhyRead.ts` reads them off the readings ledger, `slopweaver
 * fleet why` prints the report, the supervisor tick records it, and the Fleet page reads the recording.
 *
 * ## What each claim does and does not say
 *
 * - **What binds NOW is the latest tick's, never the window's.** The machine binds when that tick's `machine
 *   capacity` held; the plans bind when that tick's working seats sit at or above the ceiling `fleet ceiling`
 *   measured, which is the number the idle-capacity gate fills to (`../supervisor/idleCapacitySeats.ts`). The three
 *   readings are joined on the tick that recorded them; a reading from another tick, or a machine reading older
 *   than the window, makes the binding `unknown` rather than a guess.
 * - **The window is SAMPLED.** A tick records one capacity reading every 15–25 minutes, so "none of 4 held" is
 *   about four instants, and the widest gap between them is carried so the page can say so.
 * - **A hold explains the POLICY, not the hardware.** `machine capacity` holds when the 1-minute load crosses its
 *   hold; that is why a seat was not started, and it does not prove one more seat would have failed. Busy cores
 *   ride beside it as context.
 * - **Unattributed cpu is not assigned to anyone.** `../live/machine/hiddenCpu.ts` measures cores `top`'s rows do
 *   not account for, and separately names processes hidden from `top`; nothing establishes the one consumed the
 *   other, so the two stay two facts.
 * - **Foreign cpu is a captured LOWER bound.** `cpuHogs` keeps only the heaviest few processes, so a label's mean
 *   counts a reading it fell out of as zero; `readingsSeen` says how often it was captured.
 * - **Ten seats is a ratio, never a date.** Ten working seats is a comparison, not a floor, kept here as the
 *   bar the owner reads the fleet against. The multiple uses the
 *   unfloored rates, because flooring a 4.8-seat runway to four would overstate it.
 */
import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { fleetWhySentences } from "./fleetWhyRender.js";
import {
  type FleetWhyMachineSample,
  type FleetWhySource,
  type FleetWhyWindow,
  measureFleetWhyWindow,
} from "./fleetWhyWindow.js";

/** The window asked for is not a whole number of minutes ending at an instant. */
export interface FleetWhyInvalidWindowError {
  readonly code: "INVALID_WINDOW";
  readonly message: string;
  readonly minutes: number;
  readonly nowIso: string;
}

/** The readings ledger itself could not be read, so nothing in the report would be true. */
export interface FleetWhyLedgerUnreadableError {
  readonly code: "LEDGER_UNREADABLE";
  readonly message: string;
}

/** Why `fleet why` has no report — every other gap is a named `problem` inside one. */
export type FleetWhyError = FleetWhyInvalidWindowError | FleetWhyLedgerUnreadableError;

/** The `fleet why` failures, each with the message a caller displays. */
export const FleetWhyErrors = {
  invalidWindow: ({ minutes, nowIso }: { minutes: number; nowIso: string }): FleetWhyInvalidWindowError => ({
    code: "INVALID_WINDOW",
    message: `the window ${String(minutes)} minutes to ${nowIso} is not a whole number of minutes to an instant`,
    minutes,
    nowIso,
  }),
  ledgerUnreadable: ({ why }: { why: readonly string[] }): FleetWhyLedgerUnreadableError => ({
    code: "LEDGER_UNREADABLE",
    message: `the readings ledger could not be read: ${why.join("; ")}`,
  }),
} as const;

/** The working-seat ceiling one `fleet ceiling` reading measured, or why it could not. */
export type FleetWhyCeiling =
  | {
      readonly kind: "measured";
      readonly seats: number;
      readonly sustainablePlanWeeksPerHour: number;
      readonly burnPerWorkingSeatHour: number;
    }
  | { readonly kind: "unmeasurable"; readonly reason: string };

/** What stops one more working seat right now. `neither` means seats are free on both counts. */
type FleetWhyBinding = "plans" | "machine" | "both" | "neither" | "unknown";

/** What the plans' week carries, in working seats, and what ten would spend. */
export type FleetWhyPlans =
  | {
      readonly kind: "measured";
      readonly ceilingSeats: number;
      /** The unfloored seats the plans sustain to their resets. */
      readonly sustainableWorkingSeats: number;
      /** The share of one plan's week a working seat draws in a day. */
      readonly burnPerWorkingSeatDay: number;
      /** How many times faster than the plans reset ten working seats would spend them. */
      readonly tenSeatSpendMultiple: number;
    }
  | { readonly kind: "unmeasurable"; readonly reason: string }
  | { readonly kind: "absent" };

/** The latest tick's own figures. */
interface FleetWhyCurrent {
  readonly tick: string | null;
  readonly machineObservedAtIso: string | null;
  readonly hold: boolean | null;
  readonly holdSubjects: readonly string[];
  readonly working: number | null;
  readonly ceilingSeats: number | null;
}

/** Every measured fact of the report — what the sentences are rendered from. */
export interface FleetWhyFacts {
  readonly observedAtIso: string;
  readonly minutes: number;
  readonly binding: FleetWhyBinding;
  /** Why the binding is `unknown`, in words; `null` when it is known. */
  readonly unknownBecause: string | null;
  readonly current: FleetWhyCurrent;
  readonly window: FleetWhyWindow;
  readonly plans: FleetWhyPlans;
  readonly problems: readonly string[];
}

/** The whole report: the facts, and the sentences `./fleetWhyRender.ts` reads them as. */
export interface FleetWhyReport extends FleetWhyFacts {
  /** What binds now, what the window measured, where the cpu went — the page shows exactly these. */
  readonly sentences: readonly string[];
}

/** Ten — the working seats the owner names as the bar they read the fleet against. */
const TEN_SEATS = 10;

/** Hours in a day, for the per-seat-day burn. */
const HOURS_PER_DAY = 24;

/**
 * The plans' half: the ceiling, the unfloored seats it rounds down from, and what ten seats would spend.
 *
 * @returns the plans, or why they are not known
 */
function plansOf({ ceiling }: { ceiling: FleetWhySource<FleetWhyCeiling> | undefined }): FleetWhyPlans {
  if (ceiling === undefined) {
    return { kind: "absent" };
  }
  const measured = ceiling.value;
  if (measured.kind === "unmeasurable") {
    return { kind: "unmeasurable", reason: measured.reason };
  }
  if (measured.sustainablePlanWeeksPerHour <= 0 || measured.burnPerWorkingSeatHour <= 0) {
    return {
      kind: "unmeasurable",
      reason: "the plans' remaining rate or the burn per working seat measured zero, so no ratio of them is real",
    };
  }
  return {
    burnPerWorkingSeatDay: measured.burnPerWorkingSeatHour * HOURS_PER_DAY,
    ceilingSeats: measured.seats,
    kind: "measured",
    sustainableWorkingSeats: measured.sustainablePlanWeeksPerHour / measured.burnPerWorkingSeatHour,
    tenSeatSpendMultiple: (TEN_SEATS * measured.burnPerWorkingSeatHour) / measured.sustainablePlanWeeksPerHour,
  };
}

/**
 * Why the three current readings cannot be read as one tick, or `undefined` when they can.
 *
 * @returns the problem, or `undefined`
 */
function incoherenceOf({
  latestMachine,
  ceiling,
  workingSeats,
  fromMs,
  toMs,
}: {
  latestMachine: FleetWhySource<FleetWhyMachineSample> | undefined;
  ceiling: FleetWhySource<FleetWhyCeiling> | undefined;
  workingSeats: FleetWhySource<{ readonly working: number }> | undefined;
  fromMs: number;
  toMs: number;
}): string | undefined {
  if (latestMachine === undefined || ceiling === undefined || workingSeats === undefined) {
    const missing = [
      ...(latestMachine === undefined ? ["machine capacity"] : []),
      ...(ceiling === undefined ? ["fleet ceiling"] : []),
      ...(workingSeats === undefined ? ["session watch"] : []),
    ];
    return `no usable ${missing.join(", ")} reading, so what binds the fleet is not known`;
  }
  const ticks = [latestMachine, ceiling, workingSeats];
  if (ticks.some((source) => source.by !== latestMachine.by)) {
    const named = ticks.map((source) => `${source.by} at ${source.observedAtIso}`).join(", ");
    return `the latest machine, ceiling and seat readings came from different ticks (${named}), so what binds the fleet is not known`;
  }
  // A source's instant always parses: the reader took it off a validated ledger row.
  const machineMs = parseIsoMs({ tsIso: latestMachine.observedAtIso })!;
  if (machineMs < fromMs) {
    return `the latest machine capacity reading (${latestMachine.observedAtIso}) is older than the window, so what binds the fleet now is not known`;
  }
  // The ledger does not hold `observedAtIso` to its `recordedAtIso`, so a row can claim an instant past the window.
  if (machineMs > toMs) {
    return `the latest machine capacity reading (${latestMachine.observedAtIso}) claims an instant after the window ends, so what binds the fleet then is not known`;
  }
  return undefined;
}

/**
 * What binds the latest coherent tick.
 *
 * @returns the binding
 */
function bindingOf({
  hold,
  working,
  ceiling,
}: {
  hold: boolean;
  working: number;
  ceiling: FleetWhyCeiling;
}): FleetWhyBinding {
  if (ceiling.kind === "unmeasurable") {
    return hold ? "machine" : "unknown";
  }
  const plansBind = working >= ceiling.seats;
  if (hold && plansBind) {
    return "both";
  }
  if (hold) {
    return "machine";
  }
  if (plansBind) {
    return "plans";
  }
  return "neither";
}

/**
 * The latest readings' own figures, each `null` where its reading is not recorded. The tick is named only when the
 * three readings are one coherent tick.
 *
 * @returns the current figures
 */
function currentOf({
  latestMachine,
  ceiling,
  workingSeats,
  coherent,
}: {
  latestMachine: FleetWhySource<FleetWhyMachineSample> | undefined;
  ceiling: FleetWhySource<FleetWhyCeiling> | undefined;
  workingSeats: FleetWhySource<{ readonly working: number }> | undefined;
  coherent: boolean;
}): FleetWhyCurrent {
  let ceilingSeats: number | null = null;
  if (ceiling?.value.kind === "measured") {
    ceilingSeats = ceiling.value.seats;
  }
  let working: number | null = null;
  if (workingSeats !== undefined) {
    working = workingSeats.value.working;
  }
  if (latestMachine === undefined) {
    return { ceilingSeats, hold: null, holdSubjects: [], machineObservedAtIso: null, tick: null, working };
  }
  return {
    ceilingSeats,
    hold: latestMachine.value.hold,
    holdSubjects: latestMachine.value.holdSubjects,
    machineObservedAtIso: latestMachine.observedAtIso,
    tick: coherent ? latestMachine.by : null,
    working,
  };
}

/**
 * What binds the latest tick, and why it reads unknown when it does. A coherent tick is judged; an incoherent one
 * carries its incoherence, plus the reader's problems when a source could not be used at all.
 *
 * @returns the binding with the reason it is unknown, `null` when it is judged
 */
function judgementOf({
  incoherence,
  ceiling,
  latestMachine,
  workingSeats,
  problems,
}: {
  incoherence: string | undefined;
  ceiling: FleetWhySource<FleetWhyCeiling> | undefined;
  latestMachine: FleetWhySource<FleetWhyMachineSample> | undefined;
  workingSeats: FleetWhySource<{ readonly working: number }> | undefined;
  problems: readonly string[];
}): { binding: FleetWhyBinding; unknownBecause: string | null } {
  if (incoherence === undefined) {
    // Coherent means all three are present: `incoherenceOf` named any that was not.
    const binding = bindingOf({
      ceiling: ceiling!.value,
      hold: latestMachine!.value.hold,
      working: workingSeats!.value.working,
    });
    if (binding === "unknown" && ceiling!.value.kind === "unmeasurable") {
      const unknownBecause = `how many working seats the plans carry is not measured: ${ceiling!.value.reason}`;
      return { binding, unknownBecause };
    }
    return { binding, unknownBecause: null };
  }
  if (latestMachine === undefined || ceiling === undefined || workingSeats === undefined) {
    // A source the reader could not use names why in `problems` — never recorded, or recorded and undecodable — and
    // the page shows only the sentences, so the reason travels inside this one.
    const unknownBecause = problems.length === 0 ? incoherence : `${incoherence}: ${problems.join("; ")}`;
    return { binding: "unknown", unknownBecause };
  }
  return { binding: "unknown", unknownBecause: incoherence };
}

/**
 * Explain the fleet's working seats: what binds the latest tick, what the machine's sampled readings measured over
 * the window, and what the plans carry.
 *
 * @param nowIso the window's end and the report's instant
 * @param minutes the window's length
 * @param machineReadings the `machine capacity` readings observed inside the window, oldest first
 * @param latestMachine the newest `machine capacity` reading at `nowIso`, which may predate the window
 * @param ceiling the newest `fleet ceiling` reading at `nowIso`
 * @param workingSeats the working seats the newest `session watch` reading at `nowIso` counted
 * @param problems what the reader already could not see, carried through
 * @returns the report, or why the window itself is unusable
 */
export function measureFleetWhy({
  nowIso,
  minutes,
  machineReadings,
  latestMachine,
  ceiling,
  workingSeats,
  problems,
}: {
  nowIso: string;
  minutes: number;
  machineReadings: readonly FleetWhySource<FleetWhyMachineSample>[];
  latestMachine: FleetWhySource<FleetWhyMachineSample> | undefined;
  ceiling: FleetWhySource<FleetWhyCeiling> | undefined;
  workingSeats: FleetWhySource<{ readonly working: number }> | undefined;
  problems: readonly string[];
}): Result<FleetWhyReport, FleetWhyError> {
  const toMs = parseIsoMs({ tsIso: nowIso });
  if (toMs === undefined || !Number.isInteger(minutes) || minutes < 1) {
    return err(FleetWhyErrors.invalidWindow({ minutes, nowIso }));
  }
  const fromMs = toMs - minutes * 60_000;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const incoherence = incoherenceOf({ ceiling, fromMs, latestMachine, toMs, workingSeats });
  const facts: FleetWhyFacts = {
    // The binding and why it is unknown come from one judgement, so neither is ever set without the other.
    ...judgementOf({ ceiling, incoherence, latestMachine, problems, workingSeats }),
    current: currentOf({ ceiling, coherent: incoherence === undefined, latestMachine, workingSeats }),
    minutes,
    observedAtIso: toIso,
    plans: plansOf({ ceiling }),
    problems: [...problems, ...(incoherence === undefined ? [] : [incoherence])],
    window: measureFleetWhyWindow({ fromIso, fromMs, readings: machineReadings, toIso, toMs }),
  };
  return ok({ ...facts, sentences: fleetWhySentences({ report: facts }) });
}
