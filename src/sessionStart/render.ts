/**
 * How a ranked session-start list reads on a terminal.
 *
 * ## Every row shows its own arithmetic, because a rank the owner cannot argue with is a rank they cannot correct
 *
 * The list is rules over a scored item rather than a model call, and that only pays off if the reasoning
 * reaches the owner. So each row carries the four mandatory fields, the clause naming the signal that actually
 * carried it, and the score — and the drops are printed too, with a reason each, because a detector's
 * yield has to be explainable rather than guessed at.
 *
 * ## What it refuses to hide
 *
 * The BACKGROUND prints above the identity line and below the headline, which is the owner's own ordering —
 * what the thing is, then where it stands, then what it costs. The rule: a row the owner cannot answer
 * without remembering the detail is a row they will not answer at all.
 *
 * A row whose freshness could not be established says so on its own line rather than in a caveat at the
 * bottom where it would not be read. So does a row the owner has already ruled on — it sits at the tail of the
 * list with the ruling's date, because already-answered items leading the owner's list is the measured
 * failure `./standing.ts` exists for.
 *
 * ## A close proposal is a row of a different KIND, and it says so first
 *
 * The action on a `propose-close` row is to close something, not to do it, and burying that under a score
 * is how "approve and merge" reached the owner's list in the first place. So the row is marked before its headline
 * and explains itself with what the TRACE decided rather than with the signal that carried its score — for
 * a close, "the work was already done somewhere else" is the whole reason, and the arithmetic is a detail.
 *
 * The marker arrived with the cycle leg rather than the board leg, because a board item's evidence is a
 * single piece either way and cannot produce a close, so a branch for it here would have been unreachable.
 *
 * Pure — no I/O, no clock.
 */

import { codeOwnerSliceLine } from "../review/codeOwnerSlice.js";
import type { RankedItem, Ranking } from "./rank.js";
import type { Movement, MovementLabel } from "./reconcile.js";
import { standingLabel } from "./standing.js";

/**
 * One board row parked on a person, reduced to what the briefing prints.
 *
 * Lives here rather than beside the read for the reason {@link ./boardLeg.BoardEntry} does: the shape a
 * surface consumes belongs to the surface, so a test can build one without building a whole `BoardModel`.
 */
export interface PausedRow {
  readonly slug: string;
  /** The board's own sentence for it, from `../handover/paused.pausedPhrase` — one renderer everywhere. */
  readonly reason: string;
}

/**
 * The paused block, printed below the ranked list and never inside it.
 *
 * Unnumbered, deliberately: these are not positions the owner is being asked to work. A row waiting on somebody else
 * is not the owner's move, so ranking it would put another person's silence at the top of their list — but it is not
 * gone either, because a parked workstream should still be remembered.
 *
 * The heading carries the rule — a parked row has no time limit and no deadline — so nobody reads a parked row
 * as an overdue one. There is no age column, no day count and no nag on these lines, and there is nothing
 * anywhere for one to be computed from.
 *
 * @param paused every row the board placed under `PAUSED`
 * @returns the lines to print, empty when nothing is paused
 */
export function pausedLines({ paused }: { paused: readonly PausedRow[] }): readonly string[] {
  if (paused.length === 0) {
    return [];
  }
  return [
    "",
    `PAUSED — ${String(paused.length)} workstream(s) waiting on someone. Not your move, not forgotten, never overdue:`,
    ...paused.map((row) => `  ${row.slug} — ${row.reason}`),
  ];
}

/** What a close proposal's row is marked with, before anything else on the line. */
export const CLOSE_MARKER = "CLOSE";

/** How many rows the list shows before it stops, unless the caller asks for all of them. */
export const DEFAULT_TOP = 10;

/**
 * The widest a row's headline may be before it is cut.
 *
 * MEASURED on the real board (`slopweaver session-start --top 10`): all seven rows' recorded
 * questions ran to full paragraphs, the longest 1,262 characters, because a session records everything the
 * owner needs to rule on. Printed whole they are seven walls of text, which is a list the owner does not read —
 * the failure AGENTS.md rule 7 names. The whole question is never discarded, only moved: `--json` carries
 * `doneWhen` verbatim.
 */
export const HEADLINE_CHARS = 140;

/**
 * The item's whole recorded question, whitespace-collapsed the same way {@link headline} reads it — the text
 * a row's own folded line prints in full when the headline had to shorten it.
 *
 * @param doneWhen the item's whole recorded question
 * @returns the question with runs of whitespace collapsed to one space
 */
function collapsedDoneWhen({ doneWhen }: { doneWhen: string }): string {
  return doneWhen.replace(/\s+/g, " ").trim();
}

/**
 * A row's first line: one sentence at most, cut at a word boundary.
 *
 * Never marked with an ellipsis. The rule, generalised from a fleet-briefing headline cut
 * the same way: a rendered page never truncates — an ellipsis that drops the rest of a run leaves it nowhere
 * on the page to read. So this cuts for scannability alone; {@link rowLines} prints the whole question on its
 * own line whenever this shortened it, which is the fold a terminal list has in place of a `details`.
 *
 * Cuts at a space rather than mid-word, and only when there is a space to cut at — a single long token is
 * left alone rather than sliced, since half an identifier is worse than a long one.
 *
 * @param doneWhen the item's whole recorded question
 * @returns the headline, short enough to scan
 */
export function headline({ doneWhen }: { doneWhen: string }): string {
  const collapsed = collapsedDoneWhen({ doneWhen });
  // `split` without a limit returns at least one element, `[""]` for an empty string, so index 0 always exists.
  const firstSentence = collapsed.split(/(?<=[.?!])\s/)[0]!;
  const candidate = firstSentence.length < collapsed.length ? firstSentence : collapsed;
  if (candidate.length <= HEADLINE_CHARS) {
    return candidate;
  }
  const cut = candidate.slice(0, HEADLINE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * One row's lines, outcome first.
 *
 * @param index the row's one-based place on the list
 * @param row the ranked item
 * @returns the row's lines, in print order
 */
export function rowLines({ index, row }: { index: number; row: RankedItem }): readonly string[] {
  const stale = row.unverified ? " · freshness unverified" : "";
  const closing = row.trace.verdict === "propose-close";
  const mark = closing ? `${CLOSE_MARKER} — ` : "";
  const reason = closing ? row.trace.reason : row.why;
  const short = headline({ doneWhen: row.item.doneWhen });
  const full = collapsedDoneWhen({ doneWhen: row.item.doneWhen });
  const standing = row.standing === undefined ? undefined : standingLabel({ standing: row.standing });
  return [
    `${String(index)}. ${mark}${short}`,
    // The owner's share of a review ask sits directly under the ask, before anything else: it is what decides how big the ask is.
    ...(row.item.codeOwnerSlice === undefined ? [] : [`   ${codeOwnerSliceLine({ slice: row.item.codeOwnerSlice })}`]),
    ...(row.item.title === undefined ? [] : [`   ${row.item.title}`]),
    `   ${row.item.background}`,
    `   ${row.item.who} · ${row.item.where} · last moved ${row.item.whenIso}`,
    `   ${reason} (score ${String(row.score)})${stale}`,
    ...(standing === undefined ? [] : [`   you already answered this: ${standing}`]),
    ...(short === full ? [] : [`   (full) ${full}`]),
  ];
}

/** The words each movement label puts on the "since your last run" block. Plain, and none of them overclaim. */
const MOVEMENT_HEADINGS: Readonly<Record<MovementLabel, string>> = {
  gone: "left the list — NOT necessarily done, check the source",
  moved: "moved under you",
  new: "new since your last run",
  unchanged: "unchanged",
};

/** The order the movements read in: what arrived, what shifted, what left. `unchanged` is not printed. */
const SHOWN_MOVEMENTS: readonly MovementLabel[] = ["new", "moved", "gone"];

/**
 * What changed since the last run, as terminal lines.
 *
 * `unchanged` is counted and not listed. The settled remainder is most of the list on a quiet day, and
 * printing it would bury the three lines that matter under fourteen that do not — rule 7 in miniature.
 *
 * An empty result prints nothing at all rather than "nothing moved", because there are two ways to have no
 * movements and they are different facts: a first run has no baseline, and a second run over an unchanged
 * world genuinely found nothing. The caller knows which and says so; this function does not guess.
 *
 * @param movements the diff against the previous run
 * @param sinceIso when that previous run happened
 * @returns the lines, in print order, empty when nothing moved
 */
export function movementLines({
  movements,
  sinceIso,
}: {
  movements: readonly Movement[];
  sinceIso: string;
}): readonly string[] {
  const shown = SHOWN_MOVEMENTS.filter((label) => movements.some((movement) => movement.label === label));
  if (shown.length === 0) {
    return [];
  }
  const lines: string[] = [`Since your last run at ${sinceIso}:`, ""];
  for (const label of shown) {
    lines.push(`  ${MOVEMENT_HEADINGS[label]}`);
    for (const movement of movements.filter((one) => one.label === label)) {
      lines.push(`    ${movement.identity} — ${movement.detail}`);
    }
    lines.push("");
  }
  return lines;
}

/**
 * The whole list as terminal lines.
 *
 * The drop count is always printed, even at zero. A leg that silently found nothing looks identical to a
 * leg that was never wired, and the difference matters on the day the owner stops trusting the list.
 *
 * @param ranking what made the list and what did not
 * @param top how many rows to show
 * @returns the lines, in print order
 */
export function listLines({ ranking, top }: { ranking: Ranking; top: number }): readonly string[] {
  if (ranking.ranked.length === 0) {
    return [
      "Nothing is waiting on you.",
      `${String(ranking.dropped.length)} candidate(s) were read and none survived — run with --json to see why each dropped.`,
    ];
  }
  const shown = ranking.ranked.slice(0, top);
  const lines: string[] = [`${String(ranking.ranked.length)} thing(s) waiting on you:`, ""];
  shown.forEach((row, offset) => {
    lines.push(...rowLines({ index: offset + 1, row }));
    lines.push("");
  });
  if (ranking.ranked.length > shown.length) {
    lines.push(`${String(ranking.ranked.length - shown.length)} more — pass --top to see them.`);
  }
  lines.push(`${String(ranking.dropped.length)} candidate(s) did not make the list.`);
  return lines;
}
