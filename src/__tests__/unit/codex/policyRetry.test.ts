import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { makePassBound } from "../../../codex/bounds.js";
import type { CodexTurnResult, LockedCodexClient, LockedCodexThread } from "../../../codex/client.js";
import { runReviewPassWithPolicyRetry } from "../../../codex/policyRetryPass.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { buildPolicyRetryPrompt } from "../../../codex/prompt.js";
import type { DeadlineRuntime, ScheduledTask } from "../../../codex/runPass.js";
import { runBoundedPass } from "../../../codex/runPass.js";
import type { PlanAnswer } from "../../../codex/types.js";
import { toIngestError } from "../../../lib/ingestError.js";
import { ok, type Result, unwrap } from "../../../lib/result.js";

/** OpenAI's own words, verbatim from a refused pass's rollout. */
const REFUSAL =
  "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. " +
  "To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber";

function acceptAll({ response }: { response: string }): Result<PlanAnswer> {
  return ok({ blockers: [], bodyMarkdown: response, summary: "s", verdict: "READY" });
}

/** A clock that only moves when a test moves it, firing whatever falls due. No fake timers, no mocks. */
class FakeRuntime implements DeadlineRuntime {
  private current = 0;
  private readonly pending: { dueAt: number; onFire: () => void; cancelled: boolean }[] = [];

  nowMs(): number {
    return this.current;
  }

  nowIso(): string {
    return new Date(Date.UTC(2026, 0, 1) + this.current).toISOString();
  }

  schedule({ delayMs, onFire }: { delayMs: number; onFire: () => void }): ScheduledTask {
    const entry = { cancelled: false, dueAt: this.current + delayMs, onFire };
    this.pending.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  advanceTo({ ms }: { ms: number }): void {
    this.current = ms;
    for (const entry of this.pending) {
      if (!entry.cancelled && entry.dueAt <= ms) {
        entry.cancelled = true;
        entry.onFire();
      }
    }
  }

  /** Every armed timer's due instant — proves a retry was scheduled against the ORIGINAL deadline. */
  armedDueAt(): readonly number[] {
    return this.pending.filter((p) => !p.cancelled).map((p) => p.dueAt);
  }
}

/** What one fresh thread does with its one turn, at a given instant on the fake clock. */
type Behaviour =
  | { readonly kind: "refuse"; readonly atMs: number }
  | { readonly kind: "fail"; readonly atMs: number }
  | { readonly kind: "answer"; readonly atMs: number }
  | { readonly kind: "abort-at-signal"; readonly atMs: number }
  /** Aborted at the warn on its first turn, then refused on the resumed conclusion turn. */
  | { readonly kind: "abort-then-refuse"; readonly atMs: number; readonly refuseAtMs: number };

class FakeThread implements LockedCodexThread {
  readonly inputs: string[] = [];
  readonly armedAtRun: (readonly number[])[] = [];

  private readonly id: string;
  private readonly behaviour: Behaviour;
  private readonly runtime: FakeRuntime;

  constructor({ id, behaviour, runtime }: { id: string; behaviour: Behaviour; runtime: FakeRuntime }) {
    this.id = id;
    this.behaviour = behaviour;
    this.runtime = runtime;
  }

  currentId(): string | null {
    return this.id;
  }

  async run({ input }: { input: string; outputSchema: unknown; signal: AbortSignal }) {
    this.inputs.push(input);
    this.armedAtRun.push(this.runtime.armedDueAt());
    if (this.behaviour.kind === "abort-then-refuse" && this.inputs.length > 1) {
      this.runtime.advanceTo({ ms: this.behaviour.refuseAtMs });
      return errAsync(toIngestError({ error: new Error(REFUSAL), operation: "codex.run" }));
    }
    this.runtime.advanceTo({ ms: this.behaviour.atMs });
    if (this.behaviour.kind === "answer") {
      const turn: CodexTurnResult = {
        finalResponse: "{}",
        items: { counts: { agent_message: 1 }, kind: "measured" },
        usage: {
          kind: "measured",
          usage: {
            cache_write_input_tokens: 0,
            cached_input_tokens: 0,
            input_tokens: 1,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        },
      };
      return okAsync<CodexTurnResult>(turn);
    }
    if (this.behaviour.kind === "abort-at-signal" || this.behaviour.kind === "abort-then-refuse") {
      return errAsync(
        toIngestError({
          error: Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
          operation: "codex.run",
        }),
      );
    }
    const message = this.behaviour.kind === "refuse" ? REFUSAL : "stream disconnected before completion";
    return errAsync(toIngestError({ error: new Error(message), operation: "codex.run" }));
  }
}

/** A client whose `startThread` hands out prepared threads in order, and counts every start and resume. */
function queueClient({ threads }: { threads: readonly FakeThread[] }): {
  client: LockedCodexClient;
  starts: () => number;
  resumes: () => number;
} {
  let started = 0;
  let resumed = 0;
  return {
    client: {
      model: CODEX_MODEL,
      resumeThread: () => {
        resumed += 1;
        return threads[started - 1]!;
      },
      startThread: () => {
        started += 1;
        return threads[started - 1]!;
      },
    },
    resumes: () => resumed,
    starts: () => started,
  };
}

/** 240s: warn at 204,000ms, deadline at 240,000ms. */
const BOUND = unwrap(makePassBound({ boundSeconds: 240 }));
const PROMPT = "review the packet at /scratch/review-packet.md";

async function run({ behaviours, retry }: { behaviours: readonly Behaviour[]; retry: boolean }): Promise<{
  result: Awaited<ReturnType<typeof runBoundedPass>>;
  threads: readonly FakeThread[];
  starts: number;
  resumes: number;
  runtime: FakeRuntime;
}> {
  const runtime = new FakeRuntime();
  const threads = behaviours.map((behaviour, i) => new FakeThread({ behaviour, id: `t${String(i + 1)}`, runtime }));
  const queue = queueClient({ threads });
  const args = {
    bound: BOUND,
    client: queue.client,
    outputSchema: {},
    prompt: PROMPT,
    repoRoot: "/repo",
    runtime,
    validate: acceptAll,
    workingDirectory: "/scratch",
  };
  // A plan runs `runBoundedPass` directly and so never retries; a review runs through the retry wrapper.
  const result = retry ? await runReviewPassWithPolicyRetry(args) : await runBoundedPass(args);
  return { result, resumes: queue.resumes(), runtime, starts: queue.starts(), threads };
}

describe("runReviewPassWithPolicyRetry — one fresh thread after a cyber-policy refusal", () => {
  it("retries once on a fresh thread and returns the retry's answer, keeping the refusal on the first attempt", async () => {
    const { result, starts, resumes, threads } = await run({
      behaviours: [
        { atMs: 60_000, kind: "refuse" },
        { atMs: 90_000, kind: "answer" },
      ],
      retry: true,
    });
    expect(result.outcome.kind).toBe("answered");
    expect(starts).toBe(2);
    expect(resumes).toBe(0);
    expect(result.attempts.map((a) => [a.kind, a.status, a.threadId])).toEqual([
      ["initial", "failed", "t1"],
      ["policy-retry", "answered", "t2"],
    ]);
    expect(result.attempts[0]!.cause!.reported).toBe(null);
    expect(result.attempts[0]!.cause!.thrown).toBe(REFUSAL);
    expect(result.attempts[1]!.cause).toBe(undefined);
    expect(result.observedElapsedMs).toBe(90_000);
    // The whole original prompt, re-sent verbatim beneath the preamble — nothing dropped from what it reads.
    expect(threads[1]!.inputs).toEqual([buildPolicyRetryPrompt({ prompt: PROMPT })]);
    expect(threads[1]!.inputs[0]!.endsWith(`\n\n${PROMPT}`)).toBe(true);
  });

  it("stops after the second refusal: two threads, both causes recorded, the outcome fatal", async () => {
    const { result, starts } = await run({
      behaviours: [
        { atMs: 60_000, kind: "refuse" },
        { atMs: 120_000, kind: "refuse" },
        { atMs: 130_000, kind: "answer" },
      ],
      retry: true,
    });
    expect(starts).toBe(2);
    expect(result.outcome.kind).toBe("fatal");
    expect(result.attempts.map((a) => [a.kind, a.cause!.thrown])).toEqual([
      ["initial", REFUSAL],
      ["policy-retry", REFUSAL],
    ]);
  });

  it("never takes a retry's answer that arrives past the original deadline as a verdict", async () => {
    // The transport ignores the abort at 240,000 and answers at 241,000: past the bound, so no verdict.
    const { result } = await run({
      behaviours: [
        { atMs: 210_000, kind: "refuse" },
        { atMs: 241_000, kind: "answer" },
      ],
      retry: true,
    });
    expect(result.outcome).toMatchObject({
      kind: "no-verdict",
      rawFinalResponse: "{}",
      reason: "no-conclusion-in-bound",
    });
    expect(result.observedElapsedMs).toBe(241_000);
  });

  it("never takes a lone pass's late answer as a verdict either", async () => {
    const { result } = await run({ behaviours: [{ atMs: 241_000, kind: "answer" }], retry: false });
    expect(result.outcome).toMatchObject({ kind: "no-verdict", reason: "no-conclusion-in-bound" });
  });
  it("schedules the retry against the ORIGINAL deadline and warn, never a fresh bound", async () => {
    const { threads } = await run({
      behaviours: [
        { atMs: 60_000, kind: "refuse" },
        { atMs: 90_000, kind: "answer" },
      ],
      retry: true,
    });
    // Armed while the retry ran: the original warn (204,000) and deadline (240,000), not 60,000 + either.
    expect([...threads[1]!.armedAtRun[0]!].toSorted((a, b) => a - b)).toEqual([204_000, 240_000]);
  });

  it("gives a retry that starts after the warn the remainder only, with no warn of its own", async () => {
    const { threads } = await run({
      behaviours: [
        { atMs: 210_000, kind: "refuse" },
        { atMs: 220_000, kind: "answer" },
      ],
      retry: true,
    });
    expect(threads[1]!.armedAtRun[0]).toEqual([240_000]);
  });

  it("does not retry when the refusal spent the whole bound", async () => {
    const { result, starts } = await run({
      behaviours: [
        { atMs: 240_000, kind: "refuse" },
        { atMs: 240_000, kind: "answer" },
      ],
      retry: true,
    });
    expect(starts).toBe(1);
    expect(result.outcome.kind).toBe("fatal");
  });

  it("never retries a fault that is not the policy refusal", async () => {
    const { result, starts } = await run({
      behaviours: [
        { atMs: 60_000, kind: "fail" },
        { atMs: 90_000, kind: "answer" },
      ],
      retry: true,
    });
    expect(starts).toBe(1);
    expect(result.outcome.kind).toBe("fatal");
    expect(result.attempts[0]!.cause!.thrown).toBe("stream disconnected before completion");
  });

  it("never retries a pass whose caller supplied no retry prompt — a plan", async () => {
    const { result, starts } = await run({
      behaviours: [
        { atMs: 60_000, kind: "refuse" },
        { atMs: 90_000, kind: "answer" },
      ],
      retry: false,
    });
    expect(starts).toBe(1);
    expect(result.outcome.kind).toBe("fatal");
    expect(result.attempts[0]!.cause!.thrown).toBe(REFUSAL);
  });

  it("never retries a refusal on the conclusion turn — only a refused INITIAL turn earns the fresh thread", async () => {
    const { result, starts, resumes } = await run({
      behaviours: [
        { atMs: 204_000, kind: "abort-then-refuse", refuseAtMs: 210_000 },
        { atMs: 220_000, kind: "answer" },
      ],
      retry: true,
    });
    expect(result.attempts.map((a) => `${a.kind}=${a.status}`)).toEqual(["initial=aborted", "conclusion=failed"]);
    expect(result.outcome.kind).toBe("fatal");
    expect(starts).toBe(1);
    expect(resumes).toBe(1);
  });

  it("records no cause on an aborted attempt, only on a failed one", async () => {
    const { result } = await run({
      behaviours: [{ atMs: 240_000, kind: "abort-at-signal" }],
      retry: true,
    });
    expect(result.attempts[0]!.status).toBe("aborted");
    expect(result.attempts[0]!.cause).toBe(undefined);
  });
});
