/**
 * The block cursor the C3 reader is built from, each reader pinned on its own edges so a refusal names the block it
 * stopped at rather than surfacing only as a whole-body mismatch.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../lib/result.js";
import { PrBodyErrors } from "../../../../outbound/github/errors.js";
import {
  allOf,
  between,
  type Cursor,
  listRows,
  stop,
  take,
  takeLiteral,
} from "../../../../outbound/github/parseCursor.js";

function cursorOf({ blocks }: { blocks: readonly string[] }): Cursor {
  return { at: 0, blocks };
}

describe("take", () => {
  it("returns the next block and advances", () => {
    const cursor = cursorOf({ blocks: ["a", "b"] });
    expect([take({ cursor }), take({ cursor }), cursor.at]).toEqual(["a", "b", 2]);
  });

  it("returns undefined past the end and consumes nothing", () => {
    const cursor = cursorOf({ blocks: [] });
    expect([take({ cursor }), cursor.at]).toEqual([undefined, 0]);
  });

  it("stops at the last block once every block is consumed, however often it is asked", () => {
    const cursor = cursorOf({ blocks: ["a"] });
    expect([take({ cursor }), take({ cursor }), take({ cursor }), cursor.at]).toEqual(["a", undefined, undefined, 1]);
  });
});

describe("takeLiteral", () => {
  it("consumes an exact match", () => {
    const cursor = cursorOf({ blocks: ["## H", "x"] });
    expect([takeLiteral({ cursor, literal: "## H" }), cursor.at]).toEqual([true, 1]);
  });

  it("leaves the cursor alone on a mismatch", () => {
    const cursor = cursorOf({ blocks: ["## H"] });
    expect([takeLiteral({ cursor, literal: "## Other" }), cursor.at]).toEqual([false, 0]);
  });

  it("matches the right literal after a mismatch on the same block", () => {
    const cursor = cursorOf({ blocks: ["## Heading", "body"] });
    expect([
      takeLiteral({ cursor, literal: "## Other" }),
      takeLiteral({ cursor, literal: "## Heading" }),
      take({ cursor }),
    ]).toEqual([false, true, "body"]);
  });

  it("refuses a literal that is only a prefix of the block", () => {
    const cursor = cursorOf({ blocks: ["## Heading"] });
    expect([takeLiteral({ cursor, literal: "## Head" }), cursor.at]).toEqual([false, 0]);
  });

  it("is false past the end, consuming nothing", () => {
    const cursor = cursorOf({ blocks: ["## H"] });
    take({ cursor });
    expect([takeLiteral({ cursor, literal: "## H" }), cursor.at]).toEqual([false, 1]);
  });
});

describe("between", () => {
  it("unwraps a block with the open and close and parses what is inside", () => {
    expect(between({ block: "<p>hello</p>", close: "</p>", open: "<p>" })).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("is undefined for an absent block or one not so wrapped", () => {
    expect([
      between({ block: undefined, close: "</p>", open: "<p>" }),
      between({ block: "<li>x</li>", close: "</p>", open: "<p>" }),
    ]).toEqual([undefined, undefined]);
  });

  it("is undefined for bare text with no wrapper at all", () => {
    expect(between({ block: "hello", close: "</p>", open: "<p>" })).toBe(undefined);
  });

  it("is undefined when the open and close overlap in a block too short to hold both", () => {
    expect(between({ block: "<p>", close: "p>", open: "<p>" })).toBe(undefined);
  });

  it("parses the inline markup inside into its runs", () => {
    expect(between({ block: "<p>run <code>take</code></p>", close: "</p>", open: "<p>" })).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "take" },
    ]);
  });
});

describe("listRows", () => {
  it("returns the lines between the tags", () => {
    expect(listRows({ block: "<ul>\n<li>a</li>\n<li>b</li>\n</ul>", tag: "ul" })).toEqual(["<li>a</li>", "<li>b</li>"]);
  });

  it("is undefined for the wrong tag or an empty list", () => {
    expect([
      listRows({ block: "<ol>\n<li>a</li>\n</ol>", tag: "ul" }),
      listRows({ block: "<ul>\n</ul>", tag: "ul" }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads a one-row ordered list under its own tag", () => {
    expect(listRows({ block: "<ol>\n<li>a</li>\n</ol>", tag: "ol" })).toEqual(["<li>a</li>"]);
  });

  it("is undefined when the close tag does not stand on its own line", () => {
    expect(listRows({ block: "<ul>\n<li>a</li></ul>", tag: "ul" })).toBe(undefined);
  });

  it("is undefined for an absent block", () => {
    expect(listRows({ block: undefined, tag: "ul" })).toBe(undefined);
  });
});

describe("allOf", () => {
  it("reads every row in order", () => {
    expect(allOf({ read: (row) => row.toUpperCase(), rows: ["a", "b"] })).toEqual(["A", "B"]);
  });

  it("is undefined when one row is unreadable or the rows are absent", () => {
    expect([
      allOf({ read: (row) => (row === "b" ? undefined : row), rows: ["a", "b"] }),
      allOf({ read: (row: string) => row, rows: undefined }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads no rows as an empty list, not as unreadable", () => {
    expect(allOf({ read: (row: string) => row, rows: [] })).toStrictEqual([]);
  });

  it("keeps a falsy item, since only undefined marks a row unreadable", () => {
    expect(allOf({ read: (row) => row.length - 1, rows: ["a", "bb"] })).toStrictEqual([0, 1]);
  });
});

describe("stop", () => {
  it("is a STRUCTURE refusal naming where the reading stopped", () => {
    const result = stop<string>({ at: "the badge row" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("STRUCTURE");
  });

  it("is exactly the domain factory's STRUCTURE error, carrying the block it stopped at", () => {
    expect(unwrapErr(stop<number>({ at: "the risk list" }))).toStrictEqual(
      PrBodyErrors.structure({ at: "the risk list" }),
    );
  });
});
