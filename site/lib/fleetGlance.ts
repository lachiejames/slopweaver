/**
 * The Fleet page's one glance: is the fleet capacity-maxed, what binds it, and are the working seats on the owner's steers.
 *
 * A count of working seats alone does not say whether the fleet is capacity maxed: reading `3 working` on this page,
 * three WAS the ceiling — the supervisor fills to the working seats the plans' week carries at the measured burn
 * (`src/capacity/seatCeiling.ts`) — and the glance says so. The owner
 * should be able to look at the fleet at any time and be confident it is capacity maxed and alignment maxed. The
 * measure is useful work, never burning the machine for the sound of the fans.
 *
 * So this is a DERIVATION, never a sentence anybody writes: every field comes off a reading the supervisor tick
 * already recorded — `session watch` (seats), `handover reconcile` (seat → row, ready rows), `machine capacity`
 * (hold, load and the plans' ceilings), `fleet ceiling` (the working seats the week carries) — and the band
 * renders these fields and nothing else.
 *
 * ## The five-hour burst, stated so the owner can disagree with it
 *
 * The seat ceiling paces each plan's remaining week evenly to its reset. A plan whose week is BEHIND its own clock
 * — less of the week used than of the week elapsed — is one whose allowance expires unused unless something draws
 * harder than that pace, and its five-hour window is what lets it. So a burst is OPEN on a Claude plan that is
 * taking new work (`status: open`, which already judges its five-hour window) and is behind its week; it is TAKEN
 * when more seats are working than the ceiling paces. Seats above the ceiling on a behind plan are use, not
 * borrowing from later in the week.
 */
import type { BoardRowQuote } from "../components/live/readHisWords";
import type { Seat } from "../components/live/readNow";
import { aliasOf, claudePlansOf, fiveHourBinds, type GlancePlans, weekPaceOf } from "./fleetGlancePlans";
import type { OpenOrder } from "./fleetViews";
import { joinGapWords, type NowSeatsView } from "./nowSeats";
import { workingSessionsCountOf } from "./sidebarCounts";

/** What `machine capacity` says about the machine and the plans. */
export interface GlanceCapacity {
  readonly hold: boolean;
  readonly holdSubjects: readonly string[];
  readonly load1: number;
  /** The 1-minute load the hold is judged at; `undefined` only on a tick recorded before ticks carried it. */
  readonly loadHold: number | undefined;
  readonly plans: GlancePlans;
}

/** The working seats the plans' week carries, as `fleet ceiling` measured it — or why it could not. */
export type SeatCeiling =
  { readonly kind: "measured"; readonly seats: number } | { readonly kind: "unmeasurable"; readonly reason: string };

/** The ceiling that stops one more working seat right now. */
export type GlanceBinding = "machine load" | "plan week" | "five-hour window" | "board" | "nothing" | "not known";

/** The plain verdict, the first word the owner reads. */
export type GlanceVerdictKind = "capacity maxed" | "burst unused" | "seats free" | "held" | "not measured";

/** Whether a plan is behind its week and the fleet is drawing on it — or why that was not read. */
export type GlanceBurst =
  | { readonly kind: "read"; readonly open: readonly string[]; readonly taken: boolean }
  | { readonly kind: "unread"; readonly why: string };

/** How many working seats serve a steer of the owner's — or why the seats could not be joined to the board. */
export type GlanceAlignment =
  | { readonly kind: "joined"; readonly onSteer: number; readonly working: number }
  | { readonly kind: "unknown"; readonly why: string };

/** The whole glance. */
export interface FleetGlance {
  readonly verdict: GlanceVerdictKind;
  /** One sentence: why the verdict is what it is, with the figures behind it. */
  readonly why: string;
  readonly working: number;
  /** The working seats the plans' week carries, or `undefined` when it was not measured. */
  readonly ceiling: number | undefined;
  readonly binding: GlanceBinding;
  readonly burst: GlanceBurst;
  readonly alignment: GlanceAlignment;
}

/**
 * The burst: which open plans are behind their week, and whether the fleet runs above the paced ceiling.
 *
 * @returns the burst, or why the plans were not read
 */
function burstOf({
  capacity,
  working,
  ceiling,
  nowMs,
}: {
  capacity: GlanceCapacity | undefined;
  working: number;
  ceiling: number | undefined;
  nowMs: number;
}): GlanceBurst {
  if (capacity === undefined) {
    return { kind: "unread", why: "the machine capacity reading is not available" };
  }
  if (capacity.plans.kind === "absent") {
    return { kind: "unread", why: "the machine capacity reading predates the plans' ceilings" };
  }
  if (capacity.plans.kind === "unreadable") {
    return { kind: "unread", why: "the plans' ceilings in the machine capacity reading did not read" };
  }
  const claude = claudePlansOf({ plans: capacity.plans.plans });
  if (claude.length === 0) {
    return { kind: "unread", why: "the machine capacity reading carries no Claude plan" };
  }
  const taking = claude.filter((plan) => plan.status === "open");
  const unread = taking
    .filter((plan) => weekPaceOf({ nowMs, plan }) === "unread")
    .map((plan) => aliasOf({ id: plan.id }));
  if (unread.length > 0) {
    return { kind: "unread", why: `the week of ${aliasesWords({ aliases: unread })} did not read` };
  }
  const open = taking
    .filter((plan) => weekPaceOf({ nowMs, plan }) === "behind")
    .map((plan) => aliasOf({ id: plan.id }));
  return { kind: "read", open, taken: ceiling !== undefined && working > ceiling };
}

/**
 * How many working seats sit on a board row holding the owner's words.
 *
 * @returns the count over the working seats, or why the seats were not joined to the board
 */
function alignmentOf({
  view,
  quotes,
}: {
  view: NowSeatsView;
  quotes: ReadonlyMap<string, BoardRowQuote> | undefined;
}): GlanceAlignment {
  if (view.kind === "signal-only") {
    return { kind: "unknown", why: joinGapWords({ reason: view.reason }) };
  }
  if (quotes === undefined) {
    return { kind: "unknown", why: "the board has not been read, so the owner's words behind each row are not known" };
  }
  // Every seat with a working signal is in the working band: no standing outranks the signal any more.
  const working = view.working;
  const onSteer = working.filter(
    (joined) => joined.placement !== undefined && quotes.has(joined.placement.row.id),
  ).length;
  return { kind: "joined", onSteer, working: working.length };
}

/**
 * A list of plan aliases as a reader says it: `a`, `a and b`, `a, b and c`.
 *
 * @returns the phrase
 */
function aliasesWords({ aliases }: { aliases: readonly string[] }): string {
  if (aliases.length <= 1) {
    return aliases.join("");
  }
  return `${aliases.slice(0, -1).join(", ")} and ${aliases.at(-1)!}`;
}

/** The verdict half of the glance: verdict, why and the ceiling that binds. */
type Judged = Pick<FleetGlance, "binding" | "verdict" | "why">;

/**
 * The verdict when the plans or the machine refuse a seat outright, or `undefined` when neither does.
 *
 * @returns the held verdict, or `undefined`
 */
function heldOf({ capacity }: { capacity: GlanceCapacity | undefined }): Judged | undefined {
  if (capacity === undefined) {
    return undefined;
  }
  if (capacity.hold) {
    const subjects = capacity.holdSubjects.length > 0 ? `${capacity.holdSubjects.join(", ")}, ` : "";
    let against = "";
    if (capacity.loadHold !== undefined) {
      against = ` against a hold at ${String(capacity.loadHold)}`;
    }
    return {
      binding: "machine load",
      verdict: "held",
      why: `The machine is holding new seats: ${subjects}load ${capacity.load1.toFixed(1)}${against}.`,
    };
  }
  if (capacity.plans.kind !== "read") {
    return undefined;
  }
  const claude = claudePlansOf({ plans: capacity.plans.plans });
  if (claude.length === 0 || claude.some((plan) => plan.status === "open")) {
    return undefined;
  }
  const first = claude.find((plan) => plan.reason !== undefined);
  let reason = "";
  if (first?.reason !== undefined) {
    reason = ` ${aliasOf({ id: first.id })}: ${first.reason}.`;
  }
  let binding: GlanceBinding = "plan week";
  if (fiveHourBinds({ plans: claude })) {
    binding = "five-hour window";
  }
  return { binding, verdict: "held", why: `No Claude plan is taking new work.${reason}` };
}

/**
 * The verdict once nothing refuses a seat outright: against the measured ceiling, the board and the burst.
 *
 * @returns the verdict
 */
function judgedOf({
  ceiling,
  working,
  openReadyCount,
  burst,
}: {
  ceiling: SeatCeiling | undefined;
  working: number;
  openReadyCount: number | undefined;
  burst: GlanceBurst;
}): Judged {
  if (ceiling === undefined) {
    return {
      binding: "not known",
      verdict: "not measured",
      why: "The fleet ceiling reading is not available, so how many seats the plans carry is not known.",
    };
  }
  if (ceiling.kind === "unmeasurable") {
    return {
      binding: "not known",
      verdict: "not measured",
      why: `How many seats the plans carry is not measured: ${ceiling.reason}.`,
    };
  }
  const seats = ceiling.seats;
  if (working < seats) {
    // Room under the ceiling says nothing about whether there is work for it: an unread board is not "picking up".
    if (openReadyCount === undefined) {
      return {
        binding: "board",
        verdict: "not measured",
        why: `${String(seats - working)} more working seats fit the plans' week, but whether a ready row has nobody on it was not read.`,
      };
    }
    if (openReadyCount === 0) {
      return {
        binding: "board",
        verdict: "held",
        why: `The plans' week carries ${String(seats)}, and every ready row on the board already has a seat.`,
      };
    }
    return {
      binding: "nothing",
      verdict: "seats free",
      why: `${String(seats - working)} more working seats fit the plans' week, and ${String(openReadyCount)} ready rows have nobody on them.`,
    };
  }
  if (burst.kind === "unread") {
    return {
      binding: "plan week",
      verdict: "not measured",
      why: `${String(working)} working against the ${String(seats)} the week paces, but whether a plan is behind its week is not known: ${burst.why}.`,
    };
  }
  if (burst.open.length > 0 && !burst.taken) {
    return {
      binding: "plan week",
      verdict: "burst unused",
      why: `${aliasesWords({ aliases: burst.open })} are behind their week, so seats above ${String(seats)} there would spend allowance that otherwise expires.`,
    };
  }
  if (burst.taken) {
    return {
      binding: "plan week",
      verdict: "capacity maxed",
      why: `${String(working)} working, above the ${String(seats)} the week paces, drawing on plans behind their week.`,
    };
  }
  return {
    binding: "plan week",
    verdict: "capacity maxed",
    why: `${String(working)} working, the most the plans' week carries at the measured burn.`,
  };
}

/**
 * The Fleet page's glance, derived from the tick's own readings.
 *
 * @param seats every open seat `session watch` read; a seat whose signal is `working` is a working seat
 * @param view the same seats joined to the board, which the alignment count reads
 * @param quotes the owner's words by board row slug, `undefined` until the board reads
 * @param capacity the machine's hold and the plans' ceilings, `undefined` until the reading arrives
 * @param ceiling the working seats the plans' week carries, `undefined` until the reading arrives
 * @param order the ready rows no seat is on, `undefined` until the board reading arrives
 * @param nowIso the instant the plans' weeks are judged at — the capacity reading's own, so a replay agrees
 * @returns the glance
 */
export function fleetGlanceOf({
  seats,
  view,
  quotes,
  capacity,
  ceiling,
  order,
  nowIso,
}: {
  seats: readonly Seat[];
  view: NowSeatsView;
  quotes: ReadonlyMap<string, BoardRowQuote> | undefined;
  capacity: GlanceCapacity | undefined;
  ceiling: SeatCeiling | undefined;
  order: OpenOrder | undefined;
  nowIso: string;
}): FleetGlance {
  // The sidebar's Fleet badge counts the live seats through the same function, so on the live page the two agree; a
  // `?fixture=` page freezes only itself, never the sidebar, so there the badge still reads live.
  const working = workingSessionsCountOf({ seats }).count;
  let openReadyCount: number | undefined;
  if (order?.kind === "open") {
    openReadyCount = order.open.length;
  }
  return {
    ...fleetVerdictOf({ capacity, ceiling, nowIso, openReadyCount, working }),
    alignment: alignmentOf({ quotes, view }),
    working,
  };
}

/** The verdict half of the glance, which a past tick is judged by too. */
export type FleetVerdict = Pick<FleetGlance, "binding" | "burst" | "ceiling" | "verdict" | "why">;

/**
 * The verdict alone, off the counts the judgement reads — so the Fleet page's history judges each recorded tick by the
 * same rules the badge above it does, and the two cannot be worded by two different derivations.
 *
 * @param working how many seats were working
 * @param openReadyCount the ready rows nobody was on, `undefined` when that was not read
 * @param nowIso the instant the plans' weeks are judged at
 * @returns the verdict, its binding ceiling, why, the burst and the measured ceiling
 */
export function fleetVerdictOf({
  capacity,
  ceiling,
  working,
  openReadyCount,
  nowIso,
}: {
  capacity: GlanceCapacity | undefined;
  ceiling: SeatCeiling | undefined;
  working: number;
  openReadyCount: number | undefined;
  nowIso: string;
}): FleetVerdict {
  let measured: number | undefined;
  if (ceiling?.kind === "measured") {
    measured = ceiling.seats;
  }
  const burst = burstOf({ capacity, ceiling: measured, nowMs: Date.parse(nowIso), working });
  // A refusal by the machine or the plans outranks every judgement against the ceiling.
  const judged = heldOf({ capacity }) ?? judgedOf({ burst, ceiling, openReadyCount, working });
  return { ...judged, burst, ceiling: measured };
}
