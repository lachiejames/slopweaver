import { describe, expect, it } from "vitest";

import { frontMatterLines, parseHandoverDoc } from "../../../../handover/doc.js";

const FULL = `---
slug: a-thing
summary: do the thing
status: ready
blockedBy: [first, second]
repo: /w/repo
artifact: https://example.invalid/x
---

# body
`;

describe("frontMatterLines", () => {
  it("returns the block between the fences", () => {
    expect(frontMatterLines({ text: FULL })).toContain("slug: a-thing");
  });

  it("returns nothing for a file with no front-matter", () => {
    expect(frontMatterLines({ text: "# just a heading\n" })).toEqual([]);
  });

  it("returns nothing when the block is never closed", () => {
    expect(frontMatterLines({ text: "---\nslug: x\n" })).toEqual([]);
  });

  it("tolerates CRLF, because a doc may be edited on any machine", () => {
    expect(frontMatterLines({ text: "---\r\nslug: x\r\n---\r\n" })).toContain("slug: x");
  });
});

describe("parseHandoverDoc", () => {
  it("reads every declared field", () => {
    const parsed = parseHandoverDoc({ path: "/h/a-thing.md", text: FULL });

    expect(parsed.slug).toBe("a-thing");
    expect(parsed.summary).toBe("do the thing");
    expect(parsed.status).toBe("ready");
    expect(parsed.blockedBy).toEqual(["first", "second"]);
    expect(parsed.repo).toBe("/w/repo");
    expect(parsed.artifact).toBe("https://example.invalid/x");
  });

  it("falls back to the filename when no slug is declared", () => {
    expect(parseHandoverDoc({ path: "/h/from-the-name.md", text: "---\nstatus: ready\n---\n" }).slug).toBe(
      "from-the-name",
    );
  });

  /** An absent field is an absence, not a default that reads as a claim. */
  it("reports an absent artifact as undefined rather than an empty string", () => {
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\nartifact:\n---\n" }).artifact).toBeUndefined();
  });

  it("marks the bare `artifact: null` line as the placeholder, still reading the key as declared", () => {
    const parsed = parseHandoverDoc({ path: "/h/x.md", text: "---\nartifact: null\n---\n" });
    expect([parsed.artifact, parsed.artifactIsPlaceholder]).toEqual(["null", true]);
  });

  it("keeps `artifact: null` the placeholder when a comment follows it, at column 0 or indented", () => {
    const parsed = ["# none published yet", "  # none published yet"].map((comment) =>
      parseHandoverDoc({ path: "/h/x.md", text: `---\nartifact: null\n${comment}\nstatus: ready\n---\n` }),
    );
    expect(parsed.map((one) => [one.artifact, one.artifactIsPlaceholder, one.status])).toEqual([
      ["null", true, "ready"],
      ["null", true, "ready"],
    ]);
  });

  it("reads a `>` block or a wrapped value reading `null` as authored text, never the placeholder", () => {
    const parsed = ["artifact: >\n  null", "artifact: |-\n  null", "artifact: null\n  more"].map((front) =>
      parseHandoverDoc({ path: "/h/x.md", text: `---\n${front}\nstatus: ready\n---\n` }),
    );
    expect(parsed.map((one) => [one.artifact, one.artifactIsPlaceholder])).toEqual([
      ["null", undefined],
      ["null", undefined],
      ["null more", undefined],
    ]);
  });

  it("marks `artifact: null` the placeholder however it is spaced", () => {
    const parsed = ["artifact:  null", "artifact:null", "artifact:\tnull  ", "artifact : null"].map((front) =>
      parseHandoverDoc({ path: "/h/x.md", text: `---\n${front}\n---\n` }),
    );
    expect(parsed.map((one) => [one.artifact, one.artifactIsPlaceholder])).toEqual([
      ["null", true],
      ["null", true],
      ["null", true],
      ["null", true],
    ]);
  });

  it('reads a QUOTED `artifact: "null"` as an authored string, never the placeholder', () => {
    const parsed = parseHandoverDoc({ path: "/h/x.md", text: '---\nartifact: "null"\n---\n' });
    expect([parsed.artifact, parsed.artifactIsPlaceholder]).toEqual(["null", undefined]);
  });

  it("reads a single unbracketed dependency", () => {
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\nblockedBy: only-one\n---\n" }).blockedBy).toEqual([
      "only-one",
    ]);
  });

  it("treats an unrecognised status as unknown rather than guessing", () => {
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\nstatus: blocked\n---\n" }).status).toBe("unknown");
  });

  it("reads an optional role, which is how a standing surface opened from a doc says so", () => {
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\nrole: bot\n---\n" }).role).toBe("bot");
  });

  it("reports an absent role as undefined — nearly every doc declares none", () => {
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\nstatus: ready\n---\n" }).role).toBeUndefined();
  });

  it("reads an optional launch template", () => {
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\ntemplate: research\n---\n" }).template).toBe("research");
  });

  it("makes a misspelt template a front-matter problem, because it decides what the seat loads", () => {
    const misspelt = parseHandoverDoc({ path: "/h/x.md", text: "---\ntemplate: resarch\n---\n" });

    expect(misspelt.template).toBe("resarch");
    expect(misspelt.problems).toEqual(['template must be one of code|research|supervisor|bot, got "resarch"']);
  });

  it("discards a retired or misspelt role rather than refusing a runnable doc over a decoration", () => {
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\nrole: tooling\n---\n" }).role).toBeUndefined();
    expect(parseHandoverDoc({ path: "/h/x.md", text: "---\nrole: tooling\n---\n" }).problems).toEqual([]);
  });
});
