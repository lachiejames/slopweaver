/**
 * How many tokens each host burned over the last 24 hours, and how many of its sessions drew any in the last few
 * minutes — the pure folds behind `slopweaver fleet burn`, which the Fleet page's per-host usage line reads.
 *
 * The owner wants, per host, how many tokens it burned in the last twenty-four hours and how many it is projected to
 * burn: not just whether the fleet is at capacity right now, but whether it will be later.
 *
 * ## What one token means here, per host
 *
 * The same thing on both sides: every token the model was SENT or WROTE, cached ones included, because that is the
 * one total both providers report.
 *
 * - **Claude**: input + cache creation + cache read + output, once per `message.id` — one turn is written across
 *   several transcript lines (`../sessions/sessionCost.ts`), and a turn counts when its line's own `timestamp` falls in
 *   the window.
 * - **Codex**: the rollout's own `total_token_usage.total_tokens`, which is CUMULATIVE over a session. So a session
 *   contributes its last in-window total minus its last total at or before the window opened — never a sum of
 *   readings, which would count every earlier turn again on each one. That fold is `./codexBurn.ts`.
 *
 * Cache reads dominate both totals (95% of Claude's traffic, measured in `../sessions/sessionCost.ts`), so the output
 * figure travels beside the total: it is the part that moves with what an agent actually wrote.
 *
 * A file that could not be opened, or a cumulative counter that FELL, makes the host `partial` — a lower bound that
 * says why — never a quiet zero.
 */
import { parseIsoMs } from "../lib/date.js";
import { isRecord } from "../lib/parsers.js";
import { usageOfRecord } from "../sessions/sessionCost.js";

/** The window the burn is measured over. */
export const BURN_WINDOW_HOURS = 24;

/** How recently a session must have drawn tokens to count as running. */
export const ACTIVE_WITHIN_MINUTES = 10;

/** One host's burn over the window. */
export type HostBurn =
  | {
      readonly kind: "measured";
      readonly totalTokens: number;
      readonly outputTokens: number;
      /** The tokens seven days at this 24-hour rate would burn — an amount, never a time. */
      readonly projectedWeekTokens: number;
      /** Sessions (transcripts or rollouts) that drew any token in the window. */
      readonly sessions: number;
      /** Sessions that drew any token in the last {@link ACTIVE_WITHIN_MINUTES} minutes. */
      readonly activeSessions: number;
    }
  | {
      readonly kind: "partial";
      readonly totalTokens: number;
      readonly outputTokens: number;
      readonly sessions: number;
      readonly activeSessions: number;
      /** Why the totals are a lower bound, one line per problem. */
      readonly problems: readonly string[];
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** The whole `fleet burn` document. */
export interface FleetBurnReport {
  readonly observedAtIso: string;
  /** Where the window opens: {@link BURN_WINDOW_HOURS} before `observedAtIso`, exclusive. */
  readonly fromIso: string;
  readonly windowHours: number;
  readonly activeWithinMinutes: number;
  readonly hosts: { readonly claude: HostBurn; readonly codex: HostBurn };
}

/** The instants a fold judges a line against. */
export interface BurnWindow {
  /** The window opens AFTER this instant. */
  readonly cutoffMs: number;
  /** The window closes AT this instant; a line stamped later is a skewed clock and is not counted. */
  readonly nowMs: number;
  /** A line at or after this instant marks its session active. */
  readonly activeFromMs: number;
}

/**
 * The window ending at an instant.
 *
 * @param nowMs the instant the burn is measured at
 * @returns the window
 */
export function burnWindowOf({ nowMs }: { nowMs: number }): BurnWindow {
  return {
    activeFromMs: nowMs - ACTIVE_WITHIN_MINUTES * 60_000,
    cutoffMs: nowMs - BURN_WINDOW_HOURS * 60 * 60_000,
    nowMs,
  };
}

/**
 * A line's own top-level `timestamp`.
 *
 * @returns the instant, or undefined when it has none that parses
 */
export function stampOf({ record }: { record: Record<string, unknown> }): number | undefined {
  const stamp = record["timestamp"];
  if (typeof stamp !== "string") {
    return undefined;
  }
  return parseIsoMs({ tsIso: stamp });
}

/**
 * A JSON line as an object.
 *
 * @returns the object, or undefined when the line is not one
 */
export function recordOf({ line }: { line: string }): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  return parsed;
}

/** The Claude fold over every transcript of the window, mutated line by line. */
export interface ClaudeBurnFold {
  /** Every `message.id` already counted, across every transcript — the dedupe is fleet-wide. */
  readonly seen: Set<string>;
  /** Transcripts that drew any token in the window. */
  readonly drawing: Set<string>;
  /** Transcripts that drew any token since the window's active instant. */
  readonly active: Set<string>;
  totalTokens: number;
  outputTokens: number;
  /** Usage lines that could not be read, which a total cannot include. */
  unreadable: number;
}

/**
 * A Claude fold that has counted nothing.
 *
 * @returns the fold
 */
export function emptyClaudeBurnFold(): ClaudeBurnFold {
  return { active: new Set(), drawing: new Set(), outputTokens: 0, seen: new Set(), totalTokens: 0, unreadable: 0 };
}

/**
 * Fold one Claude transcript line in.
 *
 * A line that never mentions `usage` costs one substring search, which is what makes the half-gigabyte a day of
 * transcripts this machine writes affordable.
 *
 * @param fold the fold so far, mutated
 * @param line one transcript line
 * @param path the transcript it came from, which a session is counted by
 * @param window the instants the line is judged against
 */
export function advanceClaudeBurn({
  fold,
  line,
  path,
  window,
}: {
  fold: ClaudeBurnFold;
  line: string;
  path: string;
  window: BurnWindow;
}): void {
  if (!line.includes('"usage"')) {
    return;
  }
  // A line carrying the usage marker that will not decode, or a usage turn with no instant to judge it by, may be
  // a turn inside the window: either makes the figure a lower bound rather than a smaller whole one.
  const record = recordOf({ line });
  if (record === undefined) {
    fold.unreadable += 1;
    return;
  }
  // Only an assistant turn is a turn the model was billed for: every usage-carrying record in a day of real transcripts
  // is one (55,305 of 55,305 measured: `find ~/.claude/projects -name '*.jsonl' -mtime -1 -print0 | xargs -0 cat |
  // jq -r 'select(.message.usage? != null) | .type' | sort | uniq -c`), and any other record carrying usage is not spend.
  // What this does NOT close: `usageOfRecord` is `session spend`'s reader, and it reads a present input or cache counter
  // that is not a number as zero. Claude Code writes all four as numbers; closing it is a strict read in
  // `src/sessions/sessionCost.ts`'s `turnOf`, shared with spend, not a second reader here.
  const usage = usageOfRecord({ record });
  if (usage.kind === "other" || record["type"] !== "assistant") {
    return;
  }
  const stampMs = stampOf({ record });
  if (stampMs === undefined) {
    fold.unreadable += 1;
    return;
  }
  if (stampMs <= window.cutoffMs || stampMs > window.nowMs) {
    return;
  }
  if (usage.kind === "unreadable") {
    fold.unreadable += 1;
    return;
  }
  if (fold.seen.has(usage.turn.messageId)) {
    return;
  }
  const { turn } = usage;
  fold.seen.add(turn.messageId);
  fold.totalTokens += turn.inputTokens + turn.cacheCreationTokens + turn.cacheReadTokens + turn.outputTokens;
  fold.outputTokens += turn.outputTokens;
  fold.drawing.add(path);
  if (stampMs >= window.activeFromMs) {
    fold.active.add(path);
  }
}

/**
 * The Claude burn a finished fold reports.
 *
 * @param fold the fold over every transcript
 * @param problems every transcript that could not be read whole, named
 * @returns the burn
 */
export function claudeBurnOf({ fold, problems }: { fold: ClaudeBurnFold; problems: readonly string[] }): HostBurn {
  const counted = {
    activeSessions: fold.active.size,
    outputTokens: fold.outputTokens,
    sessions: fold.drawing.size,
    totalTokens: fold.totalTokens,
  };
  const all = [...problems];
  if (fold.unreadable > 0) {
    all.push(`${String(fold.unreadable)} usage line(s) could not be read`);
  }
  if (all.length > 0) {
    return { ...counted, kind: "partial", problems: all };
  }
  return { ...counted, kind: "measured", projectedWeekTokens: weekAtRateOf({ tokens: counted.totalTokens }) };
}

/**
 * The tokens seven days at a window's rate would burn — an amount, never a time. Only a WHOLE measurement is
 * projected: a partial one is a lower bound, and seven times a lower bound is a guess dressed as a figure.
 *
 * @returns the projected seven-day total
 */
export function weekAtRateOf({ tokens }: { tokens: number }): number {
  return Math.round((tokens * 7 * 24) / BURN_WINDOW_HOURS);
}
