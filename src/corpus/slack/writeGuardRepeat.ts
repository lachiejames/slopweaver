/**
 * The ONE DOOR for "the same identity never says the same thing twice in one place".
 *
 * A finding once went to #defects, and hours later a session hand-composed an older cut of it into a fresh
 * `slack post --as me` to the same channel. The content-hash reservation saw different bytes and passed it;
 * nothing read the channel. The rule is that a repeat is structurally impossible.
 *
 * So every post and reply READS its place before it writes — the channel's last {@link REPEAT_WINDOW_DAYS}
 * days for a top-level message, the whole thread for a reply — and refuses when this token's own identity
 * already said the same words there, or opened with the same line (`outbound/slack/repeatMatch.ts`). The
 * refusal names the existing message's permalink. It is composed in `./writeApi.ts`'s
 * `makeSlackWriteTransport`, beside `./writeGuardTypedRuns.ts`, for the same reason: that is the only place a
 * live transport is built, so a composer added later is guarded by construction, both identities alike.
 *
 * **It fails closed.** A place that cannot be read — `not_in_channel`, a page ceiling, `auth.test` naming no
 * user — refuses too, naming why, because "could not check" is not "checked and clear". The journalled
 * `repeat-send` hatch is the way past either refusal.
 *
 * ## What is guarded, and what is not
 *
 * Guarded: `postCard`, `postNoFold`, `postDripMessage`, `postPoll`, `postRecipeResponse`, and
 * `postAssistantMessage` for an actual answer (metadata V2). Not guarded, deliberately: `postTurn` (a live
 * frame keyed by its turn and edited in place), `startStream` (no comparable text at open), a V1 assistant
 * message (a held or failure NOTICE, whose words are fixed by design), a no-fold message sent with
 * `recurrence: "automation-prompt"` (a recipe's standing question, asked verbatim at every firing — the
 * form kind says so, never the text, and `outbound/slack/automationPromptChannel.ts` has already refused
 * one anywhere but the private prompt conversation; the firing's idempotency key is what stops one firing
 * posting twice), every `chat.update` (it changes a
 * message rather than adding one), and the read, reaction, upload and workspace-shape calls. The media a card
 * uploads is already up when `postCard` refuses, so a refused card leaves its files private and unshared.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchOpen } from "../../hatch/open.js";
import { hatchRefusal } from "../../hatch/render.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { slackTsFromEpochMs } from "../../lib/slackTs.js";
import { fetchCompleteSlackHistory, fetchCompleteSlackThread } from "../../live/slack/pagination.js";
import {
  DAY_MS,
  findRepeat,
  priorsFromRaw,
  REPEAT_WINDOW_DAYS,
  type RepeatSelf,
  repeatIdentity,
  repeatTextOf,
} from "../../outbound/slack/repeatMatch.js";
import { makeSlackApi } from "./api.js";
import type { SlackWriteTransport } from "./writeTransport.js";

/** The register row this guard reads. */
const HATCH_ID = "repeat-send";

/**
 * The most history pages one check reads. A channel busier than this over a week refuses rather than reading
 * without end — one Tier 3 read per post is the budget, and a guard that stalls a send for minutes gets removed.
 */
const REPEAT_READ_MAX_PAGES = 10;

/** The renderer id of a V1 assistant message — a notice, never an answer (`outbound/slack/types.ts`). */
const NOTICE_RENDERER = "slack-assistant-answer-v1";

/**
 * A post the repeat guard refused. `refusedBeforeWire` is what `outbound/slack/sendFailure.ts` reads to release
 * the send's reservation: no request left, so nothing landed.
 */
export class RepeatSendRefusedError extends Error {
  readonly refusedBeforeWire = true;
  /** The permalink of the message this one repeats, absent when the refusal is a failed read. */
  readonly permalink: string | undefined;

  constructor({ message, permalink }: { message: string; permalink: string | undefined }) {
    super(message);
    this.name = "RepeatSendRefusedError";
    this.permalink = permalink;
  }
}

/** What the guard needs beyond the transport it wraps. */
export interface RepeatGuardSeams {
  /** Every raw message in one place from `oldestTs` on: the whole thread when `threadTs` is set. */
  readonly readPlace: (args: {
    channel: string;
    threadTs: string | undefined;
    oldestTs: string;
    latestTs: string;
  }) => Promise<Result<readonly unknown[], string>>;
  readonly nowMs: () => number;
  /** Asked before anything is read: an open hatch passes the post without looking at its place. */
  readonly hatchIsOpen: () => boolean;
}

/** One post about to be judged. */
interface Outgoing {
  readonly channel: string;
  readonly threadTs: string | undefined;
  readonly payload: unknown;
  readonly surface: string;
}

/** Throw the four-line refusal. */
function refuse({ detail, permalink }: { detail: string; permalink?: string }): never {
  const text = hatchRefusal({ detail, hatch: { ...hatchFor({ id: HATCH_ID }), command: "the slack post or reply" } });
  throw new RepeatSendRefusedError({ message: text, permalink });
}

/** Whether a payload is a V1 assistant NOTICE. */
function isNotice({ payload }: { payload: unknown }): boolean {
  const metadata = isRecord(payload) ? payload["metadata"] : undefined;
  const body = isRecord(metadata) ? metadata["event_payload"] : undefined;
  return isRecord(body) && body["renderer"] === NOTICE_RENDERER;
}

/**
 * Who is posting and the conversation id its history lives under. Both are calls the wrapped transport makes
 * BEFORE the wire, so a throw from either is caught here and answered as a failed check: left to escape, it
 * would read as a send that may have landed and hold the reservation unconfirmed.
 *
 * @returns the identity, its permalink base and the conversation id, or why they could not be had
 */
async function locate({
  transport,
  outgoing,
}: {
  transport: SlackWriteTransport;
  outgoing: Outgoing;
}): Promise<Result<{ channel: string; self: RepeatSelf; workspaceUrl: string }, string>> {
  try {
    const self = await transport.whoAmI();
    if (self.userId === undefined || self.workspaceUrl === undefined) {
      return err("auth.test named no user id or workspace");
    }
    // A DM addressed by a person's id is not a conversation id until it is opened, and history reads the D id.
    const addressed = /^[UW]/u.test(outgoing.channel);
    const channel = addressed
      ? (await transport.openConversation({ userIds: [outgoing.channel] })).id
      : outgoing.channel;
    return ok({ channel, self, workspaceUrl: self.workspaceUrl });
  } catch (error) {
    return err(`looking up the place failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Judge one post against what its place already holds, throwing {@link RepeatSendRefusedError} to refuse.
 *
 * @param transport the wrapped transport, for `auth.test` and a DM's conversation id
 * @param seams the place reader, the clock and the hatch
 * @param outgoing the post
 */
async function judge({
  transport,
  seams,
  outgoing,
}: {
  transport: SlackWriteTransport;
  seams: RepeatGuardSeams;
  outgoing: Outgoing;
}): Promise<void> {
  const text = repeatTextOf({ message: outgoing.payload });
  // An open hatch lets every outcome through, so it is asked first and the place is never read.
  if (text === undefined || seams.hatchIsOpen()) {
    return;
  }
  const where = outgoing.threadTs === undefined ? outgoing.channel : `${outgoing.channel} thread ${outgoing.threadTs}`;
  const located = await locate({ outgoing, transport });
  if (located.isErr()) {
    refuse({ detail: `${located.error}, so ${where} could not be checked for a repeat` });
  }
  const { channel, self, workspaceUrl } = located.value;
  const nowMs = seams.nowMs();
  const read = await seams.readPlace({
    channel,
    latestTs: slackTsFromEpochMs({ ms: nowMs + DAY_MS }),
    oldestTs: slackTsFromEpochMs({ ms: nowMs - REPEAT_WINDOW_DAYS * DAY_MS }),
    threadTs: outgoing.threadTs,
  });
  if (read.isErr()) {
    refuse({ detail: `${where} could not be read to check for a repeat: ${read.error}` });
  }
  const priors = priorsFromRaw({ channel, rawMessages: read.value, self, workspaceUrl });
  const windowMs = REPEAT_WINDOW_DAYS * DAY_MS;
  const match = findRepeat({
    digestWindowMs: windowMs,
    firstLineWindowMs: windowMs,
    nowMs,
    outgoing: repeatIdentity({ text }),
    priors,
  });
  if (match === undefined) {
    return;
  }
  const said = match.rule === "digest" ? "the same words" : `the same first line, "${match.prior.firstLine}"`;
  refuse({
    detail:
      `${outgoing.surface}: this identity already said ${said} in ${where} at ` +
      `${new Date(match.prior.tsMs).toISOString()}: ${match.prior.permalink} — edit that message ` +
      `(\`slopweaver slack edit\`) rather than posting it again`,
    permalink: match.prior.permalink,
  });
}

/**
 * A transport that reads each post's place first and refuses a repeat from the same identity.
 *
 * @param transport the transport to wrap — the live one, or a fake in a test
 * @param seams the place reader, the clock and the hatch
 * @returns the same transport with every guarded post judged first
 */
export function guardRepeats({
  transport,
  seams,
}: {
  transport: SlackWriteTransport;
  seams: RepeatGuardSeams;
}): SlackWriteTransport {
  const check = (outgoing: Outgoing): Promise<void> => judge({ outgoing, seams, transport });
  return {
    ...transport,
    postAssistantMessage: async (args) => {
      if (!isNotice({ payload: args.payload })) {
        await check({ ...args, surface: "an assistant answer" });
      }
      return transport.postAssistantMessage(args);
    },
    postCard: async (args) => {
      await check({ ...args, surface: "a card" });
      return transport.postCard(args);
    },
    postDripMessage: async (args) => {
      await check({ ...args, surface: "an as-me message" });
      return transport.postDripMessage(args);
    },
    postNoFold: async (args) => {
      if (args.recurrence === "once") {
        await check({ ...args, surface: "a no-fold message" });
      }
      return transport.postNoFold(args);
    },
    postPoll: async (args) => {
      await check({ ...args, surface: "a poll", threadTs: undefined });
      return transport.postPoll(args);
    },
    postRecipeResponse: async (args) => {
      await check({ ...args, surface: "a recipe response" });
      return transport.postRecipeResponse(args);
    },
  };
}

/**
 * The live seams for one token: its own read client, the wall clock, and the journalled hatch.
 *
 * @param token the token the transport writes as — the same identity reads its own place
 * @param home the state home the sending lane resolved, whose grant journal decides the hatch
 * @returns the seams {@link guardRepeats} runs over in production
 */
export function productionRepeatSeams({ token, home }: { token: string; home: string }): RepeatGuardSeams {
  const api = makeSlackApi({ token });
  return {
    hatchIsOpen: () => hatchOpen({ env: process.env, home, id: HATCH_ID, nowIso: new Date().toISOString() }),
    nowMs: () => Date.now(),
    readPlace: async ({ channel, threadTs, oldestTs, latestTs }) => {
      const read =
        threadTs === undefined
          ? await fetchCompleteSlackHistory({
              api,
              channel,
              latest: latestTs,
              maxPages: REPEAT_READ_MAX_PAGES,
              oldest: oldestTs,
              paced: true,
            })
          : await fetchCompleteSlackThread({ api, channel, threadTs });
      return read.isErr() ? err(read.error.message) : ok(read.value.rawMessages);
    },
  };
}
