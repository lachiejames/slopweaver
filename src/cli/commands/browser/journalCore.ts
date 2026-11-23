/**
 * Pure selection and rendering for `slopweaver browser verdicts` — reading back what the browser-door guard
 * decided.
 *
 * No fs here; `./journalRun.ts` does every read. The split is what lets the report be tested against
 * hand-built records rather than against a home somebody had to drive a browser to fill.
 */
import type { BrowserJournalRecord } from "../../../admit/browserVerdictJournal.js";

/** How many rows the report prints when `--limit` is not given. */
export const BROWSER_VERDICTS_DEFAULT_LIMIT = 20;

/** The two waiver reasons, so a report can call one out as such without restating the union. */
const WAIVER_REASONS: ReadonlySet<string> = new Set(["break-glass-env", "break-glass-grant"]);

/**
 * The rows a report shows: the most recent ones, newest LAST so a terminal reader's eye ends on the latest.
 *
 * Filtering by `blocked` deliberately keeps the waivers, because a waived refusal is the interesting half of
 * "what did this guard stop" — it stopped nothing, and the row says who decided that.
 *
 * @param records every record the journal holds, in file order
 * @param blocked keep only refusals and waived refusals
 * @param limit how many of the most recent matching rows to keep
 * @returns the rows to render, oldest first
 */
export function selectBrowserVerdicts({
  records,
  blocked,
  limit,
}: {
  records: readonly BrowserJournalRecord[];
  blocked: boolean;
  limit: number;
}): readonly BrowserJournalRecord[] {
  const matching = blocked
    ? records.filter((record) => record.verdict === "block" || record.waived !== undefined)
    : records;
  return limit >= matching.length ? matching : matching.slice(matching.length - limit);
}

/**
 * How many rows of each verdict shape the WHOLE journal holds — the line a reader wants before the rows.
 *
 * @param records every record the journal holds
 * @returns the three counts
 */
export function browserVerdictTotals({ records }: { records: readonly BrowserJournalRecord[] }): {
  readonly allowed: number;
  readonly blocked: number;
  readonly waived: number;
} {
  const waived = records.filter((record) => record.waived !== undefined).length;
  return {
    allowed: records.filter((record) => record.verdict === "allow" && record.waived === undefined).length,
    blocked: records.filter((record) => record.verdict === "block").length,
    waived,
  };
}

/**
 * One row, as the human report prints it.
 *
 * A waiver is spelled `WAIVED` rather than `allow`, and names the verdict it overrode: printing it as an
 * allow would hide the exact event the journal exists to make visible.
 *
 * @param record the row to render
 * @returns the line
 */
export function renderBrowserVerdict({ record }: { record: BrowserJournalRecord }): string {
  const waived = record.waived === undefined ? "" : ` (waived ${record.waived})`;
  const verdict = WAIVER_REASONS.has(record.reason) ? "WAIVED" : record.verdict.toUpperCase();
  const tab = record.tabId === undefined ? "" : ` tab ${String(record.tabId)}`;
  const where = record.url === undefined ? " (url unobserved)" : ` ${record.url}`;
  const tool = record.toolName.replace("mcp__claude-in-chrome__", "");
  return `${record.tsIso}  ${verdict.padEnd(6)} ${record.reason}${waived}  ${tool}${tab}${where}`;
}

/**
 * The whole human report.
 *
 * @param records the rows to show, oldest first
 * @param totals the counts over the whole journal, so a filtered view still says what it filtered from
 * @param path the journal's path, so a reader can grep it themselves
 * @returns the lines to print
 */
export function renderBrowserVerdicts({
  records,
  totals,
  path,
}: {
  records: readonly BrowserJournalRecord[];
  totals: { readonly allowed: number; readonly blocked: number; readonly waived: number };
  path: string;
}): readonly string[] {
  if (totals.allowed + totals.blocked + totals.waived === 0) {
    return [
      `browser verdicts: nothing journalled yet (${path}).`,
      "  A row is written for every mcp__claude-in-chrome__* call the PreToolUse guard decides, so an empty",
      "  journal means no browser call has been made under this home since the guard started recording.",
    ];
  }
  return [
    `browser verdicts: ${String(totals.allowed)} allowed, ${String(totals.blocked)} refused, ` +
      `${String(totals.waived)} waived by a break-glass (${path})`,
    ...records.map((record) => `  ${renderBrowserVerdict({ record })}`),
  ];
}
