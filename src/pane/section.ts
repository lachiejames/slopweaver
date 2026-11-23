/**
 * The result contract `pane pr-status` prints, and the ranking its rows go through.
 *
 * ## A result states three things a reader needs before trusting it
 *
 * `measuredAtIso` — WHEN these facts were established, or why that instant is not known. `unavailable` — why
 * the whole result could not be read, which is never the same as it being empty. `emptyReason` — what an
 * empty list MEANS here, so "nothing has looked" can never read as "nothing to do".
 *
 * That last one is the reason this shape exists rather than a bare list: the empty case is the one the owner
 * cares about most, and a reader handed only rows quietly renders a comforting zero.
 *
 * Pure: types plus one ranking helper. No clock, no filesystem, no network.
 */

import type { Measured } from "../measurement/status.js";

/**
 * The closed colour vocabulary a row's badge is drawn from.
 *
 * Closed on purpose. If a producer could name its own badge kind, readers would drift into several palettes
 * and the badge would stop being readable at a glance — which is the entire job of a badge on a dense screen.
 *
 * `you` / `person` / `machine` answer "who is this blocked on". `ok` / `warn` / `bad` grade a measured value.
 * `unmeasured` is not a grade: it is the absence of one, and it must never share a colour with `ok`.
 */
export type BadgeKind = "you" | "person" | "machine" | "ok" | "warn" | "bad" | "unmeasured";

/** One line above the fold, with its detail collapsed underneath. */
export interface PaneRow {
  /** Which result this row belongs to. Fixed at build time. */
  readonly sectionId: string;
  /** Stable identity across measurements, so the same subject is the same row each time. */
  readonly key: string;
  /** The short word in the badge — the grade or the party who is blocking. */
  readonly badge: string;
  readonly badgeKind: BadgeKind;
  /** What to do about it. Kept short enough to read in a column. */
  readonly verb: string;
  /** The subject: a pull request. */
  readonly title: string;
  /** The evidence for the claim — visible on the row, never behind a hover. */
  readonly why: string;
  /** When this row's fact was established, or why that could not be worked out. Never implies freshness. */
  readonly age: string;
  /** 1-based position within the ranking. */
  readonly rank: number;
  /** Why the row sits where it sits, so the answer is on screen rather than in someone's head. */
  readonly rankWhy: string;
  /** The collapsed detail, one `label  value` line each. */
  readonly detail: readonly string[];
}

/** A row before it has been ranked — everything except the position the ranking assigns. */
type UnrankedRow = Omit<PaneRow, "rank" | "rankWhy" | "sectionId">;

/** One row plus the derived key it sorts on and the sentence explaining that key. */
export interface RankCandidate {
  /** The derived sort key. Lower sorts first. Never hand-set. */
  readonly sortKey: string;
  /** The sentence printed under the row explaining its position. */
  readonly rankWhy: string;
  readonly row: UnrankedRow;
}

/** Everything one read contributes: its rows, and what a reader needs before trusting them. */
export interface SectionResult {
  /** The result's stable id, used as the row prefix. */
  readonly id: string;
  /** The heading a reader shows it under. */
  readonly title: string;
  /** One sentence saying what question this result answers. */
  readonly blurb: string;
  /** The command or file these facts came from, printed so the numbers can be checked against it. */
  readonly source: string;
  readonly rows: readonly PaneRow[];
  /** When these facts were measured, or why that instant is not known. */
  readonly measuredAtIso: Measured<string>;
  /**
   * Why the whole result could not be read, or `undefined` when it was read.
   *
   * Distinct from an empty `rows` on purpose: "the scan failed" and "the scan found nothing" are different
   * facts with different fixes, and collapsing them is what makes a broken read look like a calm one.
   */
  readonly unavailable: string | undefined;
  /** What an empty list MEANS here. Never "nothing to do" when nothing has looked. */
  readonly emptyReason: string;
}

/**
 * Rank candidates and stamp each row with its position and the reason for it.
 *
 * The ranking is derived from `sortKey` alone and there is deliberately no way to override it: a board whose
 * order somebody set by hand is a board that stops matching what is true. Ties break on `key`, which is
 * stable across measurements, so equal rows do not shuffle between refreshes.
 *
 * @param sectionId the result every produced row belongs to
 * @param candidates the rows with their derived sort keys, in any order
 * @returns the ranked rows, each carrying its rank and the sentence explaining it
 */
export function rankRows({
  sectionId,
  candidates,
}: {
  sectionId: string;
  candidates: readonly RankCandidate[];
}): readonly PaneRow[] {
  return candidates
    .toSorted((a, b) => a.sortKey.localeCompare(b.sortKey) || a.row.key.localeCompare(b.row.key))
    .map((candidate, index) => ({
      ...candidate.row,
      rank: index + 1,
      rankWhy: candidate.rankWhy,
      sectionId,
    }));
}
