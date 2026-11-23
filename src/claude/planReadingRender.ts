/**
 * One `PLAN` line per CONFIGURED plan: every window it carries with that window's OWN reset, or why there is no
 * reading. Pure: plan readings in, lines out.
 *
 * This is the completeness channel `claude gauge` prints beside its table, and the one `supervisor tick open`
 * lifts verbatim. The table shows only READABLE plans and one `resets` column (the all-models week's), and an
 * unreadable plan's problem went to stderr alone — so when the provider stopped
 * answering the five-hour header and the gauge refused every plan, the tick digest printed "nothing to react to"
 * while the chair spent a plan nobody could see, and plan-five's Fable week went from 20% to 100% unwatched
 * A plan that cannot be read is a line that says so; it never disappears.
 *
 * The lines are uncapped on purpose: their bound is the configured plan count, and folding one into "and N more"
 * would hide exactly the plan the chair most needs to see.
 */
import { foldLineBreaks } from "#lib/lineBreaks.js";

import { renderPlanLapse } from "../plans/lapse.js";
import type { ClaudeAccountGauge, ClaudePlanSpend, ClaudeWindowReading } from "./contracts.js";
import type { ClaudeSpendVerdict } from "./spendPolicy.js";

/** The fixed prefix every plan line opens with, so a reader of the captured text lifts them all and nothing else. */
export const PLAN_LINE_PREFIX = "PLAN ";

/**
 * One configured plan as the gauge sweep left it: read, judged on its monthly spend, unread with why, or
 * deliberately paused — each carrying when its paid subscription lapses, from the CONFIGURED row, since a rate-limit
 * gauge owns no subscription fact.
 */
export type ClaudePlanReading = (
  | { readonly kind: "read"; readonly alias: string; readonly gauge: ClaudeAccountGauge }
  | { readonly kind: "spend"; readonly alias: string; readonly verdict: ClaudeSpendVerdict }
  | { readonly kind: "unread"; readonly alias: string; readonly problem: string }
  | { readonly kind: "paused"; readonly alias: string; readonly reason: string; readonly sinceIso: string }
) & { readonly lapsesAtIso?: string };

/**
 * One window as `<name> <pct>% resets <iso>`, with the provider's status named when it is not plain `allowed`.
 *
 * @param name the window's short name as the line prints it
 * @param window the reading
 * @returns the clause
 */
function windowClause({ name, window }: { name: string; window: ClaudeWindowReading }): string {
  const percent = `${String(Math.round(window.utilization * 100))}%`;
  const status = window.status === "allowed" ? "" : ` ${window.status.toUpperCase()}`;
  return `${name} ${percent}${status} resets ${window.resetAtIso}`;
}

/**
 * One readable plan's line: the windows the provider sent, each with its own reset. A five-hour clause prints only
 * when the plan carries that window — measured, no plan does any more (`claude gauge`, every probe answers the weekly
 * trios alone), so a standing `5h NO LIMIT` would name a limit that no longer exists on every line. A missing Fable
 * window still says UNREAD, because that one is a window the plan HAS, and a `0%` would read as a whole unspent week.
 *
 * @param gauge the plan's reading
 * @returns the line body after the alias
 */
function readBody({ gauge }: { gauge: ClaudeAccountGauge }): string {
  const fiveHour = gauge.fiveHour === undefined ? [] : [windowClause({ name: "5h", window: gauge.fiveHour })];
  const fable =
    gauge.sevenDayFable === undefined
      ? "fable UNREAD — no Fable window was returned"
      : windowClause({ name: "fable", window: gauge.sevenDayFable });
  return [...fiveHour, windowClause({ name: "week", window: gauge.sevenDay }), fable].join(" · ");
}

/**
 * One plan's line body after the alias: its windows, why it is unread, or its pause.
 *
 * @param plan the plan's reading
 * @returns the body, before the lapse clause
 */
function readingBody({ plan }: { plan: ClaudePlanReading }): string {
  switch (plan.kind) {
    case "read":
      return readBody({ gauge: plan.gauge });
    case "spend":
      return `monthly spend ${plan.verdict.kind.toUpperCase()} — ${foldLineBreaks({ text: plan.verdict.reason })}`;
    case "unread":
      return `UNREAD — ${foldLineBreaks({ text: plan.problem })}`;
    case "paused":
      return `PAUSED since ${plan.sinceIso} — ${foldLineBreaks({ text: plan.reason })}`;
    default: {
      const unreachable: never = plan;
      return unreachable;
    }
  }
}

/**
 * Every configured plan as one `PLAN` line, in the order given, each ending on when its paid subscription lapses
 * — `lapse UNRECORDED` when nobody has recorded it — whatever the reading, so no shape of line can drop it.
 *
 * @param plans each configured plan's reading, unread reason or pause, in configured order
 * @returns one line per plan, each opening with {@link PLAN_LINE_PREFIX}
 */
export function renderPlanReadingLines({ plans }: { plans: readonly ClaudePlanReading[] }): readonly string[] {
  return plans.map(
    (plan) =>
      `${PLAN_LINE_PREFIX}${plan.alias}: ${readingBody({ plan })} · ${renderPlanLapse({ lapsesAtIso: plan.lapsesAtIso })}`,
  );
}

/**
 * Every configured plan's reading out of one gauge sweep. A probed plan is read or unread by its own outcome; a
 * plan the sweep skipped is paused when the operator paused it; an unpaused monthly-spend plan carries its spend
 * verdict off the readings ledger (`./spendBudgets.ts`), never a probe; and any other is unread because a `--plan`
 * narrowed the sweep to another — said, never dropped.
 *
 * @param configured every plan the accounts file names, in configured order, with its pause when it has one
 * @param outcomes each probed plan's outcome
 * @param only the alias a `--plan` narrowed the sweep to, when one did
 * @param spends every unpaused monthly-spend plan's verdict at the sweep's instant
 * @returns one reading per configured plan, in configured order
 */
export function planReadingsOf({
  configured,
  only,
  outcomes,
  spends,
}: {
  configured: readonly {
    readonly alias: string;
    readonly lapsesAtIso?: string;
    readonly paused?: { readonly reason: string; readonly sinceIso: string };
  }[];
  only?: string | undefined;
  outcomes: readonly { readonly alias: string; readonly gauge?: ClaudeAccountGauge; readonly problem?: string }[];
  spends: readonly ClaudePlanSpend[];
}): readonly ClaudePlanReading[] {
  return configured.map((account): ClaudePlanReading => {
    const lapse = account.lapsesAtIso === undefined ? {} : { lapsesAtIso: account.lapsesAtIso };
    const outcome = outcomes.find((one) => one.alias === account.alias);
    if (outcome?.gauge !== undefined) {
      return { alias: account.alias, gauge: outcome.gauge, kind: "read", ...lapse };
    }
    if (outcome?.problem !== undefined) {
      return { alias: account.alias, kind: "unread", problem: outcome.problem, ...lapse };
    }
    if (outcome !== undefined) {
      return { alias: account.alias, kind: "unread", problem: "the probe returned no reading and no reason", ...lapse };
    }
    if (account.paused !== undefined) {
      return { alias: account.alias, kind: "paused", ...account.paused, ...lapse };
    }
    const spend = spends.find((one) => one.alias === account.alias);
    if (spend !== undefined) {
      return { alias: account.alias, kind: "spend", verdict: spend.verdict, ...lapse };
    }
    const problem = only === undefined ? "the sweep did not probe it" : `not probed because --plan selected ${only}`;
    return { alias: account.alias, kind: "unread", problem, ...lapse };
  });
}
