/*
 * The words and tone a landing row's CI draws in. The property: a red rollup always says what it is red on,
 * and a requirement the read could not establish is drawn as unknown — never as advisory, and never softened.
 */

import { describe, expect, it } from "vitest";

import type { LandingCiFailure } from "../../components/live/readLanding";
import { checkRequirementWord, landingCiTone, landingCiWord } from "../../lib/landingCi";

const REQUIRED: LandingCiFailure = { kind: "red", required: true };
const ADVISORY: LandingCiFailure = { kind: "red", required: false };
const UNKNOWN: LandingCiFailure = { kind: "red", required: undefined };
const NOT_RED: LandingCiFailure = { kind: "not-red" };

describe("landingCiWord", () => {
  it("qualifies a red rollup as required, advisory or requirement unknown", () => {
    const words = [REQUIRED, ADVISORY, UNKNOWN].map((ciFailure) => landingCiWord({ row: { ci: "red", ciFailure } }));
    expect(words).toStrictEqual(["red · required", "red · advisory", "red · requirement unknown"]);
  });

  it("keeps the verb's own word on a rollup that is not red", () => {
    const words = ["green", "running", "none"].map((ci) => landingCiWord({ row: { ci, ciFailure: NOT_RED } }));
    expect(words).toStrictEqual(["green", "running", "none"]);
  });
});

describe("checkRequirementWord", () => {
  it("names each check's requirement, unknown included", () => {
    const words = [true, false, undefined].map((required) => checkRequirementWord({ required }));
    expect(words).toStrictEqual(["required", "advisory", "requirement unknown"]);
  });
});

describe("landingCiTone", () => {
  it("draws required and unknown red as danger, and only an advisory-only red as warning", () => {
    const tones = [REQUIRED, UNKNOWN, ADVISORY].map((ciFailure) => landingCiTone({ ci: "red", ciFailure }));
    expect(tones).toStrictEqual(["danger", "danger", "warning"]);
  });

  it("draws a rollup that is not red in the verb word's own tone", () => {
    const tones = ["green", "running", "queued"].map((ci) => landingCiTone({ ci, ciFailure: NOT_RED }));
    expect(tones).toStrictEqual(["success", "warning", "info"]);
  });
});
