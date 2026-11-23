/**
 * `fleet-runs-dry`'s judgement: whether one filed ceilings reading proves that NO routable Claude or Codex plan
 * can start a seat until a reset, and for how long.
 *
 * ## A measured interval, not a burn forecast
 *
 * The reading is a snapshot of both providers' windows (`../capacity/ceilings.ts`). A snapshot cannot forecast how
 * fast a Codex plan will burn, and there is no Codex burn journal, so a provider-neutral monitor cannot project a
 * week the way `claude forecast` does for Claude alone. What it CAN prove is the present: every plan a router would
 * send a seat to is measured spent, and the first of them comes back at a named reset. That interval is what fires.
 *
 * ## Fails closed on everything that is not measured capacity
 *
 * The reading fires only when the absence of a route is attributable entirely to measured capacity. A stale
 * reading or a held or unread machine is `unmeasurable` outright. A re-judged route is `clear` whatever else failed
 * to read, because a seat can start through it. With no route, a provider-level read failure, a register that has
 * moved past the reading (`./fleetRunsDryRegister.ts`), a paused plan, an unread plan, a plan refused for a reason no window measures, a plan its router still holds `open` (even at a headroom rounded
 * to zero), or a plan still carrying headroom no route took —
 * each is `unmeasurable`, never `dry`. A Codex monthly-spend plan is passed over: nothing reads it and no router ever
 * takes one. A Claude monthly-spend plan is not, since a router takes it on a fresh spend reading, and its spend
 * window carries no reset, so it never reads spent (`./fleetRunsDryRegister.ts`).
 *
 * ## When a plan comes back
 *
 * A plan is capacity-exhausted when it is at the owner's usage limit, or at zero headroom, and either way carries a
 * known all-models seat window spent to a positive `available` with a reset still ahead. A plan with two such windows — a spent five-hour window
 * inside a spent week — takes a seat again only once BOTH have reset, so its return is the LATER of them; the fleet
 * has a route again at the EARLIEST plan's return. A window read at its whole 100 under a router bar of 100 is not
 * spent, because a raw value just under 100 rounds onto it while that router still admits it — so under the default
 * spend-out bar a Claude week with no usage limit never proves the fleet dry.
 *
 * That return is a LOWER BOUND, never a promise. A `refusing` ceiling carries its reason as text and not the
 * router's exclusion kind, so a plan refused for something a reset does not cure (signed out, say) that also has a
 * spent window is read as returning at that window's reset. The fleet is still dry until then — every plan really
 * is spent — so the dry verdict holds; only the end can come later, which the card says as "at least".
 *
 * Pure: one reading and an instant in, an assessment out.
 */
import { isDeepStrictEqual } from "node:util";

import { parseIsoMs, parseStrictIsoInstantMs } from "#lib/date.js";

import { rejudgedReading } from "../capacity/admission.js";
import type { Ceiling, CeilingsReading, CeilingWindow } from "../capacity/ceilings.js";
import type { RegisteredPlan } from "../plans/types.js";

import { neverRouted, registerDrift } from "./fleetRunsDryRegister.js";

/**
 * The oldest filed reading the monitor judges: two passes of the hourly row that fires it (`17 * * * *`), so one
 * missed tick still judges and a reading from a stopped tick never does.
 */
export const FLEET_DRY_MAX_AGE_MS = 2 * 3_600_000;

const HOUR_MS = 3_600_000;

/** The interval no routable plan can start a seat in. */
export interface FleetDryInterval {
  /** The instant judged. */
  readonly fromIso: string;
  /** The first plan's return, as its window filed it. */
  readonly untilIso: string;
  /** Every routable plan, each measured spent, sorted. */
  readonly exhaustedCeilingIds: readonly string[];
  /** Which providers those plans belong to, Claude first. */
  readonly providers: readonly ("claude" | "codex")[];
  /** The plan whose reset ends the interval. */
  readonly relievedByCeilingId: string;
  /** The routing bars it was judged under, so the card names the very windows the judgement counted. */
  readonly routingBars: RoutingBars;
}

/** What one reading says about the whole fleet. */
export type FleetDryAssessment =
  | { readonly kind: "dry"; readonly interval: FleetDryInterval }
  | { readonly kind: "clear"; readonly why: string }
  | { readonly kind: "unmeasurable"; readonly why: string };

/** One plan judged: spent until an instant, or why it does not prove it is. */
type PlanExhaustion =
  | { readonly kind: "exhausted"; readonly ceiling: Ceiling; readonly returnMs: number; readonly returnIso: string }
  | { readonly kind: "unmeasurable"; readonly why: string };

/**
 * The windows an all-models seat spends, by provider, as `../capacity/ceilings.ts` names them. A closed set, so a
 * window this monitor does not know — Claude's Fable week, Codex's `other` — never reads as what stops a seat.
 */
const SEAT_WINDOWS: Readonly<Record<"claude" | "codex", ReadonlySet<string>>> = {
  claude: new Set(["five-hour", "seven-day"]),
  codex: new Set(["five-hour", "weekly"]),
};

/**
 * The highest bar, in percents of a window, a router admits a window under before it resets, as the register stands:
 * Claude's routing bar on its five-hour window; on its week the higher of that and the spend-out bar, since spend-out
 * always opens before a week's own reset (`../claude/select.ts`); Codex's pause bar on every window.
 */
export interface RoutingBars {
  readonly claudeFiveHour: number;
  readonly claudeWeek: number;
  readonly codex: number;
}

/** The bar a window of a plan is admitted under, by {@link RoutingBars}. */
function barOf({ kind, window, bars }: { kind: "claude" | "codex"; window: string; bars: RoutingBars }): number {
  if (kind === "codex") {
    return bars.codex;
  }
  if (window === "five-hour") {
    return bars.claudeFiveHour;
  }
  return bars.claudeWeek;
}

/**
 * Every window of a plan an all-models seat spends, spent to a positive `available`, whose reset is still ahead of
 * the judged instant. A window outside the provider's known seat windows is never one, so a spent Fable week
 * neither stops a seat nor names when it can start.
 *
 * A window whose `available` is the whole 100 reads `used` 100.00 from a raw 99.995 up (`../capacity/windowArithmetic.ts`
 * rounds it so), and a router whose bar is 100 still admits that raw value — so under such a bar a window at exactly
 * 100 proves nothing. A bar below 100 refuses every raw value that rounds there, and a usage limit below 100 is never
 * rounded onto, so both of those stay proof.
 *
 * @param ceiling the plan's ceiling
 * @param nowMs the judged instant
 * @param routingBars the routing bars the register sets at the judged instant
 * @returns those windows with their reset in epoch ms, in reading order
 */
export function spentWindows({
  ceiling,
  nowMs,
  routingBars,
}: {
  ceiling: Ceiling;
  nowMs: number;
  routingBars: RoutingBars;
}): readonly { readonly window: CeilingWindow; readonly resetMs: number }[] {
  if (ceiling.kind === "machine") {
    return [];
  }
  const { kind } = ceiling;
  const seatWindows = SEAT_WINDOWS[kind];
  return ceiling.windows.flatMap((window) => {
    // A window allowing nothing is no measure of spending, so a zero allowance never reads as spent.
    const unspent = window.available <= 0 || window.used < window.available;
    const barAtWhole = barOf({ bars: routingBars, kind, window: window.window }) >= 100;
    const roundedOnto = barAtWhole && window.available >= 100 && window.used <= 100;
    if (!seatWindows.has(window.window) || unspent || roundedOnto || window.resetAtIso === null) {
      return [];
    }
    // Strict, so a calendar impossibility (`YYYY-02-31`) is no reset rather than one `Date.parse` rolls forward.
    // Both providers' resets are written from epoch seconds by `epochSecondsToIso`, which this always accepts.
    const resetMs = parseStrictIsoInstantMs({ text: window.resetAtIso });
    if (resetMs === undefined || resetMs <= nowMs) {
      return [];
    }
    return [{ resetMs, window }];
  });
}

/** A ceiling's reason as a trailing clause, or nothing when it carries none. */
function because({ reason }: { reason: string | null }): string {
  if (reason === null) {
    return "";
  }
  return `: ${reason}`;
}

/** Whether a plan is spent until a reset, or why it cannot be said to be. */
function exhaustionOf({
  ceiling,
  nowMs,
  routingBars,
}: {
  ceiling: Ceiling;
  nowMs: number;
  routingBars: RoutingBars;
}): PlanExhaustion {
  if (ceiling.status === "paused" || ceiling.status === "unreadable") {
    return {
      kind: "unmeasurable",
      why: `${ceiling.id} is ${ceiling.status}, so its capacity is not measured${because({ reason: ceiling.reason })}`,
    };
  }
  // `open` is the router's own verdict that the plan can take a seat, so it is never spent — not even at a headroom
  // rounded to zero (`../capacity/windowArithmetic.ts` rounds 99.9999% used to 100.00 while the router admits it).
  if (ceiling.status === "open") {
    return { kind: "unmeasurable", why: `${ceiling.id} is open to its router, so a seat could still start on it` };
  }
  const capacity = ceiling.status === "at-usage-limit" || ceiling.headroom === 0;
  if (!capacity) {
    return { kind: "unmeasurable", why: `${ceiling.id} still carries headroom that no route took` };
  }
  const spent = spentWindows({ ceiling, nowMs, routingBars });
  const latest = spent.toSorted((left, right) => right.resetMs - left.resetMs)[0];
  if (latest === undefined) {
    return {
      kind: "unmeasurable",
      why: `${ceiling.id} is ${ceiling.status} with no spent window resetting ahead, so no capacity measure explains it${because({ reason: ceiling.reason })}`,
    };
  }
  return { ceiling, kind: "exhausted", returnIso: latest.window.resetAtIso!, returnMs: latest.resetMs };
}

/** Why the reading's age keeps it from being judged, or `undefined` when it is fresh. */
function staleness({
  observedAtIso,
  nowMs,
  maxAgeMs,
}: {
  observedAtIso: string;
  nowMs: number;
  maxAgeMs: number;
}): string | undefined {
  // Strict, as a reset is: `machine capacity` writes `toISOString()`, and a rolled-forward impossibility is no instant.
  const observedMs = parseStrictIsoInstantMs({ text: observedAtIso });
  if (observedMs === undefined) {
    return `the filed reading's observedAtIso is not an instant: "${observedAtIso}"`;
  }
  const ageMs = nowMs - observedMs;
  if (ageMs < 0) {
    return `the filed reading was observed at ${observedAtIso}, after the instant judged`;
  }
  if (ageMs > maxAgeMs) {
    // Rounded up, so a reading a millisecond past the bound never reads as exactly at it.
    return `the filed reading is ${String(Math.ceil(ageMs / 60_000))} minutes old, past the ${String(maxAgeMs / 60_000)}-minute bound`;
  }
  return undefined;
}

/** Why the machine keeps the reading from being judged, or `undefined` when it is open with headroom. */
function unopenMachine({ reading }: { reading: CeilingsReading }): string | undefined {
  const machine = reading.ceilings.find((ceiling) => ceiling.kind === "machine");
  if (machine === undefined) {
    return "the filed reading carries no machine ceiling";
  }
  if (machine.status !== "open" || machine.headroom === null || machine.headroom <= 0) {
    return `the machine is ${machine.status}, so no provider's capacity is what stops a seat${because({ reason: machine.reason })}`;
  }
  return undefined;
}

/** Every routable plan judged spent, or the first plan's reason it cannot be. */
function everyPlanSpent({
  plans,
  nowMs,
  routingBars,
}: {
  plans: readonly Ceiling[];
  nowMs: number;
  routingBars: RoutingBars;
}): readonly Extract<PlanExhaustion, { kind: "exhausted" }>[] | Extract<PlanExhaustion, { kind: "unmeasurable" }> {
  const spent: Extract<PlanExhaustion, { kind: "exhausted" }>[] = [];
  for (const ceiling of plans) {
    const judged = exhaustionOf({ ceiling, nowMs, routingBars });
    if (judged.kind === "unmeasurable") {
      return judged;
    }
    spent.push(judged);
  }
  return spent;
}

/** Why the capture's routes or selection disagree with what its own ceilings derive, or `undefined` when they agree. */
function capturedRouteContradiction({
  captured,
  settled,
}: {
  captured: CeilingsReading;
  settled: CeilingsReading;
}): string | undefined {
  if (captured.selectedRoute !== null) {
    return `the filed reading selected a route through ${captured.selectedRoute.planCeilingId} that its own ceilings do not reproduce`;
  }
  const misnamed = captured.routes.find(
    (route) => captured.ceilings.find((ceiling) => ceiling.id === route.planCeilingId)?.kind !== route.driver,
  );
  if (misnamed !== undefined) {
    return `the filed reading's ${misnamed.driver} route names ${misnamed.planCeilingId}, which is no ${misnamed.driver} plan it carries`;
  }
  const drifted = captured.routes.find((route, index) => !isDeepStrictEqual(route, settled.routes[index]));
  if (drifted !== undefined) {
    return `the filed reading's route through ${drifted.planCeilingId} claims ${String(drifted.headroom)} headroom, which its own ceilings do not reproduce`;
  }
  return undefined;
}

/**
 * Judge one filed ceilings reading: dry when every routable plan is measured spent for at least `minDryHours`.
 *
 * @param reading the filed `machine capacity` ceilings reading
 * @param registered every plan the register configures at the judged instant, so a plan added or widened since
 *   the reading was taken is never read as measured spent
 * @param routingBars the routing bars the register sets at the judged instant, so a window rounded onto 100 is never
 *   read as spent under a bar that still admits it
 * @param nowIso the instant judged — `--now` replays a past pass exactly
 * @param maxAgeMs the oldest reading judged, {@link FLEET_DRY_MAX_AGE_MS} in production
 * @param minDryHours the shortest interval that fires
 * @returns `dry` with its interval, `clear` with why, or `unmeasurable` naming what the reading does not prove
 */
export function assessFleetDry({
  reading,
  registered,
  routingBars,
  nowIso,
  maxAgeMs,
  minDryHours,
}: {
  reading: CeilingsReading;
  registered: readonly RegisteredPlan[];
  routingBars: RoutingBars;
  nowIso: string;
  maxAgeMs: number;
  minDryHours: number;
}): FleetDryAssessment {
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (nowMs === undefined) {
    return { kind: "unmeasurable", why: `the instant judged is not an instant: "${nowIso}"` };
  }
  const stale = staleness({ maxAgeMs, nowMs, observedAtIso: reading.observedAtIso });
  if (stale !== undefined) {
    return { kind: "unmeasurable", why: stale };
  }
  const held = unopenMachine({ reading });
  if (held !== undefined) {
    return { kind: "unmeasurable", why: held };
  }
  // A route proves a seat can start whatever else failed to read, so it is judged before the problems are.
  const settled = rejudgedReading({ reading });
  if (settled.selectedRoute !== null) {
    return { kind: "clear", why: `a seat can start through ${settled.selectedRoute.planCeilingId}` };
  }
  // Admission replaces a capture's routes with what its ceilings derive. A dry verdict cannot: a capture whose routes
  // or selection its own ceilings do not reproduce contradicts itself, and a false dry is the worse error, so it
  // proves nothing either way. `lowest` names no route and is not read here.
  const contradiction = capturedRouteContradiction({ captured: reading, settled });
  if (contradiction !== undefined) {
    return { kind: "unmeasurable", why: contradiction };
  }
  if (reading.problems.length > 0) {
    return { kind: "unmeasurable", why: `a provider's plans did not read: ${reading.problems.join("; ")}` };
  }
  const drift = registerDrift({ ceilings: settled.ceilings, plans: registered });
  if (drift !== undefined) {
    return { kind: "unmeasurable", why: drift };
  }
  const plans = settled.ceilings.filter((ceiling) => ceiling.kind !== "machine" && !neverRouted({ ceiling }));
  if (plans.length === 0) {
    return { kind: "unmeasurable", why: "the filed reading carries no Claude or Codex plan a router could take" };
  }
  const spent = everyPlanSpent({ nowMs, plans, routingBars });
  if ("kind" in spent) {
    return spent;
  }
  return intervalOf({ minDryHours, nowIso, nowMs, routingBars, spent });
}

/** The dry interval a wholly spent fleet runs, or clear when its first plan comes back inside the threshold. */
function intervalOf({
  spent,
  nowIso,
  nowMs,
  minDryHours,
  routingBars,
}: {
  spent: readonly Extract<PlanExhaustion, { kind: "exhausted" }>[];
  nowIso: string;
  nowMs: number;
  minDryHours: number;
  routingBars: RoutingBars;
}): FleetDryAssessment {
  // `toSorted` is stable, so a tie keeps the reading's order.
  const first = spent.toSorted((left, right) => left.returnMs - right.returnMs)[0]!;
  const hours = (first.returnMs - nowMs) / HOUR_MS;
  if (hours < minDryHours) {
    return {
      kind: "clear",
      why: `${first.ceiling.id} resets at ${first.returnIso}, inside the ${String(minDryHours)}-hour threshold`,
    };
  }
  const providers = (["claude", "codex"] as const).filter((provider) =>
    spent.some((plan) => plan.ceiling.kind === provider),
  );
  return {
    interval: {
      exhaustedCeilingIds: spent.map((plan) => plan.ceiling.id).toSorted(),
      fromIso: nowIso,
      providers,
      relievedByCeilingId: first.ceiling.id,
      routingBars,
      untilIso: first.returnIso,
    },
    kind: "dry",
  };
}
