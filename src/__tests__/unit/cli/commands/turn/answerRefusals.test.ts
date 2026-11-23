/**
 * The refusals `turn answer`'s direct mode owes an ask before it posts — read off a REAL ask-lifecycle log in
 * a throwaway home, so every case is the shipped fold rather than a restatement of it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { refusalForBlockedOnHuman, refusalForStaleDecision } from "../../../../../cli/commands/turn/answerRefusals.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../../live/ask/store.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "none",
};

const OTHER_DECISION: RespondDecision = { ...DECISION, rationale: "a re-judged rationale" };

/** {@link DECISION} as a `dispatched` row written before `truthMode` existed recorded it. */
const { truthMode: _absentBefore436, ...PRE_TRUTH_MODE_DECISION } = DECISION;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh home holding one captured ask. */
function capturedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-answer-refusals-"));
  fixtureDirs.push(home);
  ensureCapturedAskLifecycle({ askIdentity: ASK, home, surface: "channel", userId: "U0OWNER" });
  return home;
}

/** Append the `dispatched` event a real `turn dispatch` writes, under the decision the caller names. */
function dispatch({ decision, home }: { decision: RespondDecision; home: string }): void {
  appendAskLifecycleEvent({
    event: {
      ...ASK,
      decision,
      kind: "dispatched",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      tier: "fresh-visible-session",
      tsIso: "2026-10-02T00:00:00.000Z",
    },
    home,
  });
}

describe("refusalForBlockedOnHuman", () => {
  it("is absent for an ask nobody blocked", () => {
    const home = capturedHome();

    expect(refusalForBlockedOnHuman({ askIdentity: ASK, home })).toBeUndefined();
  });

  it("is absent for an ask the log has never heard of", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-answer-refusals-"));
    fixtureDirs.push(home);

    expect(refusalForBlockedOnHuman({ askIdentity: ASK, home })).toBeUndefined();
  });

  it("names what the owner still has to do while the ask is blocked on them", () => {
    const home = capturedHome();
    appendAskLifecycleEvent({
      event: {
        ...ASK,
        kind: "blocked-on-human",
        need: "sign-in",
        stepText: "Waiting for sign-in",
        tsIso: "2026-10-02T00:01:00.000Z",
        what: "sign in to Datadog",
      },
      home,
    });

    const refusal = refusalForBlockedOnHuman({ askIdentity: ASK, home })!;

    expect(refusal.code).toBe("ASK_REFUSED");
    expect(refusal.message).toContain('"sign in to Datadog"');
  });

  it("lifts once `turn unblock` has recorded that the owner did the thing", () => {
    const home = capturedHome();
    appendAskLifecycleEvent({
      event: {
        ...ASK,
        kind: "blocked-on-human",
        need: "sign-in",
        stepText: "Waiting for sign-in",
        tsIso: "2026-10-02T00:01:00.000Z",
        what: "sign in to Datadog",
      },
      home,
    });
    appendAskLifecycleEvent({
      event: {
        ...ASK,
        kind: "unblocked",
        lifted: { need: "sign-in", what: "sign in to Datadog" },
        note: "signed in",
        tsIso: "2026-10-02T00:02:00.000Z",
      },
      home,
    });

    expect(refusalForBlockedOnHuman({ askIdentity: ASK, home })).toBeUndefined();
  });
});

describe("refusalForStaleDecision", () => {
  it("trusts any decision for an ask `turn dispatch` never touched — a hand-authored fixture stays a valid entrance", () => {
    const home = capturedHome();

    expect(refusalForStaleDecision({ askIdentity: ASK, home, supplied: DECISION })).toBeUndefined();
  });

  it("trusts the decision the ask was dispatched under", () => {
    const home = capturedHome();
    dispatch({ decision: DECISION, home });

    expect(refusalForStaleDecision({ askIdentity: ASK, home, supplied: { ...DECISION } })).toBeUndefined();
  });

  it("refuses a decision that is not the one the ask was dispatched under", () => {
    const home = capturedHome();
    dispatch({ decision: DECISION, home });

    const refusal = refusalForStaleDecision({ askIdentity: ASK, home, supplied: OTHER_DECISION })!;

    expect(refusal.code).toBe("ASK_REFUSED");
    expect(refusal.message).toContain("does not match the decision this ask was actually dispatched under");
  });

  it("refuses every decision once the ask has been answered since its dispatch", () => {
    const home = capturedHome();
    dispatch({ decision: DECISION, home });
    appendAskLifecycleEvent({
      event: { ...ASK, answerTs: "1785000100.000200", kind: "answered", tsIso: "2026-10-02T00:05:00.000Z" },
      home,
    });

    const refusal = refusalForStaleDecision({ askIdentity: ASK, home, supplied: DECISION })!;

    expect(refusal.message).toContain("already been resolved");
  });

  it("does NOT count a lease expiry as a resolution — it is a re-judgement candidate, not an ending", () => {
    const home = capturedHome();
    dispatch({ decision: DECISION, home });
    appendAskLifecycleEvent({ event: { ...ASK, kind: "lease-expired", tsIso: "2026-10-02T03:00:00.000Z" }, home });

    expect(refusalForStaleDecision({ askIdentity: ASK, home, supplied: DECISION })).toBeUndefined();
  });

  it("does NOT count a posted FIRST answer as a resolution — the same worker is still building", () => {
    const home = capturedHome();
    dispatch({ decision: DECISION, home });
    appendAskLifecycleEvent({
      event: {
        ...ASK,
        answerDigest: `sha256:${"a".repeat(64)}`,
        answerTs: "1785000100.000200",
        kind: "first-answered",
        leaseExpiresAt: "2099-01-02T00:00:00.000Z",
        owes: "pull-requests",
        tsIso: "2026-10-02T00:05:00.000Z",
        what: "open the PR",
      },
      home,
    });

    expect(refusalForStaleDecision({ askIdentity: ASK, home, supplied: DECISION })).toBeUndefined();
  });

  it("reads a pre-truthMode dispatch as a dispatch, and refuses a current decision as not the one it ran under", () => {
    const home = capturedHome();
    // @ts-expect-error — a fresh append must carry truthMode, so an August-shaped row is written past the compiler.
    dispatch({ decision: PRE_TRUTH_MODE_DECISION, home });

    const refusal = refusalForStaleDecision({ askIdentity: ASK, home, supplied: DECISION })!;

    expect(refusal.code).toBe("ASK_REFUSED");
    expect(refusal.message).toContain("does not match the decision this ask was actually dispatched under");
  });

  it("judges against the LATEST dispatch generation, and a re-dispatch after an answer reopens the ask", () => {
    const home = capturedHome();
    dispatch({ decision: DECISION, home });
    appendAskLifecycleEvent({
      event: { ...ASK, answerTs: "1785000100.000200", kind: "answered", tsIso: "2026-10-02T00:05:00.000Z" },
      home,
    });
    dispatch({ decision: OTHER_DECISION, home });

    expect(refusalForStaleDecision({ askIdentity: ASK, home, supplied: OTHER_DECISION })).toBeUndefined();
    expect(refusalForStaleDecision({ askIdentity: ASK, home, supplied: DECISION })!.message).toContain(
      "does not match the decision",
    );
  });
});
