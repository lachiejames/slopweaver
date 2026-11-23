/*
 * What more than one `runBoundedPass` test file shares: the measured usage every answered turn reports, a
 * validator that accepts anything, a controllable clock, a thread whose one turn resolves however the case says,
 * the abort error the SDK raises, a client that hands out prepared threads and the 240-second bound. A plain
 * module, not a `*.test.ts`, so no test registers twice. It was split out when the bounded-pass suite became one
 * file per behaviour.
 */

import { errAsync, okAsync } from "neverthrow";
import { type IngestError, toIngestError } from "#lib/ingestError.js";
import { ok, type Result, unwrap } from "#lib/result.js";
import { makePassBound } from "../../../../codex/bounds.js";
import type { CodexTurnResult, LockedCodexClient, LockedCodexThread } from "../../../../codex/client.js";
import type { DeadlineRuntime, ScheduledTask } from "../../../../codex/runPass.js";
import type { CodexUsage, PassBound, PlanAnswer } from "../../../../codex/types.js";

/** The usage every answered turn reports, so a measured attempt's usage is exact. */
export const USAGE: CodexUsage = {
  cache_write_input_tokens: 0,
  cached_input_tokens: 20,
  input_tokens: 100,
  output_tokens: 10,
  reasoning_output_tokens: 5,
};

/**
 * A validator that always accepts.
 *
 * @returns a READY plan answer whose body is the response itself
 */
export function acceptAll({ response }: { response: string }): Result<PlanAnswer> {
  return ok({ blockers: [], bodyMarkdown: response, summary: "s", verdict: "READY" });
}

/**
 * A controllable clock and timer set. Nothing waits: `advanceTo` fires whatever is due, so every branch of
 * the state machine is reachable synchronously and deterministically. No fake timers, no mocks.
 */
export class FakeRuntime implements DeadlineRuntime {
  private current = 0;
  private readonly pending: { dueAt: number; onFire: () => void; cancelled: boolean }[] = [];

  /**
   * The fake clock's current reading.
   *
   * @returns milliseconds since the fake epoch
   */
  nowMs(): number {
    return this.current;
  }

  /**
   * The fake clock's current reading as an instant.
   *
   * @returns the ISO instant that many milliseconds after the fake clock's epoch
   */
  nowIso(): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + this.current).toISOString();
  }

  /**
   * Arm a timer that fires once the clock is advanced past its due instant.
   *
   * @returns a handle whose `cancel` disarms the timer
   */
  schedule({ delayMs, onFire }: { delayMs: number; onFire: () => void }): ScheduledTask {
    const entry = { cancelled: false, dueAt: this.current + delayMs, onFire };
    this.pending.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  /** Move the clock forward and fire everything now due, in order. */
  advanceTo({ ms }: { ms: number }): void {
    this.current = ms;
    for (const entry of this.pending) {
      if (!entry.cancelled && entry.dueAt <= ms) {
        entry.cancelled = true;
        entry.onFire();
      }
    }
  }

  /**
   * How many timers are still armed — proves cancellation happened.
   *
   * @returns the count of timers neither fired nor cancelled
   */
  armedCount(): number {
    return this.pending.filter((p) => !p.cancelled).length;
  }
}

/** How a fake thread behaves for its one turn. */
interface FakeThreadOpts {
  readonly id: string | null;
  readonly behaviour:
    | { readonly kind: "answer"; readonly turn: CodexTurnResult }
    | { readonly kind: "abort" }
    | { readonly kind: "fail" }
    | { readonly kind: "abort-on-signal"; readonly runtime: FakeRuntime; readonly fireAtMs: number }
    | {
        readonly kind: "answer-at";
        readonly runtime: FakeRuntime;
        readonly atMs: number;
        readonly turn: CodexTurnResult;
      };
}

/** A thread whose single turn resolves however the test says. */
export class FakeThread implements LockedCodexThread {
  readonly seen: { input: string; hadSignal: boolean }[] = [];

  private readonly opts: FakeThreadOpts;

  constructor(opts: FakeThreadOpts) {
    this.opts = opts;
  }

  /**
   * The thread id the case named.
   *
   * @returns that id, or null for a turn aborted before its id existed
   */
  currentId(): string | null {
    return this.opts.id;
  }

  /**
   * Run the one turn, recording its input, and resolve it the way the case's behaviour says.
   *
   * @returns the scripted turn, an abort, or a transport failure
   */
  async run({
    input,
    signal,
  }: {
    input: string;
    outputSchema: unknown;
    signal: AbortSignal;
  }): Promise<Result<CodexTurnResult, IngestError>> {
    this.seen.push({ hadSignal: signal instanceof AbortSignal, input });
    const behaviour = this.opts.behaviour;
    if (behaviour.kind === "answer") {
      return okAsync<CodexTurnResult>(behaviour.turn);
    }
    if (behaviour.kind === "answer-at") {
      // Resolve SUCCESSFULLY but late: the abort was requested and the SDK handled it slowly.
      behaviour.runtime.advanceTo({ ms: behaviour.atMs });
      return okAsync<CodexTurnResult>(behaviour.turn);
    }
    if (behaviour.kind === "abort-on-signal") {
      behaviour.runtime.advanceTo({ ms: behaviour.fireAtMs });
      return errAsync(abortError());
    }
    if (behaviour.kind === "abort") {
      return errAsync(abortError());
    }
    return errAsync(toIngestError({ error: new Error("spawn failed"), operation: "codex.run" }));
  }
}

/**
 * The error the SDK raises when a turn's signal aborts it.
 *
 * @returns an ingest error wrapping an `AbortError`
 */
export function abortError(): IngestError {
  return toIngestError({
    error: Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    operation: "codex.run",
  });
}

/**
 * A turn that answered with one agent message and measured usage.
 *
 * @returns that turn, its final response the one given
 */
export function answeredTurn({ response }: { response: string }): CodexTurnResult {
  return {
    finalResponse: response,
    items: { counts: { agent_message: 1 }, kind: "measured" },
    usage: { kind: "measured", usage: USAGE },
  };
}

/**
 * A client that hands out prepared threads: the first for start, the second for resume.
 *
 * @returns a locked client whose start and resume answer those threads
 */
export function clientOf({ start, resume = start }: { start: FakeThread; resume?: FakeThread }): LockedCodexClient {
  return {
    model: "gpt-5.6-sol",
    resumeThread: () => resume,
    startThread: () => start,
  };
}

/** The 240-second bound every case runs under bar the one that names its own. */
export const BOUND: PassBound = unwrap(makePassBound({ boundSeconds: 240 }));
