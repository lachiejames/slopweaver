import { describe, expect, it } from "vitest";

import { topupMergeGate } from "../../../../review/vulnTopupGate.js";
import { member, ONE_OF_THREE } from "../../../vulnTopupFixture.js";

describe("topupMergeGate", () => {
  it("is disabled at 0%, reading no previous batch even when there is one", () => {
    expect(topupMergeGate({ previousSlug: "g", readings: ONE_OF_THREE, releaseAfterMergedPercent: 0 })).toEqual({
      kind: "disabled",
      releaseAfterMergedPercent: 0,
    });
  });

  it("answers first-batch when there has never been a previous generation", () => {
    expect(topupMergeGate({ previousSlug: undefined, readings: [], releaseAfterMergedPercent: 50 })).toEqual({
      kind: "first-batch",
    });
  });

  it("allows when nothing was raised, so a dead generation never stops the recipe", () => {
    const readings = [member({ hasOpenPr: false, number: 1, state: "open" })];

    expect(topupMergeGate({ previousSlug: "g", readings, releaseAfterMergedPercent: 100 })).toEqual({
      dismissed: 0,
      kind: "allow",
      merged: 0,
      previousSlug: "g",
      raised: 0,
      releaseAfterMergedPercent: 100,
      requiredMerged: 0,
      withdrawn: 0,
    });
  });

  it("needs the one raised member merged when only one was raised", () => {
    const readings = [member({ hasOpenPr: true, number: 1, state: "open" })];

    expect(topupMergeGate({ previousSlug: "g", readings, releaseAfterMergedPercent: 50 })).toEqual({
      dismissed: 0,
      kind: "idle",
      merged: 0,
      previousSlug: "g",
      raised: 1,
      releaseAfterMergedPercent: 50,
      requiredMerged: 1,
      withdrawn: 0,
    });
  });

  it("allows at exactly half of two", () => {
    const readings = [
      member({ hasOpenPr: false, number: 1, state: "fixed" }),
      member({ hasOpenPr: true, number: 2, state: "open" }),
    ];

    expect(topupMergeGate({ previousSlug: "g", readings, releaseAfterMergedPercent: 50 }).kind).toBe("allow");
  });

  it("rounds the required share UP: one of three at 34% needs two, so it idles", () => {
    expect(topupMergeGate({ previousSlug: "g", readings: ONE_OF_THREE, releaseAfterMergedPercent: 34 })).toEqual({
      dismissed: 0,
      kind: "idle",
      merged: 1,
      previousSlug: "g",
      raised: 3,
      releaseAfterMergedPercent: 34,
      requiredMerged: 2,
      withdrawn: 0,
    });
  });

  it("allows one of three at 33%, which needs exactly one", () => {
    const verdict = topupMergeGate({ previousSlug: "g", readings: ONE_OF_THREE, releaseAfterMergedPercent: 33 });

    expect(verdict.kind).toBe("allow");
    expect(verdict).toMatchObject({ requiredMerged: 1 });
  });

  it("holds two of three at 100%, and allows three of three", () => {
    const two = ONE_OF_THREE.map((read) => (read.alertNumber === 2 ? { ...read, state: "fixed" as const } : read));
    const three = ONE_OF_THREE.map((read) => ({ ...read, hasOpenPr: false, state: "fixed" as const }));

    expect(topupMergeGate({ previousSlug: "g", readings: two, releaseAfterMergedPercent: 100 }).kind).toBe("idle");
    expect(topupMergeGate({ previousSlug: "g", readings: three, releaseAfterMergedPercent: 100 }).kind).toBe("allow");
  });

  it("counts a dismissal in neither the merged nor the raised tally", () => {
    const readings = [
      member({ hasOpenPr: false, number: 1, state: "dismissed" }),
      member({ hasOpenPr: true, number: 2, state: "open" }),
    ];

    expect(topupMergeGate({ previousSlug: "g", readings, releaseAfterMergedPercent: 50 })).toEqual({
      dismissed: 1,
      kind: "idle",
      merged: 0,
      previousSlug: "g",
      raised: 1,
      releaseAfterMergedPercent: 50,
      requiredMerged: 1,
      withdrawn: 0,
    });
  });

  it("counts a withdrawal in neither tally, even behind an open pull request, so it never holds the recipe", () => {
    const readings = [member({ hasOpenPr: true, number: 1, state: "withdrawn" })];

    expect(topupMergeGate({ previousSlug: "g", readings, releaseAfterMergedPercent: 50 })).toEqual({
      dismissed: 0,
      kind: "allow",
      merged: 0,
      previousSlug: "g",
      raised: 0,
      releaseAfterMergedPercent: 50,
      requiredMerged: 0,
      withdrawn: 1,
    });
  });
});
