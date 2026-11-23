/*
 * `magnitudeShift`: the line between a figure a session may correct alone and one that changes the size of the
 * claim, so asks first. It moved here when `claimCorrection.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { magnitudeShift } from "../../../../../outbound/slack/claimMagnitude.js";

describe("magnitudeShift, the line between correcting alone and asking first", () => {
  it.each([
    ["10 failed requests", "30 failed requests", undefined],
    ["1,200 users", "1,500 users", undefined],
    ["10 failed requests", "300 failed requests", { from: 10, kind: "shift", to: 300 }],
    ["400 errors", "40 errors", { from: 400, kind: "shift", to: 40 }],
    ["0 customers affected", "12 customers affected", { from: 0, kind: "shift", to: 12 }],
    ["the staging pool", "the prod pool", undefined],
    ["4.2.0 is affected", "4.2.1 is affected", undefined],
    [
      "In 1 incident, 10 users were affected.",
      "In 1 incident, 1000 users were affected.",
      { from: 10, kind: "shift", to: 1000 },
    ],
    ["In 2 regions, 10 users", "In 3 regions, 30 users", undefined],
    ["v4.2.0 dropped 10 jobs", "v4.2.0 dropped 200 jobs", { from: 10, kind: "shift", to: 200 }],
    [
      "10 failed requests",
      "Across 2 pools, 300 failed requests.",
      { claimFigures: [10], correctionFigures: [2, 300], kind: "unpaired" },
    ],
    [
      "10 failed requests across 100 pools",
      "Across 2 regions, 300 failed requests across 100 pools",
      { claimFigures: [10, 100], correctionFigures: [2, 300, 100], kind: "unpaired" },
    ],
    [
      "10 failed requests",
      "Across 2 pools, 30 failed requests.",
      { claimFigures: [10], correctionFigures: [2, 30], kind: "unpaired" },
    ],
    ["10 failed requests", "most requests failed", { claimFigures: [10], correctionFigures: [], kind: "unpaired" }],
    ["most requests failed", "300 requests failed", { claimFigures: [], correctionFigures: [300], kind: "unpaired" }],
    ["most requests failed", "a few requests failed", undefined],
  ])("%j corrected to %j", (wrong, correction, expected) => {
    expect(magnitudeShift({ correction, wrong })).toEqual(expected);
  });
});
