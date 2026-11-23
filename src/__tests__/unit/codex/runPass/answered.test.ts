/*
 * `runBoundedPass` when the first turn answers: the answer returned with its usage and every timer cancelled, a
 * zero-tool-call pass accepted, null usage recorded as not measured, an invalid response turned into no-verdict,
 * and tool use accepted on a review and a planning pass alike.
 */

import { describe, expect, it } from "vitest";
import { err, type Result } from "#lib/result.js";
import type { CodexTurnResult } from "../../../../codex/client.js";
import { runBoundedPass } from "../../../../codex/runPass.js";
import type { PlanAnswer } from "../../../../codex/types.js";
import { acceptAll, answeredTurn, BOUND, clientOf, FakeRuntime, FakeThread, USAGE } from "./harness.js";

describe("runBoundedPass — the answered path", () => {
  it("returns the answer, records measured usage, and cancels every timer", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { kind: "answer", turn: answeredTurn({ response: "{}" }) }, id: "t1" });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start }),
      outputSchema: {},
      prompt: "do the thing",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("answered");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.status).toBe("answered");
    expect(result.attempts[0]!.usage.kind).toBe("measured");
    expect(result.attempts[0]!.threadId).toBe("t1");
    // No timer left armed: the deadline must not fire after a pass has answered.
    expect(runtime.armedCount()).toBe(0);
  });

  it("accepts a pass that made ZERO tool calls — that is the healthy signature, not a stall", async () => {
    const runtime = new FakeRuntime();
    const turn: CodexTurnResult = {
      finalResponse: "{}",
      items: { counts: {}, kind: "measured" },
      usage: { kind: "measured", usage: USAGE },
    };
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start: new FakeThread({ behaviour: { kind: "answer", turn }, id: "t1" }) }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("answered");
  });

  it("records a completed turn whose usage the SDK reported as null as NOT MEASURED, never zero", async () => {
    const runtime = new FakeRuntime();
    const turn: CodexTurnResult = {
      finalResponse: "{}",
      items: { counts: { agent_message: 1 }, kind: "measured" },
      usage: { kind: "not-measured", reason: "sdk-reported-none" },
    };
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start: new FakeThread({ behaviour: { kind: "answer", turn }, id: "t1" }) }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.attempts[0]!.usage).toEqual({ kind: "not-measured", reason: "sdk-reported-none" });
  });

  it("turns an invalid response into no-verdict, keeping the raw text for the artifact", async () => {
    const runtime = new FakeRuntime();
    const reject = (): Result<PlanAnswer> => err(["nope"]);
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({
        start: new FakeThread({ behaviour: { kind: "answer", turn: answeredTurn({ response: "garbage" }) }, id: "t1" }),
      }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: reject,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("no-verdict");
    expect(result.outcome.kind === "no-verdict" ? result.outcome.reason : "").toBe("invalid-output");
    expect(result.outcome.kind === "no-verdict" ? result.outcome.rawFinalResponse : "").toBe("garbage");
  });
});

describe("runBoundedPass — the diff-only tool rule", () => {
  /**
   * The retired veto, inverted. A review that runs commands used to be refused outright — and that rule had
   * to go, because the diff is now a FILE and reading it takes a command. Keeping the case as a test of the
   * new behaviour is deliberate: it is the exact input that used to be rejected.
   */
  it("accepts a review verdict reached by running commands — reading the diff file requires one", async () => {
    const runtime = new FakeRuntime();
    const turn: CodexTurnResult = {
      finalResponse: "{}",
      items: { counts: { agent_message: 1, command_execution: 4 }, kind: "measured" },
      usage: { kind: "measured", usage: USAGE },
    };
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start: new FakeThread({ behaviour: { kind: "answer", turn }, id: "t1" }) }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("answered");
  });

  it("allows the same tool use for a PLANNING pass, which is meant to investigate", async () => {
    const runtime = new FakeRuntime();
    const turn: CodexTurnResult = {
      finalResponse: "{}",
      items: { counts: { command_execution: 40 }, kind: "measured" },
      usage: { kind: "measured", usage: USAGE },
    };
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start: new FakeThread({ behaviour: { kind: "answer", turn }, id: "t1" }) }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("answered");
  });
});
