/**
 * The strict decoder every supersession record passes, on its way out of the old file and out of the store:
 * each refusal names the defect, so a corrupt retirement is never read as an absent one.
 */
import { describe, expect, it } from "vitest";

import { decodeSupersession } from "../../../codex/supersessionPort.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const WORDING = {
  artifactId: "a",
  atIso: "2026-09-30T02:00:00.000Z",
  propertyId: "r1-01",
  reason: "the wording cannot be satisfied",
  replacedBy: "b",
};

const NO_TREE = {
  artifactId: "b44980e5",
  atIso: "2026-09-30T03:00:00.000Z",
  branch: "feature",
  kind: "no-tree",
  mode: "plan",
  pass: "p2",
  reason: "re-planned",
  replacedBy: "224c5d1c",
};

describe("decodeSupersession", () => {
  it("reads a wording row written before kinds existed, without inventing a kind", () => {
    expect(unwrap(decodeSupersession({ value: WORDING }))).toEqual(WORDING);
  });

  it("reads an explicit wording kind as the same row, its kind dropped", () => {
    expect(unwrap(decodeSupersession({ value: { ...WORDING, kind: "wording" } }))).toEqual(WORDING);
  });

  it("refuses a value that is not an object", () => {
    expect(unwrapErr(decodeSupersession({ value: "a" })).code).toBe("SUPERSESSION_NOT_AN_OBJECT");
  });

  it("refuses a row with an empty artifact id, naming that field", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...WORDING, artifactId: "" } })).message).toBe(
      "carries no artifactId",
    );
  });

  it("refuses an artifact id no pass can carry, so an exact lookup never reads a corrupt row as no retirement", () => {
    const refused = unwrapErr(decodeSupersession({ value: { ...WORDING, artifactId: "abc123 " } }));
    expect(refused.code).toBe("SUPERSESSION_FIELD_INVALID");
    expect(refused.message).toBe('carries an artifactId "abc123 " no pass can have');
  });

  it("refuses an artifact id that is a path rather than a bare name", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...WORDING, artifactId: "../abc123" } })).message).toBe(
      'carries an artifactId "../abc123" no pass can have',
    );
  });

  it("refuses a retirement dated on a day the month does not have, which Date.parse would quietly roll into the next month", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...WORDING, atIso: "2026-02-30T00:00:00.000Z" } })).message).toBe(
      "is missing its reason, replacedBy or atIso",
    );
  });

  it("refuses a row whose replacement is not a string", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...WORDING, replacedBy: 7 } })).message).toBe(
      "is missing its reason, replacedBy or atIso",
    );
  });

  it("refuses an unknown kind, quoting it", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...WORDING, kind: "other" } })).message).toBe(
      'carries an unknown kind "other"',
    );
  });

  it("refuses a wording row with no property id", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...WORDING, propertyId: undefined } })).message).toBe(
      "is a wording retirement with no propertyId",
    );
  });

  it("refuses a wording row carrying a no-tree field", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...WORDING, branch: "feature" } })).code).toBe(
      "SUPERSESSION_FIELD_FORBIDDEN",
    );
  });

  it("refuses a no-tree row whose branch only renders blank", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...NO_TREE, branch: "⠀" } })).message).toBe(
      "is a no-tree retirement missing its pass, mode or branch",
    );
  });

  it("refuses a no-tree row with an unknown mode", () => {
    expect(unwrapErr(decodeSupersession({ value: { ...NO_TREE, mode: "draft" } })).message).toBe(
      "is a no-tree retirement missing its pass, mode or branch",
    );
  });
});
