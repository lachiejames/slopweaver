/**
 * What GitHub reports for a pull request a live ask's question names — the closures the `PR_ENDED` verdict reads —
 * shared by the board-read, apply and `--settle-ended` tests.
 */
import type { PrClosure } from "../../../../../live/github/prClosure.js";

/**
 * A pull request GitHub reports merged.
 *
 * @returns its closure, merged at the merge commit `abc<number>`
 */
export function merged({ number }: { number: number }): PrClosure {
  return {
    mergeCommitOid: `abc${String(number)}`,
    mergedAt: "2026-11-03T01:00:00Z",
    state: "MERGED",
    url: `https://github.com/acme/app/pull/${String(number)}`,
  };
}

/**
 * A pull request GitHub reports closed unmerged.
 *
 * @returns its closure, closed without a merge
 */
export function closed({ number }: { number: number }): PrClosure {
  return {
    closedAt: "2026-11-07T02:00:00Z",
    state: "CLOSED",
    url: `https://github.com/acme/app/pull/${String(number)}`,
  };
}

/**
 * A pull request GitHub reports still open.
 *
 * @returns its closure, with no ending
 */
export function open({ number }: { number: number }): PrClosure {
  return { state: "OPEN", url: `https://github.com/acme/app/pull/${String(number)}` };
}
