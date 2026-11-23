/**
 * ANSWER FIRST, TOOL SECOND as a pure decision — `live/turn/answerFirst.ts`.
 *
 * Every case is built off the incident's own numbers so that a reader can check the rule against
 * the thing it was written for: ask `C0SYN000006`/`1789952379.135579`, and a worker that
 * opened a pull request shortly after capture having posted nothing.
 *
 * The cases that matter most are the ones that answer CLEAR. A rule that refused a session it could not
 * identify, or one holding a DM, would pass every held-case assertion while blocking work it has no business
 * blocking — so each of those is asserted separately rather than left to a single happy path.
 */
// register-class: tooling-shipped-before-the-public-ask-was-answered (docs/recurring-failure-register/bindings.md)
import { describe, expect, it } from "vitest";

import {
  type AnswerFirstAsk,
  type AnswerFirstVerdict,
  answerFirstDetail,
  answerFirstVerdict,
} from "../../../../live/turn/answerFirst.js";

/** The ask under test, as its own lifecycle log carries it, with one field overridden per case. */
function askOf(over: Partial<AnswerFirstAsk> = {}): AnswerFirstAsk {
  return {
    capturedIso: "2026-09-21T02:38:28.000Z",
    channel: "C0SYN000006",
    dispatched: true,
    firstAnswered: false,
    messageTs: "1789952379.135579",
    surface: "channel",
    workerSessionId: "worker-session-1",
    ...over,
  };
}

/** The instant the worker opened the pull request, which is where the refusal has to fire. */
const AT_THE_PUSH = "2026-09-21T02:56:00.000Z";

/**
 * The held arm of a verdict, throwing on a clear one — the union's own `unwrap`, so a case reads the ask
 * without a conditional in its assertions.
 */
function held({ verdict }: { verdict: AnswerFirstVerdict }): Extract<AnswerFirstVerdict, { kind: "held" }> {
  if (verdict.kind === "clear") {
    throw new Error("expected a held verdict, got clear");
  }
  return verdict;
}

describe("answerFirstVerdict — the incident this exists for", () => {
  it("HOLDS the dispatched worker of a public ask that still carries no answer", () => {
    const verdict = answerFirstVerdict({
      asks: [askOf()],
      nowIso: AT_THE_PUSH,
      sessionId: "worker-session-1",
    });

    expect(verdict.kind).toBe("held");
    expect(held({ verdict }).ask.messageTs).toBe("1789952379.135579");
    expect(held({ verdict }).openFor).toBe("17m");
  });

  it("names the ask and its age in the clause the refusal appends", () => {
    expect(answerFirstDetail({ ask: askOf(), openFor: "2h 38m" })).toBe(
      "this session is the dispatched worker for C0SYN000006/1789952379.135579, open 2h 38m with no answer " +
        "posted yet",
    );
  });

  it("drops the age clause rather than inventing one when the elapsed time could not be measured", () => {
    expect(answerFirstDetail({ ask: askOf(), openFor: undefined })).toBe(
      "this session is the dispatched worker for C0SYN000006/1789952379.135579 with no answer posted yet",
    );
  });
});

describe("answerFirstVerdict — what it must NOT refuse", () => {
  it("clears an ask whose dispatch a terminal already superseded, which is what answering does", () => {
    const verdict = answerFirstVerdict({
      asks: [askOf({ dispatched: false })],
      nowIso: AT_THE_PUSH,
      sessionId: "worker-session-1",
    });

    expect(verdict.kind).toBe("clear");
  });

  it("clears a dispatch whose FIRST answer is posted, though the dispatch itself is kept for the build", () => {
    const before = answerFirstVerdict({ asks: [askOf()], nowIso: AT_THE_PUSH, sessionId: "worker-session-1" });
    const after = answerFirstVerdict({
      asks: [askOf({ firstAnswered: true })],
      nowIso: AT_THE_PUSH,
      sessionId: "worker-session-1",
    });

    expect(before.kind).toBe("held");
    expect(after.kind).toBe("clear");
  });

  it("clears a DM, because the audience that cannot see a branch is the whole criterion", () => {
    const verdict = answerFirstVerdict({
      asks: [askOf({ surface: "dm" })],
      nowIso: AT_THE_PUSH,
      sessionId: "worker-session-1",
    });

    expect(verdict.kind).toBe("clear");
  });

  it("clears a session that is not the one holding the ask", () => {
    const verdict = answerFirstVerdict({
      asks: [askOf()],
      nowIso: AT_THE_PUSH,
      sessionId: "some-other-session",
    });

    expect(verdict.kind).toBe("clear");
  });

  it("clears a caller that could not name itself, rather than refusing everyone unidentifiable", () => {
    expect(answerFirstVerdict({ asks: [askOf()], nowIso: AT_THE_PUSH, sessionId: undefined }).kind).toBe("clear");
    expect(answerFirstVerdict({ asks: [askOf()], nowIso: AT_THE_PUSH, sessionId: "" }).kind).toBe("clear");
  });

  it("clears an ask nobody has announced a worker session for — the named tripwire blind spot", () => {
    const verdict = answerFirstVerdict({
      asks: [askOf({ workerSessionId: undefined })],
      nowIso: AT_THE_PUSH,
      sessionId: "worker-session-1",
    });

    expect(verdict.kind).toBe("clear");
  });

  it("clears an empty world", () => {
    expect(answerFirstVerdict({ asks: [], nowIso: AT_THE_PUSH, sessionId: "worker-session-1" }).kind).toBe("clear");
  });
});

describe("answerFirstVerdict — two held asks", () => {
  it("names the OLDEST, which is the one a reader has been waiting on longest", () => {
    const verdict = answerFirstVerdict({
      asks: [
        askOf({ capturedIso: "2026-09-21T02:50:00.000Z", messageTs: "1789953000.000100" }),
        askOf({ capturedIso: "2026-09-21T02:38:28.000Z", messageTs: "1789952379.135579" }),
      ],
      nowIso: AT_THE_PUSH,
      sessionId: "worker-session-1",
    });

    expect(held({ verdict }).ask.messageTs).toBe("1789952379.135579");
    expect(held({ verdict }).openFor).toBe("17m");
  });

  it("ignores a second ask held by a DIFFERENT session even when it is older", () => {
    const verdict = answerFirstVerdict({
      asks: [
        askOf({ capturedIso: "2026-09-21T01:00:00.000Z", messageTs: "1789940000.000100", workerSessionId: "other" }),
        askOf(),
      ],
      nowIso: AT_THE_PUSH,
      sessionId: "worker-session-1",
    });

    expect(held({ verdict }).ask.messageTs).toBe("1789952379.135579");
  });
});
