/*
 * What `runBoundedPass` keeps from a pass that produced no verdict: the commands and last message it streamed,
 * the attempt's own items and usage left not measured, null when it did nothing, an event folded even when the
 * caller's relay throws, the wrap-up turn's own message, and the same salvage on the fatal arm.
 */

import { errAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { toIngestError } from "#lib/ingestError.js";
import type { LockedCodexThread } from "../../../../codex/client.js";
import { runBoundedPass } from "../../../../codex/runPass.js";
import type { CodexEventSink, CodexObservedEvent } from "../../../../codex/types.js";
import { abortError, acceptAll, BOUND, FakeRuntime } from "./harness.js";

/**
 * The total-loss class: a pass that investigated for its whole bound and recorded nothing.
 *
 * Measured shape being pinned here: three recorded planning passes each ran the full bound, were interrupted
 * at 85%, spent the entire conclusion window and were stopped at the deadline. Every one recorded
 * `rawFinalResponse: null` and `items: (not measured: aborted)` — and every one had streamed dozens of
 * commands past the caller first.
 */
describe("runBoundedPass — what survives a pass that produced no verdict", () => {
  /**
   * A thread that streams a scripted turn's events and then aborts, exactly as an out-of-bound turn does.
   *
   * The script is per TURN, because the initial turn and the wrap-up turn stream different things: the wrap-up
   * is told to run no commands, so replaying the same list for both would inflate every count.
   */
  class StreamingThread implements LockedCodexThread {
    private readonly turns: readonly (readonly CodexObservedEvent[])[];
    /** How each turn ENDS. Defaulting to abort keeps every pre-existing case reading exactly as it did. */
    private readonly endings: readonly ("abort" | "fail")[];
    private index = 0;

    constructor({
      turns,
      endings = [],
    }: {
      turns: readonly (readonly CodexObservedEvent[])[];
      endings?: readonly ("abort" | "fail")[];
    }) {
      this.turns = turns;
      this.endings = endings;
    }

    currentId(): string | null {
      return "thread-1";
    }

    async run({ onEvent }: { input: string; outputSchema: unknown; signal: AbortSignal; onEvent?: CodexEventSink }) {
      // A turn past the script streams nothing: a wrap-up the case did not script is a silent one.
      const scripted = this.turns[this.index];
      if (scripted !== undefined) {
        for (const event of scripted) {
          onEvent?.(event);
        }
      }
      // A turn the caller named no ending for aborts, which is how every case here behaved before endings
      // existed — so the absence is read here rather than substituted by an operator.
      const ending = this.endings[this.index];
      this.index += 1;
      if (ending === "fail") {
        return errAsync(toIngestError({ error: new Error("spawn failed"), operation: "codex.resume" }));
      }
      return errAsync(abortError());
    }
  }

  const INVESTIGATION: readonly CodexObservedEvent[] = [
    { item: { command: "nl -ba src/corpus/refresh.ts", exitCode: 0, itemKind: "command_execution" }, kind: "item" },
    { item: { command: "rg -n resolveSince src", exitCode: 1, itemKind: "command_execution" }, kind: "item" },
    { item: { command: "git log --oneline -20", exitCode: 0, itemKind: "command_execution" }, kind: "item" },
    {
      item: { itemKind: "agent_message", text: "The two cursor layers disagree; I have not finished checking." },
      kind: "item",
    },
  ];

  function runToDeadline({ thread }: { thread: LockedCodexThread }) {
    const runtime = new FakeRuntime();
    return runBoundedPass({
      bound: BOUND,
      client: { model: "gpt-5.6-sol", resumeThread: () => thread, startThread: () => thread },
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/scratch/pass.scratch",
    });
  }

  it("records what the pass had done instead of discarding it", async () => {
    const result = await runToDeadline({ thread: new StreamingThread({ turns: [INVESTIGATION, []] }) });

    expect(result.outcome.kind).toBe("no-verdict");
    const salvage = result.outcome.kind === "no-verdict" ? result.outcome.salvage : null;
    expect(salvage?.commands).toBe(3);
    expect(salvage?.failedCommands).toBe(1);
    expect(salvage?.lastAgentMessage).toBe("The two cursor layers disagree; I have not finished checking.");
    expect(salvage?.recentCommands).toEqual([
      "nl -ba src/corpus/refresh.ts",
      "rg -n resolveSince src",
      "git log --oneline -20",
    ]);
  });

  it("leaves the attempt's own items and usage NOT measured — the salvage is a different claim", async () => {
    const result = await runToDeadline({ thread: new StreamingThread({ turns: [INVESTIGATION, []] }) });

    expect(result.attempts[0]?.items.kind).toBe("not-measured");
    expect(result.attempts[0]?.usage.kind).toBe("not-measured");
  });

  it("records null rather than a record of zeroes when the pass truly did nothing", async () => {
    const result = await runToDeadline({ thread: new StreamingThread({ turns: [[], []] }) });

    expect(result.outcome.kind === "no-verdict" ? result.outcome.salvage : undefined).toBe(null);
  });

  /**
   * Found by a live `p1` pass reviewing this change, not by the suite. The relay used to run before the fold
   * and unguarded, so a caller's progress sink that threw silently removed the event from the fold — leaving
   * the tripwire blind to a command and the salvage wrong about what the pass had done.
   */
  it("folds an event even when the caller's own progress relay throws", async () => {
    const thread = new StreamingThread({ turns: [INVESTIGATION, []] });
    const result = await runBoundedPass({
      bound: BOUND,
      client: { model: "gpt-5.6-sol", resumeThread: () => thread, startThread: () => thread },
      onEvent: () => {
        throw new Error("the progress relay is broken");
      },
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime: new FakeRuntime(),
      validate: acceptAll,
      workingDirectory: "/scratch/pass.scratch",
    });

    expect(result.outcome.kind === "no-verdict" ? result.outcome.salvage?.commands : -1).toBe(3);
  });

  it("salvages the wrap-up turn's own message, not only the initial turn's", async () => {
    const result = await runToDeadline({
      thread: new StreamingThread({
        turns: [[], [{ item: { itemKind: "agent_message", text: "partial conclusion" }, kind: "item" }]],
      }),
    });

    expect(result.outcome.kind === "no-verdict" ? result.outcome.salvage?.lastAgentMessage : "").toBe(
      "partial conclusion",
    );
  });

  /**
   * The hole the nullable-and-required salvage was supposed to close, found open on the FATAL arm.
   *
   * MEASURED on a real pass: the initial turn investigated for
   * 764,968ms, was aborted at the 85% warn exactly as designed, and the conclusion turn then died on a
   * transport fault at 24,063ms — a 404 from `https://chatgpt.com/backend-api/codex/responses`, which four
   * sibling passes hit within the same half hour. Nothing about the fault was the pass's fault, and the whole
   * twelve minutes of investigation was discarded because the wrap-up turn lost the NETWORK rather than the
   * CLOCK. These two cases differ only in that one word, so they are asserted against each other.
   */
  it("keeps the initial turn's work when the conclusion turn dies on the TRANSPORT, not the clock", async () => {
    const result = await runToDeadline({
      thread: new StreamingThread({ endings: ["abort", "fail"], turns: [INVESTIGATION, []] }),
    });

    expect(result.outcome.kind).toBe("fatal");
    const salvage = result.outcome.kind === "fatal" ? result.outcome.salvage : null;
    expect(salvage?.commands).toBe(3);
    expect(salvage?.failedCommands).toBe(1);
    expect(salvage?.lastAgentMessage).toBe("The two cursor layers disagree; I have not finished checking.");
    expect(salvage?.recentCommands).toEqual([
      "nl -ba src/corpus/refresh.ts",
      "rg -n resolveSince src",
      "git log --oneline -20",
    ]);
  });

  it("keeps the same work when the INITIAL turn dies on the transport with no conclusion attempt at all", async () => {
    const result = await runToDeadline({
      thread: new StreamingThread({ endings: ["fail"], turns: [INVESTIGATION] }),
    });

    expect(result.outcome.kind).toBe("fatal");
    expect(result.attempts).toHaveLength(1);
    expect(result.outcome.kind === "fatal" ? result.outcome.salvage?.commands : -1).toBe(3);
  });

  it("records null on a FATAL that streamed nothing — the same distinction the no-verdict arm draws", async () => {
    const result = await runToDeadline({ thread: new StreamingThread({ endings: ["fail"], turns: [[]] }) });

    expect(result.outcome.kind).toBe("fatal");
    expect(result.outcome.kind === "fatal" ? result.outcome.salvage : undefined).toBe(null);
  });
});
