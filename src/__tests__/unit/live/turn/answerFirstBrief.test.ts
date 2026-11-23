/**
 * The answer-first block a dispatched worker is handed — `live/turn/briefGuidance.ts`.
 *
 * The block is fix 1's INSTRUCTION half; `cli/commands/github/answerFirstGate.ts` is its teeth. A worker
 * that only ever meets the teeth has been refused at the end of two hours of work, which is the outcome the
 * incident already produced once — so what these cases pin is that the rule reaches the worker
 * at the START of its turn, in the brief it actually reads.
 *
 * The surface cases are the falsifiable half. A block printed unconditionally would satisfy every assertion
 * about its content while telling a DM worker a rule that does not apply to it.
 */
// register-class: tooling-shipped-before-the-public-ask-was-answered (docs/recurring-failure-register/bindings.md)
import { describe, expect, it } from "vitest";

import { answerFirstBriefLines, firstAnswerPostedBriefLines } from "../../../../live/turn/briefGuidance.js";

const CHANNEL_BLOCK = answerFirstBriefLines({ surface: "channel" }).join("\n");

describe("answerFirstBriefLines — a public channel ask", () => {
  it("opens with the heading a session scans for, naming the surface as the reason", () => {
    expect(answerFirstBriefLines({ surface: "channel" })[0]).toBe(
      "ANSWER FIRST, THEN TOOLING — this ask is in a PUBLIC channel, so the order is a rule, not a preference:",
    );
  });

  it("puts the answer before the pull request, in that order and by name", () => {
    expect(CHANNEL_BLOCK).toContain("Post a first REVIEWED answer in the thread before you open a pull request");
  });

  it("says first does not mean unreviewed, so the rule cannot be read as licence to skip the door", () => {
    expect(CHANNEL_BLOCK).toContain("slopweaver turn answer");
    expect(CHANNEL_BLOCK).toContain("first does not mean unchecked");
  });

  it("licenses a SHORT first answer, which is what makes the rule affordable at all", () => {
    expect(CHANNEL_BLOCK).toContain("allowed to be short and to say what it does not yet know");
  });

  it("names the door that will refuse, so the worker meets the rule before the refusal", () => {
    expect(CHANNEL_BLOCK).toContain("slopweaver github stack push");
    expect(CHANNEL_BLOCK).toContain("refuses while this ask has no answer");
  });

  it("calls tooling a follow-up rather than forbidding it", () => {
    expect(CHANNEL_BLOCK).toContain("Tooling is a FOLLOW-UP");
  });

  it("teaches the followThrough declaration that keeps the dispatch past the first answer", () => {
    expect(CHANNEL_BLOCK).toContain('`"followThrough": { "owes": "pull-requests" | "other", "what": "<one line>" }`');
    expect(CHANNEL_BLOCK).toContain("KEEPS your dispatch and your workspace");
  });
});

describe("firstAnswerPostedBriefLines — the plan already stands", () => {
  it("names the posted plan, what is still owed, and that the next post is the final one", () => {
    expect(
      firstAnswerPostedBriefLines({
        dispatchId: "dispatch-1",
        firstAnswer: {
          answerDigest: "digest-of-the-plan",
          answerTs: "1790926498.645000",
          channel: "C0SYN000010",
          kind: "first-answered",
          leaseExpiresAt: "2026-10-02T09:34:58.645Z",
          messageTs: "1790924298.202269",
          owes: "pull-requests",
          threadTs: "1790924298.202269",
          tsIso: "2026-10-02T07:34:58.645Z",
          what: "open the two pull requests the plan names",
        },
      }),
    ).toEqual([
      "FIRST ANSWER ALREADY POSTED at 2026-10-02T07:34:58.645Z (Slack ts 1790926498.645000). The thread already " +
        "has your plan: do not post another plan, and do not re-review it.",
      "You still owe: open the two pull requests the plan names (pull-requests).",
      "Your next `turn answer` is the FINAL one: it carries the outcome (the PR links), with no followThrough. " +
        "If you cannot finish: `slopweaver turn resume --dispatch 'dispatch-1' --failed '<why>'`.",
    ]);
  });
});

describe("answerFirstBriefLines — a DM", () => {
  it("prints nothing at all, because the public audience is the whole criterion", () => {
    expect(answerFirstBriefLines({ surface: "dm" })).toEqual([]);
  });
});
