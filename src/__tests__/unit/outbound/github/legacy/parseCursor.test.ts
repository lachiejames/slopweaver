/**
 * The block cursor and the what-and-why reader the reading-order parser is built from, each pinned on its own
 * edges so a refusal names the block it stopped at rather than surfacing only as a whole-body mismatch.
 */
import { describe, expect, it } from "vitest";
import { unwrapErr } from "../../../../../lib/result.js";
import { ReadingOrderErrors } from "../../../../../outbound/github/legacy/errors.js";
import {
  allOf,
  between,
  type Cursor,
  cellsOf,
  listRows,
  stop,
  take,
  takeLiteral,
} from "../../../../../outbound/github/legacy/parseCursor.js";
import { whatSection } from "../../../../../outbound/github/legacy/parseWhat.js";
import { LAYOUT } from "../../../../../outbound/github/legacy/renderLayout.js";

const cursorOf = ({ blocks }: { blocks: readonly string[] }): Cursor => ({ at: 0, blocks });

describe("the block cursor", () => {
  it("takes blocks in order and consumes nothing past the end", () => {
    const cursor = cursorOf({ blocks: ["a"] });
    expect(take({ cursor })).toBe("a");
    expect(take({ cursor })).toBe(undefined);
    expect(cursor.at).toBe(1);
  });

  it("consumes a literal only when the next block is exactly it", () => {
    const cursor = cursorOf({ blocks: ["## Heading", "body"] });
    expect(takeLiteral({ cursor, literal: "## Other" })).toBe(false);
    expect(cursor.at).toBe(0);
    expect(takeLiteral({ cursor, literal: "## Heading" })).toBe(true);
    expect(cursor.at).toBe(1);
  });

  it("unwraps content between a fixed open and close, and declines an unwrapped block", () => {
    expect(between({ block: "<p>hello</p>", close: "</p>", open: "<p>" })).toEqual([{ kind: "text", text: "hello" }]);
    expect(between({ block: "hello", close: "</p>", open: "<p>" })).toBe(undefined);
    expect(between({ block: undefined, close: "</p>", open: "<p>" })).toBe(undefined);
  });

  it("reads a list's rows only when the named tag frames it", () => {
    expect(listRows({ block: "<ul>\n<li>a</li>\n</ul>", tag: "ul" })).toEqual(["<li>a</li>"]);
    expect(listRows({ block: "<ul>\n<li>a</li>\n</ul>", tag: "ol" })).toBe(undefined);
    expect(listRows({ block: "<ul>\n</ul>", tag: "ul" })).toBe(undefined);
  });

  it("reads every row or none of them", () => {
    const read: Parameters<typeof allOf<number>>[0]["read"] = (row) => (row === "x" ? undefined : row.length);
    expect(allOf({ read, rows: ["a", "bb"] })).toEqual([1, 2]);
    expect(allOf({ read, rows: ["a", "x"] })).toBe(undefined);
    expect(allOf({ read, rows: undefined })).toBe(undefined);
  });

  it("splits a table row into exactly the cells asked for", () => {
    expect(cellsOf({ count: 2, line: "<tr><td>a</td><td>b</td></tr>" })).toEqual(["a", "b"]);
    expect(cellsOf({ count: 3, line: "<tr><td>a</td><td>b</td></tr>" })).toBe(undefined);
    expect(cellsOf({ count: 1, line: "<td>a</td>" })).toBe(undefined);
  });

  it("refuses with a STRUCTURE error naming where it stopped", () => {
    expect(unwrapErr(stop<number>({ at: "the badge row" }))).toEqual(
      ReadingOrderErrors.structure({ at: "the badge row" }),
    );
  });
});

describe("whatSection", () => {
  const seen = { kind: "unevidenced" } as const;

  it("refuses at the heading when the section does not open there", () => {
    const refused = unwrapErr(whatSection({ cursor: cursorOf({ blocks: ["x"] }), seen }));
    expect(refused).toEqual(ReadingOrderErrors.structure({ at: "the what-and-why heading" }));
  });

  it("refuses at the origin line when the heading is not followed by one", () => {
    const refused = unwrapErr(
      whatSection({ cursor: cursorOf({ blocks: [LAYOUT.whatHeading, "<p>plain</p>"] }), seen }),
    );
    expect(refused).toEqual(ReadingOrderErrors.structure({ at: "the origin line" }));
  });
});
