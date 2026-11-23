/**
 * The composable PR-line pieces: a status glyph, a hyperlinked title, an optional pipe-separated note, and
 * a bold heading — each tested alone, since nothing here decides grouping or wires them together.
 */
import { describe, expect, it } from "vitest";
import {
  DISTANCE_BAR_LENGTH,
  distanceBarFor,
  ownerGlyphFor,
  PR_LINE_GLYPH,
  PR_OWNER_GLYPH,
  prGroupHeading,
  prLineRuns,
} from "../../../../outbound/assistant/prListRender.js";

describe("PR_LINE_GLYPH", () => {
  it("gives every status its own glyph", () => {
    expect(PR_LINE_GLYPH).toEqual({
      building: "⚪",
      failing: "🔴",
      merged: "🟣",
      needsAttention: "🟠",
      ready: "🟢",
    });
  });
});

describe("prLineRuns", () => {
  it("renders the glyph and the hyperlinked title, with no note run when none is given", () => {
    const runs = prLineRuns({
      status: "ready",
      title: "feat(QQQQ-51): repair the SDLC board",
      url: "https://github.com/o/r/pull/1",
    });

    expect(runs).toEqual([
      { text: "🟢 ", type: "text" },
      { label: "feat(QQQQ-51): repair the SDLC board", type: "link", url: "https://github.com/o/r/pull/1" },
    ]);
  });

  it("appends the note after a pipe when one is given", () => {
    const runs = prLineRuns({
      note: "waiting on @reviewer-one",
      status: "needsAttention",
      title: "fix(QQQQ-51)",
      url: "https://github.com/o/r/pull/2",
    });

    expect(runs).toEqual([
      { text: "🟠 ", type: "text" },
      { label: "fix(QQQQ-51)", type: "link", url: "https://github.com/o/r/pull/2" },
      { text: " | waiting on @reviewer-one", type: "text" },
    ]);
  });

  it("omits the note run for an empty string, the same as no note at all", () => {
    const runs = prLineRuns({ note: "", status: "building", title: "t", url: "https://github.com/o/r/pull/3" });

    expect(runs).toHaveLength(2);
  });

  it("uses the right glyph for every status", () => {
    for (const status of ["ready", "needsAttention", "failing", "building", "merged"] as const) {
      const runs = prLineRuns({ status, title: "t", url: "https://github.com/o/r/pull/4" });
      expect(runs[0]).toEqual({ text: `${PR_LINE_GLYPH[status]} `, type: "text" });
    }
  });
});

describe("prGroupHeading", () => {
  it("renders a bold single-run paragraph", () => {
    expect(prGroupHeading({ label: "E2E shift-left: 10-PR series" })).toEqual({
      runs: [{ bold: true, text: "E2E shift-left: 10-PR series", type: "text" }],
      type: "paragraph",
    });
  });
});

describe("PR_OWNER_GLYPH", () => {
  it("gives every owner its own double-encoded glyph", () => {
    expect(PR_OWNER_GLYPH).toEqual({
      machine: "🟧",
      person: "🔵",
      you: "🟢",
    });
  });
});

describe("ownerGlyphFor", () => {
  it("returns the green circle for you", () => {
    expect(ownerGlyphFor({ owner: "you" })).toBe("🟢");
  });

  it("returns the blue circle for a person", () => {
    expect(ownerGlyphFor({ owner: "person" })).toBe("🔵");
  });

  it("returns the orange square for a machine", () => {
    expect(ownerGlyphFor({ owner: "machine" })).toBe("🟧");
  });
});

describe("distanceBarFor", () => {
  it("fills every square when nothing remains", () => {
    expect(distanceBarFor({ rungsRemaining: 0, rungsTotal: 8 })).toBe("■■■■");
  });

  it("fills no square when the full ladder remains", () => {
    expect(distanceBarFor({ rungsRemaining: 8, rungsTotal: 8 })).toBe("□□□□");
  });

  it("fills half the squares at the halfway rung", () => {
    expect(distanceBarFor({ rungsRemaining: 4, rungsTotal: 8 })).toBe("■■□□");
  });

  it("returns a DISTANCE_BAR_LENGTH-character string for a lopsided ladder", () => {
    expect(distanceBarFor({ rungsRemaining: 1, rungsTotal: 3 })).toHaveLength(DISTANCE_BAR_LENGTH);
  });

  it("clamps remaining above the total to a fully-empty bar", () => {
    expect(distanceBarFor({ rungsRemaining: 99, rungsTotal: 8 })).toBe("□□□□");
  });

  it("clamps a negative remaining to a fully-filled bar", () => {
    expect(distanceBarFor({ rungsRemaining: -3, rungsTotal: 8 })).toBe("■■■■");
  });

  it("treats a zero total as one rung, so any remaining reads as fully empty", () => {
    expect(distanceBarFor({ rungsRemaining: 1, rungsTotal: 0 })).toBe("□□□□");
  });
});
