/**
 * The Who reviews what section read back: the inverse of `./render.ts`'s `reviewersBlocks`.
 *
 * Optional, so a body with no table consumes nothing. A table that is there and does not read is a `STRUCTURE`
 * refusal rather than a skip, because skipping it would leave the risk reader looking at a table. Every reader
 * here is loose on purpose and the caller is exact: `./parse.ts` re-renders what it read and compares bytes.
 */
import { ok, type Result } from "#lib/result.js";
import { decodeCell } from "../parseContent.js";
import type { ReadingOrderError } from "./errors.js";
import { type Cursor, cellsOf, stop, take, takeLiteral } from "./parseCursor.js";
import { LAYOUT } from "./render.js";
import type { ReviewerRow } from "./types.js";

/** The anchor a who cell opens on; its name is re-derived on the re-render, so only its shape is read. */
const ROW_ANCHOR = /^<a name="reviewers-[^"]*"><\/a>/;

/** The tokens a picked person stands in for, each in a code span. */
const STANDS_IN = /^<code>([^<]+)<\/code>$/;

/** The folded files cell. */
const FOLDED = /^<details><summary>\d+ files<\/summary>(.*)<\/details>$/;

/** One who cell, or undefined when it is not one. */
function whoOf({ cell }: { cell: string }): Pick<ReviewerRow, "who" | "standsInFor"> | undefined {
  const anchor = ROW_ANCHOR.exec(cell);
  if (anchor === null) {
    return undefined;
  }
  const [tagged = "", standsIn] = cell.slice(anchor[0].length).split(" for ");
  const standsInFor = standsIn === undefined ? [] : standsIn.split(", ").map((part) => STANDS_IN.exec(part)?.[1]);
  if (tagged === "" || standsInFor.some((token) => token === undefined)) {
    return undefined;
  }
  return {
    standsInFor: standsInFor.map((token) => decodeCell({ text: token! })),
    who: tagged.split(" or ").map((token) => decodeCell({ text: token })),
  };
}

/** One look cell, or undefined when it is not one. */
function lookOf({ cell }: { cell: string }): ReviewerRow["look"] | undefined {
  if (cell === LAYOUT.reviewersEverythingElse) {
    return { kind: "rest" };
  }
  const folded = FOLDED.exec(cell);
  const listed = folded === null ? cell : folded[1]!;
  const files = listed.split("<br>").map((part) => /^<code>(.+)<\/code>$/.exec(part)?.[1]);
  if (files.some((file) => file === undefined)) {
    return undefined;
  }
  return { files: files.map((file) => decodeCell({ text: file! })), kind: "files" };
}

/** One table row, or undefined when it is not one. */
function rowOf({ line }: { line: string }): ReviewerRow | undefined {
  const cells = cellsOf({ count: 2, line });
  const who = cells === undefined ? undefined : whoOf({ cell: cells[0]! });
  const look = cells === undefined ? undefined : lookOf({ cell: cells[1]! });
  return who === undefined || look === undefined ? undefined : { ...who, look };
}

/**
 * The Who reviews what section, when the body carries one.
 *
 * @param cursor the block cursor, positioned just after the badge row
 * @returns the rows, undefined when there is no section, or a refusal when the section does not read
 */
export function reviewersSection({
  cursor,
}: {
  cursor: Cursor;
}): Result<readonly ReviewerRow[] | undefined, ReadingOrderError> {
  if (!takeLiteral({ cursor, literal: LAYOUT.reviewersHeading })) {
    return ok(undefined);
  }
  const lines = take({ cursor })?.split("\n");
  if (lines?.[0] !== "<table>" || lines[1] !== LAYOUT.reviewersHeader || lines.at(-1) !== "</table>") {
    return stop({ at: "the Who reviews what table" });
  }
  const rows = lines.slice(2, -1).map((line) => rowOf({ line }));
  if (rows.some((row) => row === undefined)) {
    return stop({ at: "a Who reviews what row" });
  }
  return ok(rows.map((row) => row!));
}
