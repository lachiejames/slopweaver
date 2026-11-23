/**
 * `reviewerPickupPrompt`, `reviewPartyName` and `parseReviewRecord` — the one-line prompt a reviewer is
 * handed, how a party is named, and the review record's strict parse. Pure: a literal in, a string or a
 * `Result` out.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseReviewRecord, reviewerPickupPrompt, reviewPartyName } from "../../../../../live/turn/review.js";
import { RECORD, REVIEWER } from "./harness.js";

describe("reviewerPickupPrompt / reviewPartyName", () => {
  it("is one line naming the packet and the verdict path, and says the packet was composed by code", () => {
    const prompt = reviewerPickupPrompt({ packetPath: "/tmp/p.md", verdictPath: "/tmp/v.json" });
    expect(prompt).toContain("Read /tmp/p.md in full");
    expect(prompt).toContain("write your verdict JSON to /tmp/v.json");
    expect(prompt).toContain("composed by code, not by the answer's author");
    expect(prompt).not.toContain("\n");
  });

  it("names a party by role, ref AND id — the id is what survives cmux renumbering", () => {
    expect(reviewPartyName({ role: "reviewer", session: REVIEWER })).toBe(
      "reviewer workspace workspace:9 (id-workspace:9)",
    );
  });
});

describe("parseReviewRecord", () => {
  it("accepts a well-formed record", () => {
    expect(unwrap(parseReviewRecord({ value: RECORD }))).toStrictEqual(RECORD);
  });

  it("refuses a record at another schema version", () => {
    expect(unwrapErr(parseReviewRecord({ value: { ...RECORD, schemaVersion: 3 } })).length).toBeGreaterThan(0);
  });

  it("refuses an unknown extra field", () => {
    expect(unwrapErr(parseReviewRecord({ value: { ...RECORD, reviewed: true } }))).toEqual([
      'Unrecognized key: "reviewed"',
    ]);
  });
});
