/**
 * The reflection loop's telemetry leg: which tool calls FAILED, read as typed errors rather than guessed
 * lexically.
 *
 * ## Why this exists
 *
 * A sweep over transcripts cannot answer "which commands failed" — the false-positive rate has been
 * measured twice, two months apart, at roughly two thirds. Claude Code's own OTLP export already carries
 * the answer as a typed field, so this module reads it instead of inferring it.
 *
 * ## Why the LOGS track and not the span tree
 *
 * The span tree the design named is real and present — measured over 15 days with
 * `slopweaver datadog raw --method POST --path /api/v2/spans/analytics/aggregate` grouped by
 * `resource_name`: `claude_code.interaction` 6,697, `claude_code.llm_request` 121,707, `claude_code.tool`
 * 113,234, `claude_code.tool.blocked_on_user` 113,311, `claude_code.tool.execution` 112,441. It is the
 * wrong oracle anyway, for two reasons that are properties of the wire rather than preferences: every
 * spans aggregate comes back `traffic_type: "sampled"` (`src/datadog/logsAnalytics.ts`'s header records
 * the same asymmetry — a logs reply carries no `traffic_type` at all), and the error would have to be
 * joined back up a tree to recover the tool that raised it.
 *
 * The unsampled `claude_code.tool_result` log event carries all of it flat and already joined:
 * `tool_name`, `success`, `error_type`, `duration_ms`, `tool_use_id`. So this reads logs. The `error`
 * message is exporter detail, not a required field: a later export stopped carrying it,
 * with tool input, and a failure with no message is still a failure (`slopweaver datadog logs
 * 'service:claude-code @event.name:tool_result @success:false @error:*' --from 15d --by @version`).
 *
 * ## What it deliberately does not read
 *
 * No prompt text, no `tool_input`, no `tool_parameters`, no user identity. Prompt dumping was turned off
 * on purpose and this module does not route around that; "which command failed" is available here as a
 * tool name plus a typed error, never as the command line. That is a bound worth stating in the output
 * rather than only in a comment, which is why `describeResidue` (`telemetryResidue.ts`) always says it.
 *
 * ## The failure this module is built to make impossible
 *
 * **An unreadable window reported as a quiet one.** Datadog retention is finite and there is no cold
 * storage, so a window older than the horizon returns zero rows — indistinguishable, on the wire, from a
 * window in which nothing failed. Every reading therefore carries a {@link WindowCoverage} and a residue
 * list, and an `aged-out` window is answered WITHOUT issuing a query at all, so no caller can mistake its
 * empty `errors` for a measurement.
 */
import { z } from "zod";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";

import { type TelemetryReadError, TelemetryReadErrors } from "./errors.js";
import { describeResidue } from "./telemetryResidue.js";

/**
 * The query that isolates failed tool calls.
 *
 * `@success:false` alone is not enough: `claude_code.api_error` and other event kinds also carry a
 * success flag, and folding them in would report an API hiccup as a failed command.
 */
export const TOOL_ERROR_QUERY = "service:claude-code @event.name:tool_result @success:false";

/** One failed tool call, carrying nothing that identifies a person or reproduces a prompt. */
export interface ToolExecutionError {
  readonly tsIso: string;
  readonly toolName: string;
  /** The exception class Claude Code named, e.g. `ShellError`. */
  readonly errorType: string;
  /** The message the tool raised, e.g. `Shell command failed`; `null` when the exporter withheld it. */
  readonly message: string | null;
  readonly durationMs: number;
  readonly toolUseId: string;
  /** The OTLP trace this call belongs to, so several failures can be seen as one session. */
  readonly traceId: string;
}

/**
 * How long the log indexes keep data, as a range rather than a number.
 *
 * A range because an org may run several indexes with different retentions, and picking one of them would
 * be a silent choice about which windows count as readable. `null` means retention could not be read at
 * all, which is its own answer — see {@link classifyWindowCoverage}.
 */
export interface RetentionHorizon {
  readonly minDays: number;
  readonly maxDays: number;
}

/**
 * What a window's emptiness is allowed to mean.
 *
 * - `live` — every instant in the window is inside the shortest retention, so zero errors means zero errors.
 * - `partial` — the window straddles a horizon (or the indexes disagree about where it is), so zero is a floor.
 * - `aged-out` — the whole window is past the longest retention. Zero here means UNREADABLE.
 * - `unknown` — retention could not be read, so none of the above can be asserted.
 */
export type WindowCoverage = "aged-out" | "live" | "partial" | "unknown";

const MS_PER_DAY = 86_400_000;

/**
 * Decide what an empty answer over this window would mean, before one is fetched.
 *
 * Deliberately conservative at both ends: `live` only when the window starts inside the SHORTEST
 * retention, `aged-out` only when it ends outside the LONGEST. Everything between is `partial`, which is
 * the honest label for "some of this may be gone".
 *
 * @param fromMs the window start, epoch ms
 * @param toMs the window end, epoch ms
 * @param nowMs the single instant the horizon is measured back from
 * @param retention the index retention range, or `null` when it could not be read
 * @returns what an empty result over this window is allowed to be read as
 */
export function classifyWindowCoverage({
  fromMs,
  toMs,
  nowMs,
  retention,
}: {
  fromMs: number;
  toMs: number;
  nowMs: number;
  retention: RetentionHorizon | null;
}): WindowCoverage {
  if (retention === null) {
    return "unknown";
  }
  if (toMs <= nowMs - retention.maxDays * MS_PER_DAY) {
    return "aged-out";
  }
  if (fromMs >= nowMs - retention.minDays * MS_PER_DAY) {
    return "live";
  }
  return "partial";
}

/**
 * The subset of a `claude_code.tool_result` log event this module reads.
 *
 * Every field but `error` is required: an event missing one of them is not a tool failure this reader
 * understands, and counting it as one would invent a row. `error` is the exporter's optional detail and
 * projects to `null`, never `""`. `duration_ms` arrives as a string on the wire, hence the coercion — the
 * schema is the wire's shape, not the shape we wish it had.
 */
const TOOL_RESULT_EVENT = z.object({
  attributes: z.object({
    attributes: z.object({
      duration_ms: z.coerce.number(),
      error: z.string().optional(),
      error_type: z.string(),
      otel: z.object({ trace_id: z.string() }),
      tool_name: z.string(),
      tool_use_id: z.string(),
    }),
    timestamp: z.string(),
  }),
});

/**
 * Project one raw log event into a {@link ToolExecutionError}.
 *
 * Returns a plain `Result<…, readonly string[]>` rather than a typed union on purpose: the only thing a
 * caller ever does with a projection miss is count it and name it in the residue, so a discriminated error
 * here would be ceremony (see `.claude/rules/error-handling.md`, "When NOT to introduce a union").
 *
 * @param event one element of the logs-events `data` array, unvalidated
 * @returns the projected failure, or why this event is not one
 */
export function projectToolExecutionError({ event }: { event: unknown }): Result<ToolExecutionError> {
  const parsed = TOOL_RESULT_EVENT.safeParse(event);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const inner = parsed.data.attributes.attributes;
  return ok({
    durationMs: inner.duration_ms,
    errorType: inner.error_type,
    message: unsetFieldAsNull({ key: "error", record: inner }),
    toolName: inner.tool_name,
    toolUseId: inner.tool_use_id,
    traceId: inner.otel.trace_id,
    tsIso: parsed.data.attributes.timestamp,
  });
}

/** What one page of the query returned, plus the cursor that continues it. */
export interface TelemetryPage {
  readonly events: readonly unknown[];
  /** Datadog's `meta.page.after`, or `null` when this was the last page. */
  readonly nextCursor: string | null;
  /** Datadog's `meta.status`. Anything but `done` means the page is a partial answer. */
  readonly status: string;
}

/**
 * The seam that performs one page read. Injected so every branch below is reachable without a network,
 * and so the Datadog binding stays in `telemetrySource.ts` where the credentials are.
 */
export type TelemetryPageFetcher = (input: {
  query: string;
  fromMs: number;
  toMs: number;
  limit: number;
  cursor: string | null;
}) => Promise<Result<TelemetryPage, TelemetryReadError>>;

/** One window's worth of failed tool calls, and everything about the window that could not be seen. */
export interface ToolExecutionErrorReading {
  readonly query: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly coverage: WindowCoverage;
  readonly errors: readonly ToolExecutionError[];
  readonly pagesRead: number;
  /** The cap was hit, so `errors` is a prefix of the window rather than the window. */
  readonly truncated: boolean;
  /** Events the query matched that this reader could not project. Named, never silently dropped. */
  readonly unreadableEvents: number;
  /** What this reading could NOT see, in the reader's own words. Never empty. */
  readonly residue: readonly string[];
}

/** The tally a page fold carries forward, so the loop below stays under the complexity ceiling. */
interface PageFold {
  readonly errors: ToolExecutionError[];
  unreadable: number;
  incomplete: number;
}

/**
 * Fold one page into the running tally.
 *
 * @param page the page just read
 * @param fold the tally to add to, mutated in place
 * @param cap the ceiling `fold.errors` must not exceed
 * @returns nothing
 */
function absorbPage({ page, fold, cap }: { page: TelemetryPage; fold: PageFold; cap: number }): void {
  if (page.status !== "done") {
    fold.incomplete += 1;
  }
  for (const event of page.events) {
    if (fold.errors.length >= cap) {
      return;
    }
    const projected = projectToolExecutionError({ event });
    if (projected.isErr()) {
      fold.unreadable += 1;
      continue;
    }
    fold.errors.push(projected.value);
  }
}

/**
 * The most failures one read will collect before it stops and says so.
 *
 * @internal
 */
export const DEFAULT_ERROR_CAP = 500;

/**
 * The page size used against Datadog's logs-events endpoint. Its own documented maximum is 1000.
 *
 * @internal
 */
export const PAGE_SIZE = 200;

/**
 * The reading an aged-out window gets without a query being issued.
 *
 * @param fromMs the window start, epoch ms
 * @param toMs the window end, epoch ms
 * @param retention the horizon it was classified against
 * @param cap the cap that would have applied, so the residue can name it consistently
 * @returns a reading whose empty `errors` is explicitly labelled unreadable
 */
function agedOutReading({
  fromMs,
  toMs,
  retention,
  cap,
}: {
  fromMs: number;
  toMs: number;
  retention: RetentionHorizon | null;
  cap: number;
}): ToolExecutionErrorReading {
  return {
    coverage: "aged-out",
    errors: [],
    fromMs,
    pagesRead: 0,
    query: TOOL_ERROR_QUERY,
    residue: describeResidue({
      cap,
      coverage: "aged-out",
      errors: [],
      incompletePages: 0,
      retention,
      truncated: false,
      unreadableEvents: 0,
    }),
    toMs,
    truncated: false,
    unreadableEvents: 0,
  };
}

/** What the paging loop returns once it stops, whatever stopped it. */
interface PagedResult {
  readonly fold: PageFold;
  readonly pagesRead: number;
  /** The cursor still outstanding when the loop stopped, which is what makes a capped read a prefix. */
  readonly pendingCursor: string | null;
}

/**
 * Page the query until the cursor runs out or the cap is reached.
 *
 * @param fetchPage the injected page reader
 * @param fromMs the window start, epoch ms
 * @param toMs the window end, epoch ms
 * @param cap the ceiling on collected failures
 * @returns the tally and the outstanding cursor, or the one typed reason the paging stopped early
 */
async function collectPages({
  fetchPage,
  fromMs,
  toMs,
  cap,
}: {
  fetchPage: TelemetryPageFetcher;
  fromMs: number;
  toMs: number;
  cap: number;
}): Promise<Result<PagedResult, TelemetryReadError>> {
  const fold: PageFold = { errors: [], incomplete: 0, unreadable: 0 };
  let cursor: string | null = null;
  let pagesRead = 0;
  do {
    const page: Result<TelemetryPage, TelemetryReadError> = await fetchPage({
      cursor,
      fromMs,
      limit: PAGE_SIZE,
      query: TOOL_ERROR_QUERY,
      toMs,
    });
    if (page.isErr()) {
      return err(page.error);
    }
    pagesRead += 1;
    absorbPage({ cap, fold, page: page.value });
    cursor = page.value.nextCursor;
  } while (cursor !== null && fold.errors.length < cap);
  return ok({ fold, pagesRead, pendingCursor: cursor });
}

/**
 * Read every failed tool call in a window, and say what the window could not show.
 *
 * An `aged-out` window short-circuits: no query is issued, because issuing one would return zero rows and
 * hand a caller a number that looks like a measurement. Everything else pages until the cap, the cursor
 * runs out, or Datadog refuses.
 *
 * @param fetchPage the injected page reader — the only I/O this function performs
 * @param fromMs the window start, epoch ms
 * @param toMs the window end, epoch ms
 * @param nowMs the instant the retention horizon is measured back from
 * @param retention the index retention range, or `null` when it could not be read
 * @param cap the most failures to collect before stopping and reporting truncation
 * @returns the reading, or the one typed reason there is no reading at all
 */
export async function readToolExecutionErrors({
  fetchPage,
  fromMs,
  toMs,
  nowMs,
  retention,
  cap = DEFAULT_ERROR_CAP,
}: {
  fetchPage: TelemetryPageFetcher;
  fromMs: number;
  toMs: number;
  nowMs: number;
  retention: RetentionHorizon | null;
  cap?: number;
}): Promise<Result<ToolExecutionErrorReading, TelemetryReadError>> {
  if (!(toMs > fromMs)) {
    return err(TelemetryReadErrors.windowInvalid({ fromMs, toMs }));
  }
  const coverage = classifyWindowCoverage({ fromMs, toMs, nowMs, retention });
  if (coverage === "aged-out") {
    return ok(agedOutReading({ cap, fromMs, retention, toMs }));
  }
  const paged = await collectPages({ cap, fetchPage, fromMs, toMs });
  if (paged.isErr()) {
    return err(paged.error);
  }
  const { fold, pagesRead, pendingCursor } = paged.value;
  const truncated = fold.errors.length >= cap && pendingCursor !== null;
  return ok({
    coverage,
    errors: fold.errors,
    fromMs,
    pagesRead,
    query: TOOL_ERROR_QUERY,
    residue: describeResidue({
      cap,
      coverage,
      errors: fold.errors,
      incompletePages: fold.incomplete,
      retention,
      truncated,
      unreadableEvents: fold.unreadable,
    }),
    toMs,
    truncated,
    unreadableEvents: fold.unreadable,
  });
}
