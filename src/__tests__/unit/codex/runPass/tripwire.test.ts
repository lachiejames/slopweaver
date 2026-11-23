/*
 * The off-track tripwire driven through `runBoundedPass`: a pass whose every early command fails is killed and
 * says why, a pass that is finding things runs to its answer, and a tripwire abort gets no wrap-up turn.
 */

import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { toIngestError } from "#lib/ingestError.js";
import type { CodexTurnResult, LockedCodexClient, LockedCodexThread } from "../../../../codex/client.js";
import { runBoundedPass } from "../../../../codex/runPass.js";
import { acceptAll, answeredTurn, BOUND, FakeRuntime, FakeThread, USAGE } from "./harness.js";

/**
 * The tripwire, wired end to end through the state machine.
 *
 * These matter more than the pure-function tests next door: a rule that is correct in isolation and never
 * reaches the pass is the inert-check defect this repo pays for repeatedly. Each of these drives
 * `runBoundedPass` itself.
 */
describe("aborting a pass that has gone hunting", () => {
  /** A thread that emits `exits` as command results, then answers — unless the signal aborts first. */
  function huntingThread({ exits }: { exits: readonly number[] }): LockedCodexThread {
    return {
      currentId: () => "t1",
      run: async ({ signal, onEvent }) => {
        for (const exitCode of exits) {
          onEvent?.({
            item: { command: `cat missing-${String(exitCode)}.md`, exitCode, itemKind: "command_execution" },
            kind: "item",
          });
          if (signal.aborted) {
            return errAsync(
              toIngestError({
                defaultKind: "llm",
                error: Object.assign(new Error("aborted"), { name: "AbortError" }),
                operation: "codex.run",
                provider: "codex",
              }),
            );
          }
        }
        return okAsync<CodexTurnResult>({
          finalResponse: "{}",
          items: { counts: {}, kind: "measured" },
          usage: { kind: "measured", usage: USAGE },
        });
      },
    };
  }

  /** A client whose first thread hunts; the resume thread is recorded so we can assert it was never used. */
  function huntingClient({ exits, resume }: { exits: readonly number[]; resume?: FakeThread }): LockedCodexClient {
    const start = huntingThread({ exits });
    return {
      model: "gpt-5.6-sol",
      resumeThread: () => {
        // With no resume thread named, a resume lands back on the hunting thread itself.
        if (resume === undefined) {
          return start;
        }
        return resume;
      },
      startThread: () => start,
    };
  }

  it("kills a pass whose every early command fails, and says why", async () => {
    const result = await runBoundedPass({
      bound: BOUND,
      client: huntingClient({ exits: [1, 1, 1, 1] }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime: new FakeRuntime(),
      validate: acceptAll,
      workingDirectory: "/scratch",
    });

    expect(result.outcome.kind).toBe("no-verdict");
    expect(result.outcome.kind === "no-verdict" ? result.outcome.reason : "").toBe("off-track");
    expect(result.outcome.kind === "no-verdict" ? result.outcome.rawFinalResponse : "").toContain("stopped early");
  });

  it("lets a pass that is finding things run to its answer", async () => {
    const result = await runBoundedPass({
      bound: BOUND,
      client: huntingClient({ exits: [0, 1, 0, 0] }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime: new FakeRuntime(),
      validate: acceptAll,
      workingDirectory: "/scratch",
    });

    expect(result.outcome.kind).toBe("answered");
  });

  /**
   * An aborted pass gets NO wrap-up turn. A wrap-up asks a pass to conclude from what it has, and a pass that
   * was reading the wrong thing has nothing worth concluding from — asking would buy a confident wrong answer.
   */
  it("does not attempt a wrap-up turn after a tripwire abort", async () => {
    const resumed = new FakeThread({ behaviour: { kind: "answer", turn: answeredTurn({ response: "{}" }) }, id: "t2" });
    const result = await runBoundedPass({
      bound: BOUND,
      client: huntingClient({ exits: [1, 1, 1, 1], resume: resumed }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime: new FakeRuntime(),
      validate: acceptAll,
      workingDirectory: "/scratch",
    });

    expect(resumed.seen).toEqual([]);
    expect(result.attempts).toHaveLength(1);
  });
});
