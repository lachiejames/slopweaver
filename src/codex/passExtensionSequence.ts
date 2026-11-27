/**
 * One extension per run and lane, and every later one names the one before it — the rule `codex extend` applies
 * before it appends a row (`./passExtension.ts`).
 *
 * A run's first extension in a lane carries no `after`. Each further one is a deliberate call rather than a repeated
 * command, so it must carry `after` naming the run's latest extension in that lane, with its own reason saying why
 * the last was not enough. A row for a diff the run already holds one for is refused: a review of that diff is
 * admitted as it stands, so a second row would approve nothing new.
 *
 * The chain has no fixed length: every further extension names the latest with `after` and carries its own reason.
 *
 * The sequence is only as good as the history it reads. A register line that will not decode and cannot be shown
 * to belong to ANOTHER run may be this run's own earlier extension, and skipping it would let the next grant pass
 * as a first with no `after` — so {@link damagedHistoryProblem} refuses the grant until that line is repaired. A
 * damaged line that still names another run is no part of this run's history and is skipped.
 *
 * Pure: the caller reads the register and narrows it with `runExtensions`.
 */
import type { CodexPassExtension } from "./passExtension.js";

/**
 * Why a damaged register stops this run's grant, or `undefined` when every damaged line names some other run.
 *
 * @param run the run the grant is for
 * @param unreadable every register line that would not decode, with the run it names when that much was readable
 * @returns the sentence naming the lines that may be this run's own, or `undefined`
 */
export function damagedHistoryProblem({
  run,
  unreadable,
}: {
  run: string;
  unreadable: readonly { readonly detail: string; readonly run: string | undefined }[];
}): string | undefined {
  const mayBeThisRuns = unreadable.filter((line) => line.run === undefined || line.run === run);
  if (mayBeThisRuns.length === 0) {
    return undefined;
  }
  return (
    `${String(mayBeThisRuns.length)} register line(s) will not decode and cannot be shown to be another run's ` +
    `(${mayBeThisRuns.map((line) => line.detail).join("; ")}), so they may be this run's earlier extension and ` +
    "whether this one is a first cannot be told — repair or remove those lines by hand, then grant again"
  );
}

/**
 * Why this extension may not be recorded beside the run's earlier ones in its lane, or `undefined` when it may.
 *
 * @param prior the run's extensions in this lane, across every repository, oldest first
 * @param after the `--after` id the supervisor passed, naming the latest prior extension
 * @param diff the full sha256 of the diff this extension would approve
 * @returns the sentence naming what is wrong, or `undefined`
 */
export function extensionSequenceProblem({
  after,
  diff,
  prior,
}: {
  after: string | undefined;
  diff: string;
  prior: readonly CodexPassExtension[];
}): string | undefined {
  const latest = prior.at(-1);
  if (latest === undefined) {
    if (after === undefined) {
      return undefined;
    }
    return `--after ${after} names an extension, but this run holds none in this lane yet — drop --after`;
  }
  const already = prior.find((row) => row.diffSha256 === diff);
  if (already !== undefined) {
    return `extension ${already.id} already approves this diff for this run, so a review of it is admitted as it stands`;
  }
  if (after === undefined) {
    return (
      `this run already holds extension ${latest.id} in this lane (${latest.reason}); each further one is a ` +
      `deliberate call — pass --after ${latest.id} with a reason saying why the last was not enough`
    );
  }
  if (after !== latest.id) {
    return `--after ${after} is not this run's latest extension in this lane, which is ${latest.id}`;
  }
  return undefined;
}
