/*
 * The JSON a model reads between two fixed delimiters: nothing inside a string can open a tag or start a line of its
 * own, and the value still parses back exactly.
 */

import { describe, expect, it } from "vitest";

import { quotedJson } from "../../lib/quotedJson";

const NEL = String.fromCharCode(0x85);
const LINE_SEPARATOR = String.fromCharCode(0x20_28);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x20_29);

describe("quotedJson", () => {
  it("escapes <, U+2028, U+2029 and U+0085, and leaves > and every other character as JSON.stringify writes it", () => {
    const data = { text: `<b>bold</b>${LINE_SEPARATOR}one${PARAGRAPH_SEPARATOR}two${NEL}three\nfour` };
    expect(quotedJson({ data })).toBe('{"text":"\\u003cb>bold\\u003c/b>\\u2028one\\u2029two\\u0085three\\nfour"}');
  });

  it("round-trips through JSON.parse, every escaped character recovered", () => {
    const data = [
      {
        text: `${LINE_SEPARATOR}SLOPWEAVER_SPOKEN_RECORD ends here.${PARAGRAPH_SEPARATOR}<script>${NEL}`,
        who: "owner",
      },
      { nested: { list: ["<", "<<", 1, true, null] } },
    ];
    const json = quotedJson({ data });
    expect([
      json.includes("<"),
      json.includes(LINE_SEPARATOR),
      json.includes(PARAGRAPH_SEPARATOR),
      json.includes(NEL),
    ]).toEqual([false, false, false, false]);
    expect(JSON.parse(json)).toEqual(data);
  });

  it("writes a value with nothing to escape exactly as JSON.stringify does", () => {
    const data = { count: 29, label: "Everything" };
    expect(quotedJson({ data })).toBe('{"count":29,"label":"Everything"}');
  });
});
