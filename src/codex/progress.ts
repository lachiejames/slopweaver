/**
 * Turning a Codex pass's observed events into progress lines.
 *
 * This exists because the longest-running verb in the repo printed nothing. `docs/constraints/7-9.md` § 8 says a
 * verb that prints nothing is indistinguishable from a hung one, and a Codex pass can run for sixteen minutes
 * — so the one place that rule mattered most was the one place it had been skipped.
 *
 * Everything here is PURE: it folds events into a small state and renders a `RichProgressEvent`. The emitter,
 * the throttling and the sinks all belong to `src/lib/progressRichEmitter.ts`, which already solves that problem and
 * which constraint 8 explicitly says not to duplicate.
 */

import { absentAsNumber } from "#lib/absent.js";
import type { RichProgressEvent } from "../lib/progress.js";
import type { CodexObservedEvent, CodexObservedItem, CodexPassId } from "./types.js";

/** How much of a command line survives into a progress line. Enough to recognise, short enough to scan. */
const COMMAND_PREVIEW_CHARS = 72;

/** How many command lines to keep for the tripwire. Bounded so a long pass cannot grow this without limit. */
const RECENT_COMMAND_CAP = 20;

/** What a pass has done so far, folded from its events. */
export interface CodexActivity {
  readonly commands: number;
  readonly failedCommands: number;
  readonly searches: number;
  readonly fileChanges: number;
  readonly lastCommand: string | undefined;
  readonly threadId: string | undefined;
  /** The command lines so far, capped. The tripwire classifies these; the fold stays ignorant of roots. */
  readonly recentCommands: readonly string[];
  /**
   * The last complete `agent_message` text observed, or undefined if none has arrived.
   *
   * Retained so a pass that stops without a verdict is not a total loss. It is NOT the answer — a mid-turn
   * message is a thought, and `client.drainStream` is the only place allowed to call the last one the
   * response. This is the copy that survives the abort that throws that one away.
   */
  readonly lastAgentMessage: string | undefined;
  /**
   * The last failure the stream reported, or undefined if it reported none.
   *
   * Kept because it is often the ONLY place a provider refusal is named: the SDK's thrown error on a non-zero
   * exit carries the child's stderr, and a spend cap reaches the stream, not stderr.
   */
  readonly lastReportedFailure: string | undefined;
}

/**
 * A pass that has produced nothing yet.
 *
 * @returns the zero activity — counts are a measured zero rather than absent, so "nothing yet" and "not
 *   measured" stay distinguishable downstream
 */
export function initialCodexActivity(): CodexActivity {
  return {
    commands: 0,
    failedCommands: 0,
    fileChanges: 0,
    lastAgentMessage: undefined,
    lastCommand: undefined,
    lastReportedFailure: undefined,
    recentCommands: [],
    searches: 0,
    threadId: undefined,
  };
}

/** Fold a `command_execution` item: the count, the exit fact, and the capped recent-command window. */
function foldCommand({ activity, item }: { activity: CodexActivity; item: CodexObservedItem }): CodexActivity {
  return {
    ...activity,
    commands: activity.commands + 1,
    failedCommands: activity.failedCommands + (item.exitCode !== undefined && item.exitCode !== 0 ? 1 : 0),
    lastCommand: item.command,
    recentCommands:
      item.command === undefined
        ? activity.recentCommands
        : [...activity.recentCommands, item.command].slice(-RECENT_COMMAND_CAP),
  };
}

/**
 * Fold one observed event into the running activity.
 *
 * `failedCommands` is counted separately on purpose. It is the structured signal the tripwire leans on: a
 * command line is raw text and guessing paths out of it is a heuristic, but a non-zero exit is a fact, and a
 * burst of them early is what "hunting for a file that is not there" actually looks like.
 *
 * @param activity the activity so far
 * @param event the event just observed
 * @returns the updated activity
 */
export function foldCodexEvent({
  activity,
  event,
}: {
  activity: CodexActivity;
  event: CodexObservedEvent;
}): CodexActivity {
  if (event.kind === "thread-started") {
    return { ...activity, threadId: event.threadId };
  }
  if (event.kind === "turn-failed") {
    return { ...activity, lastReportedFailure: event.message };
  }
  if (event.kind !== "item") {
    return activity;
  }
  const { item } = event;
  if (item.itemKind === "command_execution") {
    return foldCommand({ activity, item });
  }
  if (item.itemKind === "agent_message") {
    // An empty-text message is not a message. Keeping the previous one is what makes this useful at abort
    // time: a later blank would otherwise erase the last thing the pass actually said.
    return item.text === undefined || item.text.length === 0 ? activity : { ...activity, lastAgentMessage: item.text };
  }
  if (item.itemKind === "web_search") {
    return { ...activity, searches: activity.searches + 1 };
  }
  if (item.itemKind === "file_change") {
    return {
      ...activity,
      fileChanges: activity.fileChanges + absentAsNumber({ value: item.changedPaths?.length, whenAbsent: 1 }),
    };
  }
  return activity;
}

/**
 * Collapse a command line onto one scannable fragment.
 *
 * @param command the raw shell line the pass ran
 * @returns a single-line fragment: whitespace collapsed, then truncated to the leading
 *   {@link COMMAND_PREVIEW_CHARS} characters with an ellipsis. Prefix truncation, with no path-aware
 *   selection — so a command with a long run of flags can push its PATHS off the end, which is a real limit
 *   given this display exists to spot a pass reading somewhere it should not
 */
function commandPreview({ command }: { command: string }): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length <= COMMAND_PREVIEW_CHARS ? flat : `${flat.slice(0, COMMAND_PREVIEW_CHARS - 1)}…`;
}

/**
 * One heartbeat for a running pass.
 *
 * `done`/`total` are milliseconds of the bound rather than a count of anything, because a Codex pass has no
 * countable unit of work — the honest denominator is the bound the caller chose. That keeps the shared
 * emitter's percentage and ETA meaningful instead of inventing a fake item count.
 *
 * @param pass which pass is running
 * @param activity what it has done so far
 * @param elapsedMs wall-clock elapsed
 * @param boundMs the pass's total bound
 * @returns the event to hand `RichProgressEmitter.emit`
 */
export function codexHeartbeat({
  pass,
  activity,
  elapsedMs,
  boundMs,
}: {
  pass: CodexPassId;
  activity: CodexActivity;
  elapsedMs: number;
  boundMs: number;
}): RichProgressEvent {
  const metrics: Record<string, number> = {
    commands: activity.commands,
    failed: activity.failedCommands,
  };
  if (activity.searches > 0) {
    metrics["searches"] = activity.searches;
  }
  if (activity.fileChanges > 0) {
    metrics["wrote"] = activity.fileChanges;
  }
  return {
    done: Math.min(elapsedMs, boundMs),
    lane: "heartbeat",
    metrics,
    phase: `codex.${pass}`,
    total: boundMs,
    ...(activity.lastCommand === undefined
      ? {}
      : { currentItem: { title: commandPreview({ command: activity.lastCommand }) } }),
  };
}
