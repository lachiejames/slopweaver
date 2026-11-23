/**
 * The per-file parser: frontmatter validation, and the edge extraction that feeds the graph rules.
 *
 * The YAML cases are the reason this module has a dependency rather than a hand-rolled reader. A duplicate key
 * and a non-string value both parse "fine" by eye and both make the memory unusable, so each one is asserted.
 */
import { describe, expect, it } from "vitest";

import {
  classifyDestination,
  extractPointers,
  extractWikilinks,
  maskNonContent,
  parseFrontmatter,
  splitFrontmatter,
} from "../../../memory/parse.js";

const VALID = "---\nname: thing\ndescription: a thing\nmetadata:\n  type: reference\n---\n\nBody.\n";

/** Every field {@link VALID} declares, parsed. Spelt out once so an added field cannot be forgotten below. */
const VALID_PARSED = {
  amendsCanon: null,
  declaredModified: null,
  declaredName: "thing",
  declaredType: "reference",
  description: "a thing",
  correctionSubject: null,
  findings: [],
  overlaps: [],
  ownerDirective: null,
};

/** Pointers with every outside destination treated as present, so only the classification is under test. */
function pointers({ text }: { text: string }): ReturnType<typeof extractPointers> {
  return extractPointers({ resolvesOutside: () => true, text });
}

describe("frontmatter validation", () => {
  it("accepts a well-formed leaf", () => {
    expect(parseFrontmatter({ file: "thing.md", text: VALID })).toEqual(VALID_PARSED);
  });

  it("reports a file with no frontmatter at all", () => {
    expect(parseFrontmatter({ file: "thing.md", text: "Just a body.\n" }).findings).toEqual([
      { check: "schema", file: "thing.md", line: null, message: "frontmatter is missing or never closed" },
    ]);
  });

  it("reports a fence that never closes", () => {
    expect(parseFrontmatter({ file: "thing.md", text: "---\nname: thing\n" }).findings).toEqual([
      { check: "schema", file: "thing.md", line: null, message: "frontmatter is missing or never closed" },
    ]);
  });

  it("reports a DUPLICATE key, which a hand-rolled last-wins reader would silently accept", () => {
    const text = "---\nname: thing\ndescription: first\ndescription: second\n---\n\nBody.\n";

    expect(parseFrontmatter({ file: "thing.md", text }).findings.map((f) => f.check)).toEqual(["schema"]);
  });

  it("reports a name that is a number rather than a string", () => {
    const text = "---\nname: 42\ndescription: a thing\n---\n\nBody.\n";

    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([
      { check: "schema", file: "thing.md", line: null, message: "frontmatter `name` must be a string" },
    ]);
  });

  it("reports a description that is a list", () => {
    const text = "---\nname: thing\ndescription:\n  - one\n  - two\n---\n\nBody.\n";

    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([
      { check: "schema", file: "thing.md", line: null, message: "frontmatter `description` must be a string" },
    ]);
  });

  it("reports an empty description, because retrieval has nothing to match on", () => {
    const text = '---\nname: thing\ndescription: ""\n---\n\nBody.\n';

    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([
      { check: "schema", file: "thing.md", line: null, message: "frontmatter `description` is empty" },
    ]);
  });

  it("reports a legacy top-level type", () => {
    const text = "---\nname: thing\ndescription: a thing\ntype: reference\n---\n\nBody.\n";

    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([
      {
        check: "schema",
        file: "thing.md",
        line: null,
        message: "frontmatter declares a top-level `type:` — it belongs under `metadata:`",
      },
    ]);
  });

  it("reports an unknown metadata type", () => {
    const text = "---\nname: thing\ndescription: a thing\nmetadata:\n  type: nonsense\n---\n\nBody.\n";

    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([
      {
        check: "schema",
        file: "thing.md",
        line: null,
        message: "frontmatter `metadata.type` is not one of user, feedback, project, reference",
      },
    ]);
  });

  it("accepts metadata with no type declared, which the brief never required", () => {
    const text = "---\nname: thing\ndescription: a thing\nmetadata:\n  node_type: memory\n---\n\nBody.\n";

    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([]);
  });

  it("carries an explicitly namespaced owner-directive opt-in", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n    ownerDirective: true\n---\n";

    expect(parseFrontmatter({ file: "thing.md", text }).ownerDirective).toBe(true);
  });

  it("carries a well-formed correction subject, which is what makes a ruling a CORRECTION", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n" +
      "    ownerDirective: true\n    correctionSubject:\n      source: slack\n      container: C0B5\n" +
      '      sourceId: "1783644763.016499"\n      url: https://example.test/x\n---\n';
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.findings).toEqual([]);
    expect(parsed.correctionSubject).toEqual({
      container: "C0B5",
      source: "slack",
      sourceId: "1783644763.016499",
      url: "https://example.test/x",
    });
  });

  it("omits `url` when absent rather than storing an empty one, since nothing matches on it anyway", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n" +
      "    ownerDirective: true\n    correctionSubject:\n      source: slack\n      container: C0B5\n" +
      '      sourceId: "1.0"\n---\n';

    expect(parseFrontmatter({ file: "thing.md", text }).correctionSubject).toEqual({
      container: "C0B5",
      source: "slack",
      sourceId: "1.0",
    });
  });

  it("REPORTS a half-formed subject AND withholds it, so it can never become an unmatchable correction", () => {
    // Both halves matter. Reporting alone would let a correction into the overlay that nothing can ever
    // match — which reads, to the owner, as the bot being told and getting it wrong anyway. Withholding
    // alone would lose the fact that the owner tried.
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n" +
      "    ownerDirective: true\n    correctionSubject:\n      source: slack\n      container: C0B5\n---\n";
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.correctionSubject).toBe(null);
    expect(parsed.findings.map((f) => f.message)).toEqual([
      "frontmatter `metadata.slopweaver.correctionSubject.sourceId` must be a non-empty string",
    ]);
  });

  it("refuses a correction subject that is not a mapping", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n" +
      "    ownerDirective: true\n    correctionSubject: C0B5\n---\n";
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.correctionSubject).toBe(null);
    expect(parsed.findings.map((f) => f.message)).toEqual([
      "frontmatter `metadata.slopweaver.correctionSubject` must be a mapping",
    ]);
  });

  it("carries a declared canon amendment, unresolved until a verb asks the board", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n" +
      "    amendsCanon:\n      target: AGENTS.md\n      row: some-row\n---\n";
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.findings).toEqual([]);
    expect(parsed.amendsCanon).toEqual({ row: "some-row", rowState: { kind: "unresolved" }, target: "AGENTS.md" });
  });

  it("carries an amendment naming no row as one, so the check can say so", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  slopweaver:\n    amendsCanon:\n      target: AGENTS.md\n---\n";

    expect(parseFrontmatter({ file: "thing.md", text }).amendsCanon).toEqual({
      row: null,
      rowState: { kind: "unresolved" },
      target: "AGENTS.md",
    });
  });

  it.each([
    [
      "not a mapping",
      "    amendsCanon: AGENTS.md\n",
      "frontmatter `metadata.slopweaver.amendsCanon` must be a mapping",
    ],
    [
      "no target",
      "    amendsCanon:\n      row: some-row\n",
      "frontmatter `metadata.slopweaver.amendsCanon.target` must name the canon file it amends",
    ],
    [
      "an empty row",
      '    amendsCanon:\n      target: AGENTS.md\n      row: ""\n',
      "frontmatter `metadata.slopweaver.amendsCanon.row` must be a board slug when present",
    ],
  ])("REPORTS and withholds an amendment with %s", (_label, block, message) => {
    const text = `---\nname: thing\ndescription: a thing\nmetadata:\n  slopweaver:\n${block}---\n`;
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.amendsCanon).toBe(null);
    expect(parsed.findings.map((f) => f.message)).toEqual([message]);
  });

  it("refuses a non-boolean owner-directive tag", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n    ownerDirective: yes please\n---\n";

    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([
      {
        check: "schema",
        file: "thing.md",
        line: null,
        message: "frontmatter `metadata.slopweaver.ownerDirective` must be a boolean",
      },
    ]);
  });

  it("reads the overlap answers in declaration order, a canon section's id included", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n    overlaps:\n" +
      '      older-thing: supersedes\n      "AGENTS.md § Operating doctrine": compatible\n---\n';
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.overlaps).toEqual([
      { answer: "supersedes", target: "older-thing" },
      { answer: "compatible", target: "AGENTS.md § Operating doctrine" },
    ]);
    expect(parsed.findings).toEqual([]);
  });

  it("REPORTS an answer that is neither word AND withholds it, so the nomination stays open", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n    overlaps:\n" +
      "      older-thing: ignore\n      other-thing: compatible\n---\n";
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.overlaps).toEqual([{ answer: "compatible", target: "other-thing" }]);
    expect(parsed.findings.map((f) => f.message)).toEqual([
      "frontmatter `metadata.slopweaver.overlaps` answers `older-thing` with something other than supersedes or compatible",
    ]);
  });

  it("refuses overlaps that are not a mapping", () => {
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n  slopweaver:\n    overlaps: older-thing\n---\n";
    const parsed = parseFrontmatter({ file: "thing.md", text });

    expect(parsed.overlaps).toEqual([]);
    expect(parsed.findings.map((f) => f.message)).toEqual([
      "frontmatter `metadata.slopweaver.overlaps` must be a mapping",
    ]);
  });

  it("survives CRLF line endings", () => {
    const text = VALID.replaceAll("\n", "\r\n");

    expect(parseFrontmatter({ file: "thing.md", text })).toEqual(VALID_PARSED);
  });

  it("survives a UTF-8 BOM", () => {
    expect(parseFrontmatter({ file: "thing.md", text: `﻿${VALID}` })).toEqual(VALID_PARSED);
  });

  it("is not confused by a later `---` in the body", () => {
    const text = `${VALID}\n---\n\nMore body.\n`;

    expect(parseFrontmatter({ file: "thing.md", text })).toEqual(VALID_PARSED);
  });
});

describe("the fields the sweep presents", () => {
  it("carries `metadata.modified` out verbatim", () => {
    const text = "---\nname: thing\ndescription: a thing\nmetadata:\n  modified: 2026-01-01T00:00:00.000Z\n---\n";

    expect(parseFrontmatter({ file: "thing.md", text }).declaredModified).toBe("2026-01-01T00:00:00.000Z");
  });

  it("carries a `modified` that is NOT a timestamp out verbatim, and calls it no defect", () => {
    const text = "---\nname: thing\ndescription: a thing\nmetadata:\n  modified: whenever\n---\n";

    // Claude Code stamps this field itself. A checker that failed the tool's own output would be unusable, and
    // whether the value is legible is the sweep's judgement to make with the value in hand.
    expect(parseFrontmatter({ file: "thing.md", text }).declaredModified).toBe("whenever");
    expect(parseFrontmatter({ file: "thing.md", text }).findings).toEqual([]);
  });

  it("reports a missing `modified` as absent rather than as a date", () => {
    expect(parseFrontmatter({ file: "thing.md", text: VALID }).declaredModified).toBeNull();
  });

  it("reports an unknown `metadata.type` as no type at all, alongside its finding", () => {
    const text = "---\nname: thing\ndescription: a thing\nmetadata:\n  type: nonsense\n---\n";

    expect(parseFrontmatter({ file: "thing.md", text }).declaredType).toBeNull();
    expect(parseFrontmatter({ file: "thing.md", text }).findings.map((f) => f.check)).toEqual(["schema"]);
  });

  it("reports an unusable description as absent rather than as the empty string", () => {
    const text = '---\nname: thing\ndescription: ""\n---\n';

    expect(parseFrontmatter({ file: "thing.md", text }).description).toBeNull();
  });
});

describe("splitting the envelope", () => {
  it("reports the body offset so wikilink line numbers stay true", () => {
    expect(splitFrontmatter({ text: VALID }).bodyOffset).toBe(6);
  });

  it("returns the body past the fence, BOM and CRLF normalised away", () => {
    expect(splitFrontmatter({ text: "---\r\nname: x\r\n---\r\n\r\nBody.\r\n" }).body).toBe("\nBody.\n");
  });

  it("treats a file with no envelope as all body", () => {
    expect(splitFrontmatter({ text: "Body only.\n" })).toEqual({
      body: "Body only.\n",
      bodyOffset: 0,
      frontmatter: null,
    });
  });
});

describe("masking non-content", () => {
  it("blanks a fenced block but keeps the line count, so numbers do not shift", () => {
    const text = "one\n```\ntwo\n```\nfive\n";

    expect(maskNonContent({ text }).split("\n")).toEqual(["one", "", "", "", "five", ""]);
  });

  it("blanks a multi-line HTML comment", () => {
    const text = "one\n<!-- hidden\nstill hidden -->\nfour\n";

    expect(maskNonContent({ text }).split("\n")).toEqual(["one", "", "", "four", ""]);
  });

  it("removes only the commented span from a single line", () => {
    expect(maskNonContent({ text: "before <!-- gone --> after\n" }).split("\n")[0]).toBe("before  after");
  });
});

describe("classifying a link destination", () => {
  it("treats a bare filename as a same-directory pointer", () => {
    expect(classifyDestination({ raw: "thing.md" })).toEqual({ outside: false, target: "thing" });
  });

  it("strips a leading ./", () => {
    expect(classifyDestination({ raw: "./thing.md" })).toEqual({ outside: false, target: "thing" });
  });

  it("strips a #fragment, which addresses the same file", () => {
    expect(classifyDestination({ raw: "thing.md#a-heading" })).toEqual({ outside: false, target: "thing" });
  });

  it("marks a parent-relative path as outside", () => {
    expect(classifyDestination({ raw: "../elsewhere/thing.md" })).toEqual({
      outside: true,
      target: "../elsewhere/thing.md",
    });
  });

  it("marks an absolute path as outside", () => {
    expect(classifyDestination({ raw: "/somewhere/thing.md" })).toEqual({
      outside: true,
      target: "/somewhere/thing.md",
    });
  });

  it("ignores a URL entirely", () => {
    expect(classifyDestination({ raw: "https://example.invalid/thing.md" })).toBeNull();
  });

  it("ignores a destination that is not markdown", () => {
    expect(classifyDestination({ raw: "thing.png" })).toBeNull();
  });

  it("percent-decodes a filename with a space", () => {
    expect(classifyDestination({ raw: "two%20words.md" })).toEqual({ outside: false, target: "two words" });
  });
});

describe("extracting edges", () => {
  it("records a pointer's line number", () => {
    expect(pointers({ text: "# Title\n\n- [Thing](thing.md) — a thing\n" })).toEqual([
      { hook: "a thing", line: 3, outside: false, raw: "thing.md", resolves: true, target: "thing" },
    ]);
  });

  it("gives each of two links on one line only the text after IT, up to the next link", () => {
    const hooks = pointers({ text: "- [A](a.md) — the first · [B](b.md): the second\n- [C](c.md)\n" }).map((p) => [
      p.target,
      p.hook,
    ]);

    expect(hooks).toEqual([
      ["a", "the first ·"],
      ["b", "the second"],
      ["c", ""],
    ]);
  });

  it("ignores a pointer inside a fenced block", () => {
    expect(pointers({ text: "```\n- [Thing](thing.md)\n```\n" })).toEqual([]);
  });

  it("consults the injected resolver only for an outside pointer", () => {
    const asked: string[] = [];
    extractPointers({
      resolvesOutside: ({ target }) => {
        asked.push(target);
        return false;
      },
      text: "- [In](inside.md)\n- [Out](../outside.md)\n",
    });

    expect(asked).toEqual(["../outside.md"]);
  });

  it("numbers a wikilink from the top of the file, not the top of the body", () => {
    expect(extractWikilinks({ text: `${VALID}Linked: [[other]]\n` })).toEqual([{ line: 9, target: "other" }]);
  });

  it("strips a trailing .md from a wikilink target", () => {
    expect(extractWikilinks({ text: "[[other.md]]\n" })).toEqual([{ line: 1, target: "other" }]);
  });
});
