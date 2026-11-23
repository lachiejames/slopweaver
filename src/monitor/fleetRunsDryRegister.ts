/**
 * Whether the plan register has moved past a filed ceilings reading in a way that could open a route.
 *
 * The reading is a snapshot of the plans configured when it was taken, and the register can change inside the
 * freshness bound: a plan added after the snapshot was never measured, and a raised usage limit, a monthly-spend
 * plan moved onto a weekly window, or a Claude plan moved onto monthly spend (routed on a spend reading no window
 * measures) can turn a plan measured spent into one a router would take. Each makes "every
 * routable plan is spent" unproven, so each reads `unmeasurable`, never `dry`. A change that only removes capacity —
 * a pause, a removed plan, a lowered limit — leaves the dry verdict true and is not drift. A plan the register no
 * longer names is still judged as filed: no seat can start on it, so it can hold the verdict at `unmeasurable`, read
 * it `clear` off a route the reading filed to it, or bring the named return EARLIER — each a missed or understated
 * note the next filed reading corrects, never a fleet with a route read as dry.
 *
 * Not caught, stated rather than discovered: the ACCOUNT behind an alias changing. A ceiling carries no store
 * directory and no verified identity, so an alias whose store was re-signed into another account, or whose row was
 * hand-edited onto another store directory, keeps its id, and nothing here can show that the account the reading
 * measured is no longer the one behind it. No register verb rebinds an alias — `plans add` refuses one already
 * registered (`../plans/mutate.ts`) and none removes a row — so the second needs a hand edit of the register.
 *
 * Pure: the reading's ceilings and the register's plans in, a reason or nothing out.
 */
import type { Ceiling } from "../capacity/ceilings.js";
import type { RegisteredPlan } from "../plans/types.js";
import { CODEX_MONTHLY_SPEND_NOT_MEASURED } from "../plans/usageLimit.js";

/**
 * Whether a ceiling is a plan no router ever takes, so `fleet-runs-dry` passes it over: a Codex monthly-spend plan,
 * which nothing reads ({@link CODEX_MONTHLY_SPEND_NOT_MEASURED}). A Claude monthly-spend plan is NOT one: a router
 * takes it whenever its spend reading is fresh and under its limit, so an unread one is unmeasured, never passed over,
 * and one at its limit carries a `monthly-spend` window with no reset, so it never proves when it comes back.
 *
 * @param ceiling the plan's ceiling
 * @returns true for a Codex monthly-spend plan
 */
export function neverRouted({ ceiling }: { ceiling: Ceiling }): boolean {
  // The provider is read too: the reason is only text, so a Claude ceiling carrying it is no Codex plan.
  return (
    ceiling.kind === "codex" && ceiling.status === "unreadable" && ceiling.reason === CODEX_MONTHLY_SPEND_NOT_MEASURED
  );
}

/**
 * The one window each provider's usage limit lowers, as `../capacity/ceilings.ts` builds it: that window's
 * `available` IS the plan's usage limit at the instant the reading was taken.
 */
const LIMITED_WINDOW: Readonly<Record<"claude" | "codex", string>> = { claude: "seven-day", codex: "weekly" };

/**
 * Why one ceiling cannot be matched to what it measures, or `undefined` when it can. The machine is found by kind and
 * a plan matched by id with its windows read by kind and by name, so the machine must carry the one `machine` id, a
 * plan's id must name the provider its kind does, and no window name may repeat: each contradiction lets the match
 * and the judgement read two different measurements.
 */
function incoherence({ ceiling }: { ceiling: Ceiling }): string | undefined {
  if (ceiling.kind === "machine") {
    return ceiling.id === "machine"
      ? undefined
      : `the filed reading's ceiling ${ceiling.id} is the machine under another id, so it measures no machine`;
  }
  if (!ceiling.id.startsWith(`${ceiling.kind}:`)) {
    return `the filed reading's ceiling ${ceiling.id} is a ${ceiling.kind} plan, so its id names no plan it measured`;
  }
  const names = ceiling.windows.map((window) => window.window);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    return `the filed reading's ceiling ${ceiling.id} carries its ${repeated} window twice, so it measures nothing`;
  }
  return undefined;
}

/** Why one configured plan is not what its filed ceiling measured, or `undefined` when it still is. */
function planDrift({ plan, ceiling }: { plan: RegisteredPlan; ceiling: Ceiling | undefined }): string | undefined {
  const id = `${plan.provider}:${plan.alias}`;
  if (ceiling === undefined) {
    return `the plan register names ${id}, which the filed reading never measured`;
  }
  if (plan.allowance.kind !== "weekly-window") {
    // A Claude monthly-spend plan is routed on its spend reading, which no seat window measures, so whatever the
    // filed ceiling says — a stale spent week included — it is not proof. A Codex one is never routed at all.
    return plan.provider === "claude"
      ? `the plan register measures ${id} in monthly spend, which a router takes on a fresh spend reading no window here proves spent`
      : undefined;
  }
  if (neverRouted({ ceiling })) {
    return `the plan register now measures ${id} on a weekly window, which the filed reading read as monthly spend`;
  }
  if (ceiling.status === "paused" || ceiling.status === "unreadable") {
    // Measured nothing, so it already reads unmeasurable for that, more precisely than a missing window would say.
    return undefined;
  }
  const limitedName = LIMITED_WINDOW[plan.provider];
  const limited = ceiling.windows.find((window) => window.window === limitedName);
  if (limited === undefined) {
    // Fails closed: with no limited window, nothing shows the limit the reading was taken under is the one now set.
    return `the filed reading's ceiling ${id} carries no ${limitedName} window, so the usage limit it was read under is not measured`;
  }
  if (plan.usageLimitPercent > limited.available) {
    return `the plan register raised ${id}'s usage limit to ${String(plan.usageLimitPercent)}% since the filed reading measured ${String(limited.available)}%`;
  }
  return undefined;
}

/**
 * The first way the register has moved past the reading so that a plan it measured spent, or never measured,
 * could now take a seat — or a ceiling too incoherent to match: the machine under another id, a plan's id and kind
 * naming two providers, a window name repeated, or one id on two ceilings, which the match by id reads only one of.
 *
 * @param ceilings every ceiling the filed reading carries
 * @param plans every plan the register configures now, both providers, in registered order
 * @returns why the reading no longer proves the fleet spent, or `undefined` when the register matches it
 */
export function registerDrift({
  ceilings,
  plans,
}: {
  ceilings: readonly Ceiling[];
  plans: readonly RegisteredPlan[];
}): string | undefined {
  const malformed = ceilings.map((ceiling) => incoherence({ ceiling })).find((why) => why !== undefined);
  if (malformed !== undefined) {
    return malformed;
  }
  const ids = ceilings.map((ceiling) => ceiling.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) {
    return `the filed reading carries the ceiling ${twice} twice, so it measures nothing`;
  }
  const byId = new Map(ceilings.map((ceiling) => [ceiling.id, ceiling]));
  for (const plan of plans) {
    const drift = planDrift({ ceiling: byId.get(`${plan.provider}:${plan.alias}`), plan });
    if (drift !== undefined) {
      return drift;
    }
  }
  return undefined;
}
