/*
 * The round trip an export owes a restore: `parseExportedLine` reads back every field an export writes, for a
 * lesson, a preference and a trace, and refuses a malformed line as a corrupt row naming its line.
 */
import { describe, expect, it } from "vitest";

import { parseExportedLine } from "../../../../knowledge/restore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { DIGEST } from "./harness.js";

describe("parseExportedLine", () => {
  it("round-trips every field an export writes", () => {
    const exported = {
      behaviourChange: null,
      createdAt: "2026-09-12T11:00:00.000Z",
      caveat: "a span metric never backtests",
      claim: "APM adaptive sampling sits upstream of retention filters",
      domain: "datadog",
      evidence: "0 of 412 traces over 7d",
      id: "l-0000000000009003",
      importKey: `${DIGEST}:0000000042`,
      kind: "lesson",
      learner: null,
      recordedAt: "2026-09-07T22:23:24.368Z",
      recordingId: "a0000075-0000-4000-8000-000000000081",
      repro: "slopweaver datadog probe --from 7d",
      retrievalCue: null,
      run: "owner-steer-6-sep",
      seq: 7,
      surface: "api",
      tier: 2,
      verdict: "confirmed",
    };
    const row = unwrap(parseExportedLine({ line: JSON.stringify(exported), lineNumber: 1 }));
    expect(row.recordingId).toBe("a0000075-0000-4000-8000-000000000081");
    expect(row.id).toBe("l-0000000000009003");
    expect(row.tier).toBe(2);
    expect(row.surface).toBe("api");
    expect(row.learner).toBe(null);
    expect(row.importKey).toBe(`${DIGEST}:0000000042`);
    expect(row.recordedAt?.toISOString()).toBe("2026-09-07T22:23:24.368Z");
    // Dropping this let a bulk restore give every row the same `now()`, collapsing the
    // tie-break that keeps a newer refutation above an older confirmation.
    expect(row.createdAt?.toISOString()).toBe("2026-09-12T11:00:00.000Z");
    // Every timestamp collapses at some precision, so `seq` is what recall orders by
    // and a round trip that regenerated it would still reorder two recordings of one claim.
    expect(row.seq).toBe(7);
  });

  it("refuses a line with no createdAt, rather than letting the restore default it", () => {
    const parsed = parseExportedLine({
      line: JSON.stringify({
        claim: "c",
        domain: "d",
        evidence: "e",
        id: "l-1",
        kind: "lesson",
        recordedAt: "2026-09-12T10:00:00.000Z",
        recordingId: "r",
        run: "ad-hoc",
        // `seq` supplied so this fixture fails on the titled MISSING createdAt, not on both ordering
        // fields being absent at once.
        seq: 1,
        surface: "api",
        tier: 2,
        verdict: "confirmed",
      }),
      lineNumber: 8,
    });
    const error = unwrapErr(parsed);
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toBe("line 8 of the register is not a decodable lesson row");
  });

  it("restores a preference with every lesson facet null", () => {
    const row = unwrap(
      parseExportedLine({
        line: JSON.stringify({
          behaviourChange: "route through the supervisor",
          caveat: null,
          createdAt: "2026-09-12T11:00:00.000Z",
          claim: "The owner only speaks to the pinned supervisor chat",
          domain: "ways-of-working",
          evidence: "owner turn 240-14",
          id: "p-abc",
          importKey: null,
          kind: "preference",
          learner: "owner",
          recordedAt: "2026-09-12T10:00:00.000Z",
          recordingId: "22222222-2222-3333-4444-555555555555",
          repro: null,
          retrievalCue: "any task about reaching the owner",
          run: "ad-hoc",
          seq: 8,
          surface: null,
          tier: null,
          verdict: "confirmed",
        }),
        lineNumber: 1,
      }),
    );
    expect(row.kind).toBe("preference");
    expect(row.tier).toBe(null);
    expect(row.surface).toBe(null);
  });

  it("reads an export written before the trace columns existed as NULL in both", () => {
    const row = unwrap(
      parseExportedLine({
        line: JSON.stringify({
          behaviourChange: null,
          caveat: null,
          claim: "c",
          createdAt: "2026-09-12T11:00:00.000Z",
          domain: "datadog",
          evidence: "e",
          id: "l-1",
          importKey: null,
          kind: "lesson",
          learner: null,
          recordedAt: "2026-09-12T10:00:00.000Z",
          recordingId: "44444444-2222-3333-4444-555555555555",
          repro: null,
          retrievalCue: null,
          run: "ad-hoc",
          seq: 9,
          surface: "api",
          tier: 2,
          verdict: "confirmed",
        }),
        lineNumber: 1,
      }),
    );
    expect([row.question, row.outcome]).toEqual([null, null]);
  });

  it("restores a trace with its question, probe and outcome", () => {
    const row = unwrap(
      parseExportedLine({
        line: JSON.stringify({
          behaviourChange: "still run this leg",
          caveat: "Linear only",
          claim: "slopweaver store probe k6 — for: why did it exhaust",
          createdAt: "2026-09-16T11:00:00.000Z",
          domain: "store-detective",
          evidence: "exact 0",
          id: "t-abc",
          importKey: null,
          kind: "trace",
          learner: "fleet",
          outcome: "empty",
          question: "why did it exhaust",
          recordedAt: "2026-09-16T10:00:00.000Z",
          recordingId: "55555555-2222-3333-4444-555555555555",
          repro: "slopweaver store probe k6",
          retrievalCue: "why did it exhaust",
          run: "ad-hoc",
          seq: 10,
          surface: null,
          tier: null,
          verdict: "confirmed",
        }),
        lineNumber: 1,
      }),
    );
    expect([row.kind, row.question, row.outcome, row.repro]).toEqual([
      "trace",
      "why did it exhaust",
      "empty",
      "slopweaver store probe k6",
    ]);
  });

  it("refuses a line whose trace outcome is outside the vocabulary", () => {
    const parsed = parseExportedLine({
      line: JSON.stringify({
        claim: "c",
        createdAt: "2026-09-16T11:00:00.000Z",
        domain: "d",
        evidence: "e",
        id: "t-1",
        kind: "trace",
        outcome: "maybe",
        question: "q",
        recordedAt: "2026-09-16T10:00:00.000Z",
        recordingId: "r",
        repro: "p",
        run: "ad-hoc",
        seq: 11,
        surface: null,
        tier: null,
        verdict: "confirmed",
      }),
      lineNumber: 5,
    });
    expect(unwrapErr(parsed).code).toBe("CORRUPT_ROW");
  });

  /** A complete exported recording, overridden per malformed-field case below. */
  const exportedRow = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      behaviourChange: null,
      caveat: null,
      claim: "c",
      createdAt: "2026-09-12T11:00:00.000Z",
      domain: "datadog",
      evidence: "e",
      id: "l-1",
      importKey: null,
      kind: "lesson",
      learner: "fleet",
      recordedAt: "2026-09-12T10:00:00.000Z",
      recordingId: "88888888-2222-3333-4444-555555555555",
      repro: null,
      retrievalCue: null,
      run: "ad-hoc",
      seq: 12,
      surface: "api",
      tier: 2,
      ...over,
    });

  it("refuses a line whose surface is neither a valid surface nor null", () => {
    expect(unwrapErr(parseExportedLine({ line: exportedRow({ surface: "carrier-pigeon" }), lineNumber: 9 })).code).toBe(
      "CORRUPT_ROW",
    );
  });

  it("refuses a line whose learner is a number rather than text or null", () => {
    expect(unwrapErr(parseExportedLine({ line: exportedRow({ learner: 7 }), lineNumber: 10 })).code).toBe(
      "CORRUPT_ROW",
    );
  });

  it("refuses a line whose seq is not a whole number, which is what orders two recordings", () => {
    expect(unwrapErr(parseExportedLine({ line: exportedRow({ seq: 1.5 }), lineNumber: 11 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a line whose recordedAt cannot be parsed", () => {
    expect(unwrapErr(parseExportedLine({ line: exportedRow({ recordedAt: "yesterday" }), lineNumber: 12 })).code).toBe(
      "CORRUPT_ROW",
    );
  });

  it("refuses a line that decodes to something other than an object", () => {
    expect(unwrapErr(parseExportedLine({ line: '"just a string"', lineNumber: 13 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a line that is not JSON, naming it", () => {
    const parsed = parseExportedLine({ line: "{ not json", lineNumber: 12 });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toBe("line 12 of the register is not a decodable lesson row");
  });

  it("refuses a line whose verdict is outside the vocabulary", () => {
    const parsed = parseExportedLine({
      line: JSON.stringify({
        claim: "c",
        domain: "d",
        evidence: "e",
        id: "l-1",
        kind: "lesson",
        recordedAt: "2026-09-12T10:00:00.000Z",
        recordingId: "r",
        run: "ad-hoc",
        verdict: "probably",
      }),
      lineNumber: 3,
    });
    const error = unwrapErr(parsed);
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toBe("line 3 of the register is not a decodable lesson row");
  });

  it("refuses a line whose tier is neither a valid tier nor null", () => {
    const parsed = parseExportedLine({
      line: JSON.stringify({
        claim: "c",
        // `createdAt`/`seq` supplied so parsing reaches the tier check itself, rather than refusing
        // earlier on the ordering fields being absent.
        createdAt: "2026-09-12T11:00:00.000Z",
        domain: "d",
        evidence: "e",
        id: "l-1",
        kind: "lesson",
        recordedAt: "2026-09-12T10:00:00.000Z",
        recordingId: "r",
        run: "ad-hoc",
        seq: 1,
        tier: 9,
        verdict: "confirmed",
      }),
      lineNumber: 5,
    });
    const error = unwrapErr(parsed);
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toBe("line 5 of the register is not a decodable lesson row");
  });
});
