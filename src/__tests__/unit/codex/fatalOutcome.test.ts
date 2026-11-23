import { describe, expect, it } from "vitest";

import { fatalOutcome, withFailureCause } from "../../../codex/fatalOutcome.js";
import type { BoundedPassResult } from "../../../codex/runPass.js";
import type { CodexAttempt, CodexPassOutcome } from "../../../codex/types.js";

const REFUSAL = "This content was flagged for possible cybersecurity risk.";

function attempt({ kind, status }: Pick<CodexAttempt, "kind" | "status">): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso: "2026-09-23T06:01:00.000Z",
    items: { kind: "not-measured", reason: "aborted" },
    kind,
    startedAtIso: "2026-09-23T06:00:00.000Z",
    status,
    threadId: "t",
    usage: { kind: "not-measured", reason: "aborted" },
  };
}

const FATAL: CodexPassOutcome = fatalOutcome({
  error: { kind: "llm", message: REFUSAL, operation: "codex.run" },
  operation: "codex.run",
  reported: () => undefined,
  salvage: () => null,
});

describe("fatalOutcome", () => {
  it("names a failed turn that returned no error as exactly that, never as a real fault", () => {
    const outcome = fatalOutcome({
      error: undefined,
      operation: "codex.run",
      reported: () => undefined,
      salvage: () => null,
    });
    expect(outcome).toEqual({
      cause: { quota: null, reported: null, thrown: "the turn failed without returning an error" },
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    });
  });
});

describe("withFailureCause", () => {
  it("stamps the fatal cause on the last attempt when that attempt failed, and on no other", () => {
    const result: BoundedPassResult = {
      attempts: [attempt({ kind: "initial", status: "aborted" }), attempt({ kind: "conclusion", status: "failed" })],
      observedElapsedMs: 20,
      outcome: FATAL,
    };
    const stamped = withFailureCause({ result });
    expect(stamped.attempts.map((each) => each.cause)).toEqual([
      undefined,
      { quota: null, reported: null, thrown: REFUSAL },
    ]);
  });

  it("leaves a fatal whose last attempt did not fail untouched", () => {
    const result: BoundedPassResult = {
      attempts: [attempt({ kind: "initial", status: "aborted" })],
      observedElapsedMs: 20,
      outcome: FATAL,
    };
    expect(withFailureCause({ result })).toBe(result);
  });

  it("leaves a pass with no attempt at all untouched", () => {
    const result: BoundedPassResult = { attempts: [], observedElapsedMs: 0, outcome: FATAL };
    expect(withFailureCause({ result })).toBe(result);
  });
});
