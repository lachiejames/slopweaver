/*
 * No session check recorded yet is an answer, never a failed read: on a fresh install `reading last --producer
 * "session watch"` exits 3, `NO_READING`, and the Fleet page draws its designed empty state over it (every empty page
 * gets one). The runner half (exit 3 becomes a typed payload) and the reader half (that payload
 * becomes the not-recorded arm) are both here.
 */
import { describe, expect, it } from "vitest";

import { isReadingNotRecorded, type RecordedReading, readingOrNotRecordedOf } from "../../components/live/reading";
import { liveResultOf } from "../../lib/liveVerbRun";
import { type LiveVerb, liveVerbFor } from "../../lib/liveVerbs";

const ROW: LiveVerb = liveVerbFor({ slug: "watch-reading" })!;
const AT = "2026-11-04T00:00:00.000Z";
const SENTENCE = 'slopweaver reading last --producer "session watch" --json exited 3: no reading yet for session watch';
const PAYLOAD = { code: "NO_READING", kind: "expected-empty", why: SENTENCE };
const RECORDED = {
  by: "tick-12",
  document: "acme",
  observedAtIso: AT,
  readingId: "r-1",
  recordedAtIso: AT,
};

/**
 * Read a payload whose document is a plain string, standing in for any producer's document reader.
 *
 * @returns the reading, or `undefined`
 */
function read({ payload }: { payload: unknown }): RecordedReading<string> | undefined {
  return readingOrNotRecordedOf({
    payload,
    read: (document) => (typeof document === "string" ? document : undefined),
  });
}

describe("the watch-reading allowlist row", () => {
  it("declares exit 3 as NO_READING", () => {
    expect(ROW.expectedEmpty).toEqual({ code: "NO_READING", exitCode: 3 });
  });

  it("answers exit 3 with a typed expected-empty payload carrying the verb's sentence", () => {
    const result = liveResultOf({
      outcome: { err: "", exitCode: 3, notMeasured: SENTENCE, ok: false, out: "", tookMs: 120 },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({ observedAtIso: AT, ok: true, payload: PAYLOAD, stampedByRoute: true });
  });

  it("keeps exit 1 a failure: an unreadable ledger is a fault, not an empty one", () => {
    const result = liveResultOf({
      outcome: { err: "", exitCode: 1, notMeasured: "reading last exited 1", ok: false, out: "", tookMs: 5 },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({ notMeasured: "reading last exited 1", observedAtIso: AT, ok: false });
  });
});

describe("readingOrNotRecordedOf", () => {
  it("reads the NO_READING payload as the not-recorded arm, with the verb's sentence", () => {
    expect(read({ payload: PAYLOAD })).toEqual({ kind: "not-recorded", why: SENTENCE });
  });

  it("refuses an expected-empty payload naming another code, carrying no sentence, or any extra key", () => {
    expect([
      read({ payload: { ...PAYLOAD, code: "NO_WORKSTREAMS" } }),
      read({ payload: { code: "NO_READING", kind: "expected-empty" } }),
      read({ payload: { ...PAYLOAD, readingId: "r-1" } }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads a recorded envelope through the producer's reader, never as not recorded", () => {
    expect(read({ payload: RECORDED })).toEqual({
      by: "tick-12",
      observedAtIso: AT,
      readingId: "r-1",
      recordedAtIso: AT,
      value: "acme",
    });
  });
});

describe("isReadingNotRecorded", () => {
  it("tells the not-recorded arm from a recorded reading", () => {
    expect([
      isReadingNotRecorded({ kind: "not-recorded", why: SENTENCE }),
      isReadingNotRecorded({ by: "tick-12", observedAtIso: AT, readingId: "r-1", recordedAtIso: AT, value: "acme" }),
    ]).toEqual([true, false]);
  });
});
