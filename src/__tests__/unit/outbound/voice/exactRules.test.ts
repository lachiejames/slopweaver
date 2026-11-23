/**
 * The prose extractor's punctuation contract, and the exact-rule matcher over it.
 *
 * Every case here is one of the three measured on the voice exercise, where a whole-token
 * replacement ate the punctuation an identifier happened to carry and welded two sentences into one.
 */
import { describe, expect, it } from "vitest";

import { authoredProseOf, exactVoiceRuleFindings } from "../../../../outbound/voice/exactRules.js";

/** The single extracted prose region for a one-line input. */
function proseOf({ text }: { text: string }): string {
  return authoredProseOf({ path: "cell", text })[0]!.text;
}

describe("authoredProseOf identifier punctuation", () => {
  it("keeps the full stop a version identifier ends a sentence with", () => {
    expect(proseOf({ text: "we pinned it to 5.2.0. that was the mistake." })).toBe(
      "we pinned it to  . that was the mistake.",
    );
  });

  it("keeps the bracket and colon a bracketed score carries", () => {
    expect(proseOf({ text: "alerts affect it (CVSS up to 8.6): command injection, and two DoS issues." })).toBe(
      "alerts affect it (CVSS up to  ): command injection, and two DoS issues.",
    );
  });

  it("keeps the full stop a bare number ends a sentence with", () => {
    expect(proseOf({ text: "We shipped it in 12. Then it broke." })).toBe("We shipped it in  . Then it broke.");
  });

  it("keeps a whole bracketed identifier's brackets balanced", () => {
    expect(proseOf({ text: "the worst score (8.6) is the injection one" })).toBe(
      "the worst score ( ) is the injection one",
    );
  });

  it("still removes the identifier's own text", () => {
    expect(proseOf({ text: "bumped to ^0.29.5 today" })).toBe("bumped to   today");
  });

  it("leaves a hyphenated word with no technical signal alone", () => {
    expect(proseOf({ text: "all in the query layer behind tasks-api." })).toBe(
      "all in the query layer behind tasks-api.",
    );
  });

  it("drops inline code, fenced code and quoted lines", () => {
    const text = ["> quoted upstream line", "the `resolutions` entry", "```", "code --flag=1", "```"].join("\n");
    expect(authoredProseOf({ path: "cell", text }).map((region) => region.text)).toStrictEqual(["the   entry"]);
  });

  it("returns no region for a line that is nothing but an identifier", () => {
    expect(authoredProseOf({ path: "cell", text: "0.28.9" })).toStrictEqual([]);
  });
});

describe("exactVoiceRuleFindings over the repaired prose", () => {
  it("still finds an em dash the identifier fix left in place", () => {
    const prose = authoredProseOf({ path: "solution", text: "it already allows ^5.0.2 — so yarn picks 5.3.1." });
    expect(exactVoiceRuleFindings({ prose, rules: [{ kind: "literal", value: "—" }] })).toStrictEqual([
      { path: "solution", rule: { kind: "literal", value: "—" } },
    ]);
  });

  it("finds nothing in a cell whose only em dash sits inside inline code", () => {
    const prose = authoredProseOf({ path: "solution", text: "the flag is `--from—to` and nothing else." });
    expect(exactVoiceRuleFindings({ prose, rules: [{ kind: "literal", value: "—" }] })).toStrictEqual([]);
  });
});
