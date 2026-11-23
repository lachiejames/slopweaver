/**
 * `listen recover --scheduled`'s cycle — a stranded ask picked up once, beside a live worker and alone. A real
 * temp home, plain fake Slack API + write transport, an injected clock; never a real network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";
import { unwrap } from "../../../../../../lib/result.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, readAskLifecycleText } from "../../../../../../live/ask/store.js";
import { readRecoverySweepState, writeRecoverySweepState } from "../../../../../../live/listen/recoverScheduleStore.js";
import { BASE_OPTIONS, BOT, fakeTransport, listOnlyC1 } from "../scheduledRecoverFakes.js";

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * A RECOVERY PASS, REPLAYED — and the stranded-ask ruling, on the same two real asks.
   *
   * A nineteen-hour-wide window (the last complete sweep was long before it) re-read a channel holding two
   * messages the loop had already dealt with: one `dispatched` to a live worker minutes earlier, and one that
   * had `failed` 37 minutes before. The real pass captured BOTH, which is the incident.
   *
   * The live worker is still never touched — that half is unchanged and is what `in-flight` protects. The
   * `failed` one is now STRANDED rather than closed: a running visible session tells its thread it is picking
   * it back up, spends its one `redispatched` record, and re-captures it exactly once.
   */
  it("leaves a live worker alone and picks up the stranded ask beside it exactly once", async () => {
    const inFlight = "1787720846.032529";
    const worked = "1787720788.183959";
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => ({
        messages: [
          { text: `<@${BOT}> do a local deploy for that PR pls`, ts: inFlight, user: "U_ASKER" },
          { text: `<@${BOT}> do a local deploy and 7 day backtest pls`, ts: worked, user: "U_ASKER" },
        ],
      }),
      listChannels: listOnlyC1,
      // Tags intact: the stranded lane re-reads the ask's own message and puts it through the same address
      // test a scanned candidate gets, so a bare row would fail as `not-addressed` rather than be picked up.
      replies: async ({ ts }) => ({
        messages: [{ text: `<@${BOT}> do a local deploy and 7 day backtest pls`, ts, user: "U_ASKER" }],
      }),
    };
    for (const messageTs of [inFlight, worked]) {
      appendAskLifecycleEvent({
        event: {
          channel: "C1",
          kind: "captured",
          messageTs,
          surface: "channel",
          threadTs: messageTs,
          tsIso: "2026-08-26T05:06:29.224Z",
          userId: "U_ASKER",
        },
        home,
      });
    }
    appendAskLifecycleEvent({
      event: {
        channel: "C1",
        decision: {
          confidence: "high",
          needs: [],
          rationale: "a scoped, well-precedented investigation",
          response: "respond",
          schemaVersion: 1,
          tier: "fresh-visible-session",
          truthMode: "current",
        },
        kind: "dispatched",
        leaseExpiresAt: "2026-08-26T09:18:50.023Z",
        messageTs: inFlight,
        threadTs: inFlight,
        tier: "fresh-visible-session",
        tsIso: "2026-08-26T07:18:55.625Z",
      },
      home,
    });
    appendAskLifecycleEvent({
      event: {
        channel: "C1",
        kind: "failed",
        messageTs: worked,
        reason: "the reviewer never picked up",
        threadTs: worked,
        tsIso: "2026-08-26T07:17:29.467Z",
      },
      home,
    });
    // The stale watermark that made the window nineteen hours wide rather than five minutes.
    writeRecoverySweepState({
      home,
      state: {
        completedThroughTs: "1787661513.653000",
        nextDueAtIso: "2026-08-26T07:43:47.000Z",
        threadCheckpoints: {},
        version: 2,
      },
    });
    const calls: string[] = [];

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      nowMs: () => Date.parse("2026-08-26T07:53:47.211Z"),
      transport: fakeTransport({ calls }),
    });

    expect(code).toBe(EXIT_OK);
    // The in-thread notice, then the ordinary capture UX: reaction, card, thinking indicator. Once, the
    // burst check parked this stranded ask behind the live worker instead, which is exactly how a
    // tag came to sit queued behind an ask that had already ended. It is captured and judged now, and the
    // brief it produces names the live worker below as already in flight for that asker.
    expect(calls).toEqual(["postDripMessage", "addReaction", "postTurn", "setAssistantStatus"]);
    const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
    // The live worker is untouched: still `dispatched`, still visible to the dispatch sweep.
    expect(folded.get(JSON.stringify(["C1", inFlight]))!.state).toBe("dispatched");
    expect(folded.get(JSON.stringify(["C1", inFlight]))!.activeDispatch?.tier).toBe("fresh-visible-session");
    // The stranded one spent its one re-dispatch, and that record survives every event after it.
    expect(folded.get(JSON.stringify(["C1", worked]))!.redispatched?.strandedAs).toBe("failed");
    // The sweep still completed, so the watermark moved off the stale value that made the window wide.
    expect(unwrap(readRecoverySweepState({ home }))!.completedThroughTs).toBe("1787730827.211000");

    // A SECOND pass over the same home spends nothing and posts nothing — the bound is one.
    const second: string[] = [];
    const again = await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      nowMs: () => Date.parse("2026-08-26T08:03:47.211Z"),
      transport: fakeTransport({ calls: second }),
    });

    expect(again).toBe(EXIT_EXPECTED_EMPTY);
    expect(second).toEqual([]);
  });

  /**
   * The ruling with nothing else in the way: one ask, stranded and unspent, no live worker beside it. This is
   * the whole shape — the thread is told, the ordinary capture UX runs, the spend record lands, and the ask
   * comes back to the caller as a survivor to answer.
   */
  it("picks up a lone stranded ask with the notice, the capture UX and one spend record", async () => {
    // `slopweaver slack when 1786600000.000100` — a fixed instant inside the lane's day-long bound.
    const worked = "1786600000.000100";
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => ({ messages: [] }),
      listChannels: listOnlyC1,
      replies: async ({ ts }) => ({ messages: [{ text: `<@${BOT}> what broke staging`, ts, user: "U_ASKER" }] }),
    };
    appendAskLifecycleEvent({
      event: {
        channel: "C1",
        kind: "captured",
        messageTs: worked,
        surface: "channel",
        threadTs: worked,
        tsIso: "2026-08-13T11:00:00.000Z",
        userId: "U_ASKER",
      },
      home,
    });
    appendAskLifecycleEvent({
      event: {
        channel: "C1",
        kind: "dispatch-failed",
        messageTs: worked,
        reason: "no session in the workspace",
        threadTs: worked,
        tsIso: "2026-08-13T11:30:00.000Z",
      },
      home,
    });
    const calls: string[] = [];

    const code = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls }) });

    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["postDripMessage", "addReaction", "postTurn", "setAssistantStatus"]);
    const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
    expect(folded.get(JSON.stringify(["C1", worked]))!.state).toBe("checklist-posted");
    expect(folded.get(JSON.stringify(["C1", worked]))!.redispatched?.strandedAs).toBe("dispatch-failed");
  });
});
