/*
 * What the outbound artifact truncate test files share: the text run, paragraph, bullets and table builders
 * each case assembles its detail and index from. They moved here when `truncate.test.ts` was split by behaviour.
 */
import type { BulletsDetail, ParagraphDetail, TableDetail, TextSpan } from "../../../../../outbound/artifact/types.js";

/**
 * One plain text run carrying the given value.
 *
 * @returns the text run
 */
export const text = ({ value }: { value: string }): TextSpan => ({ text: value, type: "text" as const });
/**
 * One paragraph block holding a single text run.
 *
 * @returns the paragraph block
 */
export const paragraph = ({ value }: { value: string }): ParagraphDetail => ({
  runs: [text({ value })],
  type: "paragraph" as const,
});
/**
 * One bullets block, each item a single text run.
 *
 * @returns the bullets block
 */
export const bullets = ({ items }: { items: readonly string[] }): BulletsDetail => ({
  items: items.map((item) => [text({ value: item })]),
  type: "bullets" as const,
});
/**
 * One single-column table block, each cell a single text run.
 *
 * @returns the table block
 */
export const table = ({ rows }: { rows: readonly (readonly string[])[] }): TableDetail => ({
  columns: ["a"],
  rows: rows.map((row) => row.map((cell) => [text({ value: cell })])),
  type: "table" as const,
});
