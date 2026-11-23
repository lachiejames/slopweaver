import { describe, expect, it } from "vitest";

import { parseOwnJson } from "../../parseOwnJson.js";

describe("parseOwnJson", () => {
  it("parses a JSON object into the caller's declared shape", () => {
    const parsed = parseOwnJson<{ ok: boolean; count: number }>({ text: JSON.stringify({ count: 3, ok: true }) });
    expect(parsed).toEqual({ count: 3, ok: true });
  });

  it("throws on unparseable text, the same as a bare JSON.parse would", () => {
    expect(() => parseOwnJson<{ ok: boolean }>({ text: "not json" })).toThrow();
  });
});
