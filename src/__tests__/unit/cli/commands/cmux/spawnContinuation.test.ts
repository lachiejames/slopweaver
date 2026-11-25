/**
 * What a continuing Codex spawn turns its seat decision into, and the one line it prints when the session it would
 * continue cannot be: the old home, why, and that a FRESH session opens without that transcript.
 */
import { describe, expect, it } from "vitest";

import { continuationOfDecision } from "../../../../../cli/commands/cmux/codexSeat.js";
import { appContinuationLine } from "../../../../../cli/commands/cmux/spawnOutput.js";

const CONTINUING = { codexHome: "/home/acme/.codex-two", sessionId: "0b5e" } as const;

describe("continuationOfDecision", () => {
  it("resumes the exact session when the decision kept its recorded plan", () => {
    const decision = {
      kind: "resume",
      route: {
        destination: { alias: "codex-two", codexHome: "/home/acme/.codex-two" },
        why: "app session 0b5e resumes on the plan it was opened on",
      },
    } as const;
    expect(continuationOfDecision({ continuing: CONTINUING, decision })).toEqual({ kind: "resume", sessionId: "0b5e" });
  });

  it("opens fresh beside the session, naming its home and the reason, when the decision routed elsewhere", () => {
    const decision = {
      kind: "fresh",
      reason: "codex-two is paused: card expired",
      route: { destination: { alias: "codex-one", codexHome: "/home/acme/.codex-one" }, why: "ranked first" },
    } as const;
    expect(continuationOfDecision({ continuing: CONTINUING, decision })).toEqual({
      kind: "fresh",
      previousCodexHome: "/home/acme/.codex-two",
      previousSessionId: "0b5e",
      reason: "codex-two is paused: card expired",
    });
  });
});

describe("appContinuationLine", () => {
  it("prints the exact fresh line naming the old home and why", () => {
    const line = appContinuationLine({
      continuation: {
        kind: "fresh",
        previousCodexHome: "/home/acme/.codex-two",
        previousSessionId: "0b5e",
        reason: "codex-two is paused: card expired",
      },
    });
    expect(line).toBe(
      "cmux spawn: app session 0b5e opened on CODEX_HOME=/home/acme/.codex-two, which cannot take the seat now " +
        "(codex-two is paused: card expired) — opening a FRESH session on a newly routed plan, so that session's " +
        "transcript does not continue here; its ledger row is left open",
    );
  });

  it("prints nothing for a resume, whose seat line names the session, or for no continuation", () => {
    expect(appContinuationLine({ continuation: { kind: "resume", sessionId: "0b5e" } })).toBe(undefined);
    expect(appContinuationLine({ continuation: { kind: "none" } })).toBe(undefined);
  });
});
