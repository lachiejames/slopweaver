/**
 * A wrong "complete" marks real entities stale, which looks exactly like a retired record — so the proof is
 * constructed only from evidence, and every reason it was refused is named.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { provenCompleteRead } from "../../../../atlas/kit/completeness.js";

describe("provenCompleteRead", () => {
  it("proves a read that exhausted paging and reached the provider's own total", () => {
    const proof = provenCompleteRead({ kind: "host", observed: 12, pagesExhausted: true, reportedTotal: 12 });

    expect(unwrap(proof)).toEqual({
      kind: "host",
      observed: 12,
      proof: "read 12 host record(s) to the end of paging, matching the 12 the provider reported",
      provenBy: "provenCompleteRead",
    });
  });

  it("states that a provider with no total leaves the proof resting on paging alone", () => {
    const proof = unwrap(provenCompleteRead({ kind: "user", observed: 0, pagesExhausted: true, reportedTotal: null }));

    expect(proof.proof).toBe(
      "read 0 user record(s) to the end of paging, the provider reported no total, so completeness rests on paging alone",
    );
  });

  it("refuses a read that stopped before paging ran out", () => {
    const problems = unwrapErr(
      provenCompleteRead({ kind: "host", observed: 12, pagesExhausted: false, reportedTotal: null }),
    );

    expect(problems).toEqual([
      "the host read stopped before the provider ran out of pages, so entities it did not reach must not be staled",
    ]);
  });

  it("refuses a read that produced fewer than the provider reported, naming both counts", () => {
    const problems = unwrapErr(
      provenCompleteRead({ kind: "host", observed: 11, pagesExhausted: true, reportedTotal: 12 }),
    );

    expect(problems).toEqual(["the host read produced 11 of the 12 the provider reported, so it is incomplete"]);
  });

  it("names BOTH failures when both conditions fail", () => {
    const problems = unwrapErr(
      provenCompleteRead({ kind: "group", observed: 3, pagesExhausted: false, reportedTotal: 9 }),
    );

    expect(problems).toEqual([
      "the group read stopped before the provider ran out of pages, so entities it did not reach must not be staled",
      "the group read produced 3 of the 9 the provider reported, so it is incomplete",
    ]);
  });

  it("accepts more observed than reported, since the total is a floor, and says EXCEEDING rather than matching", () => {
    const proof = unwrap(provenCompleteRead({ kind: "host", observed: 13, pagesExhausted: true, reportedTotal: 12 }));

    expect(proof.proof).toBe(
      "read 13 host record(s) to the end of paging, exceeding the 12 the provider reported, consistent with a record created mid-read",
    );
  });
});
