/**
 * The lines `slopweaver codex usage` prints. Pure: a report in, text out.
 *
 * Every rule here is about not letting a number read as more than it is:
 *
 *  - a token subtotal over a pass kind carrying partial or unmeasured passes prints as a FLOOR, with the
 *    count of what is missing on the same line;
 *  - the five counters are printed side by side and never added together, because which of them overlap
 *    their parents is not established (`./types.CodexUsage`);
 *  - a pass kind with no runs prints `—` rather than `0 tokens`;
 *  - with no rate card there is no money column at all, and the header says why rather than showing
 *    `$0.00`.
 */

import type { MarginalPassReading } from "./marginalYield.js";
import type { CodexUsage } from "./types.js";
import type { CodexUsageReport, PassKindRow } from "./usageReport.js";

/** How many decimal places a money estimate prints to. */
const MONEY_DP = 2;

/** How many prior invocations the marginal reading lists before it summarises the rest. */
const MAX_PRIOR_LINES = 8;

/**
 * How much of a recorded summary or counterexample one row shows before it is cut.
 *
 * MEASURED rather than chosen: a real counterexample on this machine's ledger runs to 1,100 characters and
 * carries its own newlines and numbered list, so eight of them printed whole is a wall of text where a table
 * should be. Reproduce with the run that set it:
 *
 * ```bash
 * slopweaver codex usage --repo <checkout> --diff-sha256 <sha>
 * ```
 */
const MAX_RECORDED_CHARS = 160;

/**
 * One prior invocation's recorded prose, flattened onto a single line and cut to {@link MAX_RECORDED_CHARS}.
 *
 * A counterexample is written to be read in the artifact, so it carries newlines and its own numbering. Here
 * it is one cell of a table, and a raw one breaks every row after it out of the indent — the artifact link
 * on the same row is where the whole text lives.
 */
function oneLine({ text }: { text: string }): string {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length <= MAX_RECORDED_CHARS ? flat : `${flat.slice(0, MAX_RECORDED_CHARS)}…`;
}

/**
 * An instant, or a stated absence.
 *
 * Its own function rather than an operator, because the two cases are different facts a reader has to be
 * able to tell apart: a range with no instants had no contributing invocation at all.
 */
function instant({ iso }: { iso: string | undefined }): string {
  if (iso === undefined) {
    return "no dated invocation";
  }
  return iso;
}

/** Which checkout the report counted, or the stated fact that it counted every one. */
function scopeOf({ report }: { report: CodexUsageReport }): string {
  if (report.repoRoot === undefined) {
    return "every checkout";
  }
  return report.repoRoot;
}

/** A percentage to one decimal place, or `—` when there was no denominator. */
function percent({ fraction }: { fraction: number | undefined }): string {
  return fraction === undefined ? "—" : `${(fraction * 100).toFixed(1)}%`;
}

/** The five counters side by side, never summed. */
function counters({ usage }: { usage: CodexUsage }): string {
  return [
    `in ${usage.input_tokens.toLocaleString("en-US")}`,
    `cached ${usage.cached_input_tokens.toLocaleString("en-US")}`,
    `cache-write ${usage.cache_write_input_tokens.toLocaleString("en-US")}`,
    `out ${usage.output_tokens.toLocaleString("en-US")}`,
    `reasoning ${usage.reasoning_output_tokens.toLocaleString("en-US")}`,
  ].join(", ");
}

/** What a row's find rate came to, in the vocabulary of the arm it belongs to. */
function outcomeText({ row }: { row: PassKindRow }): string {
  const parts: string[] = [];
  const { outcomes } = row;
  if (outcomes.broken > 0 || outcomes.clean > 0) {
    parts.push(`${String(outcomes.broken)} BROKEN / ${String(outcomes.clean)} CLEAN`);
  }
  if (outcomes.ready > 0 || outcomes.blocked > 0) {
    parts.push(`${String(outcomes.ready)} READY / ${String(outcomes.blocked)} BLOCKED`);
  }
  if (outcomes.noVerdict > 0) {
    parts.push(`${String(outcomes.noVerdict)} no-verdict`);
  }
  if (outcomes.fatal > 0) {
    parts.push(`${String(outcomes.fatal)} fatal`);
  }
  return parts.length === 0 ? "no verdicts" : parts.join(", ");
}

/** One pass kind's lines. */
function rowLines({ row }: { row: PassKindRow }): readonly string[] {
  if (row.runs === 0) {
    return [`  ${row.pass}  — never run in this scope`];
  }
  const missing = row.partial + row.unmeasured;
  const qualifier = missing === 0 ? "measured" : `FLOOR — ${String(missing)} of ${String(row.runs)} not fully measured`;
  const lines = [
    `  ${row.pass}  ${String(row.runs)} run(s): ${String(row.complete)} complete, ${String(row.partial)} partial, ${String(row.unmeasured)} unmeasured`,
    `        ${outcomeText({ row })}`,
    `        tokens (${qualifier}): ${counters({ usage: row.measuredSubtotal })}`,
  ];
  if (row.estimate !== undefined) {
    lines.push(
      `        estimate: ${row.estimate.toFixed(MONEY_DP)} over ${String(row.pricedAttempts)} attempt(s); ${String(row.unpricedAttempts)} unpriced`,
    );
  }
  for (const reason of row.unpricedReasons) {
    lines.push(`        unpriced: ${reason}`);
  }
  return lines;
}

/** The marginal-pass reading's own lines. */
function marginalLines({ marginal }: { marginal: MarginalPassReading }): readonly string[] {
  const lines = [
    "",
    `marginal reading for diff ${marginal.target.diffSha256.slice(0, 12)}… in ${marginal.target.repoRoot}`,
    `  the next review pass on this diff would be recorded invocation #${String(marginal.nextOrdinal)}`,
    `  earlier on this diff: ${String(marginal.prior.length)} invocation(s), ${String(marginal.priorConclusive)} conclusive` +
      ` — ${String(marginal.priorTally.broken)} BROKEN, ${String(marginal.priorTally.clean)} CLEAN,` +
      ` ${String(marginal.priorTally.noVerdict)} no-verdict, ${String(marginal.priorTally.fatal)} fatal`,
  ];
  for (const prior of marginal.prior.slice(0, MAX_PRIOR_LINES)) {
    const tie = prior.tiedStart ? " (tied start — its position is arbitrary)" : "";
    lines.push(
      `    #${String(prior.ordinal)} ${prior.pass}/${prior.propertyId} ${prior.verdict}${tie} ${prior.artifactId}`,
    );
    if (prior.recorded.length > 0) {
      lines.push(`        ${oneLine({ text: prior.recorded })}`);
    }
  }
  if (marginal.prior.length > MAX_PRIOR_LINES) {
    lines.push(`    … and ${String(marginal.prior.length - MAX_PRIOR_LINES)} more, in ${marginal.target.repoRoot}`);
  }
  for (const stratum of marginal.strata) {
    lines.push(
      `  by arm: ${stratum.pass} — ${String(stratum.tally.broken)} BROKEN, ${String(stratum.tally.clean)} CLEAN,` +
        ` ${String(stratum.tally.noVerdict)} no-verdict, ${String(stratum.tally.fatal)} fatal`,
    );
  }
  const historic = marginal.yieldAtNextOrdinal;
  if (historic.sampleDiffs === 0) {
    lines.push(`  historic yield at #${String(historic.ordinal)}: no other diff in this checkout reached that ordinal`);
  } else {
    lines.push(
      `  historic yield at #${String(historic.ordinal)} over ${String(historic.sampleDiffs)} other diff(s)` +
        ` (${instant({ iso: historic.earliestIso })} … ${instant({ iso: historic.latestIso })}):` +
        ` ${String(historic.tally.broken)} BROKEN, ${String(historic.tally.clean)} CLEAN,` +
        ` ${String(historic.tally.noVerdict)} no-verdict, ${String(historic.tally.fatal)} fatal`,
    );
  }
  lines.push(
    "  This is VISIBILITY, not a recommendation: nothing here refuses a pass, and a second BROKEN may repeat",
    "  the first rather than add to it — the record schema cannot tell those apart.",
  );
  if (marginal.historyGap.withoutSidecar > 0 || marginal.historyGap.unreadable > 0) {
    lines.push(
      `  the ordinal is a RECORDED ordinal: ${String(marginal.historyGap.withoutSidecar)} pass(es) predate the sidecar and` +
        ` ${String(marginal.historyGap.unreadable)} will not parse, so passes may have run that this cannot see`,
    );
  }
  return lines;
}

/**
 * Render the whole report.
 *
 * @param report what {@link ./usageReport.buildCodexUsageReport} built
 * @returns the lines to print, in order
 */
export function renderCodexUsageReport({ report }: { report: CodexUsageReport }): readonly string[] {
  const lines = [
    `codex usage: ${String(report.coverage.records)} recorded pass(es) in ${scopeOf({ report })}`,
    // Machine-wide, and said so: a pass with no sidecar has no `repoRoot` to scope it by, so these two counts
    // cannot be narrowed to the checkout on the line above them. Printed unqualified they read as that
    // checkout's own, which on a machine with one worktree in scope and 277 legacy passes elsewhere is a
    // three-hundredfold overstatement of what this scope could not see.
    `  coverage (every checkout — a pass with no sidecar has no checkout to scope it by): ${String(report.coverage.withoutSidecar)} predate the sidecar (ordinary), ${String(report.coverage.unreadable)} will not parse (a fault)`,
    `  unmeasured: ${String(report.unmeasured.incomplete)} of ${String(report.unmeasured.passes)} pass(es) carry an attempt the SDK never reported usage for — ${percent({ fraction: report.unmeasured.fraction })}`,
  ];
  if (report.pricing.kind === "none") {
    lines.push(`  pricing: none — ${report.pricing.why}`);
  } else {
    lines.push(
      `  pricing: ${report.pricing.currency} per ${report.pricing.source}, effective ${report.pricing.effectiveFromIso}` +
        `${report.pricing.effectiveToIso === undefined ? "" : ` … ${report.pricing.effectiveToIso}`}`,
      `  counter mapping verified by: ${report.pricing.verifiedBy}`,
      "  An estimate at the REQUESTED model's published rate — not an invoice, and not a claim about which",
      "  model ran.",
    );
  }
  lines.push("");
  for (const row of report.rows) {
    lines.push(...rowLines({ row }));
  }
  if (report.marginal !== undefined) {
    lines.push(...marginalLines({ marginal: report.marginal }));
  }
  return lines;
}
