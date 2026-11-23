/*
 * One turn of a bounded pass, read directly: a validated response is an answer and a rejected one an
 * `invalid-output` no-verdict, an answered turn keeps its measured usage, and an aborted or failed turn records
 * usage and items as not measured.
 */

import { describe, expect, it } from "vitest";
import { err, type Result } from "#lib/result.js";
import { outcomeFromResponse, runOneTurn } from "../../../codex/passTurn.js";
import type { PlanAnswer } from "../../../codex/types.js";
import { acceptAll, answeredTurn, FakeRuntime, FakeThread, USAGE } from "./runPass/harness.js";

/** The instant the fake clock reads at zero. */
const EPOCH_ISO = "2026-01-01T00:00:00.000Z";

/**
 * A validator that refuses every response.
 *
 * @returns a failure naming the response it refused
 */
function rejectAll({ response }: { response: string }): Result<PlanAnswer> {
  return err([`rejected ${response}`]);
}

describe("outcomeFromResponse", () => {
  it("answers with the validated value, keeps the raw response, and never reads the salvage", () => {
    const outcome = outcomeFromResponse({
      finalResponse: "body",
      salvage: () => {
        throw new Error("an answered outcome must not read the salvage");
      },
      validate: acceptAll,
    });

    expect(outcome).toEqual({
      answer: { blockers: [], bodyMarkdown: "body", summary: "s", verdict: "READY" },
      kind: "answered",
      rawFinalResponse: "body",
    });
  });

  it("returns an invalid-output no-verdict carrying the salvage when validation fails", () => {
    const outcome = outcomeFromResponse({ finalResponse: "{}", salvage: () => null, validate: rejectAll });

    expect(outcome).toEqual({ kind: "no-verdict", rawFinalResponse: "{}", reason: "invalid-output", salvage: null });
  });
});

describe("runOneTurn", () => {
  it("records an answered turn with its measured usage and items", async () => {
    const thread = new FakeThread({
      behaviour: { kind: "answer", turn: answeredTurn({ response: "done" }) },
      id: "t1",
    });

    const result = await runOneTurn({
      input: "p",
      kind: "initial",
      outputSchema: {},
      runtime: new FakeRuntime(),
      signal: new AbortController().signal,
      thread,
    });

    expect(result.aborted).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.finalResponse).toBe("done");
    expect(result.attempt).toEqual({
      elapsedMs: 0,
      finishedAtIso: EPOCH_ISO,
      items: { counts: { agent_message: 1 }, kind: "measured" },
      kind: "initial",
      startedAtIso: EPOCH_ISO,
      status: "answered",
      threadId: "t1",
      usage: { kind: "measured", usage: USAGE },
    });
  });

  it("records an aborted turn as aborted, with usage and items not measured", async () => {
    const result = await runOneTurn({
      input: "p",
      kind: "conclusion",
      outputSchema: {},
      runtime: new FakeRuntime(),
      signal: new AbortController().signal,
      thread: new FakeThread({ behaviour: { kind: "abort" }, id: null }),
    });

    expect(result.aborted).toBe(true);
    expect(result.finalResponse).toBeNull();
    expect(result.attempt).toEqual({
      elapsedMs: 0,
      finishedAtIso: EPOCH_ISO,
      items: { kind: "not-measured", reason: "aborted" },
      kind: "conclusion",
      startedAtIso: EPOCH_ISO,
      status: "aborted",
      threadId: null,
      usage: { kind: "not-measured", reason: "aborted" },
    });
  });

  it("records a transport failure as failed and keeps the boundary error", async () => {
    const result = await runOneTurn({
      input: "p",
      kind: "initial",
      outputSchema: {},
      runtime: new FakeRuntime(),
      signal: new AbortController().signal,
      thread: new FakeThread({ behaviour: { kind: "fail" }, id: "t2" }),
    });

    expect(result.aborted).toBe(false);
    expect(result.finalResponse).toBeNull();
    expect(result.error!.operation).toBe("codex.run");
    expect(result.attempt.status).toBe("failed");
    expect(result.attempt.usage).toEqual({ kind: "not-measured", reason: "transport-failed" });
  });
});
