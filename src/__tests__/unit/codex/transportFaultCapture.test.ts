/**
 * A transport fault's cause, carried from the event stream and the thrown error into the pass outcome.
 *
 * Drives the REAL adapter (`makeLockedCodexClient` over a plain SDK port) and the REAL state machine
 * (`runBoundedPass`), so what is proven is the path from the stream to the record, not a restatement of it.
 * The injected stream proves Slopweaver's handling; it is not evidence of what the installed Codex CLI emits.
 */
import { describe, expect, it } from "vitest";
import { makePassBound } from "../../../codex/bounds.js";
import {
  type CodexSdkPort,
  type CodexSdkStreamEvent,
  type CodexSdkThread,
  type LockedCodexClient,
  makeLockedCodexClient,
} from "../../../codex/client.js";
import { type DeadlineRuntime, runBoundedPass, type ScheduledTask } from "../../../codex/runPass.js";
import type { CodexObservedEvent, PlanAnswer } from "../../../codex/types.js";
import { ok, type Result, unwrap } from "../../../lib/result.js";

const SPEND_CAP =
  "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.";

/** Streams the given events, then optionally throws as the SDK does when `codex exec` exits non-zero. */
function streamingThread({
  events,
  throwAfter,
}: {
  events: readonly CodexSdkStreamEvent[];
  throwAfter?: string;
}): CodexSdkThread {
  async function* replay(): AsyncGenerator<CodexSdkStreamEvent> {
    for (const event of events) {
      yield event;
    }
    if (throwAfter !== undefined) {
      throw new Error(throwAfter);
    }
  }
  return { id: "thread-1", runStreamed: async () => ({ events: replay() }) };
}

/** An SDK port that hands out the same thread for start and resume. */
function portOf({ thread }: { thread: CodexSdkThread }): CodexSdkPort {
  return {
    resumeThread: () => thread,
    startThread: () => thread,
  };
}

/** A clock that never fires: every path here settles without a timer. */
const STILL_CLOCK: DeadlineRuntime = {
  nowIso: () => "2026-09-12T07:00:00.000Z",
  nowMs: () => 0,
  schedule: (): ScheduledTask => ({
    cancel: () => {
      // Nothing was armed to cancel.
    },
  }),
};

function acceptAll(): Result<PlanAnswer> {
  return ok({ blockers: [], bodyMarkdown: "", summary: "s", verdict: "READY" });
}

async function passOver({ client }: { client: LockedCodexClient }) {
  return runBoundedPass({
    bound: unwrap(makePassBound({ boundSeconds: 240 })),
    client,
    outputSchema: {},
    prompt: "Answer in one sentence: is this transport working?",
    repoRoot: "/repo",
    runtime: STILL_CLOCK,
    validate: acceptAll,
    workingDirectory: "/scratch",
  });
}

describe("a failed turn through the adapter", () => {
  it("THROWS on turn.failed with the provider's words, as the SDK's own run() does", async () => {
    const seen: CodexObservedEvent[] = [];
    const thread = makeLockedCodexClient({
      sdk: portOf({
        thread: streamingThread({
          events: [
            { thread_id: "thread-1", type: "thread.started" },
            { error: { message: SPEND_CAP }, type: "turn.failed" },
            { item: { text: "never reached", type: "agent_message" }, type: "item.completed" },
          ],
        }),
      }),
    }).startThread({ workingDirectory: "/scratch" });

    const result = await thread.run({
      input: "p",
      onEvent: (event) => {
        seen.push(event);
      },
      outputSchema: {},
      signal: new AbortController().signal,
    });

    expect(result._unsafeUnwrapErr().message).toBe(SPEND_CAP);
    // The relay saw the failure BEFORE the error came back, and nothing after it.
    expect(seen).toEqual([
      { kind: "thread-started", threadId: "thread-1" },
      { kind: "turn-failed", message: SPEND_CAP },
    ]);
  });

  it("names a BLANK failure message as unstated rather than recording an empty one", async () => {
    const thread = makeLockedCodexClient({
      sdk: portOf({
        thread: streamingThread({ events: [{ error: { message: "" }, message: " ", type: "turn.failed" }] }),
      }),
    }).startThread({ workingDirectory: "/scratch" });

    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result._unsafeUnwrapErr().message).toBe("the stream reported a failure with no message");
  });
});

describe("runBoundedPass records what the transport said", () => {
  it("records the stream's spend-cap report beside the exit error the SDK threw", async () => {
    const client = makeLockedCodexClient({
      sdk: portOf({
        thread: streamingThread({
          events: [{ message: SPEND_CAP, type: "error" }],
          throwAfter: "Codex Exec exited with code 1: Reconnecting... 5/5",
        }),
      }),
    });

    const result = await passOver({ client });

    expect(result.outcome).toEqual({
      cause: {
        quota: "usage-limit",
        reported: SPEND_CAP,
        thrown: "Codex Exec exited with code 1: Reconnecting... 5/5",
      },
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["failed"]);
  });

  it("makes a turn.failed FATAL with its cause, where it used to validate an empty response as invalid-output", async () => {
    const client = makeLockedCodexClient({
      sdk: portOf({ thread: streamingThread({ events: [{ error: { message: SPEND_CAP }, type: "turn.failed" }] }) }),
    });

    const result = await passOver({ client });

    expect(result.outcome).toEqual({
      cause: { quota: "usage-limit", reported: SPEND_CAP, thrown: SPEND_CAP },
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    });
  });

  it("records a thrown-only fault with a null report and no guessed quota", async () => {
    const client = makeLockedCodexClient({
      sdk: portOf({ thread: streamingThread({ events: [], throwAfter: "spawn codex ENOENT" }) }),
    });

    const result = await passOver({ client });

    expect(result.outcome).toEqual({
      cause: { quota: null, reported: null, thrown: "spawn codex ENOENT" },
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    });
  });

  it("keeps a turn that COMPLETED as answered, even when the stream reported a transient error first", async () => {
    const client = makeLockedCodexClient({
      sdk: portOf({
        thread: streamingThread({
          events: [
            { message: "Reconnecting... 1/5", type: "error" },
            { item: { text: "{}", type: "agent_message" }, type: "item.completed" },
            { type: "turn.completed" },
          ],
        }),
      }),
    });

    const result = await passOver({ client });

    expect(result.outcome.kind).toBe("answered");
  });

  it("keeps a COMPLETED turn answered when the exit throws after turn.completed", async () => {
    const seen: CodexObservedEvent[] = [];
    const client = makeLockedCodexClient({
      sdk: portOf({
        thread: streamingThread({
          events: [
            { item: { text: '{"ok":true}', type: "agent_message" }, type: "item.completed" },
            { type: "turn.completed" },
          ],
          throwAfter: "Codex Exec exited with code 1",
        }),
      }),
    });

    const result = await runBoundedPass({
      bound: unwrap(makePassBound({ boundSeconds: 240 })),
      client,
      onEvent: (event) => {
        seen.push(event);
      },
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime: STILL_CLOCK,
      validate: acceptAll,
      workingDirectory: "/scratch",
    });

    expect(result.outcome).toEqual({
      answer: { blockers: [], bodyMarkdown: "", summary: "s", verdict: "READY" },
      kind: "answered",
      rawFinalResponse: '{"ok":true}',
    });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["answered"]);
    // The late failure is relayed rather than hidden.
    expect(seen.at(-1)).toEqual({
      kind: "turn-failed",
      message: "after the turn completed: Codex Exec exited with code 1",
    });
  });

  it("keeps a COMPLETED turn answered when a turn.failed arrives after turn.completed", async () => {
    const seen: CodexObservedEvent[] = [];
    const client = makeLockedCodexClient({
      sdk: portOf({
        thread: streamingThread({
          events: [
            { item: { text: "{}", type: "agent_message" }, type: "item.completed" },
            { type: "turn.completed" },
            { error: { message: "shutdown failed" }, type: "turn.failed" },
          ],
        }),
      }),
    });

    const result = await runBoundedPass({
      bound: unwrap(makePassBound({ boundSeconds: 240 })),
      client,
      onEvent: (event) => {
        seen.push(event);
      },
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime: STILL_CLOCK,
      validate: acceptAll,
      workingDirectory: "/scratch",
    });

    expect(result.outcome.kind).toBe("answered");
    expect(seen.at(-1)).toEqual({ kind: "turn-failed", message: "shutdown failed" });
  });

  it("still fails a turn whose stream throws BEFORE it completed", async () => {
    const client = makeLockedCodexClient({
      sdk: portOf({
        thread: streamingThread({
          events: [{ item: { text: "{}", type: "agent_message" }, type: "item.completed" }],
          throwAfter: "Codex Exec exited with code 1",
        }),
      }),
    });

    const result = await passOver({ client });

    expect(result.outcome.kind).toBe("fatal");
  });
});
