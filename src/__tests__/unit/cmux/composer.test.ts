/**
 * The measurement this module exists for, asserted over the frozen captures in
 * `src/__tests__/fixtures/composer/`: the three plain-text reads are the SAME shape, and the three styled
 * grids are not. Every fixture is a real reply, so a Claude Code release that stops drawing its own text
 * faint fails here rather than silently going back to calling a suggestion a typed line.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type ComposerReading, composerIsFromAPerson, describeComposer, readComposer } from "../../../cmux/composer.js";
import { parseRenderGrid } from "../../../cmux/renderGrid.js";
import { unwrap } from "../../../lib/result.js";

const FIXTURES = join(import.meta.dirname, "../../fixtures/composer");

/** One frozen `terminal.replay` capture, read through the real parser and the real classifier. */
function readingFor({ shape }: { shape: string }): ComposerReading {
  const value: unknown = JSON.parse(readFileSync(join(FIXTURES, `${shape}.json`), "utf8"));
  const parsed = parseRenderGrid({ value });
  expect(parsed.isOk()).toBe(true);
  return readComposer({ grid: unwrap(parsed) });
}

/** The composer line of one frozen `surface.read_text` capture — the row the supervisor was reading. */
function plainComposerLine({ shape }: { shape: string }): string {
  const screen = readFileSync(join(FIXTURES, `${shape}.screen.txt`), "utf8");
  const lines = screen.split("\n").filter((line) => line.includes("❯ "));
  expect(lines).toHaveLength(1);
  return lines[0]!.trimEnd();
}

describe("the plain-text read is blind, which is the whole defect", () => {
  it("renders all three shapes as the same `❯ <words>` line, differing only in the words", () => {
    expect(plainComposerLine({ shape: "typed" })).toBe("❯ approved, land it");
    expect(plainComposerLine({ shape: "suggestion" })).toBe("❯ it's probably in the home directory, check ~/hello.txt");
    expect(plainComposerLine({ shape: "placeholder" })).toBe('❯ Try "create a util logging.py that..."');
  });

  it("carries no escape byte at all, so no colour survives to be read", () => {
    for (const shape of ["typed", "suggestion", "placeholder"]) {
      expect(readFileSync(join(FIXTURES, `${shape}.screen.txt`), "utf8").includes(String.fromCharCode(27))).toBe(false);
    }
  });
});

describe("readComposer over the frozen grids", () => {
  it("names the typed line typed, and carries its exact text", () => {
    expect(readingFor({ shape: "typed" })).toStrictEqual({ kind: "typed", text: "approved, land it" });
  });

  it("names the generated line a suggestion, on the same screen shape", () => {
    expect(readingFor({ shape: "suggestion" })).toStrictEqual({
      kind: "suggestion",
      text: "it's probably in the home directory, check ~/hello.txt",
    });
  });

  it("names the empty-session hint a placeholder rather than a suggestion", () => {
    expect(readingFor({ shape: "placeholder" })).toStrictEqual({
      kind: "placeholder",
      text: 'Try "create a util logging.py that..."',
    });
  });

  it("attributes only the typed one to a person — the question the incident got wrong", () => {
    expect(composerIsFromAPerson({ reading: readingFor({ shape: "typed" }) })).toBe(true);
    expect(composerIsFromAPerson({ reading: readingFor({ shape: "suggestion" }) })).toBe(false);
    expect(composerIsFromAPerson({ reading: readingFor({ shape: "placeholder" }) })).toBe(false);
  });
});

describe("readComposer refuses rather than guessing", () => {
  const style = { bold: false, faint: false, foreground: "#FFFFFF", id: 0, italic: false };
  const faintStyle = { bold: false, faint: true, foreground: "#FFFFFF", id: 1, italic: false };
  const cursor = { column: 2, row: 1, visible: true };
  /** Claude Code's live composer prompt: chevron + NON-BREAKING space, spelled as escapes so it is visible here. */
  const PROMPT = "\u276f\u00a0";
  const rule = { column: 0, row: 2, styleId: 0, text: "─".repeat(40) };

  it("still reads the box while the cursor is hidden — which is every running turn", () => {
    // Measured live: Claude Code hides the cursor for the whole of a turn and while a permission dialog is
    // up, so a cursor-gated rule answered `unreadable` for two minutes on a readable screen.
    const reading = readComposer({
      grid: {
        columns: 40,
        cursor: { column: 2, row: 1, visible: false },
        rows: 3,
        spans: [{ column: 0, row: 1, styleId: 1, text: `${PROMPT}approved, land it` }, rule],
        styles: [style, faintStyle],
      },
    });
    expect(reading).toStrictEqual({ kind: "suggestion", text: "approved, land it" });
  });

  // MEASURED live: an `AskUserQuestion` menu replaces the composer entirely — its `❯` marks the
  // highlighted option and is followed by an ORDINARY space — so there is genuinely no box to attribute.
  it("answers unreadable when no composer prompt is on the screen at all", () => {
    const reading = readComposer({
      grid: {
        columns: 40,
        cursor,
        rows: 3,
        spans: [{ column: 0, row: 1, styleId: 0, text: "$ " }],
        styles: [style],
      },
    });
    expect(reading).toStrictEqual({
      kind: "unreadable",
      reason:
        "no Claude Code composer prompt is on the screen — a menu or permission prompt has replaced it, or this is another host",
    });
  });

  it("does not read the transcript's ordinary-space echo of a submitted prompt as the box", () => {
    const reading = readComposer({
      grid: {
        columns: 40,
        cursor,
        rows: 3,
        spans: [{ column: 0, row: 1, styleId: 0, text: "\u276f already submitted" }],
        styles: [style],
      },
    });
    expect(reading.kind).toBe("unreadable");
  });

  it("answers empty for a composer holding nothing", () => {
    const reading = readComposer({
      grid: {
        columns: 40,
        cursor,
        rows: 3,
        spans: [{ column: 0, row: 1, styleId: 0, text: PROMPT }, rule],
        styles: [style],
      },
    });
    expect(reading).toStrictEqual({ kind: "empty" });
  });

  it("keeps the spaces between words when a live row arrives as several spans", () => {
    // The first live read of the shipped verb answered `approved,landit`: cmux splits a composer row (the
    // cell under the cursor becomes its own run) and omits the runs of spaces between them, so the spans
    // have to be laid out by column rather than concatenated.
    const reading = readComposer({
      grid: {
        columns: 40,
        cursor: { column: 19, row: 1, visible: true },
        rows: 3,
        spans: [
          { column: 0, row: 1, styleId: 0, text: `${PROMPT}approved,` },
          { column: 12, row: 1, styleId: 0, text: "land" },
          { column: 17, row: 1, styleId: 0, text: "it" },
          rule,
        ],
        styles: [style],
      },
    });
    expect(reading).toStrictEqual({ kind: "typed", text: "approved, land it" });
  });

  it("calls a wrapped line typed when any of its rows is drawn in the normal attribute", () => {
    const reading = readComposer({
      grid: {
        columns: 40,
        cursor: { column: 5, row: 2, visible: true },
        rows: 4,
        spans: [
          { column: 0, row: 0, styleId: 0, text: "─".repeat(40) },
          { column: 0, row: 1, styleId: 0, text: `${PROMPT}first half ` },
          { column: 0, row: 2, styleId: 1, text: "second half" },
          { column: 0, row: 3, styleId: 0, text: "─".repeat(40) },
        ],
        styles: [style, faintStyle],
      },
    });
    expect(reading).toStrictEqual({ kind: "typed", text: "first half second half" });
  });

  it("reads a row cmux sent no span for as a blank row inside the box, above and below the cursor", () => {
    // Row 2 carries no ink, so the reply holds no span for it: the walk up from the cursor passes it, and the
    // box's rows still run through it to the closing rule.
    const reading = readComposer({
      grid: {
        columns: 40,
        cursor: { column: 5, row: 3, visible: true },
        rows: 5,
        spans: [
          { column: 0, row: 1, styleId: 0, text: `${PROMPT}first half ` },
          { column: 0, row: 3, styleId: 1, text: "second half" },
          { column: 0, row: 4, styleId: 0, text: "─".repeat(40) },
        ],
        styles: [style, faintStyle],
      },
    });
    expect(reading).toStrictEqual({ kind: "typed", text: "first half second half" });
  });
});

describe("describeComposer", () => {
  it("says a suggestion was typed by nobody", () => {
    expect(describeComposer({ reading: { kind: "suggestion", text: "approved, land it" } })).toBe(
      "composer: a SUGGESTION Claude Code generated, not typed by anyone — approved, land it",
    );
  });

  it("says an unreadable box must not be treated as typed", () => {
    expect(describeComposer({ reading: { kind: "unreadable", reason: "no grid" } })).toBe(
      "composer: UNREADABLE — no grid; do not treat what the screen shows in the prompt box as typed",
    );
  });

  it("marks even a typed line as unsubmitted", () => {
    expect(describeComposer({ reading: { kind: "typed", text: "approved, land it" } })).toBe(
      "composer: TYPED, unsubmitted — approved, land it",
    );
  });
});
