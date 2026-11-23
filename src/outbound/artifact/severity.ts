/**
 * The severity vocabulary shared by every card that classifies its items this way (`digest.ts`,
 * `alertSummary.ts`). One place, so the three buckets and their glyphs cannot drift between cards that both
 * claim to use "the same red/orange/green" — they visually would not, if each picked its own emoji.
 */

/** The three severities, in the order a reader triages them — red first. The ARRAY is the sort order. */
export const SEVERITIES = ["red", "orange", "green"] as const;

/** One item's severity. */
export type Severity = (typeof SEVERITIES)[number];

/**
 * The glyph per severity, as a UNICODE character rather than a `:shortcode:`.
 *
 * Measured: `rich_text` does not expand shortcodes, so `:red_circle:` there renders as literal text. The
 * unicode character renders everywhere and Slack echoes it back as the shortcode name, which is how the live
 * probe confirmed it. See `slack/render.ts`.
 */
export const SEVERITY_GLYPH: Readonly<Record<Severity, string>> = {
  green: "🟢",
  orange: "🟠",
  red: "🔴",
};

/** The human word for a severity, used in derived prose. */
export const SEVERITY_WORD: Readonly<Record<Severity, string>> = {
  green: "green",
  orange: "orange",
  red: "red",
};

/**
 * The colours an `ordered` index line may open with — the "colour coded ranked list".
 *
 * Wider than {@link SEVERITIES} by one, on purpose: a ranked list is ordered by what moves the work most, not by
 * severity, and the compliance stand-up card grades its lines with a yellow dot
 * that no severity has. The order a list is ranked in is the author's; only the glyph is checked.
 */
export const RANK_GLYPHS = ["🔴", "🟠", "🟡", "🟢"] as const;
