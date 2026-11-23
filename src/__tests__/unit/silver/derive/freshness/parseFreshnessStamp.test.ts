/*
 * Reading a stamp back: tolerant of a missing field, which reads as moved or unwitnessed, and strict about the
 * document being a stamp at all.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_WITNESS, parseFreshnessStamp } from "../../../../../silver/derive/freshness.js";
import { UNWITNESSED_REVISION } from "../../../../../silver/derive/stampedRevision.js";

describe("parseFreshnessStamp — tolerant of a missing field, strict about being a stamp", () => {
  it("rejects a document that is not a stamp", () => {
    expect(parseFreshnessStamp({ content: "{}" })).toBe(undefined);
    expect(parseFreshnessStamp({ content: "not json" })).toBe(undefined);
    expect(parseFreshnessStamp({ content: '{"version":2,"derivedAtIso":"x"}' })).toBe(undefined);
  });

  it("defaults a missing per-source witness to zeroes, which read as moved against any real source", () => {
    const stamp = parseFreshnessStamp({ content: '{"version":1,"derivedAtIso":"2026-08-20T00:00:00Z"}' })!;
    expect(stamp.sources.slack).toEqual(EMPTY_WITNESS);
    expect(stamp.overrideRevision).toBe(UNWITNESSED_REVISION);
    expect(stamp.observedAtIso).toBe(null);
  });

  it("keeps an explicit null revision as no row, and reads a malformed one as unwitnessed", () => {
    const head = '{"version":1,"derivedAtIso":"2026-08-20T00:00:00Z","overrideRevision":';
    expect(parseFreshnessStamp({ content: `${head}null}` })!.overrideRevision).toBe(null);
    expect(parseFreshnessStamp({ content: `${head}7}` })!.overrideRevision).toBe(7);
    expect(parseFreshnessStamp({ content: `${head}0}` })!.overrideRevision).toBe(UNWITNESSED_REVISION);
    expect(parseFreshnessStamp({ content: `${head}"3"}` })!.overrideRevision).toBe(UNWITNESSED_REVISION);
  });

  it("carries the observation instant, and reads a non-string one as absent", () => {
    const carried = parseFreshnessStamp({
      content: '{"version":1,"derivedAtIso":"2026-08-20T00:00:00Z","observedAtIso":"2026-08-19T23:59:00Z"}',
    })!;
    expect(carried.observedAtIso).toBe("2026-08-19T23:59:00Z");
    const numeric = parseFreshnessStamp({
      content: '{"version":1,"derivedAtIso":"2026-08-20T00:00:00Z","observedAtIso":12}',
    })!;
    expect(numeric.observedAtIso).toBe(null);
  });
});
