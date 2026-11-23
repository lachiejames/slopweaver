/**
 * A small in-memory Slack for the placement read-back: posts land as messages, reads return what is standing,
 * deletes remove it. A plain fake, not a mock — every call is recorded on `world.calls` so a test asserts the exact
 * sequence the guard drove.
 *
 * `route` is the defect being simulated: it decides where a post ACTUALLY lands, so a test can make Slack put a
 * reply at the channel's top level, or in the wrong thread, without the guard being told. Absent, every post lands
 * where it was addressed.
 */
import type { PlacementGuardSeams } from "../corpus/slack/writeGuardPlacement.js";
import type { DeleteMessageOutcome, PostedMessage, SlackWriteTransport } from "../corpus/slack/writeTransport.js";
import { err, ok } from "../lib/result.js";
import type { PlacementJournalRow } from "../live/slack/placementJournal.js";
import { workspaceShapeRefusals } from "./slackWorkspaceShapeFake.js";

/** One standing message. `botId` set means an app posted it; absent means a person did. */
export interface WorldMessage {
  readonly channel: string;
  readonly ts: string;
  readonly threadTs?: string | undefined;
  readonly user: string;
  readonly botId?: string | undefined;
  readonly text: string;
}

/** Where a post was addressed. */
export interface WorldAddress {
  readonly channel: string;
  readonly threadTs?: string | undefined;
}

/** The fake world and everything the guard did to it. */
export interface PlacementWorld {
  readonly messages: WorldMessage[];
  readonly calls: string[];
  readonly rows: PlacementJournalRow[];
  readonly transport: SlackWriteTransport;
  readonly seams: PlacementGuardSeams;
}

/** Who the world's transport posts as: a bot id for the bot lane, absent for the as-me lane. */
interface WorldPoster {
  readonly botId?: string;
  readonly user: string;
}

/** The world's one post path, which every posting method of the transport goes through. */
type WorldPost = (args: { channel: string; threadTs: string | undefined; text: string }) => Promise<PostedMessage>;

/** Build the post path: route each post, stand it as a message, record the call, then run `afterPost`. */
function worldPoster({
  messages,
  calls,
  route,
  poster,
  failPostAfter,
  afterPost,
}: {
  messages: WorldMessage[];
  calls: string[];
  route: (args: { addressed: WorldAddress; index: number }) => WorldAddress;
  poster: WorldPoster;
  failPostAfter: number | undefined;
  afterPost: (args: { index: number; ts: string; messages: WorldMessage[] }) => void;
}): WorldPost {
  let posts = 0;
  let clock = 1790000000;
  return async ({ channel, threadTs, text }) => {
    if (failPostAfter !== undefined && posts >= failPostAfter) {
      calls.push(`post-failed ${channel} ${String(threadTs)}`);
      throw new Error("slack.chat.postMessage: ratelimited");
    }
    const landed = route({ addressed: { channel, threadTs }, index: posts });
    posts += 1;
    clock += 1;
    const ts = `${String(clock)}.000100`;
    messages.push({
      botId: poster.botId,
      channel: landed.channel,
      text,
      threadTs: landed.threadTs,
      ts,
      user: poster.user,
    });
    calls.push(`post ${channel} ${String(threadTs)} -> ${ts} @ ${landed.channel} ${String(landed.threadTs)}`);
    afterPost({ index: posts - 1, messages, ts });
    return { channel: landed.channel, ts };
  };
}

/** Every transport method the placement guard never drives, each throwing with its own name. */
function unexercised() {
  const unused =
    ({ name }: { name: string }) =>
    async (): Promise<never> => {
      throw new Error(`${name} is not exercised by the placement world`);
    };
  return {
    appendStream: unused({ name: "appendStream" }),
    attachAssistantMedia: unused({ name: "attachAssistantMedia" }),
    attachMedia: unused({ name: "attachMedia" }),
    attachRecipeResponseMedia: unused({ name: "attachRecipeResponseMedia" }),
    correctMessage: unused({ name: "correctMessage" }),
    openConversation: unused({ name: "openConversation" }),
    setAssistantStatus: unused({ name: "setAssistantStatus" }),
    setThreadTitle: unused({ name: "setThreadTitle" }),
    stopStream: unused({ name: "stopStream" }),
    updateCard: unused({ name: "updateCard" }),
    updateDripMessage: unused({ name: "updateDripMessage" }),
    updateTurn: unused({ name: "updateTurn" }),
    uploadPrivately: unused({ name: "uploadPrivately" }),
  };
}

/** Every posting method of the transport, each landing through the world's one post path. */
function postingMethods({
  post,
}: {
  post: WorldPost;
}): Pick<
  SlackWriteTransport,
  | "postAssistantMessage"
  | "postCard"
  | "postDripMessage"
  | "postNoFold"
  | "postPoll"
  | "postRecipeResponse"
  | "postTurn"
  | "startStream"
> {
  const textOf = ({ payload }: { payload: unknown }): string =>
    typeof payload === "object" && payload !== null && "text" in payload && typeof payload.text === "string"
      ? payload.text
      : "";
  return {
    postAssistantMessage: ({ channel, threadTs, payload }) => post({ channel, text: textOf({ payload }), threadTs }),
    postCard: ({ channel, threadTs, payload }) => post({ channel, text: textOf({ payload }), threadTs }),
    postDripMessage: ({ channel, threadTs, payload }) => post({ channel, text: payload.text, threadTs }),
    postNoFold: ({ channel, threadTs, payload }) => post({ channel, text: textOf({ payload }), threadTs }),
    postPoll: ({ channel, payload }) => post({ channel, text: textOf({ payload }), threadTs: undefined }),
    postRecipeResponse: ({ channel, threadTs, payload }) => post({ channel, text: textOf({ payload }), threadTs }),
    postTurn: ({ channel, threadTs, payload }) => post({ channel, text: textOf({ payload }), threadTs }),
    startStream: ({ channel, threadTs }) => post({ channel, text: "", threadTs }),
  };
}

/** The world's transport: posts land through `post`; reads, deletes and `conversations.info` act on the world. */
function worldTransport({
  messages,
  calls,
  post,
  poster,
  failDelete,
  dmMembers,
}: {
  messages: WorldMessage[];
  calls: string[];
  post: WorldPost;
  poster: WorldPoster;
  failDelete: string | undefined;
  dmMembers: Readonly<Record<string, string>>;
}): SlackWriteTransport {
  return {
    ...workspaceShapeRefusals({ path: "the placement world" }),
    ...unexercised(),
    ...postingMethods({ post }),
    addReaction: async () => true,
    conversationInfo: async ({ channel }) => ({
      name: undefined,
      surface: "public-channel" as const,
      user: dmMembers[channel],
    }),
    deleteMessage: async () => true,
    deleteMessageOnce: async ({ posted }): Promise<DeleteMessageOutcome> => {
      calls.push(`delete ${posted.channel} ${posted.ts}`);
      if (failDelete !== undefined) {
        return { kind: "failed", reason: failDelete };
      }
      const at = messages.findIndex((message) => message.channel === posted.channel && message.ts === posted.ts);
      if (at === -1) {
        return { kind: "already-gone" };
      }
      messages.splice(at, 1);
      return { kind: "gone" };
    },
    readBackFileCount: async () => 0,
    readMessage: async ({ posted }) => {
      calls.push(`read ${posted.channel} ${posted.ts}`);
      const found = messages.find((message) => message.channel === posted.channel && message.ts === posted.ts);
      if (found === undefined) {
        return undefined;
      }
      return { botId: found.botId, fileIds: [], threadTs: found.threadTs, ts: found.ts, userId: found.user };
    },
    readReactions: async () => undefined,
    removeReaction: async () => true,
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => ({ botId: poster.botId, userId: poster.user, workspaceUrl: "https://acme.slack.com/" }),
  };
}

/** The guard's seams over the world: the journal lands on `rows`, a thread read returns its standing messages. */
function worldSeams({
  messages,
  calls,
  rows,
  unreadableJournal,
}: {
  messages: WorldMessage[];
  calls: string[];
  rows: PlacementJournalRow[];
  unreadableJournal: boolean;
}): PlacementGuardSeams {
  return {
    appendRow: ({ row }) => {
      if (unreadableJournal) {
        return err("EACCES: journal read-only");
      }
      rows.push(row);
      return ok(undefined);
    },
    nowIso: () => "2026-10-04T05:00:00.000Z",
    pause: async () => undefined,
    readThread: async ({ channel, threadTs }) => {
      calls.push(`thread ${channel} ${threadTs}`);
      const raw = messages
        .filter((message) => message.channel === channel && (message.ts === threadTs || message.threadTs === threadTs))
        .map((message) => ({
          ts: message.ts,
          user: message.user,
          ...(message.botId === undefined ? {} : { bot_id: message.botId }),
          ...(message.threadTs === undefined ? {} : { thread_ts: message.threadTs }),
        }));
      return ok(raw);
    },
  };
}

/**
 * Build a world.
 *
 * @param messages the messages standing before the test posts anything
 * @param route where the Nth post (0-based) actually lands, given where it was addressed
 * @param poster who the transport posts as: a bot id for the bot lane, absent for the as-me lane
 * @param failDelete make every `chat.delete` fail with this reason
 * @param failPostAfter throw on every post after this many have succeeded
 * @param unreadableJournal make every journal append fail
 * @param afterPost called with the Nth post's (0-based) ts once it stands — where a person replies MID-repair
 * @param dmMembers the member on the other end of each `D…`, as `conversations.info` answers it
 * @returns the world
 */
export function placementWorld({
  messages = [],
  route = ({ addressed }) => addressed,
  poster = { botId: "B0BOT", user: "U0SYNBOTUSER" },
  failDelete,
  failPostAfter,
  unreadableJournal = false,
  afterPost = () => undefined,
  dmMembers = {},
}: {
  messages?: WorldMessage[];
  route?: (args: { addressed: WorldAddress; index: number }) => WorldAddress;
  poster?: { botId?: string; user: string };
  failDelete?: string;
  failPostAfter?: number;
  unreadableJournal?: boolean;
  afterPost?: (args: { index: number; ts: string; messages: WorldMessage[] }) => void;
  dmMembers?: Readonly<Record<string, string>>;
}): PlacementWorld {
  const calls: string[] = [];
  const rows: PlacementJournalRow[] = [];
  const post = worldPoster({ afterPost, calls, failPostAfter, messages, poster, route });
  const transport = worldTransport({ calls, dmMembers, failDelete, messages, post, poster });
  const seams = worldSeams({ calls, messages, rows, unreadableJournal });
  return { calls, messages, rows, seams, transport };
}
