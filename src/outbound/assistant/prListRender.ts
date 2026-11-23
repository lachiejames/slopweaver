/**
 * Small, composable pieces for rendering a pull-request line in an `answer`'s body — a colour-coded status
 * glyph, the full title as a real hyperlink, and an optional pipe-separated note (reviewers, what's
 * blocking it). Deliberately NOT one all-in-one "render my PR list" function: grouping (by a real GitHub
 * stack, by topical similarity, or not at all) is an editorial judgement the composing turn makes each time,
 * informed by whatever it actually read — encoding a fixed grouping strategy here would be the exact
 * heuristic this repo's own doctrine reserves for a person's judgement, not a matcher.
 *
 * `answerForm.ts`'s body schema has no per-line colour and no heading block — see its own header. The glyph
 * is plain literal Unicode inside a `TextSpan`, the same trick `../artifact/severity.ts` already uses for
 * `rich_text`, and a "heading" is nothing more than a bold `ParagraphDetail`.
 */
import type { InlineRun, ParagraphDetail } from "../artifact/types.js";

/** The five states a PR line's glyph names. Not tied to `pane pr-status`'s own rungs — a caller judges which fits. */
const PR_LINE_STATUSES = ["ready", "needsAttention", "failing", "building", "merged"] as const;

/** One PR line's status, as a reader would name it at a glance. */
export type PrLineStatus = (typeof PR_LINE_STATUSES)[number];

/**
 * The glyph per status, as a UNICODE character rather than a `:shortcode:` — `rich_text` does not expand
 * shortcodes (see `../artifact/severity.ts`, the same trick already measured live for this repo's cards).
 */
export const PR_LINE_GLYPH: Readonly<Record<PrLineStatus, string>> = {
  building: "⚪",
  failing: "🔴",
  merged: "🟣",
  needsAttention: "🟠",
  ready: "🟢",
};

/**
 * The runs for one PR line: the status glyph, the full title as a real hyperlink, and — when given — a
 * pipe-separated note naming who it is waiting on or what is blocking it.
 *
 * @param status which glyph this line shows
 * @param title the PR's full title, shown as the hyperlink's visible label
 * @param url the PR's own URL
 * @param note the text after the `|` — pending reviewers, what is blocking it — omitted when there is none
 * @returns the runs, ready to use as one `bullets`/`list` item or a `paragraph`'s `runs`
 */
export function prLineRuns({
  status,
  title,
  url,
  note,
}: {
  status: PrLineStatus;
  title: string;
  url: string;
  note?: string | undefined;
}): readonly InlineRun[] {
  const runs: InlineRun[] = [
    { text: `${PR_LINE_GLYPH[status]} `, type: "text" },
    { label: title, type: "link", url },
  ];
  if (note !== undefined && note.length > 0) {
    runs.push({ text: ` | ${note}`, type: "text" });
  }
  return runs;
}

/**
 * A bold heading line for one group of PRs — nothing more than a `paragraph` whose one run is bold. Not
 * required: an ungrouped list is simply the bullets with no heading in front of them.
 *
 * @param label the heading text
 * @returns a paragraph block bold enough to read as a heading
 */
export function prGroupHeading({ label }: { label: string }): ParagraphDetail {
  return { runs: [{ bold: true, text: label, type: "text" }], type: "paragraph" };
}

/**
 * Who owns the next move on a pull request — one of two axes a row can carry (see {@link distanceBarFor}
 * for the other). Not tied to `pane pr-status`'s own `BlockedKind`, for the same reason
 * {@link PrLineStatus} is not tied to its `MergeRung`: a caller judges which fits.
 */
const PR_OWNERS = ["you", "person", "machine"] as const;

/** One value of {@link PR_OWNERS}. */
export type PrOwner = (typeof PR_OWNERS)[number];

/**
 * The glyph per owner, chosen live and double-encoded by shape AND colour deliberately:
 * red/green is the commonest colour-blindness pair and this surface may end up in a shared channel, so a
 * human owner is always a circle and a machine is always a square — shape survives what colour does not.
 */
export const PR_OWNER_GLYPH: Readonly<Record<PrOwner, string>> = {
  machine: "🟧",
  person: "🔵",
  you: "🟢",
};

/**
 * The glyph naming who owns the next move on a pull request.
 *
 * @param owner which party the row is waiting on
 * @returns the glyph, ready to prefix a PR line's runs
 */
export function ownerGlyphFor({ owner }: { owner: PrOwner }): string {
  return PR_OWNER_GLYPH[owner];
}

/** How many squares make up the distance-to-merge bar — the shape chosen live. */
export const DISTANCE_BAR_LENGTH = 4;

/** One filled square of the distance-to-merge bar. */
const DISTANCE_BAR_FILLED = "■";

/** One empty square of the distance-to-merge bar. */
const DISTANCE_BAR_EMPTY = "□";

/**
 * The four-square distance-to-merge bar — filled squares read as progress made, empty ones as what is left.
 * Ordinal rather than a percentage, and it answers "how close" rather than "who", which is the different
 * question {@link ownerGlyphFor} answers.
 *
 * @param rungsRemaining how many steps are left before this pull request merges; clamped into `[0, rungsTotal]`
 * @param rungsTotal how many steps the caller's own merge ladder has in total
 * @returns a `DISTANCE_BAR_LENGTH`-character string of filled and empty squares
 */
export function distanceBarFor({ rungsRemaining, rungsTotal }: { rungsRemaining: number; rungsTotal: number }): string {
  const total = Math.max(rungsTotal, 1);
  const remaining = Math.min(Math.max(rungsRemaining, 0), total);
  const filled = Math.round(((total - remaining) / total) * DISTANCE_BAR_LENGTH);
  return DISTANCE_BAR_FILLED.repeat(filled) + DISTANCE_BAR_EMPTY.repeat(DISTANCE_BAR_LENGTH - filled);
}
