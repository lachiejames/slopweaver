/**
 * The measured-seat-ceiling half of the idle-capacity gate (`./idleCapacityGate.ts` § "When the tick MEASURED
 * how many working seats the plans carry"), split out the way `./idleCapacityCeilings.ts` carries the ceilings
 * half: it decodes the capture's `workingSeatCeiling` and the watch's working seats, decides a tick already at
 * or above N, and otherwise says which ranked rows are owed a seat and which ceiling a reason must name.
 *
 * Pure, and every decode is the gate's own for the reason `./loadDispatchGate.ts#holdReadingOf` gives.
 */
import { isRecord } from "../lib/parsers.js";

/** The one ceiling a reason may still name below a measured seat ceiling: the machine, which N does not speak for. */
const MACHINE_CEILING = "machine";

/** The watch state that draws a plan down — the same one `../capacity/seatCeilingRead.ts` counts. */
const WORKING_STATE = "working";

/** What a seat decode can decide on its own, before any row is read. */
type SeatVerdict = { readonly kind: "clean" } | { readonly kind: "unreadable"; readonly why: string };

/** The capture's measured seat ceiling: absent on an older capture, a number, the reason there is none, or malformed. */
type SeatCeilingDecode =
  | { readonly kind: "absent" }
  | { readonly kind: "measured"; readonly seats: number }
  | { readonly kind: "unmeasurable"; readonly reason: string }
  | { readonly kind: "unreadable"; readonly why: string };

/** The fill below a measured N, or `null` with the reason N was not measured (also `null` on an older capture). */
interface SeatFill {
  readonly fill: { readonly working: number; readonly ceiling: number } | null;
  readonly problem: string | null;
}

/** Decode the capacity observation's `workingSeatCeiling`, which only a newer capture carries. */
function seatCeilingOf({ sources }: { sources: unknown }): SeatCeilingDecode {
  if (!isRecord(sources) || !isRecord(sources["capacity"]) || !isRecord(sources["capacity"]["facts"])) {
    return { kind: "absent" };
  }
  const facts = sources["capacity"]["facts"];
  // Key PRESENCE, not value, for the reason `./idleCapacityCeilings.ts#ceilingsOf` gives.
  if (!("workingSeatCeiling" in facts)) {
    return { kind: "absent" };
  }
  const ceiling = facts["workingSeatCeiling"];
  const malformed = {
    kind: "unreadable",
    why: "the draft's capacity observation carries a workingSeatCeiling that is neither a whole seat count nor a reason",
  } as const;
  if (!isRecord(ceiling)) {
    return malformed;
  }
  const seats = ceiling["seats"];
  if (ceiling["kind"] === "measured" && typeof seats === "number" && Number.isInteger(seats) && seats >= 0) {
    return { kind: "measured", seats };
  }
  const reason = ceiling["reason"];
  if (ceiling["kind"] === "unmeasurable" && typeof reason === "string" && reason.length > 0) {
    return { kind: "unmeasurable", reason };
  }
  return malformed;
}

/** How many seats the tick's watch saw working, or why it saw none — a gate filling to N must know the fill. */
function workingSeatsOf({
  sources,
}: {
  sources: unknown;
}): { readonly kind: "read"; readonly value: number } | { readonly kind: "unreadable"; readonly why: string } {
  if (!isRecord(sources) || !isRecord(sources["watch"])) {
    return { kind: "unreadable", why: "the draft carries no watch observation, so how many seats work is unread" };
  }
  const watch = sources["watch"];
  const facts = watch["facts"];
  if (
    (watch["status"] !== "read" && watch["status"] !== "partial") ||
    !isRecord(facts) ||
    !Array.isArray(facts["rows"])
  ) {
    return {
      kind: "unreadable",
      why: "the draft's watch observation carries no session rows, so the fill against the measured seat ceiling is unread",
    };
  }
  const rows: readonly unknown[] = facts["rows"];
  return { kind: "read", value: rows.filter((row) => isRecord(row) && row["state"] === WORKING_STATE).length };
}

/**
 * The tick's fill against a measured seat ceiling, read BEFORE the reconciliation for the reason a hold is: at
 * or above N the answer is already determined.
 *
 * @param sources the draft's source observations; the capacity's `workingSeatCeiling` and the watch are read
 * @returns `decided` with a clean or unreadable verdict, else `open` with the fill below N (or `null`)
 */
export function seatFillOf({
  sources,
}: {
  sources: unknown;
}): { readonly kind: "decided"; readonly verdict: SeatVerdict } | ({ readonly kind: "open" } & SeatFill) {
  const ceiling = seatCeilingOf({ sources });
  if (ceiling.kind === "unreadable") {
    return { kind: "decided", verdict: ceiling };
  }
  if (ceiling.kind !== "measured") {
    return { fill: null, kind: "open", problem: ceiling.kind === "unmeasurable" ? ceiling.reason : null };
  }
  const working = workingSeatsOf({ sources });
  if (working.kind === "unreadable") {
    return { kind: "decided", verdict: working };
  }
  if (working.value >= ceiling.seats) {
    return { kind: "decided", verdict: { kind: "clean" } };
  }
  return { fill: { ceiling: ceiling.seats, working: working.value }, kind: "open", problem: null };
}

/**
 * Which of the unseated rows are owed a seat, and which ceiling a hold-rationale must name to answer one: below
 * a measured N, the first `N − working` in rank order and the machine; otherwise every row and the binding one.
 *
 * @param seats the open fill {@link seatFillOf} returned
 * @param unseated the ready, owed rows no seat is on, in rank order
 * @param bindingCeilingId the lowest unused ceiling the capture read, or `null` when it read none
 * @returns the owed rows and the ceiling id a reason must name (`null`: a row-only reason answers)
 */
export function owedScopeOf<TRow>({
  seats,
  unseated,
  bindingCeilingId,
}: {
  seats: SeatFill;
  unseated: readonly TRow[];
  bindingCeilingId: string | null;
}): { readonly rows: readonly TRow[]; readonly ceilingId: string | null } {
  if (seats.fill === null) {
    return { ceilingId: bindingCeilingId, rows: unseated };
  }
  return { ceilingId: MACHINE_CEILING, rows: unseated.slice(0, seats.fill.ceiling - seats.fill.working) };
}

/**
 * The seat fields a refusal carries: the fill and N below a measured ceiling, else the reason N was not measured.
 *
 * @param seats the open fill {@link seatFillOf} returned
 * @returns the four seat fields of the gate's refused verdict
 */
export function refusalSeatFieldsOf({ seats }: { seats: SeatFill }): {
  readonly ceilingMeasurementProblem: string | null;
  readonly seatsOwed: number | null;
  readonly workingSeatCeiling: number | null;
  readonly workingSeats: number | null;
} {
  if (seats.fill === null) {
    return {
      ceilingMeasurementProblem: seats.problem,
      seatsOwed: null,
      workingSeatCeiling: null,
      workingSeats: null,
    };
  }
  return {
    ceilingMeasurementProblem: null,
    seatsOwed: seats.fill.ceiling - seats.fill.working,
    workingSeatCeiling: seats.fill.ceiling,
    workingSeats: seats.fill.working,
  };
}
