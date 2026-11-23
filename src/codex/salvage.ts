/**
 * Keeping what a pass had done when it stopped without a verdict.
 *
 * THE MEASURED LOSS THIS EXISTS FOR. A planning pass ran the full 1,800 seconds of its bound, was interrupted
 * at 85% and asked to conclude, spent the whole 270-second conclusion window, and was stopped at the deadline.
 * Its artifact recorded `Reason: no-conclusion-in-bound`, `items: - (not measured: aborted)` and
 * `(none — the pass produced no response)`. Ninety-plus commands of real investigation left no trace. Three of
 * the recorded planning failures have exactly that shape, and every one of them burned 100% of its bound.
 *
 * Nothing about that is a reporting bug in the strict sense: `run()` rejects on abort, so no `Turn` exists,
 * and both `usage` and `items` are correctly `not-measured`. The gap is that the caller had already SEEN every
 * one of those commands stream past and folded them into {@link ../codex/progress.CodexActivity} — and then
 * discarded that fold along with the turn.
 *
 * So this module converts an observation into a record, and is careful about which is which:
 *
 *  - It NEVER touches the attempt's `items` or `usage`. Those report the SDK's measurement, and the SDK
 *    measured nothing. Writing observed counts there would be the same substitution the ledger's
 *    `not-measured` union was built to make unrepresentable.
 *  - It carries NO token spend. Usage arrives only on `turn.completed`, so an aborted pass's cost is genuinely
 *    unknown and there is nothing here for a reader to mistake for it.
 *  - A salvage is NOT a verdict. The outcome stays `no-verdict`, and the renderer says so before showing any
 *    of this.
 *
 * Pure: it folds an activity into a record and formats it. No clock, no filesystem.
 */

import { absentAsNull } from "#lib/absent.js";
import type { CodexActivity } from "./progress.js";
import type { PassSalvage } from "./types.js";

/**
 * Take what was observed of a pass and record it.
 *
 * @param activity the fold of everything that streamed past before the stop
 * @returns the salvage, or `null` when the pass genuinely produced nothing to keep — no command, no search, no
 *   write and no message. `null` rather than a record of zeroes, so "there was nothing" reads differently from
 *   "we kept nothing"
 */
export function salvageFromActivity({ activity }: { activity: CodexActivity }): PassSalvage | null {
  const producedNothing =
    activity.commands === 0 &&
    activity.searches === 0 &&
    activity.fileChanges === 0 &&
    activity.lastAgentMessage === undefined;
  if (producedNothing) {
    return null;
  }
  return {
    commands: activity.commands,
    failedCommands: activity.failedCommands,
    fileChanges: activity.fileChanges,
    lastAgentMessage: absentAsNull({ value: activity.lastAgentMessage }),
    recentCommands: activity.recentCommands,
    searches: activity.searches,
  };
}

/**
 * Render a salvage as the artifact's "what it had done" section.
 *
 * Written as prose plus a fenced command list rather than a table, because the commands are raw shell lines
 * that contain pipes — and a pipe inside a markdown table cell silently ends the cell.
 *
 * @param salvage what was kept, or `null` when nothing was
 * @returns the markdown lines, or an explicit statement that there was nothing to keep
 */
export function formatSalvage({ salvage }: { salvage: PassSalvage | null }): readonly string[] {
  if (salvage === null) {
    return [
      "### What the pass had done when it stopped",
      "",
      "Nothing was observed on the stream before the stop — no command, no search, no write, no message.",
      "That is a real observation, not a gap in the record.",
      "",
    ];
  }
  return [
    "### What the pass had done when it stopped",
    "",
    "OBSERVED from the event stream, not measured by the SDK. The attempt's `items` and `usage` above stay",
    "`not measured` because an aborted turn returns no `Turn` — these counts have a different provenance and",
    "are reported separately for that reason. Token spend is absent because it is genuinely unknown.",
    "",
    `- commands observed: ${String(salvage.commands)} (${String(salvage.failedCommands)} exited non-zero)`,
    `- web searches: ${String(salvage.searches)}`,
    `- scratch files written: ${String(salvage.fileChanges)}`,
    "",
    ...lastCommandLines({ salvage }),
    ...lastMessageLines({ salvage }),
  ];
}

/** The tail of the command log, fenced so a pipe or a quote inside a shell line cannot break the markdown. */
function lastCommandLines({ salvage }: { salvage: PassSalvage }): readonly string[] {
  if (salvage.recentCommands.length === 0) {
    return [];
  }
  return [
    `Last ${String(salvage.recentCommands.length)} command line(s), oldest first:`,
    "",
    "```",
    ...salvage.recentCommands,
    "```",
    "",
  ];
}

/** The last thing the pass said, when it said anything. Not the answer — the outcome is still no-verdict. */
function lastMessageLines({ salvage }: { salvage: PassSalvage }): readonly string[] {
  if (salvage.lastAgentMessage === null) {
    return ["The pass emitted no message before it stopped.", ""];
  }
  return [
    "The last message the pass emitted. This is NOT a verdict — it is the most recent thing it said, which",
    "may be a mid-investigation thought rather than a conclusion. Read it as a lead, never as an answer.",
    "",
    salvage.lastAgentMessage,
    "",
  ];
}
