/**
 * REPLAY LANE, SYNTHETIC — an approved reply that Slack put at the top level of the channel instead of under the
 * thread it was addressed to. Approved messages have
 * landed in the wrong thread or at the top level of a channel, which reads as a public mistake: the owner wants
 * the post deleted and re-posted in the right place automatically, unless people have already started engaging.
 * A bare reaction is moved automatically; only actual conversation holds it, and then a cross link is dropped.
 *
 * No frozen turn holds a misplaced post: the defect leaves nothing in the ask record set, because the turn believed
 * it posted where it addressed. So the stopped world is the in-memory Slack in `../../placementWorldFake.ts`, which
 * is a plain fake whose `route` IS the defect, and everything else is shipped: the guard (`guardPlacement`), the
 * PRODUCTION journal seam (`productionPlacementSeams`'s `appendRow`, writing into a throwaway home), and the reader a
 * later re-read starts from (`readPlacementJournal`).
 *
 * **The falsifiable witness.** Each case asserts the journal ON DISK, read back by the shipped reader: a guard that
 * silently did nothing writes no `placement-repair-intended` row and the move case reddens.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { guardPlacement, productionPlacementSeams } from "../../../corpus/slack/writeGuardPlacement.js";
import { readPlacementJournal } from "../../../live/slack/placementJournal.js";
import { placementLine } from "../../../outbound/slack/placement.js";
import { placementWorld, type WorldAddress, type WorldMessage } from "../../placementWorldFake.js";

const CHANNEL = "CFIXTUREAA";
const ROOT = "1789990000.000100";

/** The question the approved reply answers. */
const QUESTION: WorldMessage = {
  channel: CHANNEL,
  text: "why did staging's pool exhaust?",
  ts: ROOT,
  user: "UFIXTUREAB",
};

/** Slack's defect, once: the first post drops its thread; the repair's repost lands where addressed. */
const firstPostTopLevel = ({ addressed, index }: { addressed: WorldAddress; index: number }): WorldAddress =>
  index === 0 ? { channel: addressed.channel } : addressed;

const REPLY = { form: "plain" as const, text: "the pool is sized for 10", unfurl_links: false, unfurl_media: false };

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-replay-placement-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * The guard over a world, journalling through the PRODUCTION append into the throwaway home.
 *
 * @param world the fake Slack
 * @returns the guarded transport
 */
function guarded({ world }: { world: ReturnType<typeof placementWorld> }): ReturnType<typeof guardPlacement> {
  const live = productionPlacementSeams({ home, token: "xoxb-fixture-never-called" });
  return guardPlacement({ seams: { ...world.seams, appendRow: live.appendRow }, transport: world.transport });
}

describe("replay (synthetic): an approved reply Slack put at the channel's top level", () => {
  it("reads back a reply that landed where it was addressed, and journals it verified", async () => {
    const world = placementWorld({ messages: [QUESTION] });
    const posted = await guarded({ world }).postDripMessage({ channel: CHANNEL, payload: REPLY, threadTs: ROOT });
    const journal = readPlacementJournal({ home });
    expect(journal.unreadable).toEqual([]);
    expect(journal.rows).toEqual([
      expect.objectContaining({
        final: { channel: CHANNEL, ts: posted.ts },
        kind: "placement-settled",
        outcome: "verified",
      }),
    ]);
  });

  it("moves it into the thread with nobody asked, repost first, and the journal says what it did", async () => {
    const world = placementWorld({ messages: [QUESTION], route: firstPostTopLevel });
    const posted = await guarded({ world }).postDripMessage({ channel: CHANNEL, payload: REPLY, threadTs: ROOT });
    expect(placementLine({ report: posted.placement! })).toBe(
      `placement: MOVED ${CHANNEL}/1790000001.000100 → ${CHANNEL}/1790000002.000100 ` +
        `(addressed to ${CHANNEL} thread ${ROOT}, but Slack has 1790000001.000100 at ${CHANNEL} top level)`,
    );
    expect(world.messages.map((message) => `${message.ts} ${String(message.threadTs)}`)).toEqual([
      `${ROOT} undefined`,
      `1790000002.000100 ${ROOT}`,
    ]);
    const rows = readPlacementJournal({ home }).rows;
    expect(rows.map((row) => row.kind)).toEqual(["placement-repair-intended", "placement-settled"]);
    expect(rows[0]).toMatchObject({ act: "delete-and-repost", engagement: [] });
    expect(rows[1]).toMatchObject({ final: { channel: CHANNEL, ts: "1790000002.000100" }, outcome: "moved" });
  });

  it("leaves it where a person already answered it, and cross-links the thread to it instead", async () => {
    const world = placementWorld({ messages: [QUESTION], route: firstPostTopLevel });
    world.messages.push({
      channel: CHANNEL,
      text: "wait, which pool?",
      threadTs: "1790000001.000100",
      ts: "1790000001.900000",
      user: "UFIXTUREAC",
    });
    const posted = await guarded({ world }).postDripMessage({ channel: CHANNEL, payload: REPLY, threadTs: ROOT });
    expect(posted.ts).toBe("1790000001.000100");
    expect(world.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
    const rows = readPlacementJournal({ home }).rows;
    expect(rows[0]).toMatchObject({ act: "cross-link", engagement: ["1790000001.900000"] });
    expect(rows[1]).toMatchObject({ outcome: "held" });
  });
});
