import { describe, expect, it } from "vitest";

import { detectLimitRetryBanner } from "../../../claude/limitBanner.js";

/**
 * The exact line both stranded bot workers rendered, captured from
 * `cmux read-screen` on each worker's workspace.
 */
const CAPTURED = "✻ Weekly limit reached · Retrying in 5h (Sep 13 at 8am) · attempt 1/300";

/** The screen those workers actually showed: their delivered pickup command, then the banner. */
const WORKER_SCREEN = [
  '  ["D0SYN000001","1788698327.707229","1788698327.707229"] to load your brief and',
  "  the decision that dispatched you here, then follow the numbered steps it prints,",
  CAPTURED,
  "─────────────────────────────────────────────── ask-D0SYN000001-1788698327.707229 ─",
].join("\n");

describe("detectLimitRetryBanner", () => {
  it("finds the captured banner in the screen the stranded workers showed", () => {
    expect(detectLimitRetryBanner({ text: WORKER_SCREEN })).toBe(CAPTURED);
  });

  it("does not care which window ran out", () => {
    expect(detectLimitRetryBanner({ text: "✻ 5-hour limit reached · Retrying in 42m · attempt 1/300" })).toBe(
      "✻ 5-hour limit reached · Retrying in 42m · attempt 1/300",
    );
  });

  it("leaves a healthy booted session alone", () => {
    expect(detectLimitRetryBanner({ text: "✻ Crunched for 15m 51s · done 11:58 am · 1 monitor still running" })).toBe(
      undefined,
    );
  });

  it("does not fire on an ask that merely mentions a limit, because the retry chrome is required", () => {
    const asking = "> why did the staging pool hit its connection limit reached state last night?";
    expect(detectLimitRetryBanner({ text: asking })).toBe(undefined);
  });

  it("does not join the two halves across separate lines", () => {
    expect(detectLimitRetryBanner({ text: "the limit reached us\nRetrying in the morning" })).toBe(undefined);
  });
});
