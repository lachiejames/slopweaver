/**
 * The salvage ledger: where every salvaged worktree's work went, written down so it is findable without the run
 * that removed the tree. Split out of `./pruneApply.ts` when that file passed the size ratchet.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLines } from "../lib/appendSeparator.js";
import { stateHomePaths } from "../stateHome.js";

/** One salvage, as it is written down. */
interface SalvageRecord {
  readonly atIso: string;
  /** The worktree that was removed, by its absolute path — the name a human recognises. */
  readonly worktreePath: string;
  readonly repoRoot: string;
  readonly remote: string;
  /** The branch the work is on, and the one to pull into a fresh worktree. */
  readonly branch: string;
}

/**
 * Where every salvage is written down, one JSON object per line.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the absolute path of the ledger
 */
function salvageLedgerPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).worktreeBundles, "salvaged.jsonl");
}

/**
 * Write down where one worktree's work went, so it is findable without the run that removed it.
 *
 * The week-old rule has two halves and this is the second: the board row is updated to say the item has
 * changes on a remote branch that can be pulled down into a fresh worktree. Most of what the week-old
 * waiver reaches has no row left to update — a tree untouched since early August belongs to a run that
 * closed weeks ago — so the branch needs somewhere durable of its own. Without it the capture is real and
 * the *findability* is not, which turns the whole ruling into deletion with an extra step.
 *
 * It sits in `worktree-bundles` beside the bundles an earlier `unpushed` class wrote, so one directory answers
 * "where did the work from a removed worktree go", whichever mechanism put it there.
 *
 * @param home the resolved `$SLOPWEAVER_HOME` — never read from the ambient environment, so a test can pass its own
 * @param worktreePath the tree that was removed
 * @param repoRoot the repository it belonged to
 * @param remote the remote the branch was pushed to
 * @param branch the branch the work now lives on
 * @returns nothing
 */
export function recordSalvage({
  branch,
  home,
  remote,
  repoRoot,
  worktreePath,
}: {
  branch: string;
  home: string;
  remote: string;
  repoRoot: string;
  worktreePath: string;
}): void {
  const target = salvageLedgerPath({ home });
  const record: SalvageRecord = {
    atIso: new Date().toISOString(),
    branch,
    remote,
    repoRoot,
    worktreePath,
  };
  mkdirSync(dirname(target), { recursive: true });
  appendLines({ path: target, text: `${JSON.stringify(record)}\n` });
}
