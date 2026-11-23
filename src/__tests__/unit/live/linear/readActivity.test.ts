/** Which activity connections each Linear kind has, and the plan that refuses one a kind lacks. */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { activityOf, parseLinearReadInclude, planLinearActivity } from "../../../../live/linear/readActivity.js";

describe("activityOf", () => {
  it("gives an issue all three, a document comments alone and a project none", () => {
    expect(activityOf({ kind: "issue" })).toEqual(["comments", "attachments", "history"]);
    expect(activityOf({ kind: "document" })).toEqual(["comments"]);
    expect(activityOf({ kind: "project" })).toEqual([]);
  });
});

describe("planLinearActivity", () => {
  it("plans what was asked for, in the stable order", () => {
    const include = unwrap(parseLinearReadInclude({ value: "history,comments" }));

    expect(unwrap(planLinearActivity({ include, kind: "issue" }))).toEqual(["comments", "history"]);
    expect(unwrap(planLinearActivity({ include: { comments: true }, kind: "document" }))).toEqual(["comments"]);
    expect(unwrap(planLinearActivity({ include: {}, kind: "project" }))).toEqual([]);
  });

  it("REFUSES a connection the kind lacks, naming what it does have", () => {
    const onDocument = unwrapErr(planLinearActivity({ include: { attachments: true }, kind: "document" }));
    const onProject = unwrapErr(planLinearActivity({ include: { comments: true }, kind: "project" }));

    expect(onDocument.code).toBe("ACTIVITY_UNAVAILABLE");
    expect(onDocument.message).toContain("comments");
    expect(onProject.code).toBe("ACTIVITY_UNAVAILABLE");
  });
});
