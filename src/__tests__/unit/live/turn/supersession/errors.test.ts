/*
 * The supersession error factory — the nine reasons a declared delete does not happen.
 *
 * Every message here is read by a human auditing an irreversible act, and by `../../../../../live/turn/
 * outcomeFields.ts` when it folds the refusal into a turn's completion. So each case asserts that the
 * message NAMES the timestamp it is about: a refusal saying only "not warranted" sends a reader back to the
 * thread to work out which message it meant, which is the one thing this union exists to prevent.
 *
 * `liveThreadMismatch` is the only arm with a branch in it, and it is the reason this file is not a loop: an
 * ABSENT `thread_ts` is a channel-root message, a different finding from one hanging in somebody else's
 * thread, and `.claude/rules/typescript-patterns.md`'s no-silent-fallback rule is what made it two sentences
 * rather than one with a `??` in it.
 */
import { describe, expect, it } from "vitest";

import { SupersessionErrors } from "../../../../../live/turn/supersession/errors.js";

const TS = "1790054484.916599";

describe("SupersessionErrors", () => {
  it("nothingDeclared says the turn is additive, and names no timestamp because there is none", () => {
    expect(SupersessionErrors.nothingDeclared()).toEqual({
      code: "NOTHING_DECLARED",
      message: "the answer declared no `supersedes`, so this turn is additive and deletes nothing",
    });
  });

  it("selfTarget names the timestamp the turn just posted", () => {
    expect(SupersessionErrors.selfTarget({ ts: TS })).toEqual({
      code: "SELF_TARGET",
      message: `${TS} is the answer this turn just posted — an answer never supersedes itself`,
      ts: TS,
    });
  });

  it("unreviewed says a declaration is not a warrant", () => {
    const error = SupersessionErrors.unreviewed({ ts: TS });

    expect(error.code).toBe("UNREVIEWED");
    expect(error.message).toBe(
      `no review verdict judges the supersession of ${TS} — an answer may DECLARE what it replaces, but a ` +
        "delete needs a reviewer who looked at both messages and said so",
    );
  });

  it("verdictTargetMismatch names BOTH timestamps, since which is which is the whole finding", () => {
    expect(SupersessionErrors.verdictTargetMismatch({ reviewedTs: "1790000000.000100", ts: TS })).toEqual({
      code: "VERDICT_TARGET_MISMATCH",
      message: `the review judged the supersession of 1790000000.000100, and this answer declares ${TS}`,
      reviewedTs: "1790000000.000100",
      ts: TS,
    });
  });

  it("notWarranted carries the reviewer's own words rather than only the verdict", () => {
    expect(SupersessionErrors.notWarranted({ reason: "the new answer adds to it", ts: TS })).toEqual({
      code: "NOT_WARRANTED",
      message: `the review judged the supersession of ${TS} unwarranted — the new answer adds to it`,
      reason: "the new answer adds to it",
      ts: TS,
    });
  });

  it("noSuchAnswer states the rule it is enforcing, not only the absence", () => {
    const error = SupersessionErrors.noSuchAnswer({ ts: TS });

    expect(error.code).toBe("NO_SUCH_ANSWER");
    expect(error.message).toBe(
      `no completion this install recorded says slopweaver posted an answer at ${TS} — a supersession only ` +
        "ever removes an answer THIS program can prove it wrote",
    );
  });

  it("foreignThread names where the answer lives and where the correction is", () => {
    expect(SupersessionErrors.foreignThread({ correctingIn: "C2/3.3", recordedIn: "C1/2.2", ts: TS })).toEqual({
      code: "FOREIGN_THREAD",
      correctingIn: "C2/3.3",
      message:
        `${TS} was answered in C1/2.2 and this correction is posting in C2/3.3 — a correction only ever ` +
        "deletes an answer standing in its own thread",
      recordedIn: "C1/2.2",
      ts: TS,
    });
  });

  it("liveThreadMismatch names the thread Slack reports", () => {
    const error = SupersessionErrors.liveThreadMismatch({
      correctingThreadTs: "3.3",
      liveThreadTs: "2.2",
      ts: TS,
    });

    expect(error.liveThreadTs).toBe("2.2");
    expect(error.message).toBe(
      `Slack puts ${TS} in 2.2 while this correction is in 3.3 — the local record and the live message ` +
        "disagree, so nothing is deleted",
    );
  });

  it("liveThreadMismatch says CHANNEL-ROOT out loud when Slack reports no thread at all", () => {
    const error = SupersessionErrors.liveThreadMismatch({
      correctingThreadTs: "3.3",
      liveThreadTs: undefined,
      ts: TS,
    });

    expect(error.liveThreadTs).toBeUndefined();
    expect(error.message).toBe(
      `Slack puts ${TS} in no thread at all — it is a channel-root message while this correction is in 3.3 ` +
        "— the local record and the live message disagree, so nothing is deleted",
    );
  });

  it("editedSince names the edit instant, since that is what makes the judged words stale", () => {
    expect(SupersessionErrors.editedSince({ editedTs: "1790054999.000100", ts: TS })).toEqual({
      code: "EDITED_SINCE",
      editedTs: "1790054999.000100",
      message:
        `${TS} was edited at 1790054999.000100, after the completion that recorded it — the words standing ` +
        "there now are not the ones this correction supersedes, so it stays up",
      ts: TS,
    });
  });
});
