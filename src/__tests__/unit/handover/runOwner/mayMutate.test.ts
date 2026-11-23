/*
 * `mayMutate` — the gate deciding whether this session may write to a run, given its ownership. It moved here when
 * `runOwner.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { mayMutate } from "../../../../handover/runOwner.js";
import { AT, MINE, THEIRS } from "./harness.js";

describe("mayMutate", () => {
  it("permits acting on this session's run and on an unclaimed one", () => {
    expect(mayMutate({ ownership: { kind: "unowned" } })).toBe(true);
    expect(
      mayMutate({
        ownership: { kind: "mine", writer: { atIso: AT, pid: 1, sessionId: MINE, worktree: "/wt" } },
      }),
    ).toBe(true);
  });

  it("refuses a run held elsewhere, because finish, abandon, ask and resume all write to it", () => {
    expect(
      mayMutate({
        ownership: {
          kind: "elsewhere",
          thisSession: MINE,
          writer: { atIso: AT, pid: 1, sessionId: THEIRS, worktree: "/wt" },
        },
      }),
    ).toBe(false);
  });

  it("refuses a released run exactly as it refuses one held elsewhere — it had a real owner", () => {
    expect(
      mayMutate({
        ownership: {
          kind: "released",
          releasedAtIso: AT,
          why: "handing off",
          writer: { atIso: AT, pid: 1, sessionId: THEIRS, worktree: "/wt" },
        },
      }),
    ).toBe(false);
  });
});
