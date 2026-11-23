/**
 * Every post is READ BACK, and a post that landed somewhere it was not addressed is put right.
 *
 * A message the owner approved for a thread can reach the wrong thread or the channel's top level, which is
 * visible to everyone. So the rule is to read before and after acting, as the browser verbs do. The repair is
 * automated and needs no ask: delete the message and put it in the right place. The exception is when people
 * have already started engaging; if there is only a reaction, the message is moved automatically.
 *
 * So after each guarded post this reads the message back (`readMessage`, Slack's own `thread_ts`) and judges it
 * against the address the post asked for (`../../outbound/slack/placement.ts`). On a mismatch it reads the place
 * the message landed for anything a PERSON said after it:
 *
 * - **nobody did** → journal the intent, post the same arguments again ONCE where they were addressed, read that
 *   back, and only then `chat.delete` the misplaced message ONCE. The caller gets the REPOST's identity, so a
 *   reservation, a media attach, a turn record or a later stream append all land on the message that stands.
 * - **somebody did** → the conversation stays where it started. Journal the intent, post ONE cross-link to the
 *   intended address naming the misplaced message's permalink, and read the link back. The caller gets the
 *   original identity.
 *
 * **Repost first, delete second — the order is the safety property.** Every post here is at-most-once
 * (`./atMostOnceClient.ts`): a post whose response is lost is indistinguishable from one never sent. Deleting
 * first would make that ambiguity, a 429 or a process death between the two calls cost the message outright.
 * Reposting first means every failure leaves the ORIGINAL standing: a failed or unconfirmed repost is
 * `repost-failed`, a failed delete leaves a duplicate the report names, and a crash leaves an intent row with no
 * result — never a send that vanished.
 *
 * **What it never does.** A failed or empty read-back is `unverified` and acts on nothing: only a POSITIVE
 * observation of the wrong place licenses a repair. A reply addressed at a REPLY's ts is threaded by Slack under
 * that thread's root, so before calling a thread mismatch real the addressed ts is read too and its own root
 * taken; when that read fails the post is `unverified`, never repaired. A failed engagement read acts on nothing
 * — "could not tell whether anyone replied" is not "nobody replied". There is no loop: a repost that lands wrong
 * again is reported, never moved a second time. And nothing here throws once the first post has landed — every
 * failure after that point is an outcome on {@link PostedMessage.placement}, because a throw would read upstream
 * as a send that may not have happened and release a reservation over a message standing in Slack.
 *
 * **Innermost, and why.** `./writeGuards.ts` composes this beneath every other door, so a post reaches it only
 * once the typed-runs, high-stakes and repeat doors have passed it. The repost and the cross-link call the RAW
 * transport, so no outer door judges them a second time: the repeat door in particular would read the place,
 * and the repost is by construction the same words the door already cleared.
 *
 * **The stated limit.** A live frame `held` in a DIFFERENT channel would strand its later edits: capture persists
 * only the frame's ts and rebuilds the channel from the mention (`../../live/listen/capture.ts`). Reaching it
 * needs Slack to answer a post with a conversation other than the one it was addressed to — which a conversation
 * id never does — so it is named here rather than widened into capture's record.
 *
 * Reactions are not engagement by construction — a thread read returns messages, never reactions.
 *
 * **Three modules, one guard.** This one decides and carries the contract; it imports the reads, journal rows and
 * seams from `./writeGuardPlacementCore.ts` and the two repairs, `move` and `crossLink`, from
 * `./writeGuardPlacementRepair.ts`, which imports from the core too. Neither half imports anything from here. The
 * one re-export is `PlacementGuardSeams`, so the transport wiring reads the guard's whole surface from this file.
 */
import { err, ok } from "../../lib/result.js";
import { fetchCompleteSlackThread } from "../../live/slack/pagination.js";
import { appendPlacementRow } from "../../live/slack/placementJournal.js";
import type { ReadSlackMessage } from "../../outbound/slack/lifecycleGuards.js";
import {
  addressedToPerson,
  compareSlackPlacement,
  engagementAfter,
  type PlacedMessageRef,
  type PlacementMatch,
  type SlackPlacementAddress,
} from "../../outbound/slack/placement.js";
import { makeSlackApi } from "./api.js";
import {
  canonicalAddress,
  causeText,
  conversationTsOf,
  dmMemberOf,
  finish,
  observedRootOf,
  type PlacementGuardSeams,
  type Post,
  READ_BACK_ATTEMPTS,
  readBack,
  repairFailed,
  type Settling,
  unreadRootOf,
} from "./writeGuardPlacementCore.js";
import { crossLink, move } from "./writeGuardPlacementRepair.js";
import type { PostedMessage, SlackWriteTransport } from "./writeTransport.js";

export type { PlacementGuardSeams } from "./writeGuardPlacementCore.js";

/**
 * Every transport method that ADDS a message, each read back after it posts. Asserted exhaustive at compile time
 * below: a new method returning a {@link PostedMessage} that is not listed here fails `yarn typecheck`.
 */
export const PLACEMENT_METHODS = [
  "postAssistantMessage",
  "postCard",
  "postDripMessage",
  "postNoFold",
  "postPoll",
  "postRecipeResponse",
  "postTurn",
  "startStream",
] as const satisfies readonly (keyof SlackWriteTransport)[];

/** The transport methods whose answer is a fresh message's identity. */
type PostingMethod = {
  [K in keyof SlackWriteTransport]: SlackWriteTransport[K] extends (args: never) => Promise<PostedMessage> ? K : never;
}[keyof SlackWriteTransport];

/** `true` only when every posting method is in {@link PLACEMENT_METHODS}. */
type PlacementMethodsExhaustive = [Exclude<PostingMethod, (typeof PLACEMENT_METHODS)[number]>] extends [never]
  ? true
  : false;

/** Compile-time witness: a posting method missing from the list turns this into a type error. */
const placementMethodsExhaustive: PlacementMethodsExhaustive = true;
void placementMethodsExhaustive;

/**
 * The declaration a cassette or a replay makes that its transport is not read back: neither recorded the guard's
 * reads, so a live read-back would be an unrecorded request. A spelled-out value rather than an absent one, so
 * leaving the guard off is a decision a reader can see at the construction site.
 */
export const PLACEMENT_OUT_OF_SCOPE = "placement-out-of-scope";

/** Settle a post whose read-back failed or never found it: `unverified`, registered under what can be proven. */
async function settleUnread<A>({
  settling,
  posted,
  detail,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
  detail: string;
}): Promise<PostedMessage> {
  // The read that would name its thread failed, so the row keeps the root it was SENT to, proven without that read,
  // and whose post it is, so a later reply there is still re-read (check 4). What cannot be proven is said, not kept.
  const self = await settling.transport.whoAmI().catch(() => undefined);
  const threadRoot = await unreadRootOf({ posted, settling });
  let unregistered = "";
  if (self === undefined) {
    unregistered = "; auth.test could not name who posted it, so its thread is not registered for a later re-read";
  } else if (threadRoot === undefined) {
    unregistered = `; the addressed ts ${String(settling.intended.threadTs)} could not be read for its root, so its thread is not registered for a later re-read`;
  }
  return finish({
    final: posted,
    outcome: { detail: `${detail}${unregistered}`, kind: "unverified", posted },
    read: undefined,
    settling,
    unread: { botId: self?.botId, threadRoot, userId: self?.userId },
  });
}

/**
 * Judge a read message against its address, with a reply addressed AT a reply resolved to that thread's root.
 * `unresolved` when that root could not be read, which the caller answers as `unverified`.
 */
async function verdictOf<A>({
  settling,
  posted,
  message,
  dmMember,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
  message: ReadSlackMessage;
  dmMember: string | undefined;
}): Promise<PlacementMatch | { readonly kind: "unresolved"; readonly detail: string }> {
  const observed = { channel: posted.channel, dmMember, threadTs: message.threadTs, ts: posted.ts };
  const match = compareSlackPlacement({ observed, requested: settling.intended });
  const landedRoot = observedRootOf({ read: message });
  if (match.kind === "matched" || landedRoot === undefined || settling.intended.threadTs === undefined) {
    return match;
  }
  const canonical = await canonicalAddress({ observedChannel: posted.channel, settling });
  if (canonical === undefined) {
    const detail = `${match.detail}; the addressed root ${settling.intended.threadTs} could not be read to resolve it`;
    return { detail, kind: "unresolved" };
  }
  return compareSlackPlacement({ observed, requested: canonical });
}

/** Repair a positively misplaced post: move it when nobody engaged, cross-link to it when somebody did. */
async function repair<A>({
  settling,
  posted,
  message,
  detail,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
  message: ReadSlackMessage;
  detail: string;
}): Promise<PostedMessage> {
  // Landed top level: anybody replying did so in its own thread. Landed in a thread: anything said after it there.
  const threadTs = conversationTsOf({ read: message, ts: posted.ts });
  const place = await settling.seams.readThread({ channel: posted.channel, threadTs });
  if (place.isErr()) {
    return repairFailed({
      detail: `${detail}; ${place.error}`,
      read: message,
      reason: "engagement-unreadable",
      settling,
      standing: posted,
    });
  }
  // Whose messages are this guard's own, read once: one that cannot be read excludes nothing from engagement.
  const self = await settling.transport.whoAmI().catch(() => undefined);
  const engagement = engagementAfter({ afterTs: posted.ts, rawMessages: place.value, self });
  if (engagement.length === 0) {
    return move({ detail, posted, read: message, self, settling });
  }
  return crossLink({ detail, engagement, posted, read: message, settling });
}

/** Read one post back and settle it: verified, unverified, moved, held or repair-failed. */
async function settle<A>({
  settling,
  posted,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
}): Promise<PostedMessage> {
  const read = await readBack({ posted, seams: settling.seams, transport: settling.transport });
  if (read.isErr()) {
    return settleUnread({ detail: `read-back failed: ${read.error}`, posted, settling });
  }
  if (read.value === undefined) {
    const detail = `read-back found no message at that ts after ${String(READ_BACK_ATTEMPTS)} looks`;
    return settleUnread({ detail, posted, settling });
  }
  const message = read.value;
  const dmMember = await dmMemberOf({ channel: posted.channel, settling });
  if (addressedToPerson({ address: settling.intended }) && dmMember === undefined) {
    // Whose DM it landed in is the one fact that would justify a repair, so not knowing it acts on nothing.
    const detail = `the DM ${posted.channel} that Slack answered ${settling.intended.channel} with could not be read for its member`;
    return finish({ final: posted, outcome: { detail, kind: "unverified", posted }, read: message, settling });
  }
  const verdict = await verdictOf({ dmMember, message, posted, settling });
  if (verdict.kind === "unresolved") {
    const { detail } = verdict;
    return finish({ final: posted, outcome: { detail, kind: "unverified", posted }, read: message, settling });
  }
  if (verdict.kind === "matched") {
    return finish({ final: posted, outcome: { kind: "verified", posted }, read: message, settling });
  }
  return repair({ detail: verdict.detail, message, posted, settling });
}

/** One guarded post method: post, then settle. A throw from the post itself is the send failing, unchanged. */
function guarded<A>({
  transport,
  seams,
  post,
  surface,
  addressOf,
}: {
  transport: SlackWriteTransport;
  seams: PlacementGuardSeams;
  post: Post<A>;
  surface: string;
  addressOf: (args: A) => SlackPlacementAddress;
}): Post<A> {
  return async (args) => {
    const posted = await post(args);
    const settling: Settling<A> = { args, intended: addressOf(args), post, seams, surface, transport };
    return settle({ posted: { channel: posted.channel, ts: posted.ts }, settling });
  };
}

/**
 * A transport that reads each post back and puts a misplaced one right.
 *
 * @param transport the transport to wrap — the raw one in production, a fake in a test
 * @param seams the thread reader, the journal, the clock and the pause
 * @returns the same transport with every {@link PLACEMENT_METHODS} method read back after it posts
 */
export function guardPlacement({
  transport,
  seams,
}: {
  transport: SlackWriteTransport;
  seams: PlacementGuardSeams;
}): SlackWriteTransport {
  const addressed = (args: { channel: string; threadTs?: string | undefined }): SlackPlacementAddress => ({
    channel: args.channel,
    threadTs: args.threadTs,
  });
  const wrap = <A extends { channel: string; threadTs?: string | undefined }>({
    post,
    surface,
  }: {
    post: Post<A>;
    surface: string;
  }): Post<A> => guarded({ addressOf: addressed, post, seams, surface, transport });
  return {
    ...transport,
    postAssistantMessage: wrap({
      post: (args) => transport.postAssistantMessage(args),
      surface: "postAssistantMessage",
    }),
    postCard: wrap({ post: (args) => transport.postCard(args), surface: "postCard" }),
    postDripMessage: wrap({ post: (args) => transport.postDripMessage(args), surface: "postDripMessage" }),
    postNoFold: wrap({ post: (args) => transport.postNoFold(args), surface: "postNoFold" }),
    postPoll: wrap({ post: (args) => transport.postPoll(args), surface: "postPoll" }),
    postRecipeResponse: wrap({ post: (args) => transport.postRecipeResponse(args), surface: "postRecipeResponse" }),
    postTurn: wrap({ post: (args) => transport.postTurn(args), surface: "postTurn" }),
    startStream: wrap({ post: (args) => transport.startStream(args), surface: "startStream" }),
  };
}

/**
 * The live seams for one token and home: the same identity reads its own threads, and the home's journal.
 *
 * @param token the token the transport writes as
 * @param home the state home whose placement journal the rows go to
 * @returns the seams {@link guardPlacement} runs over in production
 */
export function productionPlacementSeams({ token, home }: { token: string; home: string }): PlacementGuardSeams {
  const api = makeSlackApi({ token });
  return {
    appendRow: ({ row }) => {
      try {
        appendPlacementRow({ home, row });
        return ok(undefined);
      } catch (cause) {
        return err(causeText({ cause }));
      }
    },
    nowIso: () => new Date().toISOString(),
    pause: ({ ms }) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    readThread: async ({ channel, threadTs }) => {
      const read = await fetchCompleteSlackThread({ api, channel, threadTs });
      return read.isErr() ? err(read.error.message) : ok(read.value.rawMessages);
    },
  };
}
