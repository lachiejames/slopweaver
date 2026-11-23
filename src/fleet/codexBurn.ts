/**
 * The Codex half of `./hostBurn.ts`'s folds: a rollout's `total_token_usage.total_tokens` is CUMULATIVE over a
 * session, so a session contributes its last in-window total minus its last total at or before the window opened —
 * never a sum of readings, which would count every earlier turn again on each one. A counter that FELL, or a reading
 * that will not read, makes the host `partial`, never a quiet zero.
 */
import { isRecord } from "../lib/parsers.js";
import { type BurnWindow, type HostBurn, recordOf, stampOf, weekAtRateOf } from "./hostBurn.js";

/** One cumulative Codex reading. */
interface CodexCumulative {
  readonly atMs: number;
  readonly totalTokens: number;
  readonly outputTokens: number;
}

/** One Codex rollout's fold, mutated line by line. */
export interface CodexSessionFold {
  /** The last cumulative reading at or before the window opened — the session's total before it. */
  baseline: CodexCumulative | undefined;
  /** The last cumulative reading in the window. */
  latest: CodexCumulative | undefined;
  /** Why this session's figure is not whole, when it is not. */
  problem: string | undefined;
  /** The instant of the last reading read, in file order: a later line stamped earlier makes the baseline ambiguous. */
  lastAtMs: number | undefined;
}

/**
 * A Codex session fold that has read nothing.
 *
 * @returns the fold
 */
export function emptyCodexSessionFold(): CodexSessionFold {
  return { baseline: undefined, lastAtMs: undefined, latest: undefined, problem: undefined };
}

/**
 * The cumulative usage a `token_count` record carries. `none` is a line that is not a token reading at all, or one
 * whose `info` is `null` — what a capped account's only reading carries (`../__tests__/codexRolloutLines.ts`).
 * `unreadable` is a reading whose counters are there but will not read as counts.
 */
function cumulativeOf({
  record,
  atMs,
}: {
  record: Record<string, unknown>;
  atMs: number;
}): { kind: "reading"; reading: CodexCumulative } | { kind: "none" } | { kind: "unreadable" } {
  const payload = record["payload"];
  if (!isRecord(payload) || payload["type"] !== "token_count" || payload["info"] === null) {
    return { kind: "none" };
  }
  const info = payload["info"];
  if (!isRecord(info) || !isRecord(info["total_token_usage"])) {
    return { kind: "unreadable" };
  }
  const totalTokens = info["total_token_usage"]["total_tokens"];
  const outputTokens = info["total_token_usage"]["output_tokens"];
  if (!isCount(totalTokens) || !isCount(outputTokens)) {
    return { kind: "unreadable" };
  }
  return { kind: "reading", reading: { atMs, outputTokens, totalTokens } };
}

/** Whether either cumulative counter is lower than it was at the reading before: a counter that fell is not whole. */
function fellFrom({ before, reading }: { before: CodexCumulative; reading: CodexCumulative }): boolean {
  return reading.totalTokens < before.totalTokens || reading.outputTokens < before.outputTokens;
}

/** Whether a counter is a count: a whole number, never negative. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Fold one Codex rollout line in.
 *
 * @param fold the session's fold so far, mutated
 * @param line one rollout line
 * @param window the instants the line is judged against
 */
export function advanceCodexSession({
  fold,
  line,
  window,
}: {
  fold: CodexSessionFold;
  line: string;
  window: BurnWindow;
}): void {
  if (!line.includes('"token_count"')) {
    return;
  }
  // A reading that will not decode, or carries no instant, may be this session's latest in the window: either makes
  // its figure a lower bound rather than a smaller whole one.
  const record = recordOf({ line });
  if (record === undefined) {
    fold.problem = "a token_count line would not decode";
    return;
  }
  const atMs = stampOf({ record });
  if (atMs === undefined) {
    fold.problem = "a token_count line carried no timestamp";
    return;
  }
  if (atMs > window.nowMs) {
    return;
  }
  const cumulative = cumulativeOf({ atMs, record });
  if (cumulative.kind === "none") {
    return;
  }
  if (cumulative.kind === "unreadable") {
    fold.problem = "a token_count reading's counters would not read";
    return;
  }
  const reading = cumulative.reading;
  // The baseline is the last reading at or before the window's start IN TIME; read in file order, a line stamped
  // before the one above it means file order is not time order, so neither the baseline nor the latest is certain.
  if (fold.lastAtMs !== undefined && atMs < fold.lastAtMs) {
    fold.problem = "its token readings are not in time order";
  }
  fold.lastAtMs = atMs;
  if (atMs <= window.cutoffMs) {
    fold.baseline = reading;
    return;
  }
  const fall = fallOf({ fold, reading });
  if (fall !== undefined) {
    fold.problem = fall;
  }
  fold.latest = reading;
}

/**
 * Whether an in-window reading fell from the one before it, the baseline included: a counter that falls just past the
 * window's start and climbs back above the baseline leaves a positive difference that is not this window's burn.
 *
 * @returns the problem in words, or undefined when it did not fall
 */
function fallOf({ fold, reading }: { fold: CodexSessionFold; reading: CodexCumulative }): string | undefined {
  if (fold.latest !== undefined) {
    if (fellFrom({ before: fold.latest, reading })) {
      return "its cumulative token counter fell inside the window";
    }
    return undefined;
  }
  if (fold.baseline !== undefined && fellFrom({ before: fold.baseline, reading })) {
    return "its cumulative token counter fell across the window's start";
  }
  return undefined;
}

/** One finished Codex session, as the host total reads it. */
export interface CodexSessionBurn {
  /** The rollout, named in a problem line. */
  readonly path: string;
  readonly fold: CodexSessionFold;
}

/**
 * The Codex burn over every rollout the window touched.
 *
 * @param sessions every rollout's finished fold
 * @param window the instants the session's activity is judged against
 * @param problems every rollout that could not be read whole, named
 * @returns the burn
 */
export function codexBurnOf({
  sessions,
  window,
  problems,
}: {
  sessions: readonly CodexSessionBurn[];
  window: BurnWindow;
  problems: readonly string[];
}): HostBurn {
  const all = [...problems];
  let totalTokens = 0;
  let outputTokens = 0;
  let drawing = 0;
  let active = 0;
  for (const { path, fold } of sessions) {
    const rise = riseOf({ fold });
    if (rise.kind === "problem") {
      all.push(`${path}: ${rise.problem}`);
      continue;
    }
    if (rise.kind === "none") {
      continue;
    }
    totalTokens += rise.total;
    outputTokens += rise.output;
    drawing += 1;
    if (rise.lastAtMs >= window.activeFromMs) {
      active += 1;
    }
  }
  const counted = { activeSessions: active, outputTokens, sessions: drawing, totalTokens };
  if (all.length > 0) {
    return { ...counted, kind: "partial", problems: all };
  }
  return { ...counted, kind: "measured", projectedWeekTokens: weekAtRateOf({ tokens: counted.totalTokens }) };
}

/** What one finished session adds to the host total. */
type SessionRise =
  | { readonly kind: "none" }
  | { readonly kind: "problem"; readonly problem: string }
  | { readonly kind: "rise"; readonly total: number; readonly output: number; readonly lastAtMs: number };

/**
 * One session's rise across the window: its latest reading less its baseline, or the problem that keeps it from
 * being whole.
 *
 * @returns nothing to count, a problem, or the rise
 */
function riseOf({ fold }: { fold: CodexSessionFold }): SessionRise {
  const latest = fold.latest;
  if (latest === undefined) {
    // No whole reading in the window: nothing to count, but a line that would not read still says so.
    if (fold.problem !== undefined) {
      return { kind: "problem", problem: fold.problem };
    }
    return { kind: "none" };
  }
  let before = { outputTokens: 0, totalTokens: 0 };
  if (fold.baseline !== undefined) {
    before = fold.baseline;
  }
  const total = latest.totalTokens - before.totalTokens;
  const output = latest.outputTokens - before.outputTokens;
  if (fold.problem !== undefined || total < 0 || output < 0) {
    return { kind: "problem", problem: describeCodexProblem({ problem: fold.problem }) };
  }
  if (total === 0) {
    return { kind: "none" };
  }
  return { kind: "rise", lastAtMs: latest.atMs, output, total };
}

/** A session's problem in words — its own, or the one a negative difference proves. */
function describeCodexProblem({ problem }: { problem: string | undefined }): string {
  if (problem === undefined) {
    return "its cumulative token counter fell across the window's start";
  }
  return problem;
}
