/**
 * The pure half of the seven investigation verbs — flag parsing, the usage string, and every printed line,
 * including the sampling qualifier and partition audit that say what each reported figure may be read as.
 *
 * One module for all seven, because they differ only in the product they name: a second copy per product is
 * the drift `cli/manifests`' own header is about.
 */

import type { InvestigateResult } from "../../../datadog/investigate/run.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** What one investigation invocation asked for. */
export interface InvestigateArgs {
  readonly query: string;
  readonly from: string;
  readonly to: string;
  readonly facets: readonly string[];
  readonly excludes: readonly string[];
  readonly rows: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Read a comma-separated list flag, dropping the empty entries a trailing comma leaves.
 *
 * @param raw the flag's value
 * @returns the entries
 */
function listOf({ raw }: { raw: unknown }): readonly string[] {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
}

/**
 * Parse one investigation invocation.
 *
 * The QUERY is positional, because that is how a person types one — `datadog logs 'service:core-api
 * status:error'` — and everything else is a flag.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseInvestigateArgs({ rest }: { rest: readonly string[] }): Result<InvestigateArgs, DatadogArgsError> {
  const flags = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["from", "to", "by", "not", "rows", "home"] },
  });
  if (flags.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { positionals, values } = flags.value;
  const rows = values["rows"];
  let asked = 0;
  if (typeof rows === "string") {
    const parsed = Number(rows);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return err(DatadogArgsErrors.notAWholeNumber({ flag: "--rows", got: rows }));
    }
    asked = parsed;
  }
  return ok({
    excludes: listOf({ raw: values["not"] }),
    facets: listOf({ raw: values["by"] }),
    from: typeof values["from"] === "string" ? values["from"] : "1h",
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    query: positionals.join(" "),
    rows: asked,
    to: typeof values["to"] === "string" ? values["to"] : "now",
  });
}

/** Every flag an investigation verb accepts, as the parser itself reads them. */
export const INVESTIGATE_FLAG_NAMES: readonly string[] = [
  "--from",
  "--to",
  "--by",
  "--not",
  "--rows",
  "--home",
  "--json",
];

/**
 * One group's line — the facet values, the count, and what the census calls it.
 *
 * @param group one counted group
 * @param total the query's own total, so a share can be shown
 * @param showShare false when the groups are known NOT to partition the total, so no share may be printed
 * @returns the line
 */
function groupLine({
  group,
  total,
  showShare,
}: {
  group: InvestigateResult["groups"][number];
  total: number | null;
  showShare: boolean;
}): string {
  const values = Object.entries(group.by)
    .map(([facet, value]) => `${facet}:${value}`)
    .join("  ");
  let share = "";
  if (showShare && total !== null && total !== 0) {
    share = ` (${((group.count / total) * 100).toFixed(1)}%)`;
  }
  // A label that just repeats the value it labels is noise, so it is dropped rather than printed twice.
  const names = Object.values(group.by);
  const repeats = group.label !== null && names.includes(group.label);
  let label = "";
  if (group.label !== null && !repeats) {
    label = `\n      ${group.label}`;
  }
  return `  ${group.count.toLocaleString("en-AU").padStart(9)}${share.padEnd(9)} ${values}${label}`;
}

/**
 * The header's own qualifier and the lines straight under the query: every caveat on the total, and the
 * result's own corroboration hint when it carries one. Empty for a plain count.
 *
 * @param result what the investigation produced
 * @returns the qualifier for the header, and the lines to print under the query
 */
function samplingLines({ result }: { result: InvestigateResult }): { qualifier: string; lines: readonly string[] } {
  const caveats = result.countLabel.caveats.map((caveat) => `  caveat: ${caveat}`);
  const corroborate = result.corroborate === null ? [] : [`  corroborate: ${result.corroborate}`];
  const qualifier = result.countLabel.kind === "sampled-count" ? ` — ${result.countLabel.statedAs}` : "";
  return { lines: [...caveats, ...corroborate], qualifier };
}

/**
 * The partition audit's line, printed before the groups when they do not sum to the total exactly.
 *
 * @param result what the investigation produced
 * @returns the counting rule for an inflated or residual audit, otherwise nothing
 */
function partitionLines({ result }: { result: InvestigateResult }): readonly string[] {
  if (result.partition === null || result.partition.verdict === "partition") {
    return [];
  }
  return [`  ${result.partition.countingRule}`];
}

/**
 * The report one investigation prints.
 *
 * Counts first and events last, which is progressive disclosure: a reader
 * sees the shape of the answer before any event reaches the context window, and `--not` is what they reach
 * for next. A "count" is what Datadog reported: a sampled total says so in its header and caveat, and groups
 * that do not partition the total print the audit's rule and, when they exceed it, no shares at all.
 *
 * @param result what the investigation produced
 * @returns the lines
 */
export function investigateLines({ result }: { result: InvestigateResult }): readonly string[] {
  const total = result.total === null ? "unknown" : result.total.toLocaleString("en-AU");
  const nextStep =
    result.rows.length > 0
      ? []
      : [
          "",
          `  next: --not '<clause>' to cut a group out of the count, --by <facet,facet> to regroup, --rows <n> to read events`,
        ];
  const sampling = samplingLines({ result });
  const showShare = result.partition?.verdict !== "inflated";
  return [
    `datadog ${result.product} — ${total} event(s) over ${result.window.fromMs === 0 ? "the window" : `${new Date(result.window.fromMs).toISOString()} .. ${new Date(result.window.toMs).toISOString()}`}${sampling.qualifier}`,
    `  query: ${result.query}`,
    ...sampling.lines,
    `  grouped by ${result.groupedBy.join(" × ")}${result.truncated ? " (reached the group limit — rarer groups exist)" : ""}`,
    ...partitionLines({ result }),
    ...result.groups.map((group) => groupLine({ group, showShare, total: result.total })),
    ...(result.groups.length === 0 ? ["  (no groups)"] : []),
    ...rowLines({ result }),
    ...nextStep,
    ...(result.notes.length === 0 ? [] : ["", "not measured:", ...result.notes.map((note) => `  ${note}`)]),
  ];
}

/**
 * The event half of the report, printed only when the caller asked for rows.
 *
 * @param result what the investigation produced
 * @returns the lines, empty when no rows were asked for
 */
function rowLines({ result }: { result: InvestigateResult }): readonly string[] {
  if (result.rows.length === 0) {
    return [];
  }
  return [
    "",
    `  ${String(result.rows.length)} event(s):`,
    ...result.rows.map((row) => `  ${row.occurredAtIso}  ${row.service}  ${row.status}  ${row.text}`),
  ];
}
