/**
 * The disk half of `worktree prune`'s scan: what each candidate costs on disk, measured LAST and only for
 * candidates. `du` over a checkout with a real `node_modules` costs seconds; over three hundred of them it
 * costs minutes, and spending that on worktrees the plan is going to hold anyway is what would stop this verb
 * being runnable daily.
 */
import { execFileSync } from "node:child_process";

import type { PruneVerdict } from "./pruneClassify.js";
import { GIT_MAX_BUFFER } from "./pruneGit.js";

/** `du` over one checkout with a real `node_modules` — measured in minutes only when the tree is pathological. */
const DU_TIMEOUT_MS = 300_000;

/**
 * Measure one directory's disk footprint in KiB.
 *
 * @param path the directory to measure
 * @returns the KiB `du -sk` reports, or `null` when it could not be measured
 */
function measureDisk({ path }: { path: string }): number | null {
  try {
    const out = execFileSync("du", ["-sk", path], {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DU_TIMEOUT_MS,
    });
    const kib = Number(out.split(/\s+/)[0]);
    return Number.isFinite(kib) ? kib : null;
  } catch {
    return null;
  }
}

/**
 * How long a whole run may spend measuring disk before it starts reporting floors instead of totals.
 *
 * Measured on this machine, warm cache: `du -sk` over a slopweaver worktree (whose
 * `node_modules` is a symlink) is 0.2s, and over an acme-admin worktree (whose `node_modules` is real, at
 * 5.8 GB) is 39s — reproduce with `time du -sk <worktree>`. Measuring a 200-worktree backlog of the second
 * kind is over half an hour, which is how a daily verb becomes a fortnightly one nobody runs. The budget
 * caps that; anything past it reports `null` and the plan says the total is a floor. Five minutes is chosen
 * against the STEADY state a daily run sees — a handful of candidates, measured in seconds — not against the
 * one-time backlog, which is expected to report a floor and did.
 */
export const DISK_BUDGET_MS = 300_000;

/**
 * Fill in the disk measurement for as many verdicts as the budget allows, in the order given.
 *
 * Deliberately NOT parallel: `no-headless` (rule 2) permits only the synchronous `child_process` calls,
 * which cannot outlive their caller, and inventing an async path for a `du` would trade that guarantee for
 * a speed-up the budget already bounds.
 *
 * @param verdicts the candidates to measure, most-worth-measuring first
 * @param budgetMs how long the whole measurement pass may take
 * @param nowMs a clock reading, so the budget is testable without waiting
 * @returns the verdicts in the same order, each measured or left `null`
 */
export function measureCandidates({
  verdicts,
  budgetMs = DISK_BUDGET_MS,
  nowMs = () => Date.now(),
}: {
  verdicts: readonly PruneVerdict[];
  budgetMs?: number;
  nowMs?: () => number;
}): readonly PruneVerdict[] {
  const deadline = nowMs() + budgetMs;
  return verdicts.map((verdict) =>
    nowMs() >= deadline ? verdict : { ...verdict, diskKib: measureDisk({ path: verdict.path }) },
  );
}
