/**
 * The two repairs, driven directly over an in-memory Slack at the moment the guard reaches them: a post already
 * misplaced and read back, its intent not yet journalled. The exact call sequence is the contract — repost, read the
 * repost back, re-read the misplaced conversation, and only then delete; or post one cross-link and read it back.
 */
import { describe, expect, it } from "vitest";

import type { Settling } from "../../../../corpus/slack/writeGuardPlacementCore.js";
import { crossLink, move } from "../../../../corpus/slack/writeGuardPlacementRepair.js";
import type { SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import {
  type PlacementWorld,
  placementWorld,
  type WorldAddress,
  type WorldMessage,
} from "../../../placementWorldFake.js";

const CHANNEL = "C0ENG";
const ROOT = "1789990000.000100";
const PERSON = "U0ADA";
const MISPLACED = "1790000001.000100";
const SECOND = "1790000002.000100";
const THIRD = "1790000003.000100";
const NOW = "2026-10-04T05:00:00.000Z";
const DETAIL = `addressed to ${CHANNEL} thread ${ROOT}, but Slack has ${MISPLACED} at ${CHANNEL} top level`;
const SELF = { botId: "B0BOT", userId: "U0SYNBOTUSER" };

/** A thread root a person opened, which the bot is replying under. */
const rootMessage: WorldMessage = { channel: CHANNEL, text: "why did the pool exhaust?", ts: ROOT, user: PERSON };

/** Slack's defect: the FIRST post drops its thread and lands top level; every later one lands where addressed. */
const firstPostTopLevel = ({ addressed, index }: { addressed: WorldAddress; index: number }): WorldAddress =>
  index === 0 ? { channel: addressed.channel } : addressed;

const plain = { form: "plain" as const, text: "the pool was sized for 10", unfurl_links: false, unfurl_media: false };

type DripArgs = Parameters<SlackWriteTransport["postDripMessage"]>[0];

/** Post once into the world, which drops the thread, and read the misplaced message back; the calls start empty. */
async function misplacedPost({ world }: { world: PlacementWorld }) {
  const args: DripArgs = { channel: CHANNEL, payload: plain, threadTs: ROOT };
  const posted = await world.transport.postDripMessage(args);
  const read = (await world.transport.readMessage({ posted }))!;
  world.calls.splice(0);
  const settling: Settling<DripArgs> = {
    args,
    intended: { channel: CHANNEL, threadTs: ROOT },
    post: (again) => world.transport.postDripMessage(again),
    seams: world.seams,
    surface: "postDripMessage",
    transport: world.transport,
  };
  return { posted: { channel: posted.channel, ts: posted.ts }, read, settling };
}

describe("move", () => {
  it("reposts where it was addressed, reads the repost back, re-reads the misplaced thread, then deletes", async () => {
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    const { posted, read, settling } = await misplacedPost({ world });
    const moved = await move({ detail: DETAIL, posted, read, self: SELF, settling });
    expect(world.calls).toEqual([
      `post ${CHANNEL} ${ROOT} -> ${SECOND} @ ${CHANNEL} ${ROOT}`,
      `read ${CHANNEL} ${SECOND}`,
      `thread ${CHANNEL} ${MISPLACED}`,
      `delete ${CHANNEL} ${MISPLACED}`,
    ]);
    expect(moved).toEqual({
      channel: CHANNEL,
      placement: {
        outcome: {
          detail: DETAIL,
          from: { channel: CHANNEL, ts: MISPLACED },
          kind: "moved",
          to: { channel: CHANNEL, ts: SECOND },
        },
      },
      ts: SECOND,
    });
    expect(world.messages.map((message) => message.ts)).toEqual([ROOT, SECOND]);
    expect(world.rows).toEqual([
      {
        act: "delete-and-repost",
        detail: DETAIL,
        engagement: [],
        intended: { channel: CHANNEL, threadTs: ROOT },
        kind: "placement-repair-intended",
        posted: { channel: CHANNEL, ts: MISPLACED },
        schemaVersion: 1,
        tsIso: NOW,
      },
      {
        botId: "B0BOT",
        detail: DETAIL,
        final: { channel: CHANNEL, ts: SECOND },
        intended: { channel: CHANNEL, threadTs: ROOT },
        kind: "placement-settled",
        outcome: "moved",
        schemaVersion: 1,
        surface: "postDripMessage",
        threadRoot: ROOT,
        tsIso: NOW,
        userId: "U0SYNBOTUSER",
      },
    ]);
  });

  it("takes its repost back and cross-links instead when a person replies to the misplaced one mid-move", async () => {
    const lateReply = "1790000002.500000";
    const world = placementWorld({
      afterPost: ({ index, messages }) => {
        if (index === 1) {
          messages.push({ channel: CHANNEL, text: "which pool?", threadTs: MISPLACED, ts: lateReply, user: PERSON });
        }
      },
      messages: [rootMessage],
      route: firstPostTopLevel,
    });
    const { posted, read, settling } = await misplacedPost({ world });
    const held = await move({ detail: DETAIL, posted, read, self: SELF, settling });
    expect(world.calls).toEqual([
      `post ${CHANNEL} ${ROOT} -> ${SECOND} @ ${CHANNEL} ${ROOT}`,
      `read ${CHANNEL} ${SECOND}`,
      `thread ${CHANNEL} ${MISPLACED}`,
      `thread ${CHANNEL} ${ROOT}`,
      `delete ${CHANNEL} ${SECOND}`,
      `post ${CHANNEL} ${ROOT} -> ${THIRD} @ ${CHANNEL} ${ROOT}`,
      `read ${CHANNEL} ${THIRD}`,
    ]);
    expect(held).toEqual({
      channel: CHANNEL,
      placement: {
        outcome: {
          crossLink: { channel: CHANNEL, ts: THIRD },
          detail: DETAIL,
          intended: { channel: CHANNEL, threadTs: ROOT },
          kind: "held",
          posted: { channel: CHANNEL, ts: MISPLACED },
        },
      },
      ts: MISPLACED,
    });
    expect(world.rows.map((row) => row.kind)).toEqual([
      "placement-repair-intended",
      "placement-repair-intended",
      "placement-settled",
    ]);
  });

  it("names the repost as the message that stands when the misplaced one will not delete", async () => {
    const world = placementWorld({
      failDelete: "cant_delete_message",
      messages: [rootMessage],
      route: firstPostTopLevel,
    });
    const { posted, read, settling } = await misplacedPost({ world });
    const failed = await move({ detail: DETAIL, posted, read, self: SELF, settling });
    expect(failed).toEqual({
      channel: CHANNEL,
      placement: {
        outcome: {
          detail: `${DETAIL}; reposted at ${SECOND}, but the misplaced ${MISPLACED} could not be deleted: cant_delete_message`,
          kind: "repair-failed",
          posted: { channel: CHANNEL, ts: SECOND },
          reason: "delete-failed",
        },
      },
      ts: SECOND,
    });
    expect(world.messages.map((message) => message.ts)).toEqual([ROOT, MISPLACED, SECOND]);
  });
});

describe("crossLink", () => {
  it("posts one link to the misplaced message where it was addressed, reads it back, and settles held", async () => {
    const reply = "1790000001.900000";
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    const { posted, read, settling } = await misplacedPost({ world });
    const held = await crossLink({ detail: DETAIL, engagement: [reply], posted, read, settling });
    expect(world.calls).toEqual([
      `post ${CHANNEL} ${ROOT} -> ${SECOND} @ ${CHANNEL} ${ROOT}`,
      `read ${CHANNEL} ${SECOND}`,
    ]);
    expect(held).toEqual({
      channel: CHANNEL,
      placement: {
        outcome: {
          crossLink: { channel: CHANNEL, ts: SECOND },
          detail: DETAIL,
          intended: { channel: CHANNEL, threadTs: ROOT },
          kind: "held",
          posted: { channel: CHANNEL, ts: MISPLACED },
        },
      },
      ts: MISPLACED,
    });
    expect(world.messages.find((message) => message.ts === SECOND)!.text).toBe(
      `This landed in the wrong place and the conversation has carried on there: https://acme.slack.com/archives/${CHANNEL}/p1790000001000100`,
    );
    expect(world.rows[0]).toEqual({
      act: "cross-link",
      detail: DETAIL,
      engagement: [reply],
      intended: { channel: CHANNEL, threadTs: ROOT },
      kind: "placement-repair-intended",
      posted: { channel: CHANNEL, ts: MISPLACED },
      schemaVersion: 1,
      tsIso: NOW,
    });
  });

  it("posts nothing and settles repair-failed when auth.test names no workspace to link from", async () => {
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    const { posted, read, settling } = await misplacedPost({ world });
    const failed = await crossLink({
      detail: DETAIL,
      engagement: ["1790000001.900000"],
      posted,
      read,
      settling: {
        ...settling,
        transport: { ...world.transport, whoAmI: async () => ({ ...SELF, workspaceUrl: undefined }) },
      },
    });
    expect(world.calls).toEqual([]);
    expect(failed).toEqual({
      channel: CHANNEL,
      placement: {
        outcome: {
          detail: `${DETAIL}; auth.test named no workspace to link from`,
          kind: "repair-failed",
          posted: { channel: CHANNEL, ts: MISPLACED },
          reason: "cross-link-failed",
        },
      },
      ts: MISPLACED,
    });
  });
});
