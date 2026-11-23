/**
 * `checksOf` reads a C3 description's Checks back in either layout: layout 2's one list of base checks then labelled
 * groups, layout 1's run of paragraphs up to Not checked. Every read declines rather than guesses.
 */
import { describe, expect, it } from "vitest";
import { checksOf } from "../../../../outbound/github/parseChecks.js";
import type { Cursor } from "../../../../outbound/github/parseCursor.js";
import { headingsOf } from "../../../../outbound/github/render.js";

const LAYOUT_2 = headingsOf({ layout: 2 });
const LAYOUT_1 = headingsOf({ layout: 1 });

/**
 * A cursor standing at the first of `blocks`.
 *
 * @returns the cursor
 */
function cursorOf({ blocks }: { blocks: readonly string[] }): Cursor {
  return { at: 0, blocks };
}

describe("checksOf — layout 2", () => {
  it("reads base checks, then a labelled group nested after them", () => {
    const cursor = cursorOf({
      blocks: [
        LAYOUT_2.checksHeading!,
        [
          "<ul>",
          "<li>Units pass</li>",
          "<li>Still refused<ul><li>An empty body</li><li>A table</li></ul></li>",
          "</ul>",
        ].join("\n"),
        LAYOUT_2.notCheckedHeading,
      ],
    });
    expect(checksOf({ cursor, layout: 2 })).toEqual({
      checkGroups: [
        {
          items: [[{ kind: "text", text: "An empty body" }], [{ kind: "text", text: "A table" }]],
          label: [{ kind: "text", text: "Still refused" }],
        },
      ],
      checks: [[{ kind: "text", text: "Units pass" }]],
    });
    expect(cursor.at).toBe(2);
  });

  it("reads no checks and consumes nothing when the Checks heading is absent", () => {
    const cursor = cursorOf({ blocks: [LAYOUT_2.notCheckedHeading] });
    expect(checksOf({ cursor, layout: 2 })).toEqual({ checkGroups: [], checks: [] });
    expect(cursor.at).toBe(0);
  });

  it("declines a group row whose nested list does not close the row", () => {
    const cursor = cursorOf({
      blocks: [
        LAYOUT_2.checksHeading!,
        ["<ul>", "<li>Still refused<ul><li>A table</li></ul> trailing</li>", "</ul>"].join("\n"),
      ],
    });
    expect(checksOf({ cursor, layout: 2 })).toBeUndefined();
  });

  it("declines a heading with no list under it", () => {
    const cursor = cursorOf({ blocks: [LAYOUT_2.checksHeading!, "<p>Units pass</p>"] });
    expect(checksOf({ cursor, layout: 2 })).toBeUndefined();
  });
});

describe("checksOf — layout 1", () => {
  it("reads paragraphs up to the Not checked heading and stops there", () => {
    const cursor = cursorOf({ blocks: ["<p>Units pass</p>", "<p>Lint passes</p>", LAYOUT_1.notCheckedHeading] });
    expect(checksOf({ cursor, layout: 1 })).toEqual({
      checkGroups: [],
      checks: [[{ kind: "text", text: "Units pass" }], [{ kind: "text", text: "Lint passes" }]],
    });
    expect(cursor.at).toBe(2);
  });

  it("declines a block that is not a paragraph", () => {
    const cursor = cursorOf({ blocks: ["<ul>\n<li>Units pass</li>\n</ul>"] });
    expect(checksOf({ cursor, layout: 1 })).toBeUndefined();
  });
});
