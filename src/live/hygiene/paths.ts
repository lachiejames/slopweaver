/**
 * Where the daily hygiene documents live under `$SLOPWEAVER_HOME/live/hygiene/` — the fixed files a
 * later reader opens rather than scraping a command's transcript or the generic readings ledger.
 *
 * Its own leaf module for the reason `../../atlasHome.ts` is one: a sub-tree joins the state-home contract as
 * one key and one resolver call. The single-home contract is unchanged — its live area
 * (`src/stateHome/live.ts`) derives `$home/live/hygiene` and hands the root in; nothing here reads the home.
 *
 * The contract a reader relies on (format, empty-result meaning, freshness) is
 * `skills/automation/reference/hygiene-documents.md`.
 */

import { join } from "node:path";

/** The hygiene document tree, rooted at `$home/live/hygiene`. */
export interface LiveHygienePaths {
  readonly root: string;
  /** `cycle-reconcile.json` — `cycle reconcile --write`'s own `--json` report, one document. */
  readonly cycleReconcile: string;
  /** `sweep-board.jsonl` — `sweep board --write`'s own `--json` lines; zero bytes is a clean pass. */
  readonly sweepBoard: string;
  /**
   * `sweep-board-census.json` — the verdict census the same `sweep board --write` pass printed, one document
   * beside the JSONL: the UNWITNESSED count a reader reports as a number rather than as rows.
   */
  readonly sweepBoardCensus: string;
  /** `github-landing.json` — the landing read the `hygiene-sweep` row hands its seated session. */
  readonly githubLanding: string;
}

/**
 * Resolve the hygiene document paths beneath the root `stateHome.ts` derived.
 *
 * @param root `$home/live/hygiene`, already resolved by the state home
 * @returns the document paths and their shared root
 */
export function liveHygienePaths({ root }: { readonly root: string }): LiveHygienePaths {
  return {
    cycleReconcile: join(root, "cycle-reconcile.json"),
    githubLanding: join(root, "github-landing.json"),
    root,
    sweepBoard: join(root, "sweep-board.jsonl"),
    sweepBoardCensus: join(root, "sweep-board-census.json"),
  };
}
