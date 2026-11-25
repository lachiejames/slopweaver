/**
 * The Fleet page's plan usage block: one line for Claude and one for Codex, each opening onto its plans.
 *
 * By default one overall line per host, shown separately — usage remaining averaged across that host's plans and how
 * many sessions are running, so capacity maxed is checkable at a glance with no arithmetic — each line expanding to
 * its plans, bars per plan (the week, the five-hour session only when the reading carries one, whether a reset is
 * available), and a burn line per
 * host: tokens burned in the last 24 hours and the projected burn, never a time estimate.
 *
 * Each plan is named `plan-one`, `plan-two` with the signed-in email on hover;
 * every status says what it means where it appears; a paused plan reads paused, with its reason and its week's reset.
 *
 * A DERIVATION off three recorded readings and nothing else: the plans' ceilings inside `machine capacity`
 * (`./fleetGlancePlans.ts`'s `GlancePlans`), the seats `session watch` judged, and `fleet burn`'s 24-hour token reading.
 * Every figure is one a reading carried; a reading or a window that was not there says so rather than drawing as zero.
 *
 * Three rules the derivation keeps, each because the alternative is a figure the owner would have to second-guess:
 *
 * - **The average is the week's, unweighted, over every plan not paused.** It is the mean of each plan's
 *   `100 - used%` on the host's weekly window (`seven-day` for Claude, `weekly` for Codex), every plan counted once. A
 *   paused plan is set aside on purpose and named beside the average, and so is a monthly-spend plan nothing measures
 *   (`./planUsageLimit.ts`), which is never routed. A plan at its usage limit IS counted: `used%` is of the share the owner
 *   lets the fleet take, so it reads as 0% left. Any other plan whose reading lacks that window
 *   refuses the whole average: a mean over the plans that happened to read is a different number wearing the same
 *   words. A paused plan's own week is the one the capacity reading in force at its pause carried, since a paused plan
 *   is never probed.
 * - **Sessions are counted where each host can be seen.** Claude's are the seats `session watch` judged `working` whose
 *   hooks named `claude` — the same working seats the verdict counts. A Codex pass fires no cmux hook (`_source` was
 *   `claude` on every frame of the measured log, `src/cmux/events.ts`), so Codex's are the rollouts `fleet burn` saw
 *   drawing tokens in its last minutes. A working seat whose hooks named no host is counted on neither line and said
 *   beside them.
 * - **The projection is an amount, never a time, and it is labelled a forecast.** `fleet burn` carries the 24-hour
 *   total scaled to seven days, and only for a host it measured whole; a lower bound carries none. Any
 *   forecast shown is labelled as based on historical usage trends, never as fact — so the line says whose trend
 *   it extends and that it is a forecast.
 */
import type { Seat } from "../components/live/readNow";
import { aliasOf, type GlancePlan, type GlancePlans } from "./fleetGlancePlans";
import { leftOf, type PlanRow, planRowOf, WEEK_WINDOW } from "./planMetersRails";
import { counted, tokenWords } from "./planMetersWords";
import { isMonthlySpendPlan, usageLimitStopOf } from "./planUsageLimit";

/** One host's 24-hour burn as `fleet burn --json` recorded it (`src/fleet/hostBurn.ts`'s `HostBurn`). */
export type HostBurn =
  | {
      readonly kind: "measured";
      readonly totalTokens: number;
      readonly outputTokens: number;
      readonly projectedWeekTokens: number;
      readonly sessions: number;
      readonly activeSessions: number;
    }
  | {
      readonly kind: "partial";
      readonly totalTokens: number;
      readonly outputTokens: number;
      readonly sessions: number;
      readonly activeSessions: number;
      readonly problems: readonly string[];
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** `fleet burn --json`'s report, the slice this page draws. */
export interface FleetBurn {
  readonly windowHours: number;
  /** How recent a draw counts a session as drawing now, in minutes. */
  readonly activeWithinMinutes: number;
  readonly claude: HostBurn;
  readonly codex: HostBurn;
}

/**
 * A reading the block is drawn from, as its channel stands: in flight, failed with the route's reason, or in hand.
 */
export type UsageRead<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "not-measured"; readonly why: string }
  | { readonly phase: "ready"; readonly value: T };

/**
 * One figure on a host's line: its words, a spinner while the reading it comes off is in flight, or a staleness mark
 * naming what did not read and why — never a sentence standing where the figure goes.
 */
export type HostFigure =
  | { readonly kind: "words"; readonly words: string }
  | { readonly kind: "reading"; readonly subject: string }
  | {
      readonly kind: "unread";
      readonly subject: string;
      readonly why: string;
      /** The two or three words drawn beside the mark, so it says why without a hover; absent draws the glyph alone. */
      readonly shortWords?: string;
    };

/** One host's line and what it opens onto. */
export interface HostUsage {
  readonly host: "claude" | "codex";
  readonly name: "Claude" | "Codex";
  /** The averaged week left, 0..100, the line's bar; `undefined` when the average is not drawn. */
  readonly remainingPercent: number | undefined;
  /** `44% of the week left on average across 3 plans`, or why the plans are not averaged. */
  readonly average: HostFigure;
  /** `5 sessions working`, `4 sessions drawing tokens in the last 10 minutes`, or why none are counted. */
  readonly sessions: HostFigure;
  /**
   * `2.93B tokens burned in the last 24h · 20.5B over 7 days if the last 24h's usage trend holds, a forecast and not a
   * fact`, or why it is not measured.
   */
  readonly burn: HostFigure;
  /** Why the burn is a lower bound, in the reading's own sentences; empty for a whole or unmeasured one. */
  readonly burnProblems: readonly string[];
  /** The host's plans in the reading's order, a spinner while they read, or why none are listed. */
  readonly plans:
    | { readonly kind: "read"; readonly rows: readonly PlanRow[] }
    | { readonly kind: "reading" }
    | { readonly kind: "unread"; readonly why: string };
}

/** Words for a figure. */
function words({ text }: { text: string }): HostFigure {
  return { kind: "words", words: text };
}

/** The whole block. */
export interface FleetUsage {
  /** Claude, then Codex. */
  readonly hosts: readonly [HostUsage, HostUsage];
  /** Working seats whose hooks named no host, and so are on neither line; `undefined` when there are none. */
  readonly unattributedWords: string | undefined;
  /** Why a plan's raise-the-usage-limit button holds (`./planUsageLimit.ts`'s `raiseHeldOf`), `undefined` when live. */
  readonly raiseHeld: string | undefined;
}

/**
 * The host's averaged week left over every plan that is not paused — a paused plan is set aside on purpose and is
 * named beside the average rather than counted. Any other plan whose week did not read refuses the whole average.
 *
 * @returns the bar's share and the words, the share `undefined` when no average is drawn
 */
function averageOf({ host, name, plans }: { host: "claude" | "codex"; name: string; plans: readonly GlancePlan[] }): {
  readonly remainingPercent: number | undefined;
  readonly average: HostFigure;
} {
  if (plans.length === 0) {
    return { average: words({ text: `no ${name} plan in this reading` }), remainingPercent: undefined };
  }
  const paused = plans.filter((plan) => plan.status === "paused").map((plan) => aliasOf({ id: plan.id }));
  // A plan nothing measures is never routed, by design, so like a paused one it is set aside and named — never a
  // failed read refusing the whole average. A Claude monthly-spend plan has no week either: it is judged in dollars.
  const notMeasured = (plan: GlancePlan): boolean => usageLimitStopOf({ plan })?.kind === "not-measured";
  const unmeasured = plans.filter(notMeasured).map((plan) => aliasOf({ id: plan.id }));
  const spending = plans
    .filter((plan) => plan.status !== "paused" && !notMeasured(plan) && isMonthlySpendPlan({ plan }))
    .map((plan) => aliasOf({ id: plan.id }));
  let aside = "";
  if (paused.length > 0) {
    aside = ` · ${paused.join(", ")} paused, not counted`;
  }
  if (unmeasured.length > 0) {
    aside = `${aside} · ${unmeasured.join(", ")} not measured, not counted`;
  }
  if (spending.length > 0) {
    aside = `${aside} · ${spending.join(", ")} on monthly spend, not counted`;
  }
  const counting = plans.filter((plan) => plan.status !== "paused" && !isMonthlySpendPlan({ plan }));
  if (counting.length === 0 && unmeasured.length === 0 && spending.length === 0) {
    return {
      average: words({ text: `every ${name} plan is paused on purpose, so none is counted: ${paused.join(", ")}` }),
      remainingPercent: undefined,
    };
  }
  if (counting.length === 0) {
    return { average: words({ text: `no ${name} plan is counted${aside}` }), remainingPercent: undefined };
  }
  const lefts: number[] = [];
  for (const plan of counting) {
    const week = plan.windows.find((window) => window.window === WEEK_WINDOW[host]);
    let left: number | undefined;
    if (week !== undefined) {
      left = leftOf({ window: week });
    }
    if (left === undefined) {
      return {
        average: {
          kind: "unread",
          subject: `the ${name} plans' average week left`,
          why: `${aliasOf({ id: plan.id })}'s week did not read this time, so the plans are not averaged${aside}`,
        },
        remainingPercent: undefined,
      };
    }
    lefts.push(left);
  }
  const mean = lefts.reduce((sum, left) => sum + left, 0) / lefts.length;
  return {
    average: words({
      text: `${String(Math.round(mean))}% of the week left on average across ${counted({ n: lefts.length, noun: "plan" })}${aside}`,
    }),
    remainingPercent: mean,
  };
}

/** What a burn figure's spinner or staleness mark names. */
const BURN_SUBJECT = "the fleet burn reading";

/** The words beside a burn figure's staleness mark. */
const BURN_NOT_READ = "burn not read";

/** The words beside Codex's session count's staleness mark, which comes off the same reading. */
const SESSIONS_NOT_READ = "sessions not read";

/**
 * A host's burn as one line, and its problems when it is a lower bound.
 *
 * @returns the words and the problems
 */
function burnOf({ host, burn }: { host: "claude" | "codex"; burn: UsageRead<FleetBurn> }): {
  readonly burn: HostFigure;
  readonly burnProblems: readonly string[];
} {
  if (burn.phase === "loading") {
    return { burn: { kind: "reading", subject: BURN_SUBJECT }, burnProblems: [] };
  }
  if (burn.phase === "not-measured") {
    return {
      burn: { kind: "unread", shortWords: BURN_NOT_READ, subject: BURN_SUBJECT, why: burn.why },
      burnProblems: [],
    };
  }
  const own = burn.value[host];
  if (own.kind === "unavailable") {
    return {
      burn: { kind: "unread", shortWords: BURN_NOT_READ, subject: `this host's burn in ${BURN_SUBJECT}`, why: own.why },
      burnProblems: [],
    };
  }
  const burned = `${tokenWords({ count: own.totalTokens })} tokens burned in the last ${String(burn.value.windowHours)}h`;
  if (own.kind === "partial") {
    return {
      burn: words({
        text: `at least ${burned} · no projection, ${counted({ n: own.problems.length, noun: "reading problem" })}`,
      }),
      burnProblems: own.problems,
    };
  }
  return {
    burn: words({
      text: `${burned} · ${tokenWords({ count: own.projectedWeekTokens })} over 7 days if the last ${String(burn.value.windowHours)}h's usage trend holds, a forecast and not a fact`,
    }),
    burnProblems: [],
  };
}

/**
 * Codex's running sessions: the rollouts `fleet burn` saw drawing tokens in its last minutes.
 *
 * @returns the figure
 */
function codexSessionsOf({ burn }: { burn: UsageRead<FleetBurn> }): HostFigure {
  if (burn.phase === "loading") {
    return { kind: "reading", subject: BURN_SUBJECT };
  }
  if (burn.phase === "not-measured") {
    return { kind: "unread", shortWords: SESSIONS_NOT_READ, subject: BURN_SUBJECT, why: burn.why };
  }
  const codex = burn.value.codex;
  if (codex.kind === "unavailable") {
    return {
      kind: "unread",
      shortWords: SESSIONS_NOT_READ,
      subject: `Codex's sessions in ${BURN_SUBJECT}`,
      why: codex.why,
    };
  }
  let floor = "";
  if (codex.kind === "partial") {
    floor = "at least ";
  }
  return words({
    text: `${floor}${counted({ n: codex.activeSessions, noun: "session" })} drawing tokens in the last ${String(burn.value.activeWithinMinutes)} minutes`,
  });
}

/**
 * Why the plans are not listed, for a reading that carried none.
 *
 * @returns the reason, or `undefined` when the plans read
 */
function plansUnreadWhy({ plans }: { plans: GlancePlans }): string | undefined {
  if (plans.kind === "absent") {
    return "the machine capacity reading predates the plans' ceilings";
  }
  if (plans.kind === "unreadable") {
    return "the plans' ceilings in the machine capacity reading did not read";
  }
  return undefined;
}

/**
 * The block: Claude's line and Codex's, each with its plans, its sessions and its burn.
 *
 * @param plans the plans' ceilings off the recorded `machine capacity`, as that reading's channel stands
 * @param seats the seats `session watch` judged, Claude's working sessions counted off them
 * @param burn `fleet burn`'s recorded report, as its channel stands — `not-measured` on a fixture with no capture of it
 * @param nowIso the capacity reading's own instant, every reset measured from it
 * @param raiseHeld why a raise press may not be taken from this reading, `undefined` when it may
 * @returns the block
 */
export function fleetUsageOf({
  plans,
  seats,
  burn,
  nowIso,
  raiseHeld,
}: {
  plans: UsageRead<GlancePlans>;
  seats: readonly Seat[];
  burn: UsageRead<FleetBurn>;
  nowIso: string;
  raiseHeld: string | undefined;
}): FleetUsage {
  const nowMs = Date.parse(nowIso);
  let unreadWhy: string | undefined;
  let read: readonly GlancePlan[] = [];
  if (plans.phase === "not-measured") {
    unreadWhy = `the machine capacity reading did not read: ${plans.why}`;
  } else if (plans.phase === "ready") {
    unreadWhy = plansUnreadWhy({ plans: plans.value });
    if (plans.value.kind === "read") {
      read = plans.value.plans;
    }
  }
  const working = seats.filter((seat) => seat.signal === "working");
  const hostOf = ({
    host,
    name,
    sessions,
  }: {
    host: "claude" | "codex";
    name: "Claude" | "Codex";
    sessions: HostFigure;
  }): HostUsage => {
    const own = read.filter((plan) => plan.provider === host);
    const subject = `the ${name} plans' average week left`;
    let average: { readonly remainingPercent: number | undefined; readonly average: HostFigure };
    let listed: HostUsage["plans"];
    if (plans.phase === "loading") {
      average = { average: { kind: "reading", subject }, remainingPercent: undefined };
      listed = { kind: "reading" };
    } else if (unreadWhy === undefined) {
      average = averageOf({ host, name, plans: own });
      listed = { kind: "read", rows: own.map((plan) => planRowOf({ nowMs, plan })) };
    } else {
      average = { average: { kind: "unread", subject, why: unreadWhy }, remainingPercent: undefined };
      listed = { kind: "unread", why: unreadWhy };
    }
    return {
      ...average,
      ...burnOf({ burn, host }),
      host,
      name,
      plans: listed,
      sessions,
    };
  };
  const unattributed = working.filter((seat) => seat.host !== "claude" && seat.host !== "codex").length;
  let unattributedWords: string | undefined;
  if (unattributed > 0) {
    let whose = "their hooks";
    if (unattributed === 1) {
      whose = "its hooks";
    }
    unattributedWords = `${counted({ n: unattributed, noun: "working seat" })} on neither line: ${whose} named no host`;
  }
  return {
    hosts: [
      hostOf({
        host: "claude",
        name: "Claude",
        sessions: words({
          text: `${counted({ n: working.filter((seat) => seat.host === "claude").length, noun: "session" })} working`,
        }),
      }),
      hostOf({ host: "codex", name: "Codex", sessions: codexSessionsOf({ burn }) }),
    ],
    raiseHeld,
    unattributedWords,
  };
}
