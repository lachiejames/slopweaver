/**
 * The literals that tell a description's SHAPE apart: what only the C3 renderer emits, and what a pre-C3 body
 * (the reading-order shape, or the retired table before it) carries. Detection reads these; nothing renders from
 * them.
 */
import {
  carriesAny as carriesAnyLegacy,
  READING_ORDER_SENTINELS,
  READING_ORDER_SHAPE_MARKERS,
  RETIRED_TABLE_MARKERS,
} from "./legacy/bodyMarkers.js";
import { ALL_LAYOUT_HEADINGS, LAYOUT } from "./render.js";

/**
 * Markup only the C3 renderer emits: its headings in every layout and its re-run fold. The badge images are
 * deliberately absent — the retired table also drew a `proof-` badge, so an image URL proves nothing about shape.
 */
const C3_MARKERS: readonly string[] = [...ALL_LAYOUT_HEADINGS, LAYOUT.rerunOpen];

/**
 * Everything any renderer of any shape emits. A region after a rendered C3 body carrying one is not third-party
 * content, and preserving it would leave a second heading, badge or fold standing.
 */
export const DESCRIPTION_SENTINELS: readonly string[] = [
  ...C3_MARKERS,
  "img.shields.io/badge/risk-",
  "img.shields.io/badge/problem-",
  ...READING_ORDER_SENTINELS,
];

/** Which shape a description is in. */
export type DescriptionShape = "c3" | "reading-order" | "retired-table" | "none";

/**
 * Whether text carries any marker in a list.
 *
 * @param text the region to judge
 * @param markers the markers to look for
 * @returns true when any one appears
 */
export function carriesAny({ text, markers }: { text: string; markers: readonly string[] }): boolean {
  return carriesAnyLegacy({ markers, text });
}

/**
 * The shape a description was written in, C3 first: a C3 body is never read as an older one.
 *
 * @param text the description
 * @returns its shape, or `none` when it carries no renderer's markup
 */
export function descriptionShapeOf({ text }: { text: string }): DescriptionShape {
  if (carriesAny({ markers: C3_MARKERS, text })) {
    return "c3";
  }
  if (carriesAny({ markers: READING_ORDER_SHAPE_MARKERS, text })) {
    return "reading-order";
  }
  return carriesAny({ markers: RETIRED_TABLE_MARKERS, text }) ? "retired-table" : "none";
}
