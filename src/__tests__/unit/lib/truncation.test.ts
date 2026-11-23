import { describe, expect, it } from "vitest";
import { truncationAtCap, truncationLine, truncationLines } from "../../../lib/truncation.js";

describe("truncationAtCap (pure)", () => {
  it("counts nothing truncated when every record fits", () => {
    expect(truncationAtCap({ cap: 100, lengths: [1, 50, 99] })).toStrictEqual({
      cap: 100,
      droppedChars: 0,
      keptChars: 150,
      longest: 99,
      measured: 3,
      truncated: 0,
    });
  });

  it("treats a length EQUAL to the cap as kept — the boundary a slice(0, cap) keeps whole", () => {
    expect(truncationAtCap({ cap: 100, lengths: [100] })).toStrictEqual({
      cap: 100,
      droppedChars: 0,
      keptChars: 100,
      longest: 100,
      measured: 1,
      truncated: 0,
    });
  });

  it("counts one char lost at cap + 1", () => {
    expect(truncationAtCap({ cap: 100, lengths: [101] })).toStrictEqual({
      cap: 100,
      droppedChars: 1,
      keptChars: 100,
      longest: 101,
      measured: 1,
      truncated: 1,
    });
  });

  it("keeps kept + dropped equal to the total offered, so the cut reads as a share of the whole", () => {
    const cut = truncationAtCap({ cap: 1_200, lengths: [400, 5_000, 1_200, 40_000] });
    expect(cut.keptChars + cut.droppedChars).toBe(46_600);
    expect(cut).toStrictEqual({
      cap: 1_200,
      droppedChars: 3_800 + 38_800,
      keptChars: 400 + 1_200 + 1_200 + 1_200,
      longest: 40_000,
      measured: 4,
      truncated: 2,
    });
  });

  it("reports the tail, not the mean — one huge record dominates a set of tiny ones", () => {
    // The measured shape of the real corpus: few records exceed the cap, and they carry most of the loss.
    const cut = truncationAtCap({ cap: 2_048, lengths: [...Array.from({ length: 99 }, () => 100), 101_563] });
    expect(cut.truncated).toBe(1);
    expect(cut.longest).toBe(101_563);
    expect(cut.droppedChars).toBe(99_515);
    expect(cut.keptChars).toBe(9_900 + 2_048);
  });

  it("yields all-zero counts for no records, so `nothing measured` stays tellable from `nothing truncated`", () => {
    expect(truncationAtCap({ cap: 1_200, lengths: [] })).toStrictEqual({
      cap: 1_200,
      droppedChars: 0,
      keptChars: 0,
      longest: 0,
      measured: 0,
      truncated: 0,
    });
  });
});

describe("truncationLine (pure)", () => {
  it("renders the counts, the share, and the longest record", () => {
    expect(
      truncationLine({
        label: "the answer prompt",
        truncation: truncationAtCap({ cap: 1_200, lengths: [1_000, 5_000, 41_200] }),
      }),
    ).toBe(
      "truncated: the answer prompt cut 2 of 3 record(s) at 1,200 chars — 43,800 of 47,200 char(s) (92.8%) never reached it; longest record 41,200 chars",
    );
  });

  it("returns undefined when the cap truncated nothing — a clean cap is not news", () => {
    expect(
      truncationLine({ label: "the answer prompt", truncation: truncationAtCap({ cap: 1_200, lengths: [10, 1_200] }) }),
    ).toBe(undefined);
  });

  it("returns undefined for an empty measurement", () => {
    expect(truncationLine({ label: "x", truncation: truncationAtCap({ cap: 1_200, lengths: [] }) })).toBe(undefined);
  });
});

describe("truncationLines (pure)", () => {
  it("keeps entry order and drops both the clean caps and the ones that never ran", () => {
    const lines = truncationLines({
      entries: [
        { label: "first", truncation: truncationAtCap({ cap: 10, lengths: [30] }) },
        { label: "never ran", truncation: undefined },
        { label: "clean", truncation: truncationAtCap({ cap: 10, lengths: [5] }) },
        { label: "second", truncation: truncationAtCap({ cap: 10, lengths: [12] }) },
      ],
    });
    expect(lines.map((line) => line.split(" ")[1])).toStrictEqual(["first", "second"]);
    expect(lines).toHaveLength(2);
  });

  it("is empty when nothing truncated anything", () => {
    expect(
      truncationLines({ entries: [{ label: "a", truncation: truncationAtCap({ cap: 10, lengths: [1] }) }] }),
    ).toStrictEqual([]);
  });
});
