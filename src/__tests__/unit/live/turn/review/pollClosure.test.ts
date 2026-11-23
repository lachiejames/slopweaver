/**
 * `reviewPollClosure` — whether a poll may close the reviewer's workspace and release its ledger row, for
 * each truth it can report. Pure: a truth in, a closure decision out.
 */
import { describe, expect, it } from "vitest";

import { reviewPollClosure } from "../../../../../live/turn/reviewPoll.js";

describe("reviewPollClosure", () => {
  it("closes on this reviewer's own verdict, whether or not it bound the current bytes", () => {
    expect(
      reviewPollClosure({ truth: { digestMatches: true, kind: "verdict", outcome: "clean", path: "/tmp/v.json" } }),
    ).toStrictEqual({ closeWorkspace: true, releaseLedger: true, reason: "its own verdict is written" });
    expect(
      reviewPollClosure({ truth: { digestMatches: false, kind: "verdict", outcome: "broken", path: "/tmp/v.json" } })
        .closeWorkspace,
    ).toBe(true);
  });

  it("closes a host-exited phantom, to reclaim the idle shell it left", () => {
    expect(reviewPollClosure({ truth: { kind: "phantom", reason: "gone", why: "host-exited" } })).toStrictEqual({
      closeWorkspace: true,
      releaseLedger: true,
      reason: "the host exited and left an idle shell",
    });
  });

  it("does not re-close a workspace cmux no longer lists, but DOES retire its still-open board row", () => {
    expect(reviewPollClosure({ truth: { kind: "phantom", reason: "gone", why: "workspace-gone" } })).toStrictEqual({
      closeWorkspace: false,
      releaseLedger: true,
      reason: "cmux no longer lists the workspace — nothing left to close, but its board row was still open",
    });
  });

  it("REFUSES both halves on a superseded file — the defect that killed twelve reviewers mid-verdict", () => {
    expect(
      reviewPollClosure({ truth: { kind: "superseded", path: "/tmp/v.json", wroteIt: "reviewer workspace:3" } }),
    ).toStrictEqual({
      closeWorkspace: false,
      releaseLedger: false,
      reason: "nothing proves the reviewer has stopped working",
    });
  });

  it("refuses a working reviewer, and one whose file is merely unreadable", () => {
    expect(reviewPollClosure({ truth: { kind: "working", reconciledDoubt: undefined } }).releaseLedger).toBe(false);
    expect(reviewPollClosure({ truth: { kind: "unreadable", reason: "outcome: bad" } }).releaseLedger).toBe(false);
  });
});
