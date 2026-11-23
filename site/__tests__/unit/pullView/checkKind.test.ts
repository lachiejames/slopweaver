/*
 * The pull-request view's checks, grouped and summarised the way GitHub's merge box does.
 */

import { describe, expect, it } from "vitest";

import { checkKind, checkSummary } from "../../../lib/pullView";

describe("checkKind and checkSummary", () => {
  it("groups each result the way GitHub's merge box does", () => {
    expect(
      [
        "SUCCESS",
        "NEUTRAL",
        "SKIPPED",
        "STALE",
        "FAILURE",
        "TIMED_OUT",
        "ACTION_REQUIRED",
        "IN_PROGRESS",
        "PENDING",
      ].map((result) => checkKind({ result })),
    ).toEqual([
      "successful",
      "successful",
      "skipped",
      "skipped",
      "failing",
      "failing",
      "failing",
      "pending",
      "pending",
    ]);
  });

  it("leads on a failure and counts every group that has a check, in GitHub's order", () => {
    const items = [
      { name: "a", result: "SUCCESS", url: undefined },
      { name: "b", result: "FAILURE", url: undefined },
      { name: "c", result: "SKIPPED", url: undefined },
      { name: "d", result: "SUCCESS", url: undefined },
    ];
    expect(checkSummary({ items })).toEqual({
      counts: ["1 failing", "1 skipped", "2 successful"],
      headline: "Some checks were not successful",
    });
  });

  it("says a run still going before it says everything passed", () => {
    const passed = { name: "a", result: "SUCCESS", url: undefined };
    const items = [passed, { name: "b", result: "QUEUED", url: undefined }];
    expect(checkSummary({ items }).headline).toBe("Some checks haven't completed yet");
    expect(checkSummary({ items: [passed] })).toEqual({
      counts: ["1 successful"],
      headline: "All checks have passed",
    });
  });
});
