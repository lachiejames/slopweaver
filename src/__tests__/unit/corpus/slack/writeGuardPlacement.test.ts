/**
 * The placement read-back over an in-memory Slack: where each post really landed decides what the guard does, and
 * the exact call sequence is the contract — repost before delete, nothing acted on without a positive observation.
 */
import { describe, expect, it } from "vitest";

import { guardPlacement, PLACEMENT_METHODS } from "../../../../corpus/slack/writeGuardPlacement.js";
import { READ_BACK_ATTEMPTS } from "../../../../corpus/slack/writeGuardPlacementCore.js";
import { placementLine } from "../../../../outbound/slack/placement.js";
import { placementWorld, type WorldAddress, type WorldMessage } from "../../../placementWorldFake.js";

const CHANNEL = "C0ENG";
const ROOT = "1789990000.000100";
const PERSON = "U0ADA";

/** A thread root a person opened, which the bot is replying under. */
const rootMessage: WorldMessage = { channel: CHANNEL, text: "why did the pool exhaust?", ts: ROOT, user: PERSON };

/** Slack's defect: the FIRST post drops its thread and lands top level; every later one lands where addressed. */
const firstPostTopLevel = ({ addressed, index }: { addressed: WorldAddress; index: number }): WorldAddress =>
  index === 0 ? { channel: addressed.channel } : addressed;

const plain = { form: "plain" as const, text: "the pool was sized for 10", unfurl_links: false, unfurl_media: false };

describe("guardPlacement — a post that landed where it was addressed", () => {
  it("is verified on one read and journalled with its thread", async () => {
    const world = placementWorld({ messages: [rootMessage] });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(posted.placement).toEqual({ outcome: { kind: "verified", posted: { channel: CHANNEL, ts: posted.ts } } });
    expect(world.calls).toEqual([
      `post ${CHANNEL} ${ROOT} -> ${posted.ts} @ ${CHANNEL} ${ROOT}`,
      `read ${CHANNEL} ${posted.ts}`,
    ]);
    expect(world.rows).toEqual([
      {
        botId: "B0BOT",
        detail: undefined,
        final: { channel: CHANNEL, ts: posted.ts },
        intended: { channel: CHANNEL, threadTs: ROOT },
        kind: "placement-settled",
        outcome: "verified",
        schemaVersion: 1,
        surface: "postDripMessage",
        threadRoot: ROOT,
        tsIso: "2026-10-04T05:00:00.000Z",
        userId: "U0SYNBOTUSER",
      },
    ]);
  });

  it("treats a reply addressed at a REPLY's ts as placed when Slack threads it under that thread's root", async () => {
    const reply: WorldMessage = {
      channel: CHANNEL,
      text: "it was",
      threadTs: ROOT,
      ts: "1789990001.000100",
      user: PERSON,
    };
    const world = placementWorld({
      messages: [rootMessage, reply],
      route: ({ addressed }) => ({ channel: addressed.channel, threadTs: ROOT }),
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: reply.ts,
    });
    expect(posted.placement!.outcome.kind).toBe("verified");
    expect(world.calls.filter((call) => call.startsWith("delete") || call.startsWith("post"))).toHaveLength(1);
  });
});

describe("guardPlacement — a reply that landed at the channel's top level", () => {
  it("reposts it into the thread FIRST, then deletes the misplaced one, and hands back the repost", async () => {
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    const misplaced = "1790000001.000100";
    const repost = "1790000002.000100";
    expect(world.calls).toEqual([
      `post ${CHANNEL} ${ROOT} -> ${misplaced} @ ${CHANNEL} undefined`,
      `read ${CHANNEL} ${misplaced}`,
      `thread ${CHANNEL} ${misplaced}`,
      `post ${CHANNEL} ${ROOT} -> ${repost} @ ${CHANNEL} ${ROOT}`,
      `read ${CHANNEL} ${repost}`,
      `thread ${CHANNEL} ${misplaced}`,
      `delete ${CHANNEL} ${misplaced}`,
    ]);
    expect(posted.ts).toBe(repost);
    expect(posted.placement!.outcome).toEqual({
      detail: `addressed to ${CHANNEL} thread ${ROOT}, but Slack has ${misplaced} at ${CHANNEL} top level`,
      from: { channel: CHANNEL, ts: misplaced },
      kind: "moved",
      to: { channel: CHANNEL, ts: repost },
    });
    expect(world.messages.map((message) => message.ts)).toEqual([ROOT, repost]);
    expect(world.rows.map((row) => row.kind)).toEqual(["placement-repair-intended", "placement-settled"]);
  });

  it("still moves it when only this bot has posted after it — its own acknowledgement is not people engaging", async () => {
    const misplaced = "1790000001.000100";
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    const guarded = guardPlacement({ seams: world.seams, transport: world.transport });
    world.messages.push({
      botId: "B0BOT",
      channel: CHANNEL,
      text: ":eyes:",
      threadTs: misplaced,
      ts: "1790000001.500000",
      user: "U0SYNBOTUSER",
    });
    const posted = await guarded.postDripMessage({ channel: CHANNEL, payload: plain, threadTs: ROOT });
    expect(posted.placement!.outcome.kind).toBe("moved");
  });

  it.each([
    ["a person posting through an app, whose message carries the app's bot_id", { botId: "B0BOT", user: "U0OWNER" }],
    ["another app", { botId: "B0OTHER", user: "U0ACK" }],
  ])("never deletes it under a reply from %s", async (_label, author) => {
    const misplaced = "1790000001.000100";
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    world.messages.push({
      ...author,
      channel: CHANNEL,
      text: "which pool?",
      threadTs: misplaced,
      ts: "1790000001.500000",
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(posted.placement!.outcome.kind).toBe("held");
    expect(world.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
  });

  it("counts every later message as engagement when auth.test cannot name its own bot", async () => {
    const misplaced = "1790000001.000100";
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    world.messages.push({
      botId: "B0BOT",
      channel: CHANNEL,
      text: ":eyes:",
      threadTs: misplaced,
      ts: "1790000001.500000",
      user: "U0SYNBOTUSER",
    });
    const guarded = guardPlacement({
      seams: world.seams,
      transport: {
        ...world.transport,
        whoAmI: async () => {
          throw new Error("slack.auth.test: ratelimited");
        },
      },
    });
    const posted = await guarded.postDripMessage({ channel: CHANNEL, payload: plain, threadTs: ROOT });
    expect(posted.placement!.outcome.kind).toBe("repair-failed");
    expect(world.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
  });

  it("leaves it standing and cross-links from the thread once a person has replied to it", async () => {
    const misplaced = "1790000001.000100";
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel });
    world.messages.push({
      channel: CHANNEL,
      text: "wait, which pool?",
      threadTs: misplaced,
      ts: "1790000001.900000",
      user: PERSON,
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(posted.ts).toBe(misplaced);
    expect(world.calls.some((call) => call.startsWith("delete"))).toBe(false);
    const link = world.messages.find((message) => message.ts === "1790000002.000100")!;
    expect(link.threadTs).toBe(ROOT);
    expect(link.text).toBe(
      `This landed in the wrong place and the conversation has carried on there: https://acme.slack.com/archives/${CHANNEL}/p1790000001000100`,
    );
    expect(posted.placement!.outcome.kind).toBe("held");
  });

  it("takes its repost back and cross-links instead when a person replies WHILE the repost goes out", async () => {
    const misplaced = "1790000001.000100";
    const repost = "1790000002.000100";
    const world = placementWorld({
      afterPost: ({ index, messages }) => {
        if (index === 1) {
          messages.push({
            channel: CHANNEL,
            text: "which pool?",
            threadTs: misplaced,
            ts: "1790000002.500000",
            user: PERSON,
          });
        }
      },
      messages: [rootMessage],
      route: firstPostTopLevel,
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(world.calls.filter((call) => call.startsWith("delete") || call.startsWith("thread"))).toEqual([
      `thread ${CHANNEL} ${misplaced}`,
      `thread ${CHANNEL} ${misplaced}`,
      `thread ${CHANNEL} ${ROOT}`,
      `delete ${CHANNEL} ${repost}`,
    ]);
    expect(posted.ts).toBe(misplaced);
    expect(posted.placement!.outcome.kind).toBe("held");
    expect(world.messages.map((message) => message.ts)).toEqual([
      ROOT,
      misplaced,
      "1790000002.500000",
      "1790000003.000100",
    ]);
  });

  it("deletes neither copy when people replied under both while it was being moved", async () => {
    const misplaced = "1790000001.000100";
    const repost = "1790000002.000100";
    const world = placementWorld({
      afterPost: ({ index, messages }) => {
        if (index === 1) {
          messages.push(
            { channel: CHANNEL, text: "which pool?", threadTs: misplaced, ts: "1790000002.500000", user: PERSON },
            { channel: CHANNEL, text: "thanks", threadTs: ROOT, ts: "1790000002.600000", user: "U0BEA" },
          );
        }
      },
      messages: [rootMessage],
      route: firstPostTopLevel,
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(world.calls.some((call) => call.startsWith("delete"))).toBe(false);
    expect(posted.placement!.outcome).toEqual({
      detail:
        `addressed to ${CHANNEL} thread ${ROOT}, but Slack has ${misplaced} at ${CHANNEL} top level; a person replied ` +
        `to the misplaced message while it was being moved; the repost ${repost} stands: a person has replied to it`,
      kind: "repair-failed",
      posted: { channel: CHANNEL, ts: misplaced },
      reason: "repost-engaged",
    });
  });

  it("counts the OWNER's own reply as engagement on the as-me lane, where the owner is also the poster", async () => {
    const misplaced = "1790000001.000100";
    const world = placementWorld({ messages: [rootMessage], poster: { user: "U0OWNER" }, route: firstPostTopLevel });
    world.messages.push({
      channel: CHANNEL,
      text: "oops, meant that in the thread",
      threadTs: misplaced,
      ts: "1790000001.900000",
      user: "U0OWNER",
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(posted.placement!.outcome.kind).toBe("held");
    expect(world.calls.some((call) => call.startsWith("delete"))).toBe(false);
  });
});

describe("guardPlacement — every failure leaves a message standing and says which", () => {
  /** A transport whose read-back never finds the post itself, while every message that stood before it reads. */
  const blindToPosts = ({
    world,
    before,
  }: {
    world: ReturnType<typeof placementWorld>;
    before: readonly string[];
  }) => ({
    ...world.transport,
    readMessage: async ({ posted }: { posted: { channel: string; ts: string } }) => {
      if (before.includes(posted.ts)) {
        return world.transport.readMessage({ posted });
      }
      world.calls.push(`read-miss ${posted.ts}`);
      return undefined;
    },
  });

  it("acts on nothing when the read-back never finds the message, after the bounded looks", async () => {
    const world = placementWorld({ messages: [rootMessage] });
    const guarded = guardPlacement({ seams: world.seams, transport: blindToPosts({ before: [ROOT], world }) });
    const posted = await guarded.postDripMessage({ channel: CHANNEL, payload: plain, threadTs: ROOT });
    expect(world.calls.filter((call) => call.startsWith("read-miss"))).toHaveLength(READ_BACK_ATTEMPTS);
    expect(world.calls.filter((call) => call.startsWith("delete") || call.startsWith("thread"))).toEqual([]);
    expect(posted.placement!.outcome).toEqual({
      detail: "read-back found no message at that ts after 3 looks",
      kind: "unverified",
      posted: { channel: CHANNEL, ts: posted.ts },
    });
    // The root it was sent to, and whose post it is, still reach the journal, so check 4 re-reads it later.
    expect(world.rows).toMatchObject([
      { botId: "B0BOT", kind: "placement-settled", threadRoot: ROOT, userId: "U0SYNBOTUSER" },
    ]);
  });

  it("journals the ROOT, never the reply, for an unread post addressed at a reply's ts", async () => {
    const reply: WorldMessage = {
      channel: CHANNEL,
      text: "it was",
      threadTs: ROOT,
      ts: "1789990001.000100",
      user: PERSON,
    };
    const world = placementWorld({ messages: [rootMessage, reply] });
    const guarded = guardPlacement({
      seams: world.seams,
      transport: blindToPosts({ before: [ROOT, reply.ts], world }),
    });
    await guarded.postDripMessage({ channel: CHANNEL, payload: plain, threadTs: reply.ts });
    expect(world.rows).toMatchObject([{ outcome: "unverified", threadRoot: ROOT }]);
  });

  it("registers nothing, and says so, when the unread post's addressed root cannot be read either", async () => {
    const world = placementWorld({ messages: [rootMessage] });
    const guarded = guardPlacement({ seams: world.seams, transport: blindToPosts({ before: [], world }) });
    const posted = await guarded.postDripMessage({ channel: CHANNEL, payload: plain, threadTs: ROOT });
    expect(posted.placement!.outcome).toEqual({
      detail:
        "read-back found no message at that ts after 3 looks; the addressed ts 1789990000.000100 could not be read " +
        "for its root, so its thread is not registered for a later re-read",
      kind: "unverified",
      posted: { channel: CHANNEL, ts: posted.ts },
    });
    expect(world.rows).toMatchObject([{ botId: "B0BOT", threadRoot: undefined }]);
  });

  it("says its thread is not registered when auth.test cannot name who posted the unread message", async () => {
    const world = placementWorld({ messages: [rootMessage] });
    const guarded = guardPlacement({
      seams: world.seams,
      transport: {
        ...blindToPosts({ before: [ROOT], world }),
        whoAmI: async () => {
          throw new Error("slack.auth.test: ratelimited");
        },
      },
    });
    const posted = await guarded.postDripMessage({ channel: CHANNEL, payload: plain, threadTs: ROOT });
    expect(posted.placement!.outcome).toEqual({
      detail:
        "read-back found no message at that ts after 3 looks; auth.test could not name who posted it, so its thread " +
        "is not registered for a later re-read",
      kind: "unverified",
      posted: { channel: CHANNEL, ts: posted.ts },
    });
    expect(world.rows).toMatchObject([{ botId: undefined, threadRoot: ROOT }]);
  });

  it("keeps the misplaced message when the repost fails, and deletes nothing", async () => {
    const world = placementWorld({ failPostAfter: 1, messages: [rootMessage], route: firstPostTopLevel });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(posted.ts).toBe("1790000001.000100");
    expect(world.calls.some((call) => call.startsWith("delete"))).toBe(false);
    expect(posted.placement!.outcome.kind).toBe("repair-failed");
    expect(posted.placement!.outcome).toMatchObject({ reason: "repost-failed" });
  });

  it("names the repost as the send's message when the misplaced one will not delete", async () => {
    const world = placementWorld({
      failDelete: "cant_delete_message",
      messages: [rootMessage],
      route: firstPostTopLevel,
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(posted.ts).toBe("1790000002.000100");
    expect(posted.placement!.outcome).toMatchObject({ kind: "repair-failed", reason: "delete-failed" });
  });

  it("takes its own repost back and keeps the original when the repost lands wrong too — no second move", async () => {
    const world = placementWorld({
      messages: [rootMessage],
      route: ({ addressed }) => ({ channel: addressed.channel }),
    });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(posted.ts).toBe("1790000001.000100");
    expect(world.calls.filter((call) => call.startsWith("post"))).toHaveLength(2);
    expect(world.calls.filter((call) => call.startsWith("delete"))).toEqual([`delete ${CHANNEL} 1790000002.000100`]);
    expect(posted.placement!.outcome).toMatchObject({ kind: "repair-failed", reason: "second-placement-mismatch" });
  });

  it("performs no repair at all when the intent row cannot be written", async () => {
    const world = placementWorld({ messages: [rootMessage], route: firstPostTopLevel, unreadableJournal: true });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: CHANNEL,
      payload: plain,
      threadTs: ROOT,
    });
    expect(world.calls.filter((call) => call.startsWith("post"))).toHaveLength(1);
    expect(world.calls.some((call) => call.startsWith("delete"))).toBe(false);
    expect(posted.placement).toMatchObject({
      journalFailure: "placement journal unwritable: EACCES: journal read-only",
      outcome: { kind: "repair-failed", reason: "intent-journal-unwritable" },
    });
  });
});

describe("guardPlacement — a DM addressed to a person", () => {
  const toDm =
    ({ dm }: { dm: string }) =>
    ({ addressed }: { addressed: WorldAddress }): WorldAddress => ({ ...addressed, channel: dm });

  it("is verified when the DM Slack answered with is with that person", async () => {
    const world = placementWorld({ dmMembers: { D0ADA: PERSON }, route: toDm({ dm: "D0ADA" }) });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: PERSON,
      payload: plain,
      threadTs: undefined,
    });
    expect(posted.placement!.outcome).toEqual({ kind: "verified", posted: { channel: "D0ADA", ts: posted.ts } });
  });

  it("is never verified when the DM is with somebody else, and the wrong copy is not reposted into it", async () => {
    const world = placementWorld({ dmMembers: { D0BOB: "U0BOB" }, route: toDm({ dm: "D0BOB" }) });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: PERSON,
      payload: plain,
      threadTs: undefined,
    });
    expect(posted.placement!.outcome).toEqual({
      detail:
        `addressed to ${PERSON} top level, but Slack has 1790000001.000100 at D0BOB top level (a DM with U0BOB); ` +
        "the repost did not read back right (addressed to U0ADA top level, but Slack has 1790000002.000100 at D0BOB " +
        "top level (a DM with U0BOB))",
      kind: "repair-failed",
      posted: { channel: "D0BOB", ts: "1790000001.000100" },
      reason: "second-placement-mismatch",
    });
    expect(world.messages.map((message) => message.ts)).toEqual(["1790000001.000100"]);
  });

  it("acts on nothing when the DM's member cannot be read", async () => {
    const world = placementWorld({ route: toDm({ dm: "D0ADA" }) });
    const posted = await guardPlacement({ seams: world.seams, transport: world.transport }).postDripMessage({
      channel: PERSON,
      payload: plain,
      threadTs: undefined,
    });
    expect(posted.placement!.outcome).toEqual({
      detail: `the DM D0ADA that Slack answered ${PERSON} with could not be read for its member`,
      kind: "unverified",
      posted: { channel: "D0ADA", ts: posted.ts },
    });
    expect(world.calls.filter((call) => call.startsWith("post") || call.startsWith("delete"))).toHaveLength(1);
  });
});

describe("the guarded surface", () => {
  it("reads back every method that adds a message", () => {
    expect([...PLACEMENT_METHODS]).toEqual([
      "postAssistantMessage",
      "postCard",
      "postDripMessage",
      "postNoFold",
      "postPoll",
      "postRecipeResponse",
      "postTurn",
      "startStream",
    ]);
  });

  it("prints a move as both places", () => {
    const line = placementLine({
      report: {
        outcome: {
          detail: "addressed to C0ENG thread 1.1, but Slack has 2.2 at C0ENG top level",
          from: { channel: "C0ENG", ts: "2.2" },
          kind: "moved",
          to: { channel: "C0ENG", ts: "3.3" },
        },
      },
    });
    expect(line).toBe(
      "placement: MOVED C0ENG/2.2 → C0ENG/3.3 (addressed to C0ENG thread 1.1, but Slack has 2.2 at C0ENG top level)",
    );
  });
});
