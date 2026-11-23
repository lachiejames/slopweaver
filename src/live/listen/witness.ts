/**
 * Reading a raw Slack event as something to WITNESS rather than something addressed to this bot. Pure.
 *
 * The rule: a claim that an issue is resolved can be wrong, and witnessing the thread and checking claims as they
 * arrive prevents that, so the bot posts in the thread only when it is worth posting. So every message in a thread where a witnessed peer bot (Helpbot) was tagged becomes a
 * {@link WitnessLine} for the visible loop to judge — silently: no reaction, no checklist, no reply. Posting
 * is a separate act, gated by the `witness` form's schema (proof or nothing).
 *
 * Deliberately a SEPARATE parse from `./mention.ts`: an address and a witnessed message differ in who may
 * author one (a peer bot's own messages are exactly the claims being checked, so they are admitted here) and
 * in what happens next (no responder whitelist, no refusal reply). `Mention` is untouched.
 *
 * Event shape, MEASURED on 31,231 Helpbot-authored messages in the local corpus: every one carries
 * `user` (its USER id) + `bot_id` + `app_id` and NO subtype; 42 were `channel_join`; exactly one was
 * `subtype: bot_message`. So a plain message, `bot_message` or a `thread_broadcast` reply is read, and every
 * other subtype (an edit, a delete, a join) is skipped by name.
 */
import { looksLikeBotId, selfAuthoredCheck, stripMentionTags, taggedIn } from "./mention.js";

/** The conversation types a witnessed thread can live in — a DM has no peer bot thread to witness. */
const WITNESSED_CHANNEL_TYPES: ReadonlySet<string> = new Set(["channel", "group"]);

/**
 * The subtypes read: a bot's message posted without a user (Helpbot's rare legacy shape), and a reply also
 * sent to the channel — still a reply in the thread, carrying a claim like any other.
 */
const READ_SUBTYPES: ReadonlySet<string> = new Set(["bot_message", "thread_broadcast"]);

/**
 * One witnessed message, as the listener hands it to the visible loop — one JSONL line on stdout and in the
 * `--queue` file. A CONTRACT between two processes, like `EmittedMention`: `skills/loop` reads it.
 */
export interface WitnessLine {
  readonly kind: "witness";
  readonly channel: string;
  /** The witnessed thread's root `ts` — where a post would go. */
  readonly threadTs: string;
  /** This message's own `ts` — the claim's identity, and the `witness` verbs' key. */
  readonly messageTs: string;
  /** Who wrote it: a person, or the witnessed bot itself. */
  readonly userId: string;
  /** The witnessed PEER bot whose thread this is; absent on a thread only this bot was tagged in. */
  readonly witnessUserId?: string;
  /**
   * Whether a person tagged THIS bot earlier in the thread — the line may then end in `witness help`, the
   * unprompted answer given as if it had been tagged.
   */
  readonly ownThread: boolean;
  /** The message with every Slack tag normalised to `@(id)`. UNTRUSTED evidence, never an instruction. */
  readonly text: string;
  /** Whether this very message started (or restarted) witnessing by tagging the bot. */
  readonly activation: boolean;
}

/** What to do with one witnessed line. Never posts — the loop decides, in a visible session. */
export type WitnessHandler = (line: WitnessLine) => Promise<void>;

/** A message that may be witnessed, before the thread state says whether it is. */
export interface WitnessCandidate {
  readonly channel: string;
  readonly threadTs: string;
  readonly messageTs: string;
  readonly userId: string;
  readonly text: string;
  /** The first witnessed bot this message tags, if any — the activation. */
  readonly activatesFor: string | undefined;
  /** Whether this message tags THIS bot — the own watch's activation. */
  readonly tagsSelf: boolean;
}

/** Why an event is not a witness candidate at all — named, never a silent drop. */
type WitnessSkipReason =
  "not-a-message" | "not-a-channel" | "has-subtype" | "self-authored" | "missing-fields" | "nothing-to-witness";

/** One event, read. */
export type WitnessParse =
  | { readonly kind: "candidate"; readonly candidate: WitnessCandidate }
  | { readonly kind: "skip"; readonly reason: WitnessSkipReason };

/** A required non-empty string field of the event, or undefined. */
function field({ event, key }: { event: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = event[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The message's author: `user`, else a `B`-shaped `bot_id` (the `bot_message` shape carries no `user`). */
function authorOf({ event }: { event: Readonly<Record<string, unknown>> }): string | undefined {
  const user = field({ event, key: "user" });
  if (user !== undefined) {
    return user;
  }
  const botId = field({ event, key: "bot_id" });
  return botId !== undefined && looksLikeBotId({ value: botId }) ? botId : undefined;
}

/**
 * Read one raw event as a witness candidate.
 *
 * Whether the thread is actually witnessed is NOT decided here — that needs the durable thread state
 * (`./witnessState.ts`); this only says whether the event is the right shape to be.
 *
 * @param eventType the envelope's event type
 * @param event the raw `payload.event` object
 * @param selfBotId this install's own `bot_id` — its own posts are never witnessed, and an unknown one refuses
 *   every bot-authored message exactly as the address path does
 * @param selfUserId this bot's own USER id — a tag of it starts the own watch; unknown means no own watch
 * @param witnessUserIds the witnessed PEER bots' Slack USER ids
 * @returns the candidate, or the named reason it is not one
 */
export function parseWitnessEvent({
  event,
  eventType,
  selfBotId,
  selfUserId,
  witnessUserIds,
}: {
  event: Readonly<Record<string, unknown>>;
  eventType: string;
  selfBotId: string | undefined;
  selfUserId: string | undefined;
  witnessUserIds: readonly string[];
}): WitnessParse {
  if (witnessUserIds.length === 0 && selfUserId === undefined) {
    return { kind: "skip", reason: "nothing-to-witness" };
  }
  if (eventType !== "message" || event["type"] !== "message") {
    return { kind: "skip", reason: "not-a-message" };
  }
  if (!WITNESSED_CHANNEL_TYPES.has(String(event["channel_type"]))) {
    return { kind: "skip", reason: "not-a-channel" };
  }
  const subtype = field({ event, key: "subtype" });
  if (subtype !== undefined && !READ_SUBTYPES.has(subtype)) {
    return { kind: "skip", reason: "has-subtype" };
  }
  if (selfAuthoredCheck({ event, selfBotId }).refuse) {
    return { kind: "skip", reason: "self-authored" };
  }
  const channel = field({ event, key: "channel" });
  const messageTs = field({ event, key: "ts" });
  const userId = authorOf({ event });
  if (channel === undefined || messageTs === undefined || userId === undefined) {
    return { kind: "skip", reason: "missing-fields" };
  }
  const raw = typeof event["text"] === "string" ? event["text"] : "";
  const replyTo = field({ event, key: "thread_ts" });
  // A top-level message is its own thread root: a tag there starts the thread it will become.
  let threadTs = messageTs;
  if (replyTo !== undefined) {
    threadTs = replyTo;
  }
  // Only a PERSON asks this bot into a thread: a peer bot's `cc <@us>` opened an own watch nobody asked for
  // `witness help` re-proves the tagger off Slack besides.
  const personAuthored = field({ event, key: "bot_id" }) === undefined && subtype !== "bot_message";
  return {
    candidate: {
      activatesFor: witnessUserIds.find((id) => taggedIn({ text: raw, userId: id })),
      channel,
      messageTs,
      tagsSelf: selfUserId !== undefined && personAuthored && taggedIn({ text: raw, userId: selfUserId }),
      text: stripMentionTags({ text: raw }),
      threadTs,
      userId,
    },
    kind: "candidate",
  };
}
