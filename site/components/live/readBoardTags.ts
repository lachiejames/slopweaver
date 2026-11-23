/**
 * One key=value tag a board row carries, and the row's own `tagsIncomplete` flag — the members `./read.ts`'s
 * `boardTagsOf` folds into a row's tags.
 */
import { type Bag, isBag, str } from "../../lib/bag";

/** Where a tag the page may act on came from: set on the row's journal, or computed from its fields. */
export type BoardTagSource = "declared" | "derived";

/**
 * One key=value tag a board row carries. It is restated structurally because `site/` never imports from `src/`.
 * The wire shape is `src/handover/rowTags.ts`'s `RowTag`.
 */
export interface BoardTag {
  readonly key: string;
  readonly value: string;
  readonly source: BoardTagSource;
}

/**
 * The row's published `tagsIncomplete`, or `undefined` when it is absent or not a boolean.
 *
 * @returns the flag, or `undefined` for unknown
 */
export function tagsIncompleteOf({ row }: { row: Bag }): boolean | undefined {
  const raw: unknown = row["tagsIncomplete"];
  if (typeof raw !== "boolean") {
    return undefined;
  }
  return raw;
}

/**
 * One published tag member, or `undefined` when it is not a `{ key, value, source }` bag with an actionable source.
 *
 * @returns the tag, or `undefined` for a member to drop
 */
export function boardTagOf({ entry }: { entry: unknown }): BoardTag | undefined {
  if (!isBag(entry)) {
    return undefined;
  }
  const key = str({ bag: entry, key: "key" });
  const value = str({ bag: entry, key: "value" });
  const source = str({ bag: entry, key: "source" });
  if (key === undefined || value === undefined || (source !== "declared" && source !== "derived")) {
    return undefined;
  }
  return { key, source, value };
}
