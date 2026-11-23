/**
 * The ONE DOOR for "a reply into a high-stakes channel is a reply".
 *
 * A top-level post there is judged by the lane that composes it (`../../cli/commands/slack/highStakesGate.ts`),
 * because only that lane knows whether it is a finding card. A reply is exempt from that judgement, but only
 * while its `thread_ts` names a real top-level message in the channel: one naming nothing lands as a top-level
 * post, with none of the defensibility block and no second-post read. Every lane can reach a reply. The turn lane
 * posts under whatever thread its brief names, and a brief is a file anyone can edit. So the thread is confirmed
 * here, where every reply crosses, rather than in each verb that composes one. It is composed in `./writeGuards.ts`
 * beside the repeat and typed-runs guards, around every live transport, so a composer added later is guarded by
 * construction.
 *
 * A turn frame is only ever a reply too, so `updateTurn` refuses to rewrite a top-level message in a high-stakes
 * channel. Without that, a brief pointing its working card at a finding would re-render the finding in place.
 *
 * **It fails closed.** A thread that cannot be read refuses, and so does a profile that cannot be read. The profile
 * is the one in the home the sending lane resolved, so a `--home` lane is judged by its own list. A home with no
 * profile names no high-stakes channel, and nothing is gated. The `high-stakes-undefended` hatch is the
 * way past, because what it waives is exactly this: an undefended top-level post.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchOpen } from "../../hatch/open.js";
import { hatchRefusal } from "../../hatch/render.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type HighStakesChannel, highStakesChannelOf } from "../../outbound/slack/highStakesChannel.js";
import type { ReadSlackMessage } from "../../outbound/slack/lifecycleGuards.js";
import { readHighStakesConfig } from "../../profileStore.js";
import type { SlackWriteTransport } from "./writeTransport.js";

/** The register row this guard reads. */
const HATCH_ID = "high-stakes-undefended";

/**
 * A reply or turn-frame edit this guard refused. `refusedBeforeWire` is what `outbound/slack/sendFailure.ts`
 * reads to release the send's reservation: no request left, so nothing landed.
 */
export class HighStakesReplyRefusedError extends Error {
  readonly refusedBeforeWire = true;

  constructor({ message }: { message: string }) {
    super(message);
    this.name = "HighStakesReplyRefusedError";
  }
}

/** What the guard needs beyond the transport it wraps. */
export interface HighStakesReplySeams {
  /** The install's high-stakes channels, or why the profile naming them could not be read. */
  readonly channels: () => Result<readonly HighStakesChannel[], string>;
  /** Asked before anything is read: an open hatch passes the call without looking. */
  readonly hatchIsOpen: () => boolean;
}

/** Throw the four-line refusal. */
function refuse({ detail }: { detail: string }): never {
  const text = hatchRefusal({ detail, hatch: { ...hatchFor({ id: HATCH_ID }), command: "the slack reply" } });
  throw new HighStakesReplyRefusedError({ message: text });
}

/** Whether a read-back message is a top-level message: Slack names no thread, or names its own ts. */
function isTopLevel({ message }: { message: ReadSlackMessage }): boolean {
  return message.threadTs === undefined || message.threadTs === message.ts;
}

/**
 * The high-stakes channel a call is aimed at, or undefined when it is not one or the hatch is open.
 *
 * @returns the gated channel, or undefined when the call passes unjudged
 */
function gatedChannel({
  seams,
  channel,
}: {
  seams: HighStakesReplySeams;
  channel: string;
}): HighStakesChannel | undefined {
  if (seams.hatchIsOpen()) {
    return undefined;
  }
  const channels = seams.channels();
  if (channels.isErr()) {
    refuse({
      detail: `the high-stakes channel list could not be read (${channels.error}), so ${channel} could not be judged`,
    });
  }
  return highStakesChannelOf({ channel, channels: channels.value });
}

/**
 * Read one message back, refusing as `surface` when the read fails.
 *
 * @returns the message, or undefined when Slack holds none at that ts
 */
async function readBack({
  transport,
  target,
  ts,
  surface,
}: {
  transport: SlackWriteTransport;
  target: HighStakesChannel;
  ts: string;
  surface: string;
}): Promise<ReadSlackMessage | undefined> {
  try {
    return await transport.readMessage({ posted: { channel: target.id, ts } });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return refuse({
      detail: `${surface} in ${target.name} names ${ts}, which could not be read (${why}), so it is judged as a top-level post`,
    });
  }
}

/** Refuse a reply whose thread is not a real top-level message in a high-stakes channel. */
async function judgeReply({
  transport,
  seams,
  channel,
  threadTs,
  surface,
}: {
  transport: SlackWriteTransport;
  seams: HighStakesReplySeams;
  channel: string;
  threadTs: string | undefined;
  surface: string;
}): Promise<void> {
  if (threadTs === undefined) {
    return;
  }
  const target = gatedChannel({ channel, seams });
  if (target === undefined) {
    return;
  }
  const parent = await readBack({ surface, target, transport, ts: threadTs });
  if (parent === undefined || !isTopLevel({ message: parent })) {
    refuse({
      detail:
        `${surface} replies under ${threadTs} in ${target.name}, which names no top-level message there, so it ` +
        "would land as a top-level post, and a top-level post there goes out only as a finding card",
    });
  }
}

/** Refuse a turn-frame edit of a top-level message in a high-stakes channel: a turn frame is only ever a reply. */
async function judgeTurnEdit({
  transport,
  seams,
  posted,
}: {
  transport: SlackWriteTransport;
  seams: HighStakesReplySeams;
  posted: { readonly channel: string; readonly ts: string };
}): Promise<void> {
  const target = gatedChannel({ channel: posted.channel, seams });
  if (target === undefined) {
    return;
  }
  const edited = await readBack({ surface: "a turn frame edit", target, transport, ts: posted.ts });
  if (edited !== undefined && isTopLevel({ message: edited })) {
    refuse({
      detail:
        `a turn frame edit would rewrite ${posted.ts}, a top-level message in ${target.name}, and a turn frame is ` +
        "only ever a reply",
    });
  }
}

/**
 * A transport that confirms every reply into a high-stakes channel hangs under a real top-level message there,
 * and refuses a turn-frame edit of a top-level one.
 *
 * @param transport the transport to wrap — the live one, or a fake in a test
 * @param seams the channel list and the hatch
 * @returns the same transport with every reply and turn-frame edit judged first
 */
export function guardHighStakesReplies({
  transport,
  seams,
}: {
  transport: SlackWriteTransport;
  seams: HighStakesReplySeams;
}): SlackWriteTransport {
  const reply = (args: { channel: string; threadTs: string | undefined; surface: string }): Promise<void> =>
    judgeReply({ ...args, seams, transport });
  return {
    ...transport,
    postAssistantMessage: async (args) => {
      await reply({ ...args, surface: "an assistant answer" });
      return transport.postAssistantMessage(args);
    },
    postCard: async (args) => {
      await reply({ ...args, surface: "a card" });
      return transport.postCard(args);
    },
    postDripMessage: async (args) => {
      await reply({ ...args, surface: "an as-me message" });
      return transport.postDripMessage(args);
    },
    postNoFold: async (args) => {
      await reply({ ...args, surface: "a no-fold message" });
      return transport.postNoFold(args);
    },
    postRecipeResponse: async (args) => {
      await reply({ ...args, surface: "a recipe response" });
      return transport.postRecipeResponse(args);
    },
    postTurn: async (args) => {
      await reply({ ...args, surface: "a turn frame" });
      return transport.postTurn(args);
    },
    startStream: async (args) => {
      await reply({ ...args, surface: "a streamed answer" });
      return transport.startStream(args);
    },
    updateTurn: async (args) => {
      await judgeTurnEdit({ posted: args.posted, seams, transport });
      return transport.updateTurn(args);
    },
  };
}

/**
 * The live seams: the LANE's own home's profile and the journalled hatch, as the repeat guard reads it.
 *
 * The profile is read from the home the sending verb resolved, never the ambient one: a `turn answer --home <dir>`
 * whose ambient home held no `profile.json` once had its reply into `<dir>`'s #defects judged against no list at all.
 * The hatch's grant is read under that same home, so `hatch open --home <dir>` reaches a send into `<dir>`.
 *
 * @param home the state home whose `profile.json` names the high-stakes channels and whose journal holds the grant
 * @returns the seams {@link guardHighStakesReplies} runs over in production
 */
export function productionHighStakesReplySeams({ home }: { home: string }): HighStakesReplySeams {
  return {
    channels: () => {
      const config = readHighStakesConfig({ home });
      return config.isErr() ? err(config.error.message) : ok(config.value.channels);
    },
    hatchIsOpen: () => hatchOpen({ env: process.env, home, id: HATCH_ID, nowIso: new Date().toISOString() }),
  };
}
