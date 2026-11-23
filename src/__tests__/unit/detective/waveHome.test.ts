import { describe, expect, it } from "vitest";

import { WAVE_RECORD_FILE, type WaveRoots, waveOutFromFlags, waveRoots } from "../../../detective/waveHome.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ROOTS: WaveRoots = { recordSet: "/fixture/home/live/slack/detectives", unattached: "/fixture/home/detective" };
const NOW_MS = 1_790_000_000_123;
const UNATTACHED_NOTE =
  "this wave is outside any turn's record set, so `turn freeze` will not carry it — " +
  "a bot turn passes --ask <channel>/<messageTs>";

describe("WAVE_RECORD_FILE", () => {
  it("is the literal file name a wave records itself in", () => {
    expect(WAVE_RECORD_FILE).toBe("wave.json");
  });
});

describe("waveRoots", () => {
  it("resolves both roots under an explicit home", () => {
    expect(waveRoots({ home: "/fixture/home" })).toEqual({
      recordSet: "/fixture/home/live/slack/detectives",
      unattached: "/fixture/home/detective",
    });
  });
});

describe("waveOutFromFlags", () => {
  it("returns an explicit --out unchanged with no note", () => {
    const result = waveOutFromFlags({ kind: "store", nowMs: NOW_MS, roots: ROOTS, values: { out: "/scratch/wave" } });
    expect(unwrap(result)).toEqual({ note: null, out: "/scratch/wave" });
  });

  it("lands a store wave with neither flag under the unattached root, named by kind and instant, and says so", () => {
    const result = waveOutFromFlags({ kind: "store", nowMs: NOW_MS, roots: ROOTS, values: {} });
    expect(unwrap(result)).toEqual({ note: UNATTACHED_NOTE, out: "/fixture/home/detective/store-1790000000123" });
  });

  it("names a recall wave with the recall prefix", () => {
    const result = waveOutFromFlags({ kind: "recall", nowMs: NOW_MS, roots: ROOTS, values: {} });
    expect(unwrap(result)).toEqual({ note: UNATTACHED_NOTE, out: "/fixture/home/detective/recall-1790000000123" });
  });

  it("lands an --ask wave inside that ask's record-set directory with no note", () => {
    const result = waveOutFromFlags({
      kind: "recall",
      nowMs: NOW_MS,
      roots: ROOTS,
      values: { ask: "C0123ABC/1790000000.000100" },
    });
    expect(unwrap(result)).toEqual({
      note: null,
      out: "/fixture/home/live/slack/detectives/C0123ABC-1790000000.000100/recall-1790000000123",
    });
  });

  it("refuses --ask together with --out rather than ranking them", () => {
    const result = waveOutFromFlags({
      kind: "store",
      nowMs: NOW_MS,
      roots: ROOTS,
      values: { ask: "C0123ABC/1790000000.000100", out: "/scratch/wave" },
    });
    expect(unwrapErr(result)).toEqual(["--ask and --out name two different places — pass one"]);
  });

  it.each([
    ["a lowercase channel", "c0123abc/1790000000.000100"],
    ["a timestamp with no fractional part", "C0123ABC/1790000000"],
    ["a traversal in the timestamp half", "C1/../../x"],
    ["a traversal in the channel half", "../C1/1790000000.000100"],
    ["no slash at all", "C0123ABC"],
    ["an empty timestamp half", "C0123ABC/"],
  ])("refuses an --ask with %s", (_label, ask) => {
    const result = waveOutFromFlags({ kind: "store", nowMs: NOW_MS, roots: ROOTS, values: { ask } });
    expect(unwrapErr(result)).toEqual([`--ask must read <channel>/<messageTs>, got ${ask}`]);
  });

  it("treats non-string flag values as absent, landing the wave unattached", () => {
    const result = waveOutFromFlags({ kind: "store", nowMs: NOW_MS, roots: ROOTS, values: { ask: true, out: 42 } });
    expect(unwrap(result)).toEqual({ note: UNATTACHED_NOTE, out: "/fixture/home/detective/store-1790000000123" });
  });
});
