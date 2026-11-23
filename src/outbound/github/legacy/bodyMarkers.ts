/**
 * The literals that tell a body's SHAPE apart: what only the reading-order renderer emits, what only the retired
 * table shape carried, and what either one leaves behind. Detection reads these; nothing renders from them.
 */
import { isPastedMedia } from "./pastedMedia.js";
import { BADGE_TARGETS, LAYOUT } from "./render.js";
import { REVIEW_OPEN } from "./tooltips.js";

/**
 * Markup only the reading-order renderer emits. Detection reads these: a body carrying one is this shape.
 * The `proof-commit:` anchor is deliberately absent — both shapes emit it.
 */
const READING_ORDER_MARKERS: readonly string[] = [
  LAYOUT.reviewersHeading,
  LAYOUT.riskHeading,
  LAYOUT.whatHeading,
  LAYOUT.codeHeading,
  LAYOUT.notesOpen,
  `<a href="#${BADGE_TARGETS.risk}" title=`,
  REVIEW_OPEN,
];

/**
 * Markup only the three-badge row carried: its solved badge. Bodies written before the badges went plain
 * still carry it and still parse, so detection keeps it even though `renderPrBody` no longer emits it.
 */
const SOLVED_BADGE_MARKERS: readonly string[] = ["img.shields.io/badge/solved-"];

/** Every marker a body in the reading-order shape can carry, whichever badge row it was written with. */
export const READING_ORDER_SHAPE_MARKERS: readonly string[] = [...READING_ORDER_MARKERS, ...SOLVED_BADGE_MARKERS];

/** The two anchor lines both shapes emit, which `./proof.ts`'s `goldAnchorVerdict` reads in either. */
const SHARED_ANCHOR_MARKERS: readonly string[] = ["proof-commit:", "proof-patch-id:"];

/**
 * Markup only the RETIRED table shape carried: its Next row, its three labelled rows, its proof-grade badge and
 * its collapsed gold-anchor summary. Open pull requests and Renovate's bodies still carry it, so detection
 * needs it even though nothing here renders it.
 */
export const RETIRED_TABLE_MARKERS: readonly string[] = [
  "👉 <strong>Next</strong>",
  "<td><strong>Problem</strong></td>",
  "<td><strong>Solution</strong></td>",
  "<td><strong>Proof</strong></td>",
  "img.shields.io/badge/proof-",
  "Proof anchor (for CI)",
];

/**
 * Everything a renderer of either shape emits. A region after a rendered body carrying any of these is not
 * third-party content, and preserving it would leave a second heading, table or proof anchor standing.
 */
export const READING_ORDER_SENTINELS: readonly string[] = [
  ...READING_ORDER_SHAPE_MARKERS,
  ...SHARED_ANCHOR_MARKERS,
  ...RETIRED_TABLE_MARKERS,
];

/**
 * Whether text carries any marker in a list, every line that is wholly pasted media aside: such a line is one
 * image or video whose alt is the human's own words, so a marker spelled inside it is never a renderer's, and
 * neither shape detection nor the trailing-region check may read it as one.
 *
 * @param text the region to judge
 * @param markers the markers to look for
 * @returns true when any one appears on a line other than a pasted one
 */
export function carriesAny({ text, markers }: { text: string; markers: readonly string[] }): boolean {
  const scanned = text
    .split("\n")
    .filter((line) => !isPastedMedia({ block: line }))
    .join("\n");
  return markers.some((marker) => scanned.includes(marker));
}
