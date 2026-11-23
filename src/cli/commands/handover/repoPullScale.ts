/**
 * How large a row's repository's pull-request numbers run — so a card reading ONE row still links a bare pull-request number.
 *
 * The console attests a repository's scale from every address on the whole board (`site/lib/cardReferences.ts`'s
 * `attestedNumbers`), and a bare number links only when it fits that scale. `handover row` reads one doc and its
 * `blockedBy` closure, never the board, so a card built from one row would have no scale at all and print
 * a bare number as plain text. The row's `repo:` checkout attests it instead: a GitHub squash merge ends its
 * subject `(#N)`, so the largest such N on the default branch is how many digits the repository's numbers run to.
 * MEASURED on the acme-admin checkout: a `(#N)` among the last five subjects, in milliseconds. Repro:
 * `git -C ~/dev/acme-admin log -n 5 --format=%s refs/remotes/origin/HEAD`.
 *
 * A checkout with no `origin/HEAD`, or whose merges carry no `(#N)`, attests nothing — which only narrows what a
 * card links, never links a number to the wrong place.
 */
import { execFileSync } from "node:child_process";

import { stripGitEnv } from "../../../codex/gitRun.js";

/** How many default-branch subjects are read — enough to span a busy week of merges on either repository. */
const SUBJECTS_READ = 200;

/** One read's bound, the same as `originRepository`'s in `src/config.ts`: a stalled checkout costs a card its scale, not the verb. */
const SCALE_READ_TIMEOUT_MS = 3_000;

/** A squash merge's trailing pull-request number. Mid-subject `(#N)` — a revert quoting what it reverts — is not the merge's. */
const TRAILING_PULL = /\(#(\d+)\)$/u;

/**
 * The largest pull-request number any subject ends with.
 *
 * @param subjects commit subjects, one per line as `git log --format=%s` prints them
 * @returns the number, or `undefined` when no subject ends in `(#N)`
 */
export function largestPullInSubjects({ subjects }: { subjects: readonly string[] }): number | undefined {
  let largest: number | undefined;
  for (const subject of subjects) {
    const pull = TRAILING_PULL.exec(subject.trim());
    if (pull === null) {
      continue;
    }
    const number = Number(pull[1]);
    if (largest === undefined || number > largest) {
      largest = number;
    }
  }
  return largest;
}

/**
 * The largest pull-request number the checkout's default branch names, read off git.
 *
 * @param path the row's `repo:` checkout
 * @returns the number, or `undefined` when the checkout has no readable `origin/HEAD` or no `(#N)` subject
 */
export function repoPullScale({ path }: { path: string }): number | undefined {
  let log: string;
  try {
    log = execFileSync(
      "git",
      ["-C", path, "log", "-n", String(SUBJECTS_READ), "--format=%s", "refs/remotes/origin/HEAD"],
      {
        encoding: "utf8",
        env: stripGitEnv({ env: process.env }),
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: SCALE_READ_TIMEOUT_MS,
      },
    );
  } catch {
    return undefined;
  }
  return largestPullInSubjects({ subjects: log.split("\n") });
}
