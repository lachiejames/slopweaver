/**
 * The weekly value sample's pure half: which asks are eligible, how five are drawn, and how each one's cost is joined
 * through the seat that ran it. Synthetic rows, seats and transcripts only.
 */
import { describe, expect, it } from "vitest";

import type { TranscriptSpend } from "../../../sessions/spendFold.js";
import {
  askCostOf,
  type BoardAskRow,
  drawSample,
  SAMPLE_SIZE,
  type SettledAsk,
  settledAsksOf,
} from "../../../value/sample.js";

const NOW = "2026-11-23T00:00:00.000Z";

/** One board row, an ask answered a day before {@link NOW} unless overridden. */
const row = (over: Partial<BoardAskRow> = {}): BoardAskRow => ({
  artifact: undefined,
  kind: "ask",
  prUrls: [],
  settledIso: "2026-11-22T00:00:00.000Z",
  settlement: "answered",
  settlementWitness: "https://acme.slack.com/archives/C0FIXTURE/p1",
  slug: "acme-ask",
  summary: "Export the widget report",
  ...over,
});

/** One settled ask, filed into a doc. */
const ask = (over: Partial<SettledAsk> = {}): SettledAsk => ({
  artifact: undefined,
  prUrls: [],
  settledIso: "2026-11-22T00:00:00.000Z",
  settlement: "filed",
  slug: "acme-ask",
  summary: "Export the widget report",
  witness: "acme-doc",
  ...over,
});

/** One transcript run in `cwd`: 100 fresh input and 10 output tokens on Sonnet 5, worth 150 units. */
const transcript = ({ cwd }: { cwd: string }): TranscriptSpend => ({
  contextFloor: null,
  cwd,
  path: `${cwd}/t.jsonl`,
  refusals: { other: 0, "poll-gate": 0, python: 0, "raw-side-effect": 0, "shell-script": 0, "whole-tree": 0 },
  seat: "handover-seat",
  unreadable: 0,
  usage: [
    {
      day: "2026-11-22",
      model: "claude-sonnet-5-20260101",
      totals: { cacheCreationTokens: 0, cacheReadTokens: 0, inputTokens: 100, outputTokens: 10, turns: 2 },
    },
  ],
});

describe("settledAsksOf", () => {
  it("keeps an ask filed or answered inside the seven days, carrying its witness and summary", () => {
    const asks = settledAsksOf({
      nowIso: NOW,
      rows: [row(), row({ settlement: "filed", settlementWitness: "acme-doc", slug: "acme-filed" })],
    });
    expect(asks).toEqual([
      {
        artifact: undefined,
        prUrls: [],
        settledIso: "2026-11-22T00:00:00.000Z",
        settlement: "answered",
        slug: "acme-ask",
        summary: "Export the widget report",
        witness: "https://acme.slack.com/archives/C0FIXTURE/p1",
      },
      {
        artifact: undefined,
        prUrls: [],
        settledIso: "2026-11-22T00:00:00.000Z",
        settlement: "filed",
        slug: "acme-filed",
        summary: "Export the widget report",
        witness: "acme-doc",
      },
    ]);
  });

  it("leaves out a declined, open, undated, out-of-window, future or non-ask row", () => {
    const asks = settledAsksOf({
      nowIso: NOW,
      rows: [
        row({ settlement: "declined", slug: "declined" }),
        row({ settlement: undefined, slug: "open" }),
        row({ settledIso: undefined, slug: "undated" }),
        row({ settledIso: "2026-11-15T23:59:59.000Z", slug: "too-old" }),
        row({ settledIso: "2026-11-23T00:00:01.000Z", slug: "future" }),
        row({ kind: "doc", slug: "a-doc" }),
        row({ settledIso: "not a date", slug: "garbled" }),
      ],
    });
    expect(asks).toEqual([]);
  });

  it("keeps an ask settled exactly seven days back, the window's edge", () => {
    const asks = settledAsksOf({ nowIso: NOW, rows: [row({ settledIso: "2026-11-16T00:00:00.000Z" })] });
    expect(asks.map((kept) => kept.slug)).toEqual(["acme-ask"]);
  });

  it("names an ask by its slug when its summary is blank", () => {
    const asks = settledAsksOf({ nowIso: NOW, rows: [row({ summary: "  " }), row({ slug: "b", summary: undefined })] });
    expect(asks.map((kept) => kept.summary)).toEqual(["acme-ask", "b"]);
  });
});

describe("drawSample", () => {
  const seven = ["a", "b", "c", "d", "e", "f", "g"].map((slug) => ask({ slug }));

  it("draws five of seven, each one from the eligible set", () => {
    const drawn = drawSample({ asks: seven, week: "2026-W48" });
    expect(drawn.length).toBe(SAMPLE_SIZE);
    expect(drawn.filter((picked) => !seven.includes(picked))).toEqual([]);
  });

  it("draws the same five in the same order whatever order the board listed them in", () => {
    const forward = drawSample({ asks: seven, week: "2026-W48" }).map((picked) => picked.slug);
    const reversed = drawSample({ asks: seven.toReversed(), week: "2026-W48" }).map((picked) => picked.slug);
    expect(reversed).toEqual(forward);
  });

  it("draws every ask when fewer than five ended, and none from none", () => {
    expect(drawSample({ asks: seven.slice(0, 2), week: "2026-W48" }).length).toBe(2);
    expect(drawSample({ asks: [], week: "2026-W48" })).toEqual([]);
  });
});

describe("askCostOf", () => {
  it("joins a filed ask's doc seat by its working directory, a subdirectory included", () => {
    const cost = askCostOf({
      ask: ask(),
      spawns: [{ cwd: "/w/acme-doc", slug: "acme-doc" }],
      transcripts: [transcript({ cwd: "/w/acme-doc" }), transcript({ cwd: "/w/acme-doc/sub" })],
    });
    expect(cost).toEqual({ known: true, value: { coveredTurns: 4, totalTurns: 4, transcripts: 2, units: 300 } });
  });

  it("never joins a sibling directory that only shares the seat's prefix", () => {
    const cost = askCostOf({
      ask: ask(),
      spawns: [{ cwd: "/w/acme-doc", slug: "acme-doc" }],
      transcripts: [transcript({ cwd: "/w/acme-doc2" }), transcript({ cwd: "/w/acme-doc" })],
    });
    expect(cost).toEqual({ known: true, value: { coveredTurns: 2, totalTurns: 2, transcripts: 1, units: 150 } });
  });

  it("says an ask with no seat of its own is not measured, never a zero", () => {
    const cost = askCostOf({
      ask: ask({ settlement: "answered", witness: "https://acme.slack.com/archives/C0FIXTURE/p1" }),
      spawns: [{ cwd: "/w/acme-doc", slug: "acme-doc" }],
      transcripts: [transcript({ cwd: "/w/acme-doc" })],
    });
    expect(cost).toEqual({ known: false, why: "no seat was spawned for it, so no transcript is joined to it" });
  });

  it("says a seat whose transcripts were not read is not measured", () => {
    const cost = askCostOf({
      ask: ask(),
      spawns: [{ cwd: "/w/acme-ask", slug: "acme-ask" }],
      transcripts: [transcript({ cwd: "/w/elsewhere" })],
    });
    expect(cost).toEqual({ known: false, why: "its seat's transcripts were not among those read for the window" });
  });

  it("ignores a spawn that recorded no working directory", () => {
    const cost = askCostOf({
      ask: ask(),
      spawns: [{ cwd: "", slug: "acme-ask" }],
      transcripts: [transcript({ cwd: "" })],
    });
    expect(cost).toEqual({ known: false, why: "no seat was spawned for it, so no transcript is joined to it" });
  });
});
