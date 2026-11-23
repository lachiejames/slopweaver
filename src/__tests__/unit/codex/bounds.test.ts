import { describe, expect, it } from "vitest";
import {
  aggregateExitCode,
  armBound,
  formatUsage,
  MAX_BOUND_SECONDS,
  makePassBound,
  WARN_FRACTION,
  warnIsWorthwhile,
} from "../../../codex/bounds.js";
import { CodexErrors } from "../../../codex/errors.js";
import type { DeadlineRuntime } from "../../../codex/runPass.js";
import type { CodexPassOutcome, CodexUsage } from "../../../codex/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const USAGE: CodexUsage = {
  cache_write_input_tokens: 3,
  cached_input_tokens: 2,
  input_tokens: 1,
  output_tokens: 4,
  reasoning_output_tokens: 5,
};

const ANSWERED: CodexPassOutcome = {
  answer: { blockers: [], bodyMarkdown: "body", summary: "s", verdict: "READY" },
  kind: "answered",
  rawFinalResponse: "{}",
};
const NO_VERDICT: CodexPassOutcome = {
  kind: "no-verdict",
  rawFinalResponse: null,
  reason: "invalid-output",
  salvage: null,
};
const FATAL: CodexPassOutcome = {
  cause: { quota: null, reported: null, thrown: "boom" },
  error: { kind: "llm", message: "boom", operation: "codex.run" },
  kind: "fatal",
  salvage: null,
};

describe("makePassBound", () => {
  it("splits a 240s bound into the measured 85% warn point and the remainder", () => {
    const bound = unwrap(makePassBound({ boundSeconds: 240 }));
    expect(bound.totalMs).toBe(240_000);
    expect(bound.warnAfterMs).toBe(204_000);
    expect(bound.conclusionWindowMs).toBe(36_000);
  });

  it("splits a 7200s planning bound the same way", () => {
    const bound = unwrap(makePassBound({ boundSeconds: 7200 }));
    expect(bound.totalMs).toBe(7_200_000);
    expect(bound.warnAfterMs).toBe(6_120_000);
    expect(bound.conclusionWindowMs).toBe(1_080_000);
  });

  it("keeps warn + conclusion exactly equal to the total, so a warn cannot extend the deadline", () => {
    const bound = unwrap(makePassBound({ boundSeconds: 137 }));
    expect(bound.warnAfterMs + bound.conclusionWindowMs).toBe(bound.totalMs);
  });

  it("uses 0.85 as the warn fraction", () => {
    expect(WARN_FRACTION).toBe(0.85);
  });

  it("refuses zero", () => {
    expect(unwrapErr(makePassBound({ boundSeconds: 0 }))).toEqual(CodexErrors.boundNotPositive({ boundSeconds: 0 }));
    expect(unwrapErr(makePassBound({ boundSeconds: 0 })).message).toBe(
      "--bound-seconds must be greater than zero, got 0",
    );
  });

  it("refuses a negative bound", () => {
    expect(unwrapErr(makePassBound({ boundSeconds: -5 }))).toEqual(CodexErrors.boundNotPositive({ boundSeconds: -5 }));
    expect(unwrapErr(makePassBound({ boundSeconds: -5 })).message).toContain("greater than zero");
  });

  it("refuses a fractional bound", () => {
    expect(unwrapErr(makePassBound({ boundSeconds: 1.5 }))).toEqual(CodexErrors.boundNotWhole({ boundSeconds: 1.5 }));
    expect(unwrapErr(makePassBound({ boundSeconds: 1.5 })).message).toContain("whole number");
  });

  it("refuses a non-finite bound", () => {
    const infinite = unwrapErr(makePassBound({ boundSeconds: Number.POSITIVE_INFINITY }));
    expect(infinite).toEqual(CodexErrors.boundNotWhole({ boundSeconds: Number.POSITIVE_INFINITY }));
    expect(infinite.message).toContain("whole number");
  });

  it("refuses a bound over 24 hours", () => {
    const over = unwrapErr(makePassBound({ boundSeconds: MAX_BOUND_SECONDS + 1 }));
    expect(over).toEqual(CodexErrors.boundTooLarge({ boundSeconds: MAX_BOUND_SECONDS + 1, max: MAX_BOUND_SECONDS }));
    expect(over.message).toContain("at most 86400");
  });

  it("accepts exactly the maximum", () => {
    expect(unwrap(makePassBound({ boundSeconds: MAX_BOUND_SECONDS })).totalMs).toBe(86_400_000);
  });
});

describe("warnIsWorthwhile", () => {
  it("is true for a bound whose remainder can hold a conclusion", () => {
    expect(warnIsWorthwhile({ bound: unwrap(makePassBound({ boundSeconds: 240 })) })).toBe(true);
  });

  it("is false for a bound so short the interrupt would cost more than it buys", () => {
    // 10s → 8.5s warn, 1.5s conclusion window: below the 5s floor.
    expect(warnIsWorthwhile({ bound: unwrap(makePassBound({ boundSeconds: 10 })) })).toBe(false);
  });
});

describe("aggregateExitCode", () => {
  it("returns 0 when every pass answered — including BROKEN, which is a successful review", () => {
    expect(aggregateExitCode({ outcomes: [ANSWERED, ANSWERED] })).toBe(0);
  });

  it("returns 3 when any pass produced no verdict, so a non-answer never reads as clean", () => {
    expect(aggregateExitCode({ outcomes: [ANSWERED, NO_VERDICT] })).toBe(3);
  });

  it("returns 1 when any pass was fatal, even alongside a pass that answered", () => {
    expect(aggregateExitCode({ outcomes: [ANSWERED, FATAL] })).toBe(1);
  });

  it("prefers fatal over no-verdict — a transport fault is not masked by a sibling", () => {
    expect(aggregateExitCode({ outcomes: [NO_VERDICT, FATAL, ANSWERED] })).toBe(1);
  });

  it("returns 3 for an empty set — nothing ran, so nothing is clean", () => {
    expect(aggregateExitCode({ outcomes: [] })).toBe(3);
  });
});

describe("formatUsage", () => {
  it("prints all five counters when measured", () => {
    expect(formatUsage({ usage: { kind: "measured", usage: USAGE } })).toEqual([
      "input_tokens: 1",
      "cached_input_tokens: 2",
      "cache_write_input_tokens: 3",
      "output_tokens: 4",
      "reasoning_output_tokens: 5",
    ]);
  });

  it("prints a genuine measured ZERO as 0, not as a dash", () => {
    const zeroed: CodexUsage = {
      cache_write_input_tokens: 0,
      cached_input_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
    };
    expect(formatUsage({ usage: { kind: "measured", usage: zeroed } })[0]).toBe("input_tokens: 0");
  });

  it("prints a dash and the reason for an aborted attempt — never a zero", () => {
    const lines = formatUsage({ usage: { kind: "not-measured", reason: "aborted" } });
    expect(lines).toEqual(["- (not measured: aborted)"]);
  });

  it("distinguishes sdk-reported-none from aborted", () => {
    expect(formatUsage({ usage: { kind: "not-measured", reason: "sdk-reported-none" } })).toEqual([
      "- (not measured: sdk-reported-none)",
    ]);
  });

  it("never emits the digit 0 for an unmeasured attempt", () => {
    const lines = formatUsage({ usage: { kind: "not-measured", reason: "transport-failed" } });
    expect(lines.join(" ")).not.toContain("0");
  });
});

describe("armBound", () => {
  /** A runtime frozen at `nowMs` that records each delay it is asked to schedule. */
  function frozenRuntime({ nowMs }: { nowMs: number }): { runtime: DeadlineRuntime; delays: number[] } {
    const delays: number[] = [];
    const runtime: DeadlineRuntime = {
      nowIso: () => "2026-09-23T00:00:00.000Z",
      nowMs: () => nowMs,
      schedule: ({ delayMs }) => {
        delays.push(delayMs);
        return { cancel: () => undefined };
      },
    };
    return { delays, runtime };
  }

  it("arms the deadline at the anchor's absolute instant, so a gap before arming never extends it", () => {
    const { delays, runtime } = frozenRuntime({ nowMs: 220_000 });
    const armed = armBound({ anchorMs: 0, bound: unwrap(makePassBound({ boundSeconds: 240 })), runtime });
    expect(delays).toEqual([20_000]);
    expect(armed.warnTask).toBe(undefined);
  });

  it("keeps the original warn instant while it is still ahead", () => {
    const { delays, runtime } = frozenRuntime({ nowMs: 100_000 });
    armBound({ anchorMs: 0, bound: unwrap(makePassBound({ boundSeconds: 240 })), runtime });
    expect(delays).toEqual([140_000, 104_000]);
  });

  it("fires the deadline at once when the anchor's bound has already passed", () => {
    const { delays, runtime } = frozenRuntime({ nowMs: 300_000 });
    armBound({ anchorMs: 0, bound: unwrap(makePassBound({ boundSeconds: 240 })), runtime });
    expect(delays).toEqual([0]);
  });
});

describe("armBound — a clock that moves while it arms", () => {
  it("never arms a warn past the original warn instant when registering the deadline took time", () => {
    // The clock reads 203,999 until the deadline is registered, then 204,001: the warn has already passed.
    let nowMs = 203_999;
    const delays: number[] = [];
    const runtime: DeadlineRuntime = {
      nowIso: () => "2026-09-23T00:00:00.000Z",
      nowMs: () => nowMs,
      schedule: ({ delayMs }) => {
        delays.push(delayMs);
        nowMs = 204_001;
        return { cancel: () => undefined };
      },
    };
    const armed = armBound({ anchorMs: 0, bound: unwrap(makePassBound({ boundSeconds: 240 })), runtime });
    expect(delays).toEqual([36_001]);
    expect(armed.warnTask).toBe(undefined);
  });
});
