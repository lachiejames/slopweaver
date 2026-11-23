/**
 * The PURE core of `slopweaver reflect telemetry`: flag parsing and the rendering of a reading into lines.
 * No fs, no clock, no network — `telemetryRun.ts` does every read and resolves every credential.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { ToolExecutionErrorReading } from "../../../reflect/telemetry.js";
import { flagValueOr, parseFlagTail, parsePositiveInteger } from "../../optionParsers.js";

/** The most failures one invocation collects before it stops and reports truncation. */
export const REFLECT_TELEMETRY_DEFAULT_LIMIT = 500;

/**
 * The validated invocation for `reflect telemetry`.
 *
 * @internal
 */
export interface ReflectTelemetryOptions {
  readonly from: string;
  readonly to: string;
  readonly limit: number;
  readonly json: boolean;
}

/**
 * The one flag spec the verb parses with, exported so `helpTruth.test.ts` probes the REAL list rather than
 * a copy of it — a verb whose help advertises a flag its parser does not accept is the drift that test exists
 * to catch, and it can only catch it if there is exactly one list.
 */
export const REFLECT_TELEMETRY_FLAG_SPEC = {
  boolean: ["json"],
  value: ["from", "to", "limit"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/**
 * The window start used when the caller states none — the reflection loop's own default cadence.
 * Printed in every result, never applied invisibly.
 */
export const TELEMETRY_DEFAULT_FROM = "24h";

/**
 * Parse `reflect telemetry`'s flags.
 *
 * @param rest the argv tail (after `slopweaver reflect telemetry`)
 * @param defaultLimit the cap applied when `--limit` is absent
 * @returns the validated options, or every rejection
 */
export function parseReflectTelemetryOptions({
  rest,
  defaultLimit,
}: {
  rest: readonly string[];
  defaultLimit: number;
}): Result<ReflectTelemetryOptions> {
  const parsed = parseFlagTail({ rest, spec: REFLECT_TELEMETRY_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const rawLimit = values["limit"];
  const errors: string[] = [];
  const limit =
    rawLimit === undefined ? defaultLimit : parsePositiveInteger({ value: rawLimit, label: "--limit", errors });
  if (limit === undefined) {
    return err(errors);
  }
  return ok({
    from: flagValueOr({ fallback: TELEMETRY_DEFAULT_FROM, name: "from", parsed: parsed.value }),
    json: flags.has("json"),
    limit,
    to: flagValueOr({ fallback: "now", name: "to", parsed: parsed.value }),
  });
}

/**
 * Count each tool's failures, most-failed first, so a reader sees the pattern rather than a log.
 *
 * @param reading the reading to summarise
 * @returns one `{ toolName, count }` row per tool that failed, descending by count then by name
 */
export function tallyByTool({
  reading,
}: {
  reading: ToolExecutionErrorReading;
}): readonly { readonly toolName: string; readonly count: number }[] {
  const toolNames = [...new Set(reading.errors.map((error) => error.toolName))];
  return toolNames
    .map((toolName) => ({ count: reading.errors.filter((error) => error.toolName === toolName).length, toolName }))
    .toSorted((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName));
}

/**
 * Whether this reading is a measurement — that is, whether its number can be believed as a number.
 *
 * The distinction the whole phase turns on, hoisted out of the shell so it is testable and so the exit code
 * carries it. An `aged-out` window is never a measurement: it was not queried, and its zero means the data
 * is gone. An `unknown` window is a measurement only when it found something — a floor is still a number,
 * whereas an empty one cannot be told apart from an expired one. `live` and `partial` are measurements,
 * an honest zero included — except an empty reading over matched events that went unread, whose zero is
 * the reader's blindness rather than the window's quiet.
 *
 * @param reading the reading to judge
 * @returns whether the caller may read `reading.errors.length` as a count
 */
export function isMeasurement({ reading }: { reading: ToolExecutionErrorReading }): boolean {
  if (reading.coverage === "aged-out") {
    return false;
  }
  if (reading.errors.length === 0 && reading.unreadableEvents > 0) {
    return false;
  }
  return reading.coverage !== "unknown" || reading.errors.length > 0;
}

/**
 * Render a reading as terminal lines, residue included and never abbreviated away.
 *
 * @param reading the reading to render
 * @param link the frozen console link that reproduces the query
 * @returns the lines to print, in order
 */
export function renderReading({
  reading,
  link,
}: {
  reading: ToolExecutionErrorReading;
  link: string;
}): readonly string[] {
  let headline = `reflect telemetry: ${String(reading.errors.length)} failed tool call(s), coverage ${reading.coverage}`;
  if (reading.unreadableEvents > 0) {
    headline += `, ${String(reading.unreadableEvents)} matched but unreadable`;
  }
  const lines = [
    headline,
    `  window: ${String(reading.fromMs)}..${String(reading.toMs)} (${String(reading.pagesRead)} page(s) read)`,
    `  query:  ${reading.query}`,
  ];
  for (const row of tallyByTool({ reading })) {
    lines.push(`  ${row.toolName}: ${String(row.count)}`);
  }
  lines.push("  could NOT see:");
  for (const line of reading.residue) {
    lines.push(`    - ${line}`);
  }
  lines.push(`  link: ${link}`);
  return lines;
}
