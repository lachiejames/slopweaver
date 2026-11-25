/**
 * The pure half of `fleet recover`: the challenge, the three-part pass condition, the plan order, the time budget, the
 * sign-in step and the one result the app draws.
 */
import { describe, expect, it } from "vitest";

import {
  boundedReason,
  judgeRecoverySnapshot,
  orderedRecoveryCandidates,
  RECOVERY_ATTEMPT_MS,
  RECOVERY_PASS_MS,
  RECOVERY_REASON_MAX,
  type RecoveryAttempt,
  type RecoveryEvidence,
  recoveryAttemptFits,
  recoveryChallenge,
  recoveryResultOf,
  recoverySignInStep,
} from "../../../fleet/recoveryCheck.js";

/** A byte source that hands out 0x01…, then 0x02…, so each half is known. */
function countingBytes(): (size: number) => Buffer {
  let call = 0;
  return (size) => {
    call += 1;
    return Buffer.alloc(size, call);
  };
}

const PROMPT = "the prompt";
const EXPECTED = "abc123";

describe("boundedReason", () => {
  it("collapses whitespace onto one line", () => {
    expect(boundedReason({ text: "  plan  paused\n\tby the owner  " })).toBe("plan paused by the owner");
  });

  it("keeps a reason exactly at the bound whole", () => {
    const text = "x".repeat(RECOVERY_REASON_MAX);
    expect(boundedReason({ text })).toBe(text);
  });

  it("cuts a longer reason to the bound in code points, ending in an ellipsis", () => {
    const cut = boundedReason({ text: "é".repeat(RECOVERY_REASON_MAX + 5) });
    expect(Array.from(cut).length).toBe(RECOVERY_REASON_MAX);
    expect(cut).toBe(`${"é".repeat(RECOVERY_REASON_MAX - 1)}…`);
  });
});

describe("recoveryChallenge", () => {
  it("sends both halves apart and expects them joined, so the answer is not in the prompt", () => {
    const { expected, prompt } = recoveryChallenge({ randomBytes: countingBytes() });
    const first = "01".repeat(16);
    const second = "02".repeat(16);
    expect(expected).toBe(`${first}${second}`);
    expect(prompt).toContain(`[${first}]`);
    expect(prompt).toContain(`[${second}]`);
    expect(prompt.includes(expected)).toBe(false);
  });
});

describe("judgeRecoverySnapshot", () => {
  it("passes an idle session whose last message is this prompt and whose last words are exactly the answer", () => {
    const verdict = judgeRecoverySnapshot({
      deadlinePassed: false,
      expected: EXPECTED,
      prompt: PROMPT,
      snapshot: { lastAgentText: ` ${EXPECTED}\n`, lastSubmittedText: PROMPT, state: "idle" },
    });
    expect(verdict).toEqual({ kind: "passed" });
  });

  it("fails an idle session that answered something else, quoting it", () => {
    const verdict = judgeRecoverySnapshot({
      deadlinePassed: false,
      expected: EXPECTED,
      prompt: PROMPT,
      snapshot: { lastAgentText: "API Error: 401", lastSubmittedText: PROMPT, state: "idle" },
    });
    expect(verdict).toEqual({ kind: "failed", reason: "its turn ended with another answer: API Error: 401" });
  });

  it("fails an idle session that said nothing after this prompt", () => {
    const verdict = judgeRecoverySnapshot({
      deadlinePassed: false,
      expected: EXPECTED,
      prompt: PROMPT,
      snapshot: { lastAgentText: undefined, lastSubmittedText: PROMPT, state: "idle" },
    });
    expect(verdict).toEqual({ kind: "failed", reason: "its turn ended and it said nothing" });
  });

  it("keeps waiting on a session idle before this prompt reached it", () => {
    const verdict = judgeRecoverySnapshot({
      deadlinePassed: false,
      expected: EXPECTED,
      prompt: PROMPT,
      snapshot: { lastAgentText: EXPECTED, lastSubmittedText: undefined, state: "idle" },
    });
    expect(verdict).toEqual({ kind: "waiting" });
  });

  it("calls a session still running at its deadline a deadline, naming its state", () => {
    const verdict = judgeRecoverySnapshot({
      deadlinePassed: true,
      expected: EXPECTED,
      prompt: PROMPT,
      snapshot: { lastAgentText: undefined, lastSubmittedText: PROMPT, state: "running" },
    });
    expect(verdict).toEqual({ kind: "deadline", reason: "it was still running when its time ran out" });
  });

  it("fails a session the app reports failed, whatever it last said", () => {
    const verdict = judgeRecoverySnapshot({
      deadlinePassed: false,
      expected: EXPECTED,
      prompt: PROMPT,
      snapshot: { lastAgentText: EXPECTED, lastSubmittedText: PROMPT, state: "failed" },
    });
    expect(verdict).toEqual({ kind: "failed", reason: "the session was failed before it answered" });
  });

  it("fails a session the app no longer lists", () => {
    const verdict = judgeRecoverySnapshot({
      deadlinePassed: false,
      expected: EXPECTED,
      prompt: PROMPT,
      snapshot: undefined,
    });
    expect(verdict).toEqual({ kind: "failed", reason: "the app no longer lists the session" });
  });
});

describe("orderedRecoveryCandidates", () => {
  it("keeps routing's order and tries each login once", () => {
    const evidence: RecoveryEvidence = {
      candidates: [
        { alias: "claude-2", storeDir: "/s/two", vendor: "claude" },
        { alias: "claude-2-again", storeDir: "/s/two", vendor: "claude" },
        { alias: "claude-1", storeDir: "/s/one", vendor: "claude" },
      ],
      excluded: [],
      vendor: "claude",
    };
    expect(orderedRecoveryCandidates({ evidence }).map((candidate) => candidate.alias)).toEqual([
      "claude-2",
      "claude-1",
    ]);
  });

  it("answers no plans for a vendor with none", () => {
    expect(orderedRecoveryCandidates({ evidence: { candidates: [], excluded: [], vendor: "codex" } })).toEqual([]);
  });
});

describe("recoveryAttemptFits", () => {
  it("fits an attempt while a whole one is left", () => {
    const startedMs = 1_000;
    const nowMs = startedMs + RECOVERY_PASS_MS - RECOVERY_ATTEMPT_MS;
    expect(recoveryAttemptFits({ nowMs, startedMs })).toBe(true);
  });

  it("refuses one a millisecond later", () => {
    const startedMs = 1_000;
    const nowMs = startedMs + RECOVERY_PASS_MS - RECOVERY_ATTEMPT_MS + 1;
    expect(recoveryAttemptFits({ nowMs, startedMs })).toBe(false);
  });
});

const CLAUDE_SIGNED_OUT: RecoveryEvidence = {
  candidates: [],
  excluded: [
    { alias: "claude-1", reason: "plan paused", vendor: "claude" },
    { alias: "claude-2", reason: "not signed in", signInCommand: "slopweaver plans login claude-2", vendor: "claude" },
  ],
  vendor: "claude",
};

const CODEX_ONE: RecoveryEvidence = {
  candidates: [{ alias: "codex-1", codexHome: "/c/one", vendor: "codex" }],
  excluded: [],
  vendor: "codex",
};

const CODEX_FAILED: RecoveryAttempt = {
  alias: "codex-1",
  attemptId: "run-1",
  outcome: "failed",
  reason: "its turn ended and it said nothing",
  sessionId: "s-1",
  vendor: "codex",
};

describe("recoverySignInStep", () => {
  it("names the first excluded plan whose missing step is a sign-in, when nothing started", () => {
    expect(recoverySignInStep({ attempts: [CODEX_FAILED], evidence: [CLAUDE_SIGNED_OUT, CODEX_ONE] })).toEqual({
      alias: "claude-2",
      command: "slopweaver plans login claude-2",
      vendor: "claude",
    });
  });

  it("names none once any vendor started", () => {
    const passed: RecoveryAttempt = { ...CODEX_FAILED, outcome: "passed", reason: "it answered" };
    expect(recoverySignInStep({ attempts: [passed], evidence: [CLAUDE_SIGNED_OUT, CODEX_ONE] })).toBe(undefined);
  });

  it("names none when no exclusion is a missing sign-in", () => {
    expect(recoverySignInStep({ attempts: [CODEX_FAILED], evidence: [CODEX_ONE] })).toBe(undefined);
  });
});

describe("recoveryResultOf", () => {
  const times = { finishedAtIso: "2026-11-25T10:05:00.000Z", runId: "run", startedAtIso: "2026-11-25T10:00:00.000Z" };

  it("reports partial when one vendor answered, the other's line carrying why not", () => {
    const passed: RecoveryAttempt = { ...CODEX_FAILED, outcome: "passed", reason: "it answered" };
    const result = recoveryResultOf({
      ...times,
      attempts: [passed],
      evidence: [CLAUDE_SIGNED_OUT, CODEX_ONE],
      infrastructure: undefined,
    });
    expect(result).toEqual({
      ...times,
      attempts: [passed],
      schemaVersion: 1,
      status: "partial",
      vendors: [
        {
          excluded: [
            { alias: "claude-1", reason: "plan paused" },
            { alias: "claude-2", reason: "not signed in" },
          ],
          reason: "claude-1: plan paused",
          status: "failed",
          vendor: "claude",
        },
        { alias: "codex-1", excluded: [], reason: "it answered", status: "passed", vendor: "codex" },
      ],
    });
  });

  it("reports failed with the sign-in step when neither answered", () => {
    const result = recoveryResultOf({
      ...times,
      attempts: [CODEX_FAILED],
      evidence: [CLAUDE_SIGNED_OUT, CODEX_ONE],
      infrastructure: undefined,
    });
    expect(result.status).toBe("failed");
    expect(result.vendors[1]!.reason).toBe("codex-1: its turn ended and it said nothing");
    expect(result.signIn).toEqual({ alias: "claude-2", command: "slopweaver plans login claude-2", vendor: "claude" });
  });

  it("reports infrastructure-failed over any verdict, and a vendor it never read as unread", () => {
    const result = recoveryResultOf({
      ...times,
      attempts: [],
      evidence: [],
      infrastructure: "the desktop app is not running",
    });
    expect(result.status).toBe("infrastructure-failed");
    expect(result.infrastructure).toBe("the desktop app is not running");
    expect(result.vendors.map((vendor) => vendor.reason)).toEqual([
      "its plans could not be read: the check stopped before reading them",
      "its plans could not be read: the check stopped before reading them",
    ]);
  });

  it("says a vendor with no plan registered has none", () => {
    const result = recoveryResultOf({
      ...times,
      attempts: [],
      evidence: [
        { candidates: [], excluded: [], vendor: "claude" },
        { candidates: [], excluded: [], vendor: "codex" },
      ],
      infrastructure: undefined,
    });
    expect(result.vendors.map((vendor) => vendor.reason)).toEqual([
      "no plan of it is registered",
      "no plan of it is registered",
    ]);
    expect(result.status).toBe("failed");
  });
});
