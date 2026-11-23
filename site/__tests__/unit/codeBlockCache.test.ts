/*
 * The code block's token cache key names exactly the text it highlighted. A key of the
 * text's length and first and last hundred characters handed one voice tool call's tokens to another that differed
 * only in the middle, so the fold drew arguments the model never wrote.
 */
import { describe, expect, it } from "vitest";

import { codeTokensKeyOf } from "../../lib/codeTokensKey";

const argumentsWith = ({ middle }: { middle: string }): string =>
  JSON.stringify({ q: `${"A".repeat(120)}${middle}${"B".repeat(120)}` }, null, 2);

describe("codeTokensKeyOf", () => {
  it("files two texts sharing their length and both hundred-character ends under different keys", () => {
    const first = codeTokensKeyOf({ code: argumentsWith({ middle: "X" }), language: "json" });
    const second = codeTokensKeyOf({ code: argumentsWith({ middle: "Y" }), language: "json" });
    expect(first === second).toBe(false);
  });

  it("files one text under one key per language", () => {
    expect(codeTokensKeyOf({ code: "{}", language: "json" })).toBe("json:{}");
    expect(codeTokensKeyOf({ code: "{}", language: "ts" })).toBe("ts:{}");
  });
});
