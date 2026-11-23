import { describe, expect, it } from "vitest";

import { canonicalWords, documentUnits, plainText, sideTokens } from "../../../../policy/diff/units.js";

describe("documentUnits", () => {
  it("splits front matter, headings, items, paragraphs, images and fences into units", () => {
    const markdown = [
      "---",
      "title: Network",
      "---",
      "# Network segregation",
      "",
      "Staging is separate",
      "from production.",
      "",
      "- one",
      "  - nested",
      "![Topology](topology.png)",
      "```",
      "code",
      "```",
    ].join("\n");
    const parsed = documentUnits({ markdown });
    expect(parsed.units).toEqual([
      { depth: 0, kind: "front", level: 0, raw: "title: Network" },
      { depth: 0, kind: "heading", level: 1, raw: "Network segregation" },
      { depth: 0, kind: "paragraph", level: 0, raw: "Staging is separate from production." },
      { depth: 0, kind: "item", level: 0, raw: "one" },
      { depth: 1, kind: "item", level: 0, raw: "nested" },
      { depth: 0, kind: "image", level: 0, raw: "![Topology](topology.png)" },
      { depth: 0, kind: "fence", level: 0, raw: "```\ncode\n```" },
    ]);
  });

  it("joins a list item's continuation line onto the item", () => {
    const parsed = documentUnits({ markdown: "- first half\n  second half" });
    expect(parsed.units).toEqual([{ depth: 0, kind: "item", level: 0, raw: "first half second half" }]);
  });

  it("reads a marker line holding a lone line terminator past its leading space as a paragraph", () => {
    const [lineSeparator, paragraphSeparator] = [String.fromCodePoint(0x2028), String.fromCodePoint(0x2029)];
    const parsed = documentUnits({
      markdown: `# Head${lineSeparator}tail\n\n#${lineSeparator}Head\n\n- x\ry\n\n- z${paragraphSeparator}`,
    });
    expect(parsed.units).toEqual([
      { depth: 0, kind: "paragraph", level: 0, raw: `# Head${lineSeparator}tail` },
      { depth: 0, kind: "heading", level: 1, raw: "Head" },
      { depth: 0, kind: "paragraph", level: 0, raw: "- x\ry" },
      { depth: 0, kind: "paragraph", level: 0, raw: "- z" },
    ]);
  });

  it("answers no units for an empty document", () => {
    expect(documentUnits({ markdown: "" })).toEqual({ units: [] });
  });
});

describe("sideTokens", () => {
  it("places every word with the link it is under and the code it is in, and a fence or front matter as code", () => {
    const units = documentUnits({
      markdown: "---\nttl: -1\n---\n[Runbook](https://a.test) and `mfa  && vpn` ![Map](m.png) `--`\n\n```\nx\n```",
    }).units;
    const side = sideTokens({ units });
    expect(side.tokens.map((token) => [token.word, token.link, token.code])).toEqual([
      ["ttl", null, 0],
      ["-", null, 0],
      ["1", null, 0],
      ["runbook", "https://a.test", null],
      ["and", null, null],
      ["mfa", null, 1],
      ["&", null, 1],
      ["&", null, 1],
      ["vpn", null, 1],
      ["map", null, null],
      ["x", null, 3],
    ]);
    expect([side.code, side.anchors, side.images]).toEqual([
      ["ttl: -1", "mfa  && vpn", "--", "x"],
      ["10\u0000code\u0000--"],
      ["map\u0000m.png"],
    ]);
    expect(side.visible.slice(side.tokens[5]!.start, side.tokens[8]!.end)).toBe("mfa  && vpn");
  });
});

describe("plainText", () => {
  it("reduces links, images, bold and code to the text a reader sees", () => {
    expect(plainText({ markdown: "**Owner:** [NET-38](https://x.test/n)  see `utils.ts` ![map](m.png)" })).toBe(
      "Owner: NET-38 see utils.ts map",
    );
  });
});

describe("canonicalWords", () => {
  it("drops case, punctuation and markup so a reformatted line says the same words", () => {
    expect(canonicalWords({ markdown: "**Controls in place:** see [PAM](https://x.test)." })).toEqual([
      "controls",
      "in",
      "place",
      "see",
      "pam",
    ]);
  });

  it("keeps a comparison or strikethrough, which says something different", () => {
    expect(canonicalWords({ markdown: "inactive < 30 days, ~~required~~" })).toEqual([
      "inactive",
      "<",
      "30",
      "days",
      "~",
      "~",
      "required",
      "~",
      "~",
    ]);
  });

  it("counts every character but soft punctuation and markers as a word, an underscore inside a word included", () => {
    expect(canonicalWords({ markdown: "Call f(x)? See *PROD_DB_KEY* — “done”; a/b #1" })).toEqual([
      "call",
      "f",
      "(",
      "x",
      ")",
      "?",
      "see",
      "prod",
      "_",
      "db",
      "_",
      "key",
      "done",
      "a",
      "/",
      "b",
      "#",
      "1",
    ]);
  });

  it("keeps the minus of a signed number, and drops a hyphen inside a word", () => {
    expect(canonicalWords({ markdown: "offset -30, read-only" })).toEqual(["offset", "-", "30", "read", "only"]);
  });

  it("keeps every math and currency symbol, a typographic minus as a minus, and a separator between digits", () => {
    expect(canonicalWords({ markdown: "−30 ±5 ¥100 1,000 a && b, ok" })).toEqual([
      "-",
      "30",
      "±",
      "5",
      "¥",
      "100",
      "1",
      ",",
      "000",
      "a",
      "&",
      "&",
      "b",
      "ok",
    ]);
  });
});
