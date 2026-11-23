import { describe, expect, it } from "vitest";

import {
  MAX_BOOT_BLOCK_LINES,
  MAX_STATE_DOC_LINES,
  parseStateDoc,
  RULINGS_HEADING,
  rulingsOffences,
  rulingsRows,
  stateDocOffences,
  stateDocRefusalLines,
} from "../../../supervisor/stateDoc.js";

const HEADING = "## SUCCESSOR BOOT BLOCK";

/** A doc of `blocks` boot blocks, each `bodyLines` lines of body under its heading. */
const doc = ({ blocks, bodyLines, preamble = 0 }: { blocks: number; bodyLines: number; preamble?: number }): string => {
  const head = Array.from({ length: preamble }, (_unused, index) => `preamble ${index}`);
  const body = Array.from({ length: blocks }, (_unused, index) =>
    [`${HEADING} — block ${index}`, ...Array.from({ length: bodyLines }, (_line, n) => `line ${n}`)].join("\n"),
  );
  return [...head, ...body].join("\n");
};

describe("parseStateDoc", () => {
  it("counts an empty doc as zero lines and no blocks", () => {
    const shape = parseStateDoc({ text: "" });
    expect(shape.totalLines).toBe(0);
    expect(shape.blocks.length).toBe(0);
    expect(shape.currentBlock).toBe(undefined);
  });

  it("finds every boot block and sizes each from its own heading to the next", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 3, bodyLines: 4 }) });
    expect(shape.blocks.length).toBe(3);
    expect(shape.blocks[0]!.lines).toBe(5);
    expect(shape.blocks[1]!.lines).toBe(5);
    expect(shape.blocks[2]!.lines).toBe(5);
    expect(shape.totalLines).toBe(15);
  });

  it("names the last block as the current one, with its 1-based start line", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 2, bodyLines: 2, preamble: 3 }) });
    expect(shape.currentBlock!.startLine).toBe(7);
    expect(shape.currentBlock!.heading).toBe(`${HEADING} — block 1`);
    expect(shape.currentBlock!.lines).toBe(3);
  });

  it("counts preamble before the first heading against the doc, not against any block", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 1, bodyLines: 1, preamble: 10 }) });
    expect(shape.totalLines).toBe(12);
    expect(shape.blocks[0]!.lines).toBe(2);
  });

  it("normalises CRLF so a Windows-written doc measures the same", () => {
    const shape = parseStateDoc({ text: `${HEADING} — a\r\nline one\r\nline two` });
    expect(shape.totalLines).toBe(3);
    expect(shape.blocks[0]!.lines).toBe(3);
  });
});

describe("stateDocOffences", () => {
  it("passes a doc inside both caps", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 2, bodyLines: 10 }) });
    expect(stateDocOffences({ docPath: "/s.md", shape }).length).toBe(0);
  });

  it("refuses a doc over the whole-doc cap and names the cap", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 40, bodyLines: 30 }) });
    const offences = stateDocOffences({ docPath: "/s.md", shape });
    expect(offences[0]!.code).toBe("doc-too-long");
    expect(offences[0]!.cap).toBe(MAX_STATE_DOC_LINES);
    expect(offences[0]!.lines).toBe(1240);
  });

  it("refuses a current boot block over the block cap and points at its line", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 1, bodyLines: MAX_BOOT_BLOCK_LINES }) });
    const offences = stateDocOffences({ docPath: "/s.md", shape });
    expect(offences.length).toBe(1);
    expect(offences[0]!.code).toBe("boot-block-too-long");
    expect(offences[0]!.lines).toBe(61);
    expect(offences[0]!.message).toContain("/s.md:1, with the shift notes under it");
  });

  it("judges only the CURRENT block, never an archived predecessor", () => {
    const oversized = [`${HEADING} — old`, ...Array.from({ length: 200 }, () => "x")].join("\n");
    const current = [`${HEADING} — new`, "small"].join("\n");
    const shape = parseStateDoc({ text: `${oversized}\n${current}` });
    expect(shape.blocks[0]!.lines).toBe(201);
    expect(stateDocOffences({ docPath: "/s.md", shape }).length).toBe(0);
  });

  it("reports both offences at once when a doc breaks both caps", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 6, bodyLines: 80 }) });
    const codes = stateDocOffences({ docPath: "/s.md", shape }).map((offence) => offence.code);
    expect(codes).toStrictEqual(["doc-too-long", "boot-block-too-long"]);
  });
});

describe("stateDocRefusalLines", () => {
  it("says nothing when there is nothing to refuse", () => {
    expect(stateDocRefusalLines({ offences: [] })).toStrictEqual([]);
  });

  it("names what unblocks the refusal, not just what is wrong", () => {
    const shape = parseStateDoc({ text: doc({ blocks: 40, bodyLines: 30 }) });
    const lines = stateDocRefusalLines({ offences: stateDocOffences({ docPath: "/s.md", shape }) });
    expect(lines[0]).toContain("supervisorState:");
    expect(lines.at(-2)).toContain("slopweaver supervisor state-check --path");
    expect(lines.at(-1)).toContain("skills/supervisor/reference/state-doc.md");
  });
});

/** A doc whose current block carries the given lines under its heading. */
const withBlock = ({ lines }: { lines: readonly string[] }): string =>
  [`${HEADING} — earlier`, "- old shift", `${HEADING} — current`, ...lines].join("\n");

describe("rulingsRows", () => {
  it("reports no section when the current block has no rulings heading", () => {
    const text = withBlock({ lines: ["- OWNER: ruled on the 16415 stack in chat"] });
    const shape = parseStateDoc({ text });
    expect(rulingsRows({ block: shape.currentBlock!, lines: text.split("\n") })).toEqual({
      found: false,
      unanchored: [],
    });
  });

  it("accepts a section of rows that each carry a URL, or the one row `- none`", () => {
    const text = withBlock({
      lines: [
        `### ${RULINGS_HEADING}`,
        "- https://github.com/acme/acme-admin/pull/16415 — no review asks until PR 1 lands (deferred)",
        "",
        "- none",
      ],
    });
    const shape = parseStateDoc({ text });
    expect(rulingsRows({ block: shape.currentBlock!, lines: text.split("\n") })).toEqual({
      found: true,
      unanchored: [],
    });
  });

  it("names every row written as prose, with its line", () => {
    const text = withBlock({
      lines: [
        "- OWNER awake",
        `## ${RULINGS_HEADING}`,
        "- the #16415 stack gets no review asks until PR 1 lands",
        "- https://github.com/acme/acme-admin/pull/16358 — resolve Kieran's own thread",
        "- no bump of Arlo before 3 Sep 22:45 AEST",
      ],
    });
    const shape = parseStateDoc({ text });
    expect(rulingsRows({ block: shape.currentBlock!, lines: text.split("\n") })).toEqual({
      found: true,
      unanchored: [
        { line: 6, text: "- the #16415 stack gets no review asks until PR 1 lands" },
        { line: 8, text: "- no bump of Arlo before 3 Sep 22:45 AEST" },
      ],
    });
  });

  it("stops at the next heading, so shift notes after the section are not judged as rulings", () => {
    const text = withBlock({
      lines: [`### ${RULINGS_HEADING}`, "- none", "### TRAPS", "- a shell-backgrounded spawn is refused"],
    });
    const shape = parseStateDoc({ text });
    expect(rulingsRows({ block: shape.currentBlock!, lines: text.split("\n") }).unanchored).toEqual([]);
  });

  it("reads the heading case-insensitively at any depth", () => {
    const text = withBlock({ lines: ["#### Rulings", "- prose ruling"] });
    const shape = parseStateDoc({ text });
    expect(rulingsRows({ block: shape.currentBlock!, lines: text.split("\n") }).unanchored.length).toBe(1);
  });
});

describe("rulingsOffences", () => {
  it("refuses a current block with no rulings section, and says what to add", () => {
    const text = withBlock({ lines: ["- OWNER: ruled in chat"] });
    const offences = rulingsOffences({ docPath: "/d.md", shape: parseStateDoc({ text }), text });
    expect(offences.map((offence) => offence.code)).toEqual(["rulings-missing"]);
    expect(offences[0]!.message).toContain("/d.md:3 has no `### RULINGS` section");
    expect(offences[0]!.message).toContain("slopweaver session-start lock-in --item <url>");
  });

  it("refuses each prose ruling by line, quoting it", () => {
    const text = withBlock({ lines: [`### ${RULINGS_HEADING}`, "- no bump of Arlo before 3 Sep"] });
    const offences = rulingsOffences({ docPath: "/d.md", shape: parseStateDoc({ text }), text });
    expect(offences).toEqual([
      {
        cap: 0,
        code: "unanchored-ruling",
        lines: 5,
        message:
          '/d.md:5 is a ruling written as prose, with no URL — "- no bump of Arlo before 3 Sep"; a ruling row names the pull request, thread or ticket it was given on, so the next supervisor\'s list can read it back',
      },
    ]);
  });

  it("judges only the current block, so an archived predecessor's prose is not refused", () => {
    const text = [
      `${HEADING} — earlier`,
      "- ruled in prose",
      `${HEADING} — current`,
      `### ${RULINGS_HEADING}`,
      "- none",
    ].join("\n");
    expect(rulingsOffences({ docPath: "/d.md", shape: parseStateDoc({ text }), text })).toEqual([]);
  });

  it("has nothing to say about a doc with no boot block at all", () => {
    expect(rulingsOffences({ docPath: "/d.md", shape: parseStateDoc({ text: "preamble" }), text: "preamble" })).toEqual(
      [],
    );
  });
});

describe("stateDocOffences with the doc's text", () => {
  it("adds the rulings offences to the size caps only when given the text", () => {
    const text = withBlock({ lines: ["- prose"] });
    const shape = parseStateDoc({ text });
    expect(stateDocOffences({ docPath: "/d.md", shape }).length).toBe(0);
    expect(stateDocOffences({ docPath: "/d.md", shape, text }).map((offence) => offence.code)).toEqual([
      "rulings-missing",
    ]);
  });
});
