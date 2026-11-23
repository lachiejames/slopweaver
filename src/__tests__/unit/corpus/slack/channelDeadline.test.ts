/**
 * The per-conversation progress watchdog itself: what re-arms it, what it reports when it fires, and how a
 * configured stall window is resolved.
 *
 * Driven through an injected timer and an injected clock rather than by waiting, so every figure on a skip
 * line is asserted exactly. That matters more here than usual: the PHASE and the elapsed figures are the
 * whole product of this change — they are the dataset the root-cause work reads, and a field that is
 * plausible but wrong would send it looking in the wrong place.
 */
import { describe, expect, it } from "vitest";
import {
  type ChannelProgressSnapshot,
  channelProgressDeadline,
  channelStallGap,
  channelStallLine,
  MIN_SLACK_CHANNEL_STALL_MS,
  resolveChannelStallMs,
  SLACK_CHANNEL_STALL_MS,
  setTimeoutDeadlineTimer,
} from "../../../../corpus/slack/channelDeadline.js";

/** A clock the test advances by hand, so `elapsedMs`/`sinceProgressMs` are exact rather than "about". */
function fakeClock(): { nowMs: () => number; advance: (by: number) => void } {
  let at = 1_000;
  return {
    advance: (by) => {
      at += by;
    },
    nowMs: () => at,
  };
}

/** A timer that never fires on its own; the test fires it, and counts how often progress re-armed it. */
function fakeTimer(): {
  timer: (args: { onExpiry: () => void; timeoutMs: number }) => { reset: () => void; release: () => void };
  fire: () => void;
  resets: () => number;
  released: () => boolean;
} {
  let onExpiry = (): void => undefined;
  let resets = 0;
  let released = false;
  return {
    fire: () => {
      onExpiry();
    },
    released: () => released,
    resets: () => resets,
    timer: (args) => {
      onExpiry = args.onExpiry;
      return {
        release: () => {
          released = true;
        },
        reset: () => {
          resets += 1;
        },
      };
    },
  };
}

describe("channelProgressDeadline", () => {
  it("reports the phase it was AWAITING, not the last one that succeeded", async () => {
    const clock = fakeClock();
    const timer = fakeTimer();
    const deadline = channelProgressDeadline({ nowMs: clock.nowMs, timeoutMs: 5_000, timer: timer.timer });
    deadline.progressed({ of: "page", rows: 40 });
    deadline.awaiting({ phase: "page-threads" });
    timer.fire();
    const at = await deadline.expiry;
    expect(at.phase).toBe("page-threads");
  });

  it("defaults to first-page, so a conversation that never got a response says so", async () => {
    const timer = fakeTimer();
    const deadline = channelProgressDeadline({ nowMs: fakeClock().nowMs, timeoutMs: 5_000, timer: timer.timer });
    timer.fire();
    expect((await deadline.expiry).phase).toBe("first-page");
  });

  it("measures elapsed from the conversation's start and sinceProgress from the last unit of motion", async () => {
    const clock = fakeClock();
    const timer = fakeTimer();
    const deadline = channelProgressDeadline({ nowMs: clock.nowMs, timeoutMs: 5_000, timer: timer.timer });
    clock.advance(700);
    deadline.progressed({ of: "page", rows: 12 });
    clock.advance(9_000);
    deadline.awaiting({ phase: "history-page" });
    timer.fire();
    expect(await deadline.expiry).toEqual({
      elapsedMs: 9_700,
      pages: 1,
      phase: "history-page",
      rows: 12,
      sinceProgressMs: 9_000,
      threads: 0,
      timeoutMs: 5_000,
    } satisfies ChannelProgressSnapshot);
  });

  it("counts pages and threads apart, and takes rows from the caller's running total", async () => {
    const timer = fakeTimer();
    const deadline = channelProgressDeadline({ nowMs: fakeClock().nowMs, timeoutMs: 1_000, timer: timer.timer });
    deadline.progressed({ of: "page", rows: 100 });
    deadline.progressed({ of: "thread", rows: 130 });
    deadline.progressed({ of: "thread", rows: 155 });
    deadline.progressed({ of: "flush", rows: 155 });
    timer.fire();
    const at = await deadline.expiry;
    expect(at.pages).toBe(1);
    expect(at.threads).toBe(2);
    expect(at.rows).toBe(155);
  });

  it("re-arms on every page, thread AND flush — the three things that mean the conversation is alive", () => {
    const timer = fakeTimer();
    const deadline = channelProgressDeadline({ nowMs: fakeClock().nowMs, timeoutMs: 1_000, timer: timer.timer });
    deadline.progressed({ of: "page", rows: 1 });
    deadline.progressed({ of: "thread", rows: 2 });
    deadline.progressed({ of: "flush", rows: 2 });
    expect(timer.resets()).toBe(3);
  });

  it("does NOT re-arm merely because the crawl entered a new phase", () => {
    const timer = fakeTimer();
    const deadline = channelProgressDeadline({ nowMs: fakeClock().nowMs, timeoutMs: 1_000, timer: timer.timer });
    deadline.awaiting({ phase: "history-page" });
    deadline.awaiting({ phase: "page-threads" });
    deadline.awaiting({ phase: "known-threads" });
    expect(timer.resets()).toBe(0);
  });

  it("reports abandoned only after it has actually fired", () => {
    const timer = fakeTimer();
    const deadline = channelProgressDeadline({ nowMs: fakeClock().nowMs, timeoutMs: 1_000, timer: timer.timer });
    expect(deadline.abandoned()).toBe(false);
    timer.fire();
    expect(deadline.abandoned()).toBe(true);
  });

  it("releases its timer, so a finished run does not sit out one last window", () => {
    const timer = fakeTimer();
    channelProgressDeadline({ nowMs: fakeClock().nowMs, timeoutMs: 1_000, timer: timer.timer }).release();
    expect(timer.released()).toBe(true);
  });
});

describe("setTimeoutDeadlineTimer", () => {
  it("fires once the window elapses with nothing resetting it", async () => {
    let fired = 0;
    const handle = setTimeoutDeadlineTimer({
      onExpiry: () => {
        fired += 1;
      },
      timeoutMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    handle.release();
    expect(fired).toBe(1);
  });

  it("does not fire after release", async () => {
    let fired = 0;
    setTimeoutDeadlineTimer({
      onExpiry: () => {
        fired += 1;
      },
      timeoutMs: 1,
    }).release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(0);
  });

  it("stays released — a reset after release does not re-arm a disarmed watchdog", async () => {
    let fired = 0;
    const handle = setTimeoutDeadlineTimer({
      onExpiry: () => {
        fired += 1;
      },
      timeoutMs: 1,
    });
    handle.release();
    handle.reset();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(0);
  });
});

describe("resolveChannelStallMs", () => {
  it("defaults when the variable is unset", () => {
    expect(resolveChannelStallMs({ raw: undefined })).toBe(SLACK_CHANNEL_STALL_MS);
  });

  it("defaults on a typo rather than refusing — a bad env var must not stop a backfill", () => {
    expect(resolveChannelStallMs({ raw: "ten" })).toBe(SLACK_CHANNEL_STALL_MS);
  });

  it("defaults on zero and on a negative, which would abandon every channel instantly", () => {
    expect(resolveChannelStallMs({ raw: "0" })).toBe(SLACK_CHANNEL_STALL_MS);
    expect(resolveChannelStallMs({ raw: "-5" })).toBe(SLACK_CHANNEL_STALL_MS);
  });

  it("reads minutes and converts to milliseconds", () => {
    expect(resolveChannelStallMs({ raw: "3" })).toBe(180_000);
  });

  it("accepts a fractional minute", () => {
    expect(resolveChannelStallMs({ raw: "0.5" })).toBe(30_000);
  });

  it("clamps a window too short for a healthy round-trip up to the floor", () => {
    expect(resolveChannelStallMs({ raw: "0.001" })).toBe(MIN_SLACK_CHANNEL_STALL_MS);
  });
});

describe("channelStallGap", () => {
  it("names the abandoned conversation by id and says the next pass retries it", () => {
    expect(channelStallGap({ channelId: "C_STUCK" }).message).toBe(
      "slack channel C_STUCK was abandoned as stalled and not read this run; the next pass retries it whole",
    );
  });

  it("is held by this channel's OWN watermark, so it never freezes the workspace cursor", () => {
    // The whole conversation is left unread — `workspaceCrawl.ts#abandonStalledChannel` writes no `visited`
    // entry — so `reach.ts#planChannelOldest` re-offers it from its own cursor whatever the pooled one says.
    // MEASURED: holding the pooled cursor here froze it for a workspace of hundreds of conversations.
    expect(channelStallGap({ channelId: "C_STUCK" }).heldPerContainer).toBe(true);
  });
});

describe("channelStallLine", () => {
  it("names the channel, the phase, the window and everything the conversation got through", () => {
    const line = channelStallLine({
      at: {
        elapsedMs: 900_000,
        pages: 14,
        phase: "history-page",
        rows: 13_402,
        sinceProgressMs: 601_000,
        threads: 240,
        timeoutMs: 600_000,
      },
      channelId: "C_STUCK",
    });
    expect(line).toBe(
      "slack channel C_STUCK ABANDONED: no page, thread or flush for 601000ms (window 600000ms) while " +
        "awaiting history-page — elapsed=900000ms pages=14 threads=240 rows=13402; no watermark and no " +
        "fullHistory recorded, so the next pass retries it whole",
    );
  });

  it("carries the channel ID and never a channel NAME, which is workspace-private", () => {
    const line = channelStallLine({
      at: {
        elapsedMs: 601_000,
        pages: 0,
        phase: "first-page",
        rows: 0,
        sinceProgressMs: 601_000,
        threads: 0,
        timeoutMs: 600_000,
      },
      channelId: "C_QUIET",
    });
    expect(line).toContain("first-page");
    expect(line).toContain("C_QUIET");
    expect(line).toContain("pages=0");
  });
});
