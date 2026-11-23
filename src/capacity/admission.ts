/**
 * The JUDGEMENT half of a ceilings reading: the routes a seat could take, the one selected, the lowest ceiling
 * the sweep fills to, and whether a new seat may start now. `./ceilings.ts` builds the ceilings and calls
 * {@link judgedRoutes} once; the idle-capacity gate calls {@link admissionOf} over a captured reading, which
 * {@link rejudgedReading} rebuilds from its own ceilings first rather than believing what it carries.
 */
import { CODEX_MONTHLY_SPEND_NOT_MEASURED, MONTHLY_SPEND_REASON_PREFIX } from "../plans/usageLimit.js";
import type { Ceiling, CeilingRoute, CeilingsAdmission, CeilingsReading } from "./ceilings.js";

/**
 * One provider's route through its routed plan: the smaller of the machine's and the plan's headroom, the
 * machine limiting on a tie.
 *
 * @param driver which provider's router picked the plan
 * @param plan the routed plan's ceiling, `undefined` when the router routed nowhere
 * @returns the route, or `null` when the plan or the machine carries no number
 */
export function routeThrough({
  driver,
  machine,
  plan,
}: {
  driver: CeilingRoute["driver"];
  machine: Ceiling;
  plan: Ceiling | undefined;
}): CeilingRoute | null {
  if (plan?.headroom == null || machine.headroom === null) {
    return null;
  }
  const machineBinds = machine.headroom <= plan.headroom;
  return {
    driver,
    headroom: Math.min(machine.headroom, plan.headroom),
    limitingCeilingId: machineBinds ? machine.id : plan.id,
    planCeilingId: plan.id,
  };
}

/** The route with the most headroom above zero, the first (Claude) on a tie; `null` when none has any. */
function selectedRouteOf({ routes }: { routes: readonly CeilingRoute[] }): CeilingRoute | null {
  let selected: CeilingRoute | null = null;
  for (const route of routes) {
    if (route.headroom > 0 && (selected === null || route.headroom > selected.headroom)) {
      selected = route;
    }
  }
  return selected;
}

/**
 * Whether the plans fall short of PROVING every one spent — no plan configured, a whole provider's list unread
 * (`problems`, which names only provider-level failures), or any plan unread or still carrying headroom that no
 * route took. Only a fleet where every plan was measured at zero is capped (a captured `routes: []` beside an open plan once read as spent).
 *
 * An UNMEASURED monthly-spend plan is NOT an unread one here. Its null headroom says nothing measures its spend now, and
 * every router refuses it until something does, so it can never be the capacity an unproven plan stands for: counted, it let a
 * usage-limited plan at its limit beside a monthly-spend one admit work no route could take. It is passed over, so a fleet whose only routable plans are measured at zero is capped.
 */
function notProvenSpent({ plans, problems }: { plans: readonly Ceiling[]; problems: readonly string[] }): boolean {
  return (
    plans.length === 0 ||
    problems.length > 0 ||
    plans.some((ceiling) => ceiling.headroom !== 0 && !neverRouted({ ceiling }))
  );
}

/**
 * Whether a ceiling is a plan no router takes until its spend is measured: a Codex monthly-spend plan, which nothing
 * reads ({@link CODEX_MONTHLY_SPEND_NOT_MEASURED}), or a Claude one with no fresh spend reading — `unreadable` with a
 * reason opening {@link MONTHLY_SPEND_REASON_PREFIX} (`./ceilings.ts`).
 */
function neverRouted({ ceiling }: { ceiling: Ceiling }): boolean {
  if (ceiling.status !== "unreadable" || ceiling.reason === null) {
    return false;
  }
  return ceiling.reason === CODEX_MONTHLY_SPEND_NOT_MEASURED || ceiling.reason.startsWith(MONTHLY_SPEND_REASON_PREFIX);
}

/**
 * The ceiling the sweep fills to: the selected route's limiting ceiling; with no route above zero, the machine
 * when it is the one at zero, or when it carries a number and the plans are {@link notProvenSpent} — the same
 * machine-only posture {@link admissionOf} takes; else the first route's limit, else the first plan measured
 * at zero; `null` when nothing does.
 */
function lowestCeilingOf({
  machine,
  plans,
  problems,
  routes,
  selected,
}: {
  machine: Ceiling;
  plans: readonly Ceiling[];
  problems: readonly string[];
  routes: readonly CeilingRoute[];
  selected: CeilingRoute | null;
}): string | null {
  if (selected !== null) {
    return selected.limitingCeilingId;
  }
  if (machine.headroom === 0) {
    return machine.id;
  }
  // Before any route: a zero route beside an unproven plan must not name that route's plan, or `lowest` and
  // {@link admissionOf}'s binding part.
  if (machine.headroom !== null && notProvenSpent({ plans, problems })) {
    return machine.id;
  }
  const first = routes[0];
  if (first !== undefined) {
    return first.limitingCeilingId;
  }
  const spent = plans.find((ceiling) => ceiling.headroom === 0);
  if (spent !== undefined) {
    return spent.id;
  }
  return null;
}

/**
 * The derived half of a reading from its ceilings and candidate routes — the one computation both the builder
 * and {@link rejudgedReading} run, so a fresh reading and a re-judged capture can never disagree.
 *
 * @param plans every ceiling but the machine's, in reading order
 * @param problems the provider-level read failures, which keep the plans unproven
 * @param routes each provider's route, `null` where {@link routeThrough} found no number
 * @returns the routes that carry a number, the selected one and the lowest ceiling
 */
export function judgedRoutes({
  machine,
  plans,
  problems,
  routes,
}: {
  machine: Ceiling;
  plans: readonly Ceiling[];
  problems: readonly string[];
  routes: readonly (CeilingRoute | null)[];
}): Pick<CeilingsReading, "lowest" | "routes" | "selectedRoute"> {
  const numbered = routes.filter((route): route is CeilingRoute => route !== null);
  const selected = selectedRouteOf({ routes: numbered });
  return {
    lowest: lowestCeilingOf({ machine, plans, problems, routes: numbered, selected }),
    routes: numbered,
    selectedRoute: selected,
  };
}

/**
 * Whether a new seat may start now, and which ceiling it would fill.
 *
 * A held machine, or one with no headroom, holds everything. A captured reading is RE-JUDGED through
 * {@link rejudgedReading}, never trusted (a schema-valid `selectedRoute` disagreeing
 * with its own ceilings once read `free`), so the binding always equals the rejudged `lowest`. A rebuilt route above
 * zero is free capacity bound by its limiting ceiling. With no such route, plans {@link notProvenSpent} — any
 * unread, any with headroom no route took, or a provider whose whole list could not be read — judge the tick on
 * the machine alone: an unread plan must never clear a tick as if it were spent (a
 * spent Claude plan beside an unread routed Codex plan once read `capped`). This keeps the machine-only posture the
 * gate had before plans were read. Only when every plan was MEASURED AT ZERO is the tick capped.
 *
 * @param reading the ceilings reading
 * @returns the admission and its binding ceiling
 */
export function admissionOf({ reading }: { reading: CeilingsReading }): CeilingsAdmission {
  const machine = reading.ceilings.find((ceiling) => ceiling.kind === "machine");
  if (machine?.headroom == null) {
    return { kind: "unreadable" };
  }
  if (machine.status === "held" || machine.headroom <= 0) {
    return { kind: "held" };
  }
  const settled = rejudgedReading({ reading });
  if (settled.selectedRoute !== null) {
    return { binding: settled.selectedRoute.limitingCeilingId, kind: "free" };
  }
  const plans = settled.ceilings.filter((ceiling) => ceiling.kind !== "machine");
  if (notProvenSpent({ plans, problems: settled.problems })) {
    return { binding: machine.id, kind: "free" };
  }
  return { binding: settled.lowest, kind: "capped" };
}

/**
 * A captured reading with its derived fields rebuilt from its own ceilings: each captured route re-run through
 * the machine and the plan ceiling it names, then the selected route and `lowest` recomputed by
 * {@link judgedRoutes}, exactly as the builder does. A capture is evidence, so a route, selection or `lowest`
 * that disagrees with the ceilings it came with is replaced rather than believed.
 *
 * @param reading the reading as captured
 * @returns the same ceilings and problems, with routes, selectedRoute and lowest derived from them
 */
export function rejudgedReading({ reading }: { reading: CeilingsReading }): CeilingsReading {
  const machine = reading.ceilings.find((ceiling) => ceiling.kind === "machine");
  if (machine === undefined) {
    return { ...reading, lowest: null, routes: [], selectedRoute: null };
  }
  const plans = reading.ceilings.filter((ceiling) => ceiling.kind !== "machine");
  const routes = reading.routes.map((route) =>
    routeThrough({
      driver: route.driver,
      machine,
      plan: plans.find((ceiling) => ceiling.id === route.planCeilingId),
    }),
  );
  return { ...reading, ...judgedRoutes({ machine, plans, problems: reading.problems, routes }) };
}
