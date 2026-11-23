/**
 * `settleUndispatched`'s three arms that settle NOTHING: an ask neither arm owns, an ask still inside the
 * unrouted window, and an ask whose open review holds both arms off it. Each is driven over a throwaway home
 * that is checked to stay empty, with every counter compared on every case. The finalising arm and
 * `settleSweptTerminal` record lifecycle events and finalise Slack indicators through other modules, and are
 * not exercised here.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { settleUndispatched } from "../../../../../cli/commands/turn/abandoned.js";
import type { AskLifecycle } from "../../../../../live/ask/lifecycle.js";
import type { ReviewPosture } from "../../../../../live/turn/leaseJudgement.js";

const CHANNEL = "C0SYN000001";
const MESSAGE_TS = "1789348656.323469";

/** An ask carded at 02:12:19.348Z and routed by nobody. */
function carded(): AskLifecycle {
  return {
    capturedIso: "2026-09-14T02:12:10.938Z",
    channel: CHANNEL,
    lastEvent: {
      channel: CHANNEL,
      kind: "checklist-posted",
      messageTs: MESSAGE_TS,
      threadTs: MESSAGE_TS,
      tsIso: "2026-09-14T02:12:19.348Z",
      turnId: "turn-1789351938440",
      workingTs: "1789351938.864729",
    },
    messageTs: MESSAGE_TS,
    started: { turnId: "turn-1789351938440", workingTs: "1789351938.864729" },
    state: "checklist-posted",
    surface: "channel",
    text: "@(U0SYN000005) ranked ISO tasks for today",
    threadTs: MESSAGE_TS,
    userId: "U0SYN000001",
  };
}

/** The same ask after the sweep already finalised it, so neither undispatched arm owns it. */
function finalised(): AskLifecycle {
  return {
    ...carded(),
    lastEvent: {
      channel: CHANNEL,
      kind: "dispatch-failed",
      messageTs: MESSAGE_TS,
      reason: "no session ever picked this up",
      threadTs: MESSAGE_TS,
      tsIso: "2026-09-14T02:45:27.414Z",
    },
    state: "dispatch-failed",
  };
}

const NO_REVIEW: ReviewPosture = { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined };

const REVIEW_IN_FLIGHT: ReviewPosture = {
  hasUsableVerdict: false,
  inFlight: true,
  recordOpen: true,
  spawnedAt: "2026-09-14T02:20:00.000Z",
};

/** Minute 29 and minute 30 after the ask's last event: the last unrouted minute and the first finalising one. */
const MINUTE_29 = "2026-09-14T02:41:19.348Z";
const MINUTE_30 = "2026-09-14T02:42:19.348Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "abandoned-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Run one sweep step and report every line and every counter.
 *
 * @param entry the ask being swept
 * @param nowIso the sweep's instant
 * @param review the ask's review posture
 * @returns the lines written and how often each counter fired
 */
async function sweep({
  entry,
  nowIso,
  review,
}: {
  entry: AskLifecycle;
  nowIso: string;
  review: ReviewPosture;
}): Promise<{ counts: { inReview: number; undispatched: number; unrouted: number }; lines: string[] }> {
  const lines: string[] = [];
  const counts = { inReview: 0, undispatched: 0, unrouted: 0 };
  await settleUndispatched({
    entry,
    home,
    nowIso,
    onInReview: () => {
      counts.inReview += 1;
    },
    onUndispatched: () => {
      counts.undispatched += 1;
    },
    onUnrouted: () => {
      counts.unrouted += 1;
    },
    review,
    writeLine: ({ line }) => {
      lines.push(line);
    },
  });
  return { counts, lines };
}

/** The in-review line both held cases print, at the given elapsed minute. */
function inReviewAt({ minutes }: { minutes: number }): string {
  return (
    `IN REVIEW — DO NOT ROUTE: C0SYN000001/1789348656.323469 — last event ${String(minutes)}m ago and no ` +
    "dispatch was ever recorded, but an independent reviewer is mid-verdict, and its time is not the " +
    "worker's to pay for (reviewer spawned 2026-09-14T02:20:00.000Z). A session is inside this turn; the " +
    "never-dispatched bound is HELD and nothing was settled. Do not re-brief it — that posts a second card " +
    "over the one the person is watching — and never message the reviewer."
  );
}

describe("settleUndispatched", () => {
  it("an ask neither undispatched arm owns writes no line, fires no counter and writes nothing under home", async () => {
    const outcome = await sweep({ entry: finalised(), nowIso: MINUTE_30, review: REVIEW_IN_FLIGHT });

    expect(outcome).toEqual({ counts: { inReview: 0, undispatched: 0, unrouted: 0 }, lines: [] });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("an ask at minute 29 with no review prints the exact unrouted line and fires only onUnrouted", async () => {
    const outcome = await sweep({ entry: carded(), nowIso: MINUTE_29, review: NO_REVIEW });

    expect(outcome).toEqual({
      counts: { inReview: 0, undispatched: 0, unrouted: 1 },
      lines: [
        "UNROUTED — ROUTE IT NOW: C0SYN000001/1789348656.323469 — captured 29m ago, a card is standing in " +
          "the thread and no routing decision has ever been recorded for it. Run the three steps over it, " +
          "starting with:\n" +
          "    slopweaver turn brief --channel C0SYN000001 --message-ts 1789348656.323469 " +
          "--thread-ts 1789348656.323469 --user U0SYN000001 --surface channel --mode continuous-drain " +
          "--text '@(U0SYN000005) ranked ISO tasks for today'\n" +
          "    `turn brief` recovers the capture-time card from the ledger, so do NOT re-capture it.",
      ],
    });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("an in-flight review at minute 29 displaces the unrouted arm: the in-review line, and only onInReview", async () => {
    const outcome = await sweep({ entry: carded(), nowIso: MINUTE_29, review: REVIEW_IN_FLIGHT });

    expect(outcome).toEqual({
      counts: { inReview: 1, undispatched: 0, unrouted: 0 },
      lines: [inReviewAt({ minutes: 29 })],
    });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("an in-flight review at minute 30 displaces the finalising arm: the in-review line, only onInReview, nothing written", async () => {
    const outcome = await sweep({ entry: carded(), nowIso: MINUTE_30, review: REVIEW_IN_FLIGHT });

    expect(outcome).toEqual({
      counts: { inReview: 1, undispatched: 0, unrouted: 0 },
      lines: [inReviewAt({ minutes: 30 })],
    });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });
});
