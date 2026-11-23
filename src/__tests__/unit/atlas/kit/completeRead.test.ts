/**
 * The provider-named copy of the complete-read proof: the same two conditions as `completeness.ts`, with every
 * sentence in the provider's own name so a coverage reason reads in its vocabulary.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { provenCompleteRead } from "../../../../atlas/kit/completeRead.js";

describe("provenCompleteRead", () => {
  it("proves a read that exhausted paging and matched the provider's total, naming the provider", () => {
    const proof = provenCompleteRead({
      kind: "device",
      observed: 4,
      pagesExhausted: true,
      providerName: "Example",
      reportedTotal: 4,
    });

    expect(unwrap(proof)).toEqual({
      kind: "device",
      observed: 4,
      proof: "read 4 device record(s) to the end of paging, matching the 4 Example reported",
      provenBy: "provenCompleteRead",
    });
  });

  it("says EXCEEDING when the read observed more than the provider reported", () => {
    const proof = unwrap(
      provenCompleteRead({
        kind: "device",
        observed: 5,
        pagesExhausted: true,
        providerName: "Example",
        reportedTotal: 4,
      }),
    );

    expect(proof.proof).toBe(
      "read 5 device record(s) to the end of paging, exceeding the 4 Example reported, consistent with a record created mid-read",
    );
  });

  it("states that a provider reporting no total leaves the proof resting on paging alone", () => {
    const proof = unwrap(
      provenCompleteRead({
        kind: "group",
        observed: 0,
        pagesExhausted: true,
        providerName: "Example",
        reportedTotal: null,
      }),
    );

    expect(proof.proof).toBe(
      "read 0 group record(s) to the end of paging, Example reported no total for this listing, so completeness rests on paging alone",
    );
  });

  it("refuses a read that stopped before the provider ran out of pages", () => {
    const problems = unwrapErr(
      provenCompleteRead({
        kind: "device",
        observed: 4,
        pagesExhausted: false,
        providerName: "Example",
        reportedTotal: null,
      }),
    );

    expect(problems).toEqual([
      "the device read stopped before Example ran out of pages, so entities it did not reach must not be staled",
    ]);
  });

  it("refuses a read that produced fewer than the provider reported", () => {
    const problems = unwrapErr(
      provenCompleteRead({
        kind: "device",
        observed: 3,
        pagesExhausted: true,
        providerName: "Example",
        reportedTotal: 4,
      }),
    );

    expect(problems).toEqual(["the device read produced 3 of the 4 Example reported, so it is incomplete"]);
  });

  it("names both failures, paging first, when both conditions fail", () => {
    const problems = unwrapErr(
      provenCompleteRead({
        kind: "user",
        observed: 1,
        pagesExhausted: false,
        providerName: "Example",
        reportedTotal: 9,
      }),
    );

    expect(problems).toEqual([
      "the user read stopped before Example ran out of pages, so entities it did not reach must not be staled",
      "the user read produced 1 of the 9 Example reported, so it is incomplete",
    ]);
  });
});
