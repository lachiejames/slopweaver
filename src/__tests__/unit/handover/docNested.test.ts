import { describe, expect, it } from "vitest";

import { isTopLevelKey, NESTED_KEYS, nestedFields } from "../../../handover/docNested.js";

/** The front-matter of a row, as lines, so a case can state exactly what it is feeding the reader. */
const frontMatter = ({ text }: { text: string }): readonly string[] => text.split("\n");

describe("NESTED_KEYS", () => {
  it("names the five keys whose values nest", () => {
    expect([...NESTED_KEYS]).toEqual(["doneWhen", "examples", "options", "outputs", "shot"]);
  });
});

describe("isTopLevelKey", () => {
  it("reads a key at column zero as one", () => {
    expect(isTopLevelKey({ line: "slug: ship-the-card" })).toBe(true);
    expect(isTopLevelKey({ line: "asked-iso: 2026-09-21T14:00:00Z" })).toBe(true);
  });

  it("reads an indented list item and a blank line as continuations", () => {
    expect(isTopLevelKey({ line: "  - option: ship the card" })).toBe(false);
    expect(isTopLevelKey({ line: "" })).toBe(false);
  });
});

describe("nestedFields", () => {
  it("reads the options block, lettering by position", () => {
    const read = nestedFields({
      lines: frontMatter({
        text: [
          "slug: ship-the-card",
          "options:",
          '  - option: "ship the schema"',
          '    tradeoff: "a day of work"',
          '  - option: "ship the card"',
          '    tradeoff: "they wait another turn"',
          "status: ready",
        ].join("\n"),
      }),
    });
    expect(read.problems).toEqual([]);
    expect(read.options).toEqual([
      { letter: "A", option: "ship the schema", tradeoff: "a day of work" },
      { letter: "B", option: "ship the card", tradeoff: "they wait another turn" },
    ]);
  });

  it("reads outputs and doneWhen alongside options", () => {
    const read = nestedFields({
      lines: frontMatter({
        text: ["outputs:", "  - docs/security.md", "doneWhen:", "  - path: docs/security.md"].join("\n"),
      }),
    });
    expect(read.outputs).toEqual(["docs/security.md"]);
    expect(read.probes.map((probe) => probe.kind)).toEqual(["path"]);
  });

  it("reads the examples list in order, a colon and a quote inside a scene included", () => {
    const read = nestedFields({
      lines: frontMatter({
        text: ["examples:", '  - "You see #1788: merged. Right?"', '  - "You see \\"two\\". Right?"'].join("\n"),
      }),
    });
    expect(read.problems).toEqual([]);
    expect(read.examples).toEqual(["You see #1788: merged. Right?", 'You see "two". Right?']);
  });

  it("is untroubled by a flat scalar it never looks at, even one opening with a backtick", () => {
    const read = nestedFields({
      lines: frontMatter({
        text: ["summary: `distil` latest collapse: why", "options:", '  - option: "a"', '    tradeoff: "b"'].join("\n"),
      }),
    });
    expect(read.problems).toEqual([]);
    expect(read.options).toEqual([{ letter: "A", option: "a", tradeoff: "b" }]);
  });

  it("reads a registered ask's picture, written as the one JSON line `handover shot` writes", () => {
    const shot = {
      boxes: [{ height: 36, label: "stale", width: 380, x: 40, y: 212 }],
      height: 900,
      sha256: "a".repeat(64),
      width: 1440,
    };
    const read = nestedFields({
      lines: frontMatter({ text: ["slug: vanta-evidence", `shot: ${JSON.stringify(shot)}`].join("\n") }),
    });
    expect(read.problems).toEqual([]);
    expect(read.shot).toEqual(shot);
  });

  it("says a picture that will not read, rather than reading the row as one with none", () => {
    const shot = { boxes: [], height: 900, sha256: "a".repeat(64), width: 1440 };
    const read = nestedFields({ lines: frontMatter({ text: `shot: ${JSON.stringify(shot)}` }) });
    expect(read.shot).toBe(undefined);
    expect(read.problems).toEqual(["shot carries 1 to 9 boxes — a picture with none shows the owner nothing to grab"]);
  });

  it("reports an unreadable nested block, naming all five keys", () => {
    const read = nestedFields({
      lines: frontMatter({ text: ["options:", "  - option: `bad", "   tradeoff:"].join("\n") }),
    });
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toContain(
      "`doneWhen:`/`examples:`/`options:`/`outputs:`/`shot:` could not be read — not valid YAML",
    );
    expect(read.options).toEqual([]);
  });

  it("says nothing about front-matter that declares none of the five keys", () => {
    const read = nestedFields({
      lines: frontMatter({ text: ["summary: `a backtick opens this", "status: ready"].join("\n") }),
    });
    expect(read).toEqual({ examples: [], options: [], outputs: [], probes: [], problems: [] });
  });

  it("answers empty front-matter with empty fields and no complaint", () => {
    expect(nestedFields({ lines: [] })).toEqual({ examples: [], options: [], outputs: [], probes: [], problems: [] });
  });
});
