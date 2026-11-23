/*
 * `landedUnderOf` — naming the standing rule an act on the pull request merged under, and none when the owner steered the
 * newest act or no rule settled one.
 */
import { describe, expect, it } from "vitest";

import type { AutonomyAction } from "../../../../autonomy/types.js";
import { landedUnderOf } from "../../../../fleet/landed.js";
import { selfMerged, URL_1843 } from "./harness.js";

describe("landedUnderOf", () => {
  it("names the standing rule that settled an act on the pull request", () => {
    expect(landedUnderOf({ acts: { acts: [selfMerged({ subject: URL_1843 })], kind: "read" }, url: URL_1843 })).toEqual(
      {
        anchor: "transcript:merge-rule",
        actKind: "github.pr.self-merge",
        classId: "self-merge-owner-prs",
        kind: "rule",
        words: "auto-merge pretty much any slopweaver PR",
      },
    );
  });

  it("names none when no act on that pull request was settled by a rule", () => {
    const acts = {
      acts: [selfMerged({ subject: "https://github.com/lachiejames/slopweaver/pull/1" })],
      kind: "read",
    } as const;
    expect(landedUnderOf({ acts, url: URL_1843 })).toEqual({ kind: "none" });
  });

  it("matches the subject a landing press stored lowercased against a remote spelled with capitals", () => {
    const acts = { acts: [selfMerged({ subject: URL_1843 })], kind: "read" } as const;
    expect(landedUnderOf({ acts, url: "https://github.com/LachieJames/slopweaver/pull/1843" }).kind).toBe("rule");
  });

  it("names none when the owner steered the newest act, never an older act's rule", () => {
    const older = selfMerged({ subject: URL_1843 });
    const newest: AutonomyAction = {
      ...older,
      action: { ...older.action, actionId: "act-2", doneIso: "2026-10-05T03:00:00.000Z", steer: "merge this one" },
    };
    expect(landedUnderOf({ acts: { acts: [older, newest], kind: "read" }, url: URL_1843 })).toEqual({ kind: "none" });
  });

  it("says the register would not read rather than claiming none", () => {
    expect(landedUnderOf({ acts: { kind: "unread", why: "conflict at act-1" }, url: URL_1843 })).toEqual({
      kind: "unread",
      why: "conflict at act-1",
    });
  });
});
