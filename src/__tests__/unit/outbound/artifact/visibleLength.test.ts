import { describe, expect, it } from "vitest";

import type { Citation, DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import {
  visibleLengthOfDetail,
  visibleLengthOfDetailBlock,
  visibleLengthOfRun,
  visibleLengthOfRuns,
} from "../../../../outbound/artifact/visibleLength.js";

const CITATIONS: readonly Citation[] = [{ id: "c1", label: "[1]", url: "https://example.invalid/a" }];

describe("visibleLengthOfRun", () => {
  it("counts a text run's characters", () => {
    const run: InlineRun = { text: "twelve chars", type: "text" };

    expect(visibleLengthOfRun({ citations: [], run })).toBe(12);
  });

  it("counts ONLY a link's label, never its URL — a long URL must not eat the budget", () => {
    const run: InlineRun = {
      label: "Draft PR",
      type: "link",
      url: "https://example.invalid/a/very/long/path/that/nobody/ever/reads?with=query&more=params",
    };

    expect(visibleLengthOfRun({ citations: [], run })).toBe(8);
  });

  it("counts a user group as its handle plus the @", () => {
    const run: InlineRun = { handle: "engineers", type: "group" };
    expect(visibleLengthOfRun({ citations: [], run })).toBe(10);
  });

  it("counts a mention as its handle plus the @", () => {
    const run: InlineRun = { person: "ada", type: "mention" };

    expect(visibleLengthOfRun({ citations: [], run })).toBe(4);
  });

  it("counts a broadcast as @here / @channel", () => {
    expect(visibleLengthOfRun({ citations: [], run: { range: "here", type: "broadcast" } })).toBe(5);
    expect(visibleLengthOfRun({ citations: [], run: { range: "channel", type: "broadcast" } })).toBe(8);
  });

  it("counts a citation chip as the width of its [n] label", () => {
    const run: InlineRun = { citationId: "c1", type: "citation" };

    expect(visibleLengthOfRun({ citations: CITATIONS, run })).toBe(3);
  });

  it("counts an unknown citation as zero rather than throwing — the schema reports it instead", () => {
    const run: InlineRun = { citationId: "missing", type: "citation" };

    expect(visibleLengthOfRun({ citations: CITATIONS, run })).toBe(0);
  });
});

describe("visibleLengthOfRuns", () => {
  it("sums a mixed sequence", () => {
    const runs: InlineRun[] = [
      { text: "see ", type: "text" },
      { label: "the PR", type: "link", url: "https://example.invalid/very/long/url/indeed" },
      { text: " ", type: "text" },
      { citationId: "c1", type: "citation" },
    ];

    expect(visibleLengthOfRuns({ citations: CITATIONS, runs })).toBe(14);
  });

  it("is zero for an empty sequence", () => {
    expect(visibleLengthOfRuns({ citations: [], runs: [] })).toBe(0);
  });
});

describe("visibleLengthOfDetailBlock", () => {
  it("counts a paragraph's runs", () => {
    const block: DetailBlock = { runs: [{ text: "abcde", type: "text" }], type: "paragraph" };

    expect(visibleLengthOfDetailBlock({ block, citations: [] })).toBe(5);
  });

  it("sums every bullet item", () => {
    const block: DetailBlock = {
      items: [[{ text: "abc", type: "text" }], [{ text: "de", type: "text" }]],
      type: "bullets",
    };

    expect(visibleLengthOfDetailBlock({ block, citations: [] })).toBe(5);
  });

  it("counts a TABLE as zero prose — it is bounded structurally, not by characters", () => {
    const block: DetailBlock = {
      columns: ["a really quite long column heading"],
      rows: [[[{ text: "a long cell value that would otherwise blow a prose budget", type: "text" }]]],
      type: "table",
    };

    expect(visibleLengthOfDetailBlock({ block, citations: [] })).toBe(0);
  });
});

describe("visibleLengthOfDetail", () => {
  it("sums prose across sub-blocks while ignoring tables entirely", () => {
    const detail: DetailBlock[] = [
      { runs: [{ text: "1234567890", type: "text" }], type: "paragraph" },
      { columns: ["x"], rows: [[[{ text: "ignored entirely", type: "text" }]]], type: "table" },
      { items: [[{ text: "12345", type: "text" }]], type: "bullets" },
    ];

    expect(visibleLengthOfDetail({ citations: [], detail })).toBe(15);
  });

  it("is zero for an empty detail sequence", () => {
    expect(visibleLengthOfDetail({ citations: [], detail: [] })).toBe(0);
  });
});
