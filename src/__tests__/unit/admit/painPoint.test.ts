/**
 * The pain-point ledger, driven by calling it.
 *
 * `painPointLine` is pure and deterministic (the timestamp is a parameter, never a clock read), so it is
 * asserted with exact JSON. `recordPainPoint`/`readPainPointsText` are the effectful edge, exercised with a
 * real `mkdtempSync` round-trip — genuine fixture I/O, never a shared service, which the testing rules allow.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PainPoint } from "../../../admit/painPoint.js";
import {
  painPointGuidanceLines,
  painPointLine,
  parsePainPoints,
  readPainPointsText,
  recordPainPoint,
} from "../../../admit/painPoint.js";

const POINT: PainPoint = {
  fieldPath: "(whole-message)",
  kind: "voice",
  lane: "as-me",
  reason: 'authored prose matched configured phrase voice rule "blocked phrase"',
  tsIso: "2026-08-07T00:00:00.000Z",
};

describe("painPointLine", () => {
  it("renders one exact JSON object", () => {
    expect(JSON.parse(painPointLine({ point: POINT }))).toEqual({
      fieldPath: "(whole-message)",
      kind: "voice",
      lane: "as-me",
      reason: 'authored prose matched configured phrase voice rule "blocked phrase"',
      schemaVersion: 1,
      tsIso: "2026-08-07T00:00:00.000Z",
    });
  });
});

describe("parsePainPoints", () => {
  it("parses well-formed rows", () => {
    const text = [
      JSON.stringify({ fieldPath: "(whole-message)", kind: "voice", lane: "as-me", reason: "r1", tsIso: "t1" }),
      JSON.stringify({ fieldPath: "(whole-message)", kind: "voice", lane: "as-bot", reason: "r2", tsIso: "t2" }),
    ].join("\n");
    expect(parsePainPoints({ text })).toEqual([
      { fieldPath: "(whole-message)", kind: "voice", lane: "as-me", reason: "r1", tsIso: "t1" },
      { fieldPath: "(whole-message)", kind: "voice", lane: "as-bot", reason: "r2", tsIso: "t2" },
    ]);
  });

  it("skips a malformed line rather than failing the read", () => {
    const text = [
      "{not json",
      "",
      JSON.stringify({ fieldPath: "f", kind: "voice", lane: "as-me", reason: "r", tsIso: "t" }),
    ].join("\n");
    expect(parsePainPoints({ text })).toEqual([
      { fieldPath: "f", kind: "voice", lane: "as-me", reason: "r", tsIso: "t" },
    ]);
  });

  it("skips a row whose kind is not a known pain-point kind", () => {
    const text = JSON.stringify({ fieldPath: "f", kind: "typo", lane: "as-me", reason: "r", tsIso: "t" });
    expect(parsePainPoints({ text })).toEqual([]);
  });

  it("skips a row whose lane is not a known voice lane", () => {
    const text = JSON.stringify({ fieldPath: "f", kind: "voice", lane: "as-anyone", reason: "r", tsIso: "t" });
    expect(parsePainPoints({ text })).toEqual([]);
  });

  it("returns nothing for empty text", () => {
    expect(parsePainPoints({ text: "" })).toEqual([]);
  });
});

describe("recordPainPoint / readPainPointsText", () => {
  it("round-trips: append to a fresh home, then read the same row back", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-painpoint-"));
    recordPainPoint({ home, point: POINT });
    const text = readPainPointsText({ home });
    expect(parsePainPoints({ text })).toEqual([
      { fieldPath: POINT.fieldPath, kind: POINT.kind, lane: POINT.lane, reason: POINT.reason, tsIso: POINT.tsIso },
    ]);
    rmSync(home, { force: true, recursive: true });
  });

  it("appends a second row rather than overwriting the first", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-painpoint-"));
    recordPainPoint({ home, point: POINT });
    recordPainPoint({ home, point: { ...POINT, fieldPath: "lead", tsIso: "2026-08-07T00:01:00.000Z" } });
    const rows = parsePainPoints({ text: readPainPointsText({ home }) });
    expect(rows.length).toBe(2);
    expect(rows[1]!.fieldPath).toBe("lead");
    rmSync(home, { force: true, recursive: true });
  });

  it("returns empty text for a home that has never recorded a pain point", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-painpoint-read-"));
    expect(readPainPointsText({ home })).toBe("");
    rmSync(home, { force: true, recursive: true });
  });
});

describe("painPointGuidanceLines", () => {
  it("renders the newest distinct misses and caps the section", () => {
    const entries = [
      { ...POINT, fieldPath: "old", reason: "old miss", tsIso: "t1" },
      { ...POINT, fieldPath: "repeat", reason: "same miss", tsIso: "t2" },
      { ...POINT, fieldPath: "repeat", reason: "same miss", tsIso: "t3" },
      { ...POINT, fieldPath: "new", reason: "new miss", tsIso: "t4" },
    ];

    expect(painPointGuidanceLines({ entries, limit: 2 })).toEqual([
      "RECENT VOICE PAIN POINTS — avoid repeating these exact misses:",
      "  - new miss (as-me, new)",
      "  - same miss (as-me, repeat)",
    ]);
  });

  it("renders no section when there are no entries or the limit is zero", () => {
    expect(painPointGuidanceLines({ entries: [] })).toEqual([]);
    expect(painPointGuidanceLines({ entries: [POINT], limit: 0 })).toEqual([]);
  });
});

describe("an unwritable ledger must never stop a send", () => {
  it("reports why it could not write instead of throwing", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-painpoint-ro-"));
    // A FILE where the ledgers DIRECTORY must go: mkdir refuses with ENOTDIR on every platform, which is a
    // portable unwritable-home without relying on running as a non-root user.
    writeFileSync(join(home, "ledgers"), "not a directory", "utf8");
    const outcome = recordPainPoint({ home, point: POINT });
    expect(outcome.written).toBe(false);
    expect(outcome.written === false && outcome.why.length > 0).toBe(true);
    rmSync(home, { force: true, recursive: true });
  });
});
