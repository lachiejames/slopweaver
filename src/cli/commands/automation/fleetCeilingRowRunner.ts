/**
 * The `fleet-ceiling-report` kind's executor: measure the days the plans left unused, publish the morning's page,
 * and card the owner's Queue only when the page needs the owner (`../../../live/automation/fleetCeilingAsk.ts`). A measurement
 * that broke still publishes its page, then FAILS the firing with `EXIT_ERROR` — the exit code, not `failed`, is what
 * settles a firing failed — so the failure hold files one p0 finding and a repair is seated on it, never asked of the owner.
 *
 * Beside `./rowRunners.ts` for the reason `./metricsPushRowRunner.ts` is: everything it needs arrives through
 * `RecipeRunDueDeps`. It has no Slack leg and reads no prompt channel: the report lands on the
 * Queue or a page on this install, never a post.
 */
import { err, type Result } from "#lib/result.js";

import type { FleetCeilingReport } from "../../../capacity/seatCeiling.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import {
  fleetCeilingDelivery,
  fleetCeilingSlugForSlot,
  planFleetCeilingReport,
} from "../../../live/automation/fleetCeilingReport.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { FleetCeilingDelivered } from "./fleetCeilingDeliveryErrors.js";
import type { RecipeRunDueDeps, RowOutcome } from "./rowRunners.js";

/** What became of the card and yesterday's card, in words for the outcome line. */
function placedWords({ delivered }: { delivered: FleetCeilingDelivered }): string {
  const card = {
    existing: "card already on the Queue",
    none: "no card, nothing needs them",
    placed: "card placed on the Queue",
    settled: "card already settled by them",
    withdrawn: "an earlier attempt's card withdrawn, this reading no longer earns it",
  }[delivered.card];
  const previous = delivered.previous;
  if (previous.kind === "withdrawn") {
    return `${card} · yesterday's card withdrawn`;
  }
  if (previous.kind === "withdraw-failed") {
    return `${card} · yesterday's card NOT withdrawn: ${previous.why}`;
  }
  return card;
}

/**
 * Run one `fleet-ceiling-report` row: read the span ending at the firing's own slot, then publish its page and place
 * its card once.
 *
 * The span ends at `slotIso` rather than the clock, so a retried firing measures the same days and lands under the
 * same slug. `--dry-run` does the real reads and stops before any effect, naming the page and card it would place.
 *
 * @param definition the due row
 * @param deps the four edges it reads — no Slack leg and no prompt channel is reachable from here
 * @param dryRun whether to read and withhold every effect
 * @param home the state home this tick is running over
 * @param base the shared not-yet-run outcome fields
 * @param slotIso the firing this run covers, and the instant its span ends
 * @returns what happened, ready to print
 */
export async function runFleetCeilingRow({
  definition,
  deps,
  dryRun,
  home,
  base,
  slotIso,
}: {
  definition: RecipeDefinition;
  deps: Pick<
    RecipeRunDueDeps,
    "deliverFleetCeiling" | "now" | "readFleetCeilingReport" | "readFleetWhy" | "withdrawFleetCeilingCard"
  >;
  dryRun: boolean;
  home: string;
  base: Omit<RowOutcome, "line">;
  slotIso: string;
}): Promise<RowOutcome> {
  const { recipeId } = definition;
  const plan = planFleetCeilingReport({ definition });
  if (plan.isErr()) {
    return failedOutcome({ base, line: `recipe ${recipeId} · REFUSED · ${plan.error.message}` });
  }
  const { days } = plan.value;
  const report = await readReportCatching({ days, deps, home, slotIso });
  if (report.isErr()) {
    const line = `recipe ${recipeId} · fleet ceiling could not be read · ${report.error.join("; ")}`;
    if (dryRun) {
      return failedOutcome({ base, line });
    }
    return failedOutcome({ base, line: await withEarlierCardWithdrawn({ deps, home, line, slotIso }) });
  }
  const why = deps.readFleetWhy({ home, nowIso: slotIso });
  const delivery = fleetCeilingDelivery({ days, report: report.value, slotIso, why });
  if (delivery.isErr()) {
    return failedOutcome({ base, line: `recipe ${recipeId} · REFUSED · ${delivery.error.message}` });
  }
  const { ask, brokenReason, slug } = delivery.value;
  const legs = `fleet ceiling --days ${String(days)} → page ${slug}`;
  if (dryRun) {
    const card = ask === null ? "no card, nothing needs them" : `a ${ask.kind} card on the Queue`;
    const fails = brokenReason === null ? "" : ` · would FAIL and hold for a seated repair: ${brokenReason}`;
    return { ...base, failed: false, line: `recipe ${recipeId} · would publish · ${legs} · ${card}${fails}` };
  }
  const delivered = await deps.deliverFleetCeiling({ delivery: delivery.value, home, nowIso: deps.now() });
  if (delivered.isErr()) {
    return { ...failedOutcome({ base, line: `recipe ${recipeId} · ${legs} · ${delivered.error.message}` }), ran: true };
  }
  const placed = `${delivered.value.pageUrl} · ${placedWords({ delivered: delivered.value })}`;
  return ranOutcome({ base, brokenReason, line: `recipe ${recipeId} · ran · ${legs} · ${placed}` });
}

/**
 * Read the report, folding a reader that THREW into the same failure as one that answered `err` — a ledger path that
 * is a directory throws `EISDIR` from the line reader — so it still fails with exit 1 and still withdraws an earlier
 * attempt's card, rather than escaping to the row wrapper's exit-less `THREW` line.
 */
async function readReportCatching({
  days,
  deps,
  home,
  slotIso,
}: {
  days: number;
  deps: Pick<RecipeRunDueDeps, "readFleetCeilingReport">;
  home: string;
  slotIso: string;
}): Promise<Result<FleetCeilingReport>> {
  try {
    return await deps.readFleetCeilingReport({ days, home, nowIso: slotIso });
  } catch (cause) {
    return err([`the report reader threw: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
}

/**
 * A firing that could not read its report never reaches delivery, so the card an earlier attempt at the same slot
 * left open is withdrawn here instead — the firing still fails, and nothing is left asking the owner.
 *
 * Residue, stated: a withdrawal that THROWS rather than answering `err` — `handover withdraw`'s own
 * router crashing — escapes to `runOneRowSafely`'s `THREW` line, which still settles the firing failed, and
 * `slotSettle.ts`'s failure hold still files the repair finding ("exit none"), so a repair is seated and nothing new
 * is asked of the owner; what that line does not do is name the card, which the repair seat finds on the board. Catching
 * every seam's throw here would not close the class — `deliverFleetCeiling`'s own withdraw sits behind the same verb.
 */
async function withEarlierCardWithdrawn({
  deps,
  home,
  line,
  slotIso,
}: {
  deps: Pick<RecipeRunDueDeps, "withdrawFleetCeilingCard">;
  home: string;
  line: string;
  slotIso: string;
}): Promise<string> {
  const slug = fleetCeilingSlugForSlot({ slotIso });
  if (slug === undefined) {
    return line;
  }
  const withdrawn = await deps.withdrawFleetCeilingCard({ home, slug });
  if (withdrawn.isErr()) {
    return `${line} · ${withdrawn.error.message}`;
  }
  if (withdrawn.value === "withdrawn") {
    return `${line} · an earlier attempt's card withdrawn`;
  }
  return line;
}

/** A failed firing: `EXIT_ERROR` on every failed arm, so settlement records it failed and the failure hold runs. */
function failedOutcome({ base, line }: { base: Omit<RowOutcome, "line">; line: string }): RowOutcome {
  return { ...base, exitCode: EXIT_ERROR, failed: true, line };
}

/**
 * A delivered firing's outcome: clean, or FAILED with `EXIT_ERROR` when the reading broke. The page stands with no
 * card; the failure hold then seats a repair — never a card asking the owner.
 */
function ranOutcome({
  base,
  brokenReason,
  line,
}: {
  base: Omit<RowOutcome, "line">;
  brokenReason: string | null;
  line: string;
}): RowOutcome {
  if (brokenReason !== null) {
    return {
      ...base,
      exitCode: EXIT_ERROR,
      failed: true,
      line: `${line} · the measurement BROKE: ${brokenReason}`,
      ran: true,
    };
  }
  return { ...base, exitCode: EXIT_OK, failed: false, line, ran: true };
}
