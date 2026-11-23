/**
 * The residue lines of `slopweaver github review-state` — what one run could NOT see, in the plainest terms
 * available. Pure: every line is decided from numbers and a watermark the caller already has, so the shell
 * in `reviewStateRun.ts` only assembles them. The corpus-freshness line is printed on EVERY run, because only
 * the exhaustive corpus scan can carry an absence and its age is the one number that decides how much of the
 * table is trustworthy.
 */

import type { NeighbourhoodWindow, SlackCoverage } from "../../../review/slackEvidenceTypes.js";
import { SEARCH_RESULT_CEILING } from "./reviewStateCore.js";

/**
 * The lines a reader needs about what this run could NOT see.
 *
 * @param coverage what the two Slack legs together could and could not reach
 * @param total how many pull requests the search matched
 * @param limit how many of them were read
 * @returns the residue lines, the coverage's own first
 */
export function baseResidue({
  coverage,
  total,
  limit,
}: {
  coverage: SlackCoverage;
  total: number;
  limit: number;
}): string[] {
  const residue = [...coverage.residue];
  if (total > limit) {
    residue.push(
      `${String(total)} pull requests matched and ${String(limit)} were read — raise --limit to see the rest`,
    );
  }
  if (total > SEARCH_RESULT_CEILING) {
    residue.push(
      `GitHub's own search caps a result set at ${String(SEARCH_RESULT_CEILING)}, so the match count itself is a floor`,
    );
  }
  return residue;
}

/**
 * What neither Slack leg can ever see, and how far the leg that decides a `no` actually reaches.
 *
 * The watermark line is printed on EVERY run, not only when a row comes back `unknown`. Only the exhaustive
 * corpus scan can carry an absence — Slack's own search collapses proximate matches — so the corpus's age is
 * the single number that decides how much of this table is trustworthy, and a reader should not have to
 * infer it from a row that happened to go unknown.
 *
 * @param liveRan whether the live search leg ran
 * @param corpusThroughIso the corpus watermark, or undefined when Slack has never been ingested
 * @param nowIso the reference instant, for the staleness the reader actually cares about
 * @param neighbourhoods the conversations this run went back and read around a live hit in
 * @returns the residue lines, most consequential first
 */
export function slackResidue({
  liveRan,
  corpusThroughIso,
  nowIso,
  neighbourhoods,
}: {
  liveRan: boolean;
  corpusThroughIso: string | undefined;
  nowIso: string;
  neighbourhoods: readonly NeighbourhoodWindow[];
}): readonly string[] {
  const lines = [freshnessLine({ corpusThroughIso, nowIso })];
  lines.push(
    "a direct message or private channel the owner's own token cannot read is invisible to both Slack legs",
    collapseLine({ neighbourhoods }),
  );
  if (!liveRan) {
    lines.push(
      "the live Slack search leg was skipped (--no-slack-live), so nothing posted since the watermark was seen beyond the thread under each channel post of the owner's",
    );
  }
  return lines;
}

/**
 * What the collapsing of proximate search matches still costs this run.
 *
 * The standing sentence — the live leg can confirm an ask but never rule one out — stops being true of a
 * conversation the run went back and READ AROUND, so a run that took windows says which ones instead of
 * repeating a caveat it has just paid to retire.
 */
function collapseLine({ neighbourhoods }: { neighbourhoods: readonly NeighbourhoodWindow[] }): string {
  if (neighbourhoods.length === 0) {
    return "Slack's search collapses matches that sit close together in one thread, so the live leg can only ever confirm an ask, never rule one out";
  }
  const where = neighbourhoods.map((window) => window.channelId).join(" ");
  return (
    "Slack's search collapses matches that sit close together in one thread, so the live leg can only ever " +
    `confirm an ask — except in the ${String(neighbourhoods.length)} conversation(s) read around a hit since ` +
    `the watermark, which were read exhaustively: ${where}`
  );
}

/** How stale the leg that decides every `no` is, in the plainest terms available. */
function freshnessLine({ corpusThroughIso, nowIso }: { corpusThroughIso: string | undefined; nowIso: string }): string {
  if (corpusThroughIso === undefined) {
    return "the Slack corpus has never been ingested, so NO row here can report `no` — run `slopweaver refresh --source slack`";
  }
  const behindMs = Date.parse(nowIso) - Date.parse(corpusThroughIso);
  const hours = Math.max(0, Math.round(behindMs / 3_600_000));
  return (
    `only the Slack corpus can decide a \`no\`, and it reaches ${corpusThroughIso} — ${String(hours)}h behind ` +
    "this read. Anything asked inside that gap reads as `unknown`; `slopweaver refresh --source slack` closes it"
  );
}
