/**
 * `previewedAfterStackPush`: the snapshot an update's door re-read is compared with moves ONLY its head to the commit
 * the push landed, so the push's own new head is not read as somebody else's force-push, while a description, title,
 * author, state, draft or base change made in the window is still caught.
 */
import { describe, expect, it } from "vitest";

import { previewedAfterStackPush } from "../../../../../cli/commands/github/stackPushUpdate.js";
import { updateFreshnessFor } from "../../../../../cli/commands/github/updateCore.js";
import { AMENDED_SHA, LOCAL_SHA, pr } from "./stackPushRun/fixtures.js";

/** The branch's open pull request as read before the push, still at the commit the push replaces. */
const BEFORE_PUSH = { ...pr({ number: 42 }), head: { ...pr({ number: 42 }).head, ref: "top", sha: LOCAL_SHA } };

describe("previewedAfterStackPush", () => {
  it("moves the head to the pushed commit and keeps every other field of the snapshot", () => {
    const moved = previewedAfterStackPush({ previewed: BEFORE_PUSH, pushedHeadSha: AMENDED_SHA });
    expect(moved).toStrictEqual({ ...BEFORE_PUSH, head: { ...BEFORE_PUSH.head, sha: AMENDED_SHA } });
    expect(BEFORE_PUSH.head.sha).toBe(LOCAL_SHA);
  });

  it("reads fresh against the pull request at the pushed head, where the unmoved snapshot does not", () => {
    const current = { ...BEFORE_PUSH, head: { ...BEFORE_PUSH.head, sha: AMENDED_SHA } };
    const moved = previewedAfterStackPush({ previewed: BEFORE_PUSH, pushedHeadSha: AMENDED_SHA });
    expect(updateFreshnessFor({ current, previewed: moved }).fresh).toBe(true);
    expect(updateFreshnessFor({ current, previewed: BEFORE_PUSH }).fresh).toBe(false);
  });

  it("still reads stale when the description moved during the push", () => {
    const current = { ...BEFORE_PUSH, body: "edited in the window", head: { ...BEFORE_PUSH.head, sha: AMENDED_SHA } };
    const moved = previewedAfterStackPush({ previewed: BEFORE_PUSH, pushedHeadSha: AMENDED_SHA });
    expect(updateFreshnessFor({ current, previewed: moved }).fresh).toBe(false);
  });

  it("still reads stale when the pull request was retargeted during the push", () => {
    const current = { ...BEFORE_PUSH, baseRef: "release", head: { ...BEFORE_PUSH.head, sha: AMENDED_SHA } };
    const moved = previewedAfterStackPush({ previewed: BEFORE_PUSH, pushedHeadSha: AMENDED_SHA });
    expect(BEFORE_PUSH.baseRef).not.toBe("release");
    expect(updateFreshnessFor({ current, previewed: moved })).toStrictEqual({
      fresh: false,
      reason:
        "the base branch changed between reading this pull request and writing to it, so nothing was sent. Re-run to work from the current state",
    });
  });
});
