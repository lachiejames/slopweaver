/**
 * The stranded lane's Slack read — plain fakes for the read seam, no network, no writes.
 *
 * The review posture is the ONE thing here that is genuinely read off disk, so every case passes an explicit
 * throwaway `home` and the open-review case writes a real review record into it through the shipped
 * `writeReview`. A hand-built posture would prove the classifier and nothing about the wiring, which is the
 * half that was broken.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SightBuilder, scanStrandedAsks } from "../../../../cli/commands/listen/strandedSurvivors.js";
import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import type { IgnoredAsk } from "../../../../live/ask/ignore.js";
import type { IgnoredConversation } from "../../../../live/ask/ignoredConversation.js";
import {
  type AskLifecycle,
  askLifecycleKey,
  type FirstAnsweredEvent,
  type StrandedAs,
  type TerminalAskLifecycleEvent,
} from "../../../../live/ask/lifecycle.js";
import type { ClassificationContext } from "../../../../live/listen/recoverForegroundMessages.js";
import type { ReviewRecord } from "../../../../live/turn/review.js";
import { writeReview } from "../../../../live/turn/reviewStore.js";

const ASK = { channel: "C1", messageTs: "1788606000.000100", threadTs: "1788606000.000100" } as const;
/** The same instant as the message ts above — `slopweaver slack when 1788606000.000100`. */
const NOW = "2026-09-05T12:00:00.000Z";
/** The stranded instant, an hour before NOW, so the candidate reads as an hour old. */
const STRANDED_AT = "2026-09-05T11:00:00.000Z";

/**
 * A builder sighting that says ALIVE for every ask — the hostile default, because alive is what would hold a
 * strand. An ask the lane is not allowed to hold must still be picked up under it.
 */
const ALIVE_BUILDER: SightBuilder = async () => "alive";

/** The plan a worker posted before its strand, as the fold carries it. */
const PLAN: FirstAnsweredEvent = {
  ...ASK,
  answerDigest: "sha256:525c720f",
  answerTs: "1788602400.000200",
  kind: "first-answered",
  leaseExpiresAt: "2026-09-05T10:40:00.000Z",
  owes: "pull-requests",
  tsIso: "2026-09-05T08:40:00.000Z",
  what: "the four-PR stack, links in this thread as each opens",
};

/** One stranded ask, folded, with an optional spend record and an optional posted plan already on it. */
function strandedLifecycle({
  firstAnswer,
  redispatched = false,
  state = "dispatch-failed",
}: { firstAnswer?: FirstAnsweredEvent; redispatched?: boolean; state?: StrandedAs } = {}): AskLifecycle {
  return {
    capturedIso: "2026-09-05T10:00:00.000Z",
    channel: ASK.channel,
    ...(firstAnswer === undefined ? {} : { firstAnswer }),
    lastEvent: { ...ASK, kind: "dispatch-failed", reason: "nothing ran", tsIso: STRANDED_AT },
    messageTs: ASK.messageTs,
    state,
    surface: "channel",
    threadTs: ASK.threadTs,
    userId: "U_ASKER",
    ...(redispatched
      ? {
          redispatched: {
            ...ASK,
            kind: "redispatched" as const,
            reason: "already picked up",
            strandedAs: state,
            tsIso: STRANDED_AT,
          },
        }
      : {}),
  };
}

/** The classification context the stranded lane shares with the scanned candidates. */
function classificationFor({
  allowedChannels = ["C1"],
  ignored = new Map<string, IgnoredAsk>(),
  lifecycle = strandedLifecycle(),
}: {
  allowedChannels?: readonly string[];
  ignored?: ReadonlyMap<string, IgnoredAsk>;
  lifecycle?: AskLifecycle;
} = {}): ClassificationContext {
  return {
    allowedChannels,
    botUserId: "U_BOT",
    cardEventType: "slopweaver_card_v1",
    ignored,
    ignoredConversations: new Map<string, IgnoredConversation>(),
    lifecycles: new Map([[askLifecycleKey({ askIdentity: lifecycle }), lifecycle]]),
    // The scan's own window is minutes wide; the stranded lane must replace it with its own day-long bound.
    since: "2026-09-05T11:55:00.000Z",
    terminalByAsk: new Map<string, TerminalAskLifecycleEvent>(),
  };
}

/** A thread read that serves the ask's own message back, tag intact. */
function threadServing({ messages }: { messages: readonly unknown[] }): Pick<SlackApi, "replies"> {
  return { replies: async () => ({ messages }) };
}

const ASK_ROW = { text: "<@U_BOT> what broke staging", ts: ASK.messageTs, user: "U_ASKER" };

/** A review record with no `releasedAt` — `reviewPostureOf`'s `recordOpen`, as the shipped writer lays it down. */
function openReviewRecord(): ReviewRecord {
  return {
    ...ASK,
    answerDigest: "sha256:3178fa7e",
    answerPath: "/dev/null/answer.json",
    authorSession: "author workspace workspace:235 (id-235)",
    carriedUnresolved: [],
    packetPath: "/dev/null/packet.md",
    reviewer: {
      host: "claude-code",
      surfaceId: "id-surface-251",
      surfaceRef: "surface:251",
      workspaceId: "id-251",
      workspaceRef: "workspace:251",
    },
    reviewerSession: "reviewer workspace workspace:251 (id-251)",
    round: 7,
    schemaVersion: 2,
    spawnedAt: "2026-09-05T11:05:00.000Z",
    verdictPath: "/dev/null/verdict.json",
  };
}

describe("scanStrandedAsks", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "stranded-survivors-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("returns the stranded ask as a survivor, with its own message rebuilt", async () => {
    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [ASK_ROW] }),
      classification: classificationFor(),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(scan.refused).toEqual([]);
    expect(scan.survivors.length).toBe(1);
    expect(scan.survivors[0]?.stranded.strandedAs).toBe("dispatch-failed");
    expect(scan.survivors[0]?.stranded.sinceMinutes).toBe(60);
    expect(scan.survivors[0]?.verdict.mention?.text).toBe("@(U_BOT) what broke staging");
  });

  it("reads no thread at all when nothing is stranded and unspent", async () => {
    let read = 0;
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        read += 1;
        return { messages: [ASK_ROW] };
      },
    };

    const scan = await scanStrandedAsks({
      api,
      classification: classificationFor({ lifecycle: strandedLifecycle({ redispatched: true }) }),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(read).toBe(0);
    expect(scan.survivors).toEqual([]);
  });

  it("refuses without spending anything when the thread will not read", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        throw new Error("channel_not_found");
      },
    };

    const scan = await scanStrandedAsks({
      api,
      classification: classificationFor(),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(scan.survivors).toEqual([]);
    expect(scan.refused.length).toBe(1);
    expect(scan.refused[0]?.reason).toContain("could not read its thread");
  });

  it("refuses when the ask's own message has left the thread", async () => {
    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [{ ...ASK_ROW, ts: "1788606000.000900" }] }),
      classification: classificationFor(),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(scan.refused[0]?.reason).toBe("its own message is no longer in the thread");
  });

  it("still applies every ordinary exclusion — a channel the bot may not answer in", async () => {
    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [ASK_ROW] }),
      classification: classificationFor({ allowedChannels: ["C_OTHER"] }),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(scan.survivors).toEqual([]);
    expect(scan.refused[0]?.reason).toContain("is not a channel the bot answers in");
  });

  it("classifies against the day-long bound rather than the scan's own minutes-wide window", async () => {
    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [ASK_ROW] }),
      classification: classificationFor(),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(scan.survivors.length).toBe(1);
  });

  it("leaves an ask alone, and reads no thread, while a review record is open on it", async () => {
    // `C0SYN000001/1790048248.995219`: a warn-tier door refusal wrote `failed` over a worker that was alive
    // on review round 7, and this pass minted a second turn and a second public card over it. The review
    // record is what the sweep reads in the same minute to say DO NOT ROUTE.
    writeReview({ home, packet: "the round-7 packet", record: openReviewRecord() });
    let read = 0;
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        read += 1;
        return { messages: [ASK_ROW] };
      },
    };

    const scan = await scanStrandedAsks({
      api,
      classification: classificationFor(),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(read).toBe(0);
    expect(scan.survivors).toEqual([]);
    expect(scan.refused).toEqual([]);
    expect(scan.reviewOpen.map((one) => one.messageTs)).toEqual([ASK.messageTs]);
  });

  it("picks the same ask up once its reviewer has been released", async () => {
    writeReview({
      home,
      packet: "the round-7 packet",
      record: { ...openReviewRecord(), releasedAt: "2026-09-05T11:30:00.000Z" },
    });

    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [ASK_ROW] }),
      classification: classificationFor(),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(scan.reviewOpen).toEqual([]);
    expect(scan.survivors.length).toBe(1);
  });

  it("holds a lease-expired strand whose plan stands while its builder is still busy", async () => {
    // A four-PR build can outlast the re-armed lease and its reprieve; re-dispatching then starts a second
    // builder beside the first on the same ask.
    let read = 0;
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        read += 1;
        return { messages: [ASK_ROW] };
      },
    };
    const scan = await scanStrandedAsks({
      api,
      classification: classificationFor({
        lifecycle: strandedLifecycle({ firstAnswer: PLAN, state: "lease-expired" }),
      }),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: ALIVE_BUILDER,
    });

    expect(read).toBe(0);
    expect(scan.survivors).toEqual([]);
    expect(scan.refused).toEqual([]);
    expect(scan.builderRunning.map((one) => one.messageTs)).toEqual([ASK.messageTs]);
  });

  it("picks the same strand up when no dispatch record names a builder", async () => {
    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [ASK_ROW] }),
      classification: classificationFor({
        lifecycle: strandedLifecycle({ firstAnswer: PLAN, state: "lease-expired" }),
      }),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: async () => "unrecorded",
    });

    expect(scan.builderRunning).toEqual([]);
    expect(scan.survivors.length).toBe(1);
  });

  it("picks the same strand up once its builder's workspace is gone", async () => {
    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [ASK_ROW] }),
      classification: classificationFor({
        lifecycle: strandedLifecycle({ firstAnswer: PLAN, state: "lease-expired" }),
      }),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: async () => "gone",
    });

    expect(scan.builderRunning).toEqual([]);
    expect(scan.survivors.length).toBe(1);
  });

  it("never sights a lease-expired strand with no plan posted, so it is judged as it always was", async () => {
    let sighted = 0;
    const scan = await scanStrandedAsks({
      api: threadServing({ messages: [ASK_ROW] }),
      classification: classificationFor({ lifecycle: strandedLifecycle({ state: "lease-expired" }) }),
      home,
      nowIso: NOW,
      selfBotId: undefined,
      sightBuilder: async () => {
        sighted += 1;
        return "alive";
      },
    });

    expect(sighted).toBe(0);
    expect(scan.builderRunning).toEqual([]);
    expect(scan.survivors.length).toBe(1);
  });
});
