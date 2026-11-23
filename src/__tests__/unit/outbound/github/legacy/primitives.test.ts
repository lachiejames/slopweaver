/**
 * The reading-order building blocks: UTC day arithmetic, the tooltip templates and their inverses, the shared
 * proof-block reader, and the error factory's conversion pointer.
 */
import { describe, expect, it } from "vitest";
import { daysBetween, longDay, shortDay, utcDayOf, utcMidnightOf } from "../../../../../outbound/github/days.js";
import { RETIRED_SHAPE_CONVERSION, ReadingOrderErrors } from "../../../../../outbound/github/legacy/errors.js";
import { parseProofBlocks } from "../../../../../outbound/github/legacy/parseBlocks.js";
import { renderProofBlock } from "../../../../../outbound/github/legacy/render.js";
import {
  problemTooltip,
  readProblemTooltip,
  readSolvedTooltip,
  solvedTooltip,
} from "../../../../../outbound/github/legacy/tooltips.js";
import type { ProofBlock, ProofBlockLeaf } from "../../../../../outbound/github/legacy/types.js";

describe("days", () => {
  it("reads the UTC day an instant falls on, not the local one", () => {
    expect([
      utcDayOf({ instant: new Date("2026-10-01T23:59:59.999Z") }),
      utcDayOf({ instant: new Date("2026-10-02T00:00:00.000Z") }),
      utcDayOf({ instant: new Date("2026-10-02T09:30:00+10:00") }),
    ]).toEqual(["2026-10-01", "2026-10-02", "2026-10-01"]);
  });

  it("refuses a well-shaped day that is not on the calendar", () => {
    expect([utcMidnightOf({ day: "2026-02-30" }), utcMidnightOf({ day: "2026-9-1" })]).toEqual([undefined, undefined]);
  });

  it("measures whole UTC days, signed", () => {
    const from = utcMidnightOf({ day: "2026-09-16" })!;
    const to = utcMidnightOf({ day: "2026-10-01" })!;
    expect([daysBetween({ from, to }), daysBetween({ from: to, to: from })]).toEqual([15, -15]);
  });

  it("prints the short and long forms with no leading zero", () => {
    expect([shortDay({ day: "2026-09-05" }), longDay({ day: "2026-09-05" })]).toEqual(["5 Sep", "5 Sep 2026"]);
  });
});

describe("tooltips — each template reads back through its inverse", () => {
  it("round-trips a seen problem", () => {
    const text = problemTooltip({ days: 3, seen: { kind: "seen", on: "2026-09-28" }, writtenOn: "2026-10-01" });
    expect(readProblemTooltip({ text })).toEqual({
      problemSeen: { kind: "seen", on: "2026-09-28" },
      writtenOn: "2026-10-01",
    });
  });

  it("round-trips an unevidenced problem", () => {
    const text = problemTooltip({ days: 0, seen: { kind: "unevidenced" }, writtenOn: "2026-10-01" });
    expect(readProblemTooltip({ text })).toEqual({ problemSeen: { kind: "unevidenced" }, writtenOn: "2026-10-01" });
  });

  it("round-trips a review whose reason carries a colon and a semicolon", () => {
    const review = { grade: "bronze", reviewer: "codex", why: "ran it: passes; slow" } as const;
    expect(readSolvedTooltip({ text: solvedTooltip({ gaps: 2, review }) })).toEqual({ review });
  });

  it("reads 'not yet reviewed' as no review, and a foreign string as nothing", () => {
    expect(readSolvedTooltip({ text: solvedTooltip({ gaps: 0, review: undefined }) })).toEqual({ review: undefined });
    expect([readSolvedTooltip({ text: "solved" }), readProblemTooltip({ text: "problem" })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("parseProofBlocks", () => {
  it("reads back a paragraph, a code block and a details block", () => {
    const blocks: readonly ProofBlock[] = [
      { content: [{ kind: "text", text: "A paragraph." }], kind: "para" },
      { kind: "code", lang: "ts", text: "const a = 1;" },
      {
        blocks: [{ content: [{ kind: "text", text: "Inside." }], kind: "para" }],
        kind: "details",
        summary: "More",
      },
    ];
    const source = blocks.map((block) => renderProofBlock({ block })).join("\n\n");
    expect(parseProofBlocks({ source })).toEqual(blocks);
  });

  it.each([false, true])(
    "reads a paragraph that looks like a fence opener, before a real code block, as the paragraph (nested: %s)",
    (nested) => {
      const leaves: readonly ProofBlockLeaf[] = [
        { content: [{ kind: "text", text: "```ts" }], kind: "para" },
        { kind: "code", lang: "", text: "x" },
      ];
      const blocks: readonly ProofBlock[] = nested ? [{ blocks: leaves, kind: "details", summary: "More" }] : leaves;
      const source = blocks.map((block) => renderProofBlock({ block })).join("\n\n");
      expect(parseProofBlocks({ source })).toEqual(blocks);
    },
  );

  /** Each code block is read by two readers that end in the same place: a search retrying both is 2^40 here. */
  it("refuses a region of forty code blocks with a broken tail without retrying every pair", () => {
    const code = renderProofBlock({ block: { kind: "code", lang: "", text: "x" } });
    const source = `${Array.from({ length: 40 }, () => code).join("\n\n")}\n<b>`;
    expect(parseProofBlocks({ source })).toBe(undefined);
  });

  it("reads twenty thousand blocks back without overflowing the stack", () => {
    const blocks: readonly ProofBlock[] = Array.from({ length: 20_000 }, () => ({ kind: "code", lang: "", text: "x" }));
    const source = blocks.map((block) => renderProofBlock({ block })).join("\n\n");
    expect(parseProofBlocks({ source })!.length).toBe(20_000);
  });

  it("does not read a fence longer than the renderer would choose as code", () => {
    const source = "````ts\nconst a = 1;\n````";
    expect(parseProofBlocks({ source })).toEqual([{ content: [{ kind: "text", text: source }], kind: "para" }]);
  });
});

describe("ReadingOrderErrors.retiredShape", () => {
  it("names the whole-replace conversion", () => {
    const error = ReadingOrderErrors.retiredShape();
    expect([error.code, error.conversion]).toEqual(["RETIRED_SHAPE", RETIRED_SHAPE_CONVERSION]);
    expect(error.conversion).toBe("slopweaver github pr update --repo <owner/name> --number <n> --file <f>");
  });
});
