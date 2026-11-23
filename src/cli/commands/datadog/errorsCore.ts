/**
 * The PURE core of `slopweaver datadog errors`: its usage, its flag parser and both renderings. No client, no
 * clock, no env — `errorsRun.ts` does those — so the manifest reads the usage string without loading the SDK.
 */
import {
  ERROR_TRACKING_STATE_LABELS,
  ERROR_TRACKING_STATES,
  type ErrorTrackingAgeSummary,
  type ErrorTrackingIssueRow,
  type ErrorTrackingOrder,
  type ErrorTrackingState,
  type ErrorTrackingTrack,
  parseErrorTrackingState,
} from "../../../datadog/errorTracking.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** The validated invocation for `datadog errors`. */
export interface DatadogErrorsOptions {
  readonly query: string;
  readonly from: string;
  readonly to: string;
  readonly track: ErrorTrackingTrack;
  readonly order: ErrorTrackingOrder;
  /** Empty keeps every state. */
  readonly states: readonly ErrorTrackingState[];
  /** How many rows the text view lists; the per-state summary always covers every issue returned. */
  readonly limit: number;
  readonly json: boolean;
}

const TRACKS: readonly ErrorTrackingTrack[] = ["trace", "logs", "rum"];
const ORDERS: readonly ErrorTrackingOrder[] = ["count", "newest"];

const DATADOG_ERRORS_FLAG_SPEC = {
  boolean: ["json"],
  value: ["query", "from", "to", "track", "order", "state", "limit"],
} as const;

/** Every flag `datadog errors` accepts in `--flag` form, so the help ratchet compares it with the usage. */
export const DATADOG_ERRORS_FLAG_NAMES: readonly string[] = [
  ...DATADOG_ERRORS_FLAG_SPEC.value.map((name) => `--${name}`),
  ...DATADOG_ERRORS_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `--state`'s comma list read into states, with one reason per token no state matches. */
function parseStateList({ raw }: { raw: string | undefined }): {
  states: ErrorTrackingState[];
  reasons: string[];
} {
  const states: ErrorTrackingState[] = [];
  const reasons: string[] = [];
  if (raw === undefined) {
    return { reasons, states };
  }
  for (const token of raw.split(",").filter((each) => each.trim() !== "")) {
    const state = parseErrorTrackingState({ value: token });
    if (state === null) {
      reasons.push(`--state '${token}' is not one of for-review, reviewed, ignored, resolved, excluded`);
    } else {
      states.push(state);
    }
  }
  return { reasons, states };
}

/** An issue's service as the text view names it; an issue Datadog attributes to no service says so. */
function serviceLabel({ service }: { service: string | null }): string {
  if (service === null) {
    return "(no service)";
  }
  return service;
}

/** `--limit` read as a positive whole number, 25 when absent, or the reason it is not one. */
function parseLimit({ raw }: { raw: string | undefined }): { limit: number; reasons: string[] } {
  if (raw === undefined) {
    return { limit: 25, reasons: [] };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    return { limit: 25, reasons: [DatadogArgsErrors.notAWholeNumber({ flag: "--limit", got: raw }).message] };
  }
  return { limit: n, reasons: [] };
}

/**
 * Parse `datadog errors`'s flags.
 *
 * @param rest the argv tail
 * @returns the validated options, or every rejection
 */
export function parseDatadogErrorsOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogErrorsOptions, DatadogArgsError> {
  const parsed = parseFlagTail({ rest, spec: DATADOG_ERRORS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const reasons: string[] = [];

  const track = TRACKS.find((each) => each === flagValueOr({ fallback: "trace", name: "track", parsed: parsed.value }));
  if (track === undefined) {
    reasons.push(`--track must be one of ${TRACKS.join(", ")}, got '${String(values["track"])}'`);
  }
  const order = ORDERS.find((each) => each === flagValueOr({ fallback: "count", name: "order", parsed: parsed.value }));
  if (order === undefined) {
    reasons.push(`--order must be one of ${ORDERS.join(", ")}, got '${String(values["order"])}'`);
  }
  const { states, reasons: stateReasons } = parseStateList({ raw: values["state"] });
  const { limit, reasons: limitReasons } = parseLimit({ raw: values["limit"] });
  reasons.push(...stateReasons, ...limitReasons);

  if (reasons.length > 0 || track === undefined || order === undefined) {
    return err(DatadogArgsErrors.optionsRefused({ reasons }));
  }
  return ok({
    from: flagValueOr({ fallback: "1d", name: "from", parsed: parsed.value }),
    json: flags.has("json"),
    limit,
    order,
    query: flagValueOr({ fallback: "*", name: "query", parsed: parsed.value }),
    states,
    to: flagValueOr({ fallback: "now", name: "to", parsed: parsed.value }),
    track,
  });
}

/** What one `datadog errors` run established. */
export interface ErrorsReport {
  readonly site: string;
  readonly query: string;
  readonly track: ErrorTrackingTrack;
  readonly order: ErrorTrackingOrder;
  readonly states: readonly ErrorTrackingState[];
  readonly fromMs: number;
  readonly toMs: number;
  /** The instant ages are measured from. */
  readonly nowMs: number;
  readonly byState: Readonly<Partial<Record<ErrorTrackingState, ErrorTrackingAgeSummary>>>;
  readonly issues: readonly (ErrorTrackingIssueRow & { readonly link: string })[];
}

const DAY_MS = 86_400_000;

/** One issue's `type: message`, cut to a line. */
function issueTitle({ row }: { row: ErrorTrackingIssueRow }): string {
  const parts = [row.errorType, row.errorMessage].filter((part): part is string => part !== null && part !== "");
  // A message often carries its own stack or a multi-line payload; one issue stays one line.
  const joined = parts.join(": ").replace(/\s+/g, " ").trim();
  const title = joined === "" ? "(no type or message)" : joined;
  return title.length > 110 ? `${title.slice(0, 109)}…` : title;
}

/**
 * The human view: the window, a per-state summary over every issue returned, and the first `limit` rows.
 *
 * @param report what the run established
 * @param limit how many issue rows to list
 * @returns the rendered report
 */
export function renderErrorsText({ report, limit }: { report: ErrorsReport; limit: number }): string {
  const lines = [
    `datadog errors: ${String(report.issues.length)} issue(s) returned, ${report.track} track, ordered by ${report.order}`,
    `  site    ${report.site}`,
    `  query   ${report.query}`,
    `  window  ${new Date(report.fromMs).toISOString()} → ${new Date(report.toMs).toISOString()}`,
    `  states  ${report.states.length > 0 ? report.states.map((s) => ERROR_TRACKING_STATE_LABELS[s]).join(", ") : "all"}`,
    "",
    "  by state (over the issues returned; age = days since first seen; ≥ = Datadog's per-state cap reached):",
  ];
  for (const state of ERROR_TRACKING_STATES) {
    const summary = report.byState[state];
    if (summary === undefined) {
      continue;
    }
    const issues = summary.capped ? `≥${String(summary.issues)}` : String(summary.issues);
    lines.push(
      `    ${ERROR_TRACKING_STATE_LABELS[state].padEnd(11)} ${issues.padStart(4)} issue(s) · ` +
        `${summary.events.toLocaleString("en-US")} event(s) · median age ${String(summary.medianAgeDays)}d · ` +
        `oldest ${String(summary.oldestAgeDays)}d · ${String(summary.olderThan30Days)} older than 30d`,
    );
  }
  lines.push("");
  report.issues.slice(0, limit).forEach((row, index) => {
    const ageDays = Math.floor((report.nowMs - row.firstSeenMs) / DAY_MS);
    lines.push(
      `  ${String(index + 1).padStart(3)}. ${row.count.toLocaleString("en-US").padStart(8)}  ` +
        `${ERROR_TRACKING_STATE_LABELS[row.state].padEnd(10)}  ${serviceLabel({ service: row.service })}`,
      `       ${issueTitle({ row })}`,
      `       first seen ${new Date(row.firstSeenMs).toISOString()} (${String(ageDays)}d)` +
        `${row.firstSeenVersion === null ? "" : ` in ${row.firstSeenVersion}`} · ${row.link}`,
    );
  });
  if (report.issues.length > limit) {
    lines.push(`  … ${String(report.issues.length - limit)} more — raise --limit, or --json for every row`);
  }
  return lines.join("\n");
}
