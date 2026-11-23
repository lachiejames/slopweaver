/**
 * REPLAY LANE, SYNTHETIC — a person replied under the bot's answer a day later, in a thread whose root had long left
 * every history window, and nothing would ever have looked. The owner wants the bot
 * to check in on threads later to see if there have been replies, feeding the loop's existing ask detection.
 *
 * The real-world shape is recorded in `recoverThreads.ts`'s `recoveryRootRegistrations` header: a tag under the bot's
 * OWN root two days old reached nothing, because the root's key was absent from the inventory. A bot ANSWER under
 * somebody else's question had the same hole with no fix at all — the root is a person's, so the sweep registers it
 * only if its history window happens to show it. No frozen turn holds that reply (it was never captured, which is
 * the defect), so this world is built from shipped writers: the answer is posted through the placement guard, which
 * journals where it landed through the PRODUCTION append into a throwaway home; the next scheduled sweep's starting
 * inventory is computed by the shipped `startingCheckpoints`, planned by `planRecoveryThreadChecks`, and the thread
 * it reads is filtered by `recoveryReplyRows` and read into a candidate by `candidateFromMessage` — the same chain
 * the sweep runs.
 *
 * **The falsifiable witness.** The binding asserts the inventory WITHOUT the journal lacks the thread — remove the
 * registration and the plan has nothing to poll and the reply is never a candidate.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startingCheckpoints } from "../../../cli/commands/listen/scheduledRecoverState.js";
import { guardPlacement, productionPlacementSeams } from "../../../corpus/slack/writeGuardPlacement.js";
import { candidateFromMessage, UNREAD_THREAD } from "../../../live/listen/recover.js";
import type { RecoverySweepState, RecoveryWindow } from "../../../live/listen/recoverSchedule.js";
import { planRecoveryThreadChecks } from "../../../live/listen/recoverThreadPlan.js";
import { recoveryReplyRows } from "../../../live/listen/recoverThreads.js";
import { placementWorld } from "../../placementWorldFake.js";

const CHANNEL = "CFIXTUREAA";
/** A person's question, a day before the sweep. */
const ROOT = "1790000000.000100";
const ANSWER = "1790000001.000100";

/** The sweep a day later, whose history window starts long after the question. */
const WINDOW: RecoveryWindow = {
  latestExclusiveTs: "1790090000.000000",
  oldestExclusiveTs: "1790089700.000000",
  sinceIso: "2026-09-21T23:55:00.000Z",
  untilIso: "2026-09-22T00:00:00.000Z",
};

/** The inventory the previous complete sweep persisted — it never saw this thread. */
const PREVIOUS: RecoverySweepState = {
  completedThroughTs: "1790089700.000000",
  nextDueAtIso: "2026-09-22T00:00:00.000Z",
  threadCheckpoints: { "COTHER:1789000000.000100": { cursorTs: "1789000000.000100" } },
  version: 2,
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-replay-followup-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("replay (synthetic): a reply under the bot's answer after the root left every window", () => {
  it("binds: without the journal the next sweep's inventory does not hold the thread", () => {
    expect(Object.keys(startingCheckpoints({ home, migrating: false, previous: PREVIOUS, window: WINDOW }))).toEqual([
      "COTHER:1789000000.000100",
    ]);
  });

  it("registers the answered thread from the journal, polls it, and reads the later reply as a candidate", async () => {
    const world = placementWorld({
      messages: [{ channel: CHANNEL, text: "why did staging's pool exhaust?", ts: ROOT, user: "UFIXTUREAB" }],
    });
    const seams = {
      ...world.seams,
      appendRow: productionPlacementSeams({ home, token: "xoxb-never-called" }).appendRow,
    };
    const posted = await guardPlacement({ seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: { form: "plain", text: "it is sized for 10", unfurl_links: false, unfurl_media: false },
      threadTs: ROOT,
    });
    expect(posted.ts).toBe(ANSWER);

    const inventory = startingCheckpoints({ home, migrating: false, previous: PREVIOUS, window: WINDOW });
    expect(inventory[`${CHANNEL}:${ROOT}`]).toEqual({ cursorTs: ANSWER });

    const plan = planRecoveryThreadChecks({
      checkpoints: inventory,
      foregroundKeys: new Set(),
      hints: [],
      nowTs: WINDOW.latestExclusiveTs,
    });
    expect(plan.checks).toContainEqual({ channel: CHANNEL, oldest: ANSWER, threadTs: ROOT });

    const laterReply = {
      text: "<@U0SYNBOTUSER> and the prod pool?",
      thread_ts: ROOT,
      ts: "1790086400.000100",
      user: "UFIXTUREAB",
    };
    const thread = [
      { text: "why did staging's pool exhaust?", ts: ROOT, user: "UFIXTUREAB" },
      { bot_id: "B0BOT", text: "it is sized for 10", thread_ts: ROOT, ts: ANSWER, user: "U0SYNBOTUSER" },
      laterReply,
    ];
    const rows = recoveryReplyRows({
      afterTs: ANSWER,
      beforeTs: WINDOW.latestExclusiveTs,
      rawMessages: thread,
      threadTs: ROOT,
    });
    expect(rows).toEqual([laterReply]);
    const candidate = candidateFromMessage({
      channel: CHANNEL,
      evidence: UNREAD_THREAD,
      message: rows[0],
      selfBotId: "B0BOT",
      surface: "channel",
    })!;
    expect([candidate.messageTs, candidate.threadTs, candidate.userId]).toEqual([laterReply.ts, ROOT, "UFIXTUREAB"]);
  });
});
