/**
 * The settle loop over a scripted client and a fake monotonic clock. Each scripted command can advance the
 * clock by how long it "took", and each sleep advances it by what was slept, so the 6000 ms budget and the
 * 250 ms pulse interval are exercised exactly — including the pulse that runs up to or across the deadline,
 * which is followed by no sleep at all.
 */
import { describe, expect, it } from "vitest";

import { type BrowserActionError, BrowserActionErrors } from "../../../browser/actionErrors.js";
import type { PagePulse } from "../../../browser/pageSettle.js";
import { PAGE_PULSE_SOURCE } from "../../../browser/pageSettle.js";
import { settlePage } from "../../../browser/pageSettleRun.js";
import type { TerminalClientDeps, TerminalReply } from "../../../browser/terminalClient.js";
import { err, ok, type Result } from "../../../lib/result.js";

const DEPS: TerminalClientDeps = {
  chromePinPath: "/fake/chrome-pin",
  clientSession: "settle-test",
  extensionToken: "not-a-real-token",
  placement: "background",
  workspace: "/fake/workspace",
};

const START_MS = 10_000;

/** A complete, titled pulse with the given element count. */
function pulse({ elementCount }: { elementCount: number }): PagePulse {
  return { elementCount, ready: "complete", textLength: 6231, title: "APM Home | Datadog" };
}

/** A reply whose stdout is the eval result the client prints. */
function reply({ stdout }: { stdout: string }): TerminalReply {
  return { modalState: null, pageTitle: null, pageUrl: null, snapshotPath: null, snapshotYaml: null, stdout };
}

/** The client's eval reply carrying one pulse. */
function pulseReply({ elementCount }: { elementCount: number }): Result<TerminalReply, BrowserActionError> {
  const value = pulse({ elementCount });
  return ok(reply({ stdout: `### Ran Playwright code\n### Result\n${JSON.stringify(value, null, 2)}\n` }));
}

/** One scripted command: what it answers, and how long it takes on the fake clock. */
interface Step {
  readonly answer: Result<TerminalReply, BrowserActionError>;
  readonly takesMs: number;
}

/** Run the loop over a script, recording every command's argv and every sleep. */
function run({ script }: { script: readonly Step[] }): { commands: (readonly string[])[]; sleeps: number[] } {
  let now = START_MS;
  const commands: (readonly string[])[] = [];
  const sleeps: number[] = [];
  settlePage({
    deps: DEPS,
    monotonicMs: () => now,
    runCommand: ({ args, deps }) => {
      expect(deps).toBe(DEPS);
      const step = script[commands.length]!;
      commands.push(args);
      now += step.takesMs;
      return step.answer;
    },
    sleep: (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  return { commands, sleeps };
}

const EVAL = ["eval", PAGE_PULSE_SOURCE];

describe("settlePage", () => {
  it("stops after two agreeing pulses: two eval commands and one 250 ms sleep between them", () => {
    const result = run({
      script: [
        { answer: pulseReply({ elementCount: 1840 }), takesMs: 0 },
        { answer: pulseReply({ elementCount: 1840 }), takesMs: 0 },
      ],
    });

    expect(result.commands).toEqual([EVAL, EVAL]);
    expect(result.sleeps).toEqual([250]);
  });

  it("stops at once, with no sleep, when the client command fails", () => {
    const result = run({ script: [{ answer: err(BrowserActionErrors.sessionIdle({ sessionId: "s1" })), takesMs: 0 }] });

    expect(result.commands).toEqual([EVAL]);
    expect(result.sleeps).toEqual([]);
  });

  it("stops at once, with no sleep, when the reply carries no readable pulse", () => {
    const result = run({ script: [{ answer: ok(reply({ stdout: "### Ran Playwright code\n" })), takesMs: 0 }] });

    expect(result.commands).toEqual([EVAL]);
    expect(result.sleeps).toEqual([]);
  });

  it("keeps polling while the element count moves, and stops once it holds still", () => {
    const result = run({
      script: [
        { answer: pulseReply({ elementCount: 900 }), takesMs: 0 },
        { answer: pulseReply({ elementCount: 1500 }), takesMs: 0 },
        { answer: pulseReply({ elementCount: 1840 }), takesMs: 0 },
        { answer: pulseReply({ elementCount: 1840 }), takesMs: 0 },
      ],
    });

    expect(result.commands).toEqual([EVAL, EVAL, EVAL, EVAL]);
    expect(result.sleeps).toEqual([250, 250, 250]);
  });

  it("gives up at the 6000 ms budget on a page that never settles: 24 pulses, each followed by 250 ms", () => {
    const script = Array.from({ length: 30 }, (_, index) => ({
      answer: pulseReply({ elementCount: index }),
      takesMs: 0,
    }));

    const result = run({ script });

    expect(result.commands.length).toBe(24);
    expect(result.sleeps).toEqual(Array.from({ length: 24 }, () => 250));
  });

  it("sleeps only the 100 ms left when a pulse ends 100 ms short of the deadline, then stops", () => {
    const result = run({ script: [{ answer: pulseReply({ elementCount: 1 }), takesMs: 5900 }] });

    expect(result.commands).toEqual([EVAL]);
    expect(result.sleeps).toEqual([100]);
  });

  it("does not sleep at all after a pulse that ends exactly on the deadline", () => {
    const result = run({ script: [{ answer: pulseReply({ elementCount: 1 }), takesMs: 6000 }] });

    expect(result.commands).toEqual([EVAL]);
    expect(result.sleeps).toEqual([]);
  });

  it("does not sleep at all after a pulse that runs past the deadline", () => {
    const result = run({ script: [{ answer: pulseReply({ elementCount: 1 }), takesMs: 6100 }] });

    expect(result.commands).toEqual([EVAL]);
    expect(result.sleeps).toEqual([]);
  });
});
