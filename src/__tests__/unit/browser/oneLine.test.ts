import { describe, expect, it } from "vitest";

import { oneLine } from "../../../browser/oneLine.js";
import { outlineSnapshot } from "../../../browser/snapshotOutline.js";
import { unwrap } from "../../../lib/result.js";

/** Built from code points, so this source file carries no raw separator for an editor to break on. */
const breaks = [0x0a, 0x0d, 0x0b, 0x0c, 0x85, 0x2028, 0x2029].map((code) => String.fromCodePoint(code));
const LINE_SEPARATOR = String.fromCodePoint(0x2028);

describe("oneLine", () => {
  it("escapes every line break a reader may split on", () => {
    expect(oneLine({ text: `a${breaks.join("b")}c` })).toBe(
      "a\\u000ab\\u000db\\u000bb\\u000cb\\u0085b\\u2028b\\u2029c",
    );
  });

  it("leaves text with no line break untouched", () => {
    expect(oneLine({ text: '- button "Merge pull request" [ref=e12]' })).toBe(
      '- button "Merge pull request" [ref=e12]',
    );
  });

  it("keeps a page name holding U+2028 on one outline line", () => {
    const yaml = `- button "Merge${LINE_SEPARATOR}now" [ref=e1]\n`;
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 1024, maxLines: 10 }, under: undefined, yaml }));
    expect(view.lines).toEqual(['- button "Merge\\u2028now" [ref=e1]']);
  });
});
