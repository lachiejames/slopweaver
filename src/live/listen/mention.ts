/**
 * The CONTRACT between transport and turn: a Slack event read into a typed {@link Mention}, and the
 * {@link MentionHandler} that receives one. PURE — this file knows nothing about sockets, tokens or Slack's
 * wire format beyond the event object it is handed.
 *
 * The seam is deliberate and it is the whole point of splitting this work in two: everything upstream of
 * `MentionHandler` is transport (open a socket, acknowledge an envelope, drop a redelivery), and everything
 * downstream is a turn (retrieve, answer, render, cite). One function between them, so the two can be built
 * and replaced independently.
 *
 * ## Only-when-addressed, in a channel and in a DM alike
 *
 * The owner was explicit that a bot which joins conversations uninvited "can be like really annoying really
 * fast". The rule that came out of that is *only respond when addressed*, and what counts as ADDRESS is this
 * file and nothing else — three shapes, each reached by a different Slack event, each refusing everything it
 * does not name:
 *
 *  - **In a channel, address means an explicit tag.** Other people are talking to each other, so nothing but
 *    `app_mention` may wake the bot on a message nobody threaded. That is enforced here as well as in the
 *    subscription, because a subscription is configuration and configuration drifts.
 *  - **In a 1:1 DM, address ALSO means an explicit tag.** Measured: a tagged message in a DM does
 *    not produce `app_mention` at all — it arrives as a `message` event with `channel_type: "im"` — so the
 *    tag has to be found in the event's own text here, and a listener subscribed to `app_mention` alone is
 *    simply deaf in a DM. The POLICY built on that measurement: a DM that treats every message as address
 *    breaks once the DM becomes where DRAFT messages are composed as the owner, because the bot starts a turn
 *    on each one — hourglass reacts and working cards on the owner's own drafts. So in the DM the bot responds
 *    ONLY to messages that explicitly mention it, exactly like a channel, and an untagged DM message is not
 *    captured at all — no react, no card, no queue entry. Refusing it HERE, at the parse, is what makes "not captured at all" true: nothing downstream
 *    (the burst queue included) ever sees an untagged DM, so there is no artifact for a later layer to undo.
 *
 * ## A reply under one of the bot's OWN posts, and nothing else about a channel
 *
 * The bot's scheduled posts are addressable, so a reader gets the root cause by replying in the thread instead of opening
 * Datadog. This is a THIRD way to be addressed and it is deliberately the narrowest one in the file —
 * {@link parseChannelThreadReply} refuses everything that is not a reply, in an opted-in conversation, under
 * a root this install's own bot user wrote. Nothing top-level wakes it, `mpim` is refused exactly as before,
 * and the bot still never answers itself. The default is OFF: with no conversation named, every channel
 * `message` takes the same refusal it took before the feature existed.
 *
 * MEASURED before this was built: the app already subscribes `message.channels` and
 * `message.groups` — both bundled manifests list them — and 2,576 channel and group `message` events had
 * already reached this listener and been refused at the `channel_type` check. Nothing about the Slack app
 * needed changing; only the predicate did. Repro:
 * `grep -ch "not a direct message" "$SLOPWEAVER_HOME"/live/listener/*.err | paste -sd+ - | bc`
 *
 * ## What a DM must still refuse, and why each refusal is load-bearing
 *
 *  - **A message THIS INSTALL'S OWN APP posted.** The listener's own answer is a message in the very channel
 *    it is now listening to, so without this refusal the first DM produces an unbounded loop of the bot
 *    answering itself. In a channel that risk needed the bot's own tag to be echoed; in a DM it needs
 *    nothing at all, which makes this the sharpest refusal in the file. This used to refuse EVERY bot-
 *    authored event, human or not; only self-authorship is refused here — a whitelisted
 *    bot deserves the same treatment a whitelisted human gets, full capability, not a second trust tier, so
 *    every other identity (bot or human) reaches the ordinary responder whitelist exactly the same way.
 *  - **Any `subtype`.** A person speaking sends a message with NO subtype. An edit (`message_changed`), a
 *    deletion, a join and a thread broadcast all carry one, and none of them is somebody addressing the bot.
 *    Refusing the whole class rather than an enumerated list is the conservative direction: a subtype nobody
 *    here has seen is refused BY NAME in the log, so a wrongly-refused one is discoverable rather than silent.
 *    The channel path refuses the same class for the same reason — Slack can dispatch `app_mention` for an
 *    edit that newly introduces a tag, not only a fresh message, so this is not DM-specific after all.
 *  - **A `channel_type` that is not `im`.** `message.mpim` is subscribed on the app, and a group DM is
 *    deliberately NOT treated as address — several humans plus the bot is neither a private conversation nor
 *    a channel, and the turn applies the OWNER's identity lens to whoever spoke, which is safe in a 1:1 and
 *    is not safe in front of an audience. That is a question for the owner, recorded rather than assumed.
 */

import { err, ok, type Result } from "../../lib/result.js";
import type { StartedChecklist } from "../ask/checklist.js";
import type { AskIdentity } from "../ask/identity.js";
import { type MentionParseError, MentionParseErrors } from "./errors.js";

/**
 * Which Slack surface addressed the bot.
 *
 * Carried as a typed field rather than inferred downstream from the channel id's leading letter, because
 * "does this id start with D" is exactly the kind of guess this repo's identity rule exists to forbid. A
 * consumer that behaves differently in a DM — the thread title, which only an agent-container thread has —
 * reads a value the parser established from the event, not one it re-derived from a string.
 */
export type MentionSurface = "channel" | "dm";

/**
 * A mention, already parsed and validated: everything a turn needs, nothing about Slack's wire format.
 *
 * `threadTs` is the thread to REPLY in, already resolved: Slack sets `thread_ts` only on a message that is
 * already in a thread, so a top-level mention resolves to its own `ts`. A consumer therefore never has to
 * decide where a reply goes, and cannot get it wrong in one place and right in another.
 */
export interface Mention extends AskIdentity {
  /** The Slack user id who addressed the bot. An id, never a name: identity resolves by exact match only. */
  readonly userId: string;
  /**
   * The message text with every `<@…>`/`<!…>` tag normalised to `@(id)` and Slack's `&amp;`/`&lt;`/`&gt;`
   * escapes decoded (see {@link stripMentionTags}).
   */
  readonly text: string;
  /** Which surface the tag came from — an `app_mention` in a channel, or a `message` in a 1:1 DM. */
  readonly surface: MentionSurface;
  /**
   * The capture-time checklist the listener already posted for this mention, when it did.
   *
   * The one field on this interface that is NOT parsed off the Slack event — no `parse*` function here ever
   * sets it, so it is always absent on the value those functions return. It exists on `Mention` rather than
   * as a second parallel value only because `MentionHandler` is a fixed one-argument contract: attaching it
   * here is what lets `src/cli/commands/listen/run.ts`'s capture-time wrapper hand the value to the next
   * handler in the chain — ultimately the emitted mention JSON `slopweaver turn brief` reads — without a
   * second handler shape for the rest of the listener to accommodate.
   */
  readonly started?: StartedChecklist | undefined;
}

/** What the transport hands a turn. The one function the two halves of this feature share. */
export type MentionHandler = (mention: Mention) => Promise<void>;

/** The `message` event's `channel_type` for a 1:1 direct message. The ONLY message surface that is address. */
const DIRECT_MESSAGE_CHANNEL_TYPE = "im";

/**
 * Every event type this listener will even consider.
 *
 * `message` is here for DMs alone; a `message.channels` or `message.groups` delivery reaches the same parse
 * and is refused on its `channel_type`, so widening the subscription cannot make the bot answer a channel it
 * was not tagged in.
 */
export const MENTION_EVENT_TYPES: readonly string[] = ["app_mention", "message"];

/**
 * Every Slack tag token: a user (`<@U123>`), a user with a display hint (`<@U123|name>`), a user group
 * (`<!subteam^S123|@group>`) and the specials (`<!here>`, `<!channel>`, `<!everyone>`).
 *
 * Anchored on the literal `<` … `>` delimiters Slack itself emits, so nothing that merely LOOKS like a name
 * is touched. That is the identity rule holding at the character level: a tag is an explicit, exact-match
 * token, and a bare word is never treated as one.
 */
const TAG_TOKEN = /<[@!][^>]*>/g;

/**
 * Whether a message body carries the EXACT-match Slack tag for one user id — `<@U123>` or `<@U123|display>`.
 *
 * The single definition of "this text tags that id", exported so the live parser and recovery
 * (`./recover.ts`'s own `addressed`) apply the same predicate rather than two regexes that can drift apart.
 * Exact match only: a bare display name is never a tag, which is this repo's identity rule holding at the
 * character level. It reads the RAW text rather than {@link stripMentionTags}'s output, because that
 * function normalises `<@U123>` to `@(U123)` and this one is anchored on Slack's own delimiters.
 *
 * @param text the raw message text, tags still intact — never the `stripMentionTags` output
 * @param userId the Slack USER id the tag must name
 * @returns whether the text tags exactly that id
 */
export function taggedIn({ text, userId }: { text: string; userId: string }): boolean {
  return new RegExp(String.raw`<@${userId}(\|[^>]*)?>`).test(text);
}

/**
 * The three Slack broadcast specials that carry no identity at all — nobody's id is lost by dropping one, so
 * these are the only tokens this function actually removes rather than normalises.
 */
const NO_IDENTITY_SPECIALS: ReadonlySet<string> = new Set(["here", "channel", "everyone"]);

/**
 * Normalise one already-matched tag token (the full `<…>` span) to what {@link stripMentionTags} keeps.
 *
 * A user tag (`<@U123>`, with or without a `|name` display hint) and a user-group tag (`<!subteam^S123>`,
 * same optional hint) both carry an id a turn may need to act on — measured: an owner
 * instruction naming who to whitelist arrived with its `<@U…>` stripped to nothing, and only the id would
 * have said who. Both normalise to `@(id)`, dropping the display hint rather than resolving it: a display
 * name is ambiguous (two people can share one), an id never is. The three broadcast specials carry no id at
 * all, so they are the one case still removed outright.
 *
 * @param token the matched tag, delimiters included
 * @returns the normalised replacement — `@(id)` for an identity-bearing tag, empty for a broadcast special
 */
function normaliseTagToken(token: string): string {
  const body = token.slice(1, -1); // drop the outer `<` and `>`
  const marker = body[0];
  const rest = body.slice(1);
  if (marker === "!" && NO_IDENTITY_SPECIALS.has(rest)) {
    return "";
  }
  // `split` on any string always yields at least one element, so the first is never absent.
  const withoutDisplayHint = rest.split("|")[0]!;
  const id = withoutDisplayHint.startsWith("subteam^")
    ? withoutDisplayHint.slice("subteam^".length)
    : withoutDisplayHint;
  return `@(${id})`;
}

/**
 * Undo the three entities Slack escapes in every text field it returns, so what a turn echoes back is what
 * the human actually typed.
 *
 * Slack's documented contract is that `&`, `<` and `>` — and only those three — are escaped, so this is a
 * complete decoder rather than a partial one. `&amp;` is undone LAST so `&amp;lt;` decodes to the literal
 * `&lt;` a person typed rather than to a `<` they did not; a sequential chain in the other order
 * double-decodes. The same decoder as `../slack/fileMeta.ts` and `../../corpus/slack/curated.ts`, stated
 * again rather than shared for the reason `curated.ts` already records: these layers move independently.
 *
 * MEASURED: the owner replied to a live turn quoting their own earlier line, and the progress
 * card in a public channel rendered `answering: &gt; I think we had a PR for it…` — Slack's escape for the
 * `>` a blockquote starts with, echoed raw into the one part of the card a reader sees first.
 *
 * Runs AFTER {@link TAG_TOKEN} has consumed Slack's own `<…>` tag spans, and {@link taggedIn} reads the RAW
 * text, so decoding here can never change which ids a message is judged to address.
 *
 * @param text the escaped text as Slack returned it
 * @returns the text with Slack's escapes undone
 */
function unescapeSlackEntities({ text }: { text: string }): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * Normalise Slack's tag tokens in a message body and tidy the whitespace they leave behind.
 *
 * What is left is what the human actually asked, WITH every id it named — a mention tag can be pure
 * addressing (the bot's own tag, redundant once the event fired) or it can be the entire content of the
 * instruction (who to add, who to loop in), and this function cannot tell those apart from the text alone.
 * So it keeps every identity-bearing tag rather than guessing, normalised to a stable `@(id)` form so the
 * stream never carries Slack's own `<@…>` markup or a display name a turn might mistake for resolved
 * identity. A DM goes through the same normaliser even though no tag is required there, because a human who
 * tags out of habit must still have that id land in the question, not vanish.
 *
 * @param text the raw `event.text`
 * @returns the text with every tag token normalised, Slack's three HTML entities decoded
 *   ({@link unescapeSlackEntities}) and internal runs of whitespace collapsed
 */
export function stripMentionTags({ text }: { text: string }): string {
  const withoutTags = text.replaceAll(TAG_TOKEN, normaliseTagToken);
  return unescapeSlackEntities({ text: withoutTags }).replaceAll(/\s+/g, " ").trim();
}

/** A required non-empty string field of the event, or undefined. */
function required({ event, key }: { event: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = event[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Whether ANY app authored this event — bot-shaped, but not yet distinguished as ours or someone else's.
 *
 * Two fields are checked rather than one. `bot_id` is what a `chat.postMessage` from this app carries, and
 * it is the field the channel path has always tested; `app_id` is present on some bot deliveries where
 * `bot_id` is not.
 */
function botAuthored({ event }: { event: Readonly<Record<string, unknown>> }): boolean {
  return required({ event, key: "bot_id" }) !== undefined || required({ event, key: "app_id" }) !== undefined;
}

/** Every reason a bot-authored event gets refused as this install's own — worded distinctly, never conflated. */
export type SelfAuthoredReason = "confirmed-match" | "unknown-self-identity" | "ambiguous-app-id-only";

/**
 * Whether a bot-authored event must be refused as (or as indistinguishable from) THIS install's own app.
 *
 * `selfBotId` is this install's own `bot_id` — resolved once via `auth.test` at startup (see
 * `SlackSelfIdentity` in `../../outbound/slack/lifecycleGuards.ts`) and threaded down here as plain data, so
 * this file stays pure. Three refusal reasons, checked in order, and never conflated — an earlier version of
 * this check reused one boolean for both "unknown self identity" and "ambiguous app_id-only shape", which
 * produced the WRONG reason (the app_id-only wording) for an event that actually carried a `bot_id`:
 *
 *  - **`selfBotId` unknown** (the identity call never resolved): refuse every bot-authored event, exactly the
 *    conservative behaviour this file has always had — "we could not tell" must never read as "safe to admit".
 *  - **The event carries `bot_id`**: refuse only when it matches ours; a different bot's `bot_id` is a peer,
 *    not an echo, and reaches the ordinary responder whitelist like anyone else.
 *  - **The event carries `app_id` but no `bot_id`**: there is no self `app_id` to compare against, so this
 *    cannot be told apart from our own echo — refuse defensively rather than risk the loop.
 *
 * @param event the raw `payload.event` object
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns refused, naming exactly why — or not refused at all
 */
export function selfAuthoredCheck({
  event,
  selfBotId,
}: {
  event: Readonly<Record<string, unknown>>;
  selfBotId: string | undefined;
}): { readonly refuse: false } | { readonly refuse: true; readonly reason: SelfAuthoredReason } {
  if (selfBotId === undefined) {
    return botAuthored({ event }) ? { reason: "unknown-self-identity", refuse: true } : { refuse: false };
  }
  const eventBotId = required({ event, key: "bot_id" });
  if (eventBotId !== undefined) {
    return eventBotId === selfBotId ? { reason: "confirmed-match", refuse: true } : { refuse: false };
  }
  return required({ event, key: "app_id" }) !== undefined
    ? { reason: "ambiguous-app-id-only", refuse: true }
    : { refuse: false };
}

/**
 * Whether a `bot_id` value is actually SHAPED like one — Slack's own platform-assigned `bot_id` is always
 * `B` followed by uppercase letters and digits only (e.g. `B0SYN000011`), never user-typed or attacker-
 * chosen text. Two review-pass rounds found progressively narrower ways an unvalidated fallback could be
 * abused: first a crafted `bot_id: "U0VICTIM"` becoming `Mention.userId` outright; then, once only the `B`
 * PREFIX was required, a crafted `bot_id` such as `` B` <@U0VICTIM> `X `` — genuinely `B`-prefixed, but
 * carrying embedded backticks that would break out of `acknowledgementText`'s own inline-code wrapping and
 * inject a live mention anyway. Matching the FULL shape (anchored start to end, no stray characters
 * possible) closes both: a value that fails this can never reach `Mention.userId`, so nothing downstream —
 * now or in some future consumer — has to re-derive "is this actually safe to treat as an id".
 *
 * @param value the raw `bot_id` string to check
 * @returns whether it matches Slack's own `bot_id` shape
 */
export function looksLikeBotId({ value }: { value: string }): boolean {
  return /^B[A-Z0-9]{6,}$/.test(value);
}

/**
 * Who sent the event: its `user`, or — on a peer bot's post, which Slack sends with a `bot_id` and NO `user`
 * at all — that `bot_id`, only when it is `B`-shaped. Undefined when neither identifies a sender.
 */
function senderOf({
  event,
  rawBotId,
}: {
  event: Readonly<Record<string, unknown>>;
  rawBotId: string | undefined;
}): string | undefined {
  const user = required({ event, key: "user" });
  if (user === undefined) {
    return rawBotId !== undefined && looksLikeBotId({ value: rawBotId }) ? rawBotId : undefined;
  }
  return user;
}

/**
 * The fields every accepted event must carry, or the names of the ones it did not.
 *
 * `userId` prefers `event["user"]`, falling back to `event["bot_id"]` only when `user` is absent AND the
 * `bot_id` value is actually `B`-shaped (see {@link looksLikeBotId}) — measured directly against a real
 * message from the official Claude-in-Slack app: it carries `bot_id` and a display
 * `username`, but NO `user` field at all. `Mention.userId` is compared against the responder whitelist,
 * logged, and — only when it is `U`/`W`-shaped — rendered as a live `<@…>` Slack mention by
 * `acknowledgementText`; requiring the fallback's shape here is what keeps that downstream check honest.
 */
function coreFields({
  event,
}: {
  event: Readonly<Record<string, unknown>>;
}):
  | { readonly channel: string; readonly messageTs: string; readonly userId: string }
  | { readonly missing: readonly string[] } {
  const channel = required({ event, key: "channel" });
  const messageTs = required({ event, key: "ts" });
  const rawBotId = required({ event, key: "bot_id" });
  const userId = senderOf({ event, rawBotId });
  if (channel === undefined || messageTs === undefined || userId === undefined) {
    return {
      missing: [
        ...(channel === undefined ? ["channel"] : []),
        ...(messageTs === undefined ? ["ts"] : []),
        ...(userId === undefined ? ["user or bot_id"] : []),
      ],
    };
  }
  return { channel, messageTs, userId };
}

/**
 * The thread a mention sits in. Slack sets `thread_ts` only inside a thread, so a top-level message threads on
 * its own ts.
 */
function mentionThreadTs({
  event,
  core,
}: {
  event: Readonly<Record<string, unknown>>;
  core: { readonly messageTs: string };
}): string {
  const threadTs = required({ event, key: "thread_ts" });
  if (threadTs === undefined) {
    return core.messageTs;
  }
  return threadTs;
}

/** Assemble the mention once every refusal has been passed. */
function mentionOf({
  event,
  core,
  surface,
}: {
  event: Readonly<Record<string, unknown>>;
  core: { readonly channel: string; readonly messageTs: string; readonly userId: string };
  surface: MentionSurface;
}): Mention {
  return {
    channel: core.channel,
    messageTs: core.messageTs,
    surface,
    // An empty body is legitimate — a bare tag with no words is a real thing a human sends.
    text: stripMentionTags({ text: typeof event["text"] === "string" ? event["text"] : "" }),
    threadTs: mentionThreadTs({ core, event }),
    userId: core.userId,
  };
}

/**
 * Read a raw `app_mention` event into a {@link Mention}, refusing anything else.
 *
 * The channel path, unchanged: in a channel the bot answers an explicit tag and nothing else. A tag from
 * another bot is no longer refused outright — only this install's own tag is, so that a whitelisted peer
 * bot reaches the responder whitelist exactly the way a human does.
 *
 * @param event the raw `payload.event` object
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known
 * @returns the mention, or every reason it was refused
 */
export function parseAppMention({
  event,
  selfBotId,
}: {
  event: Readonly<Record<string, unknown>>;
  selfBotId: string | undefined;
}): Result<Mention, MentionParseError> {
  const eventType = required({ event, key: "type" });
  if (eventType !== "app_mention") {
    return err(MentionParseErrors.notAppMention({ eventType }));
  }
  // Our OWN acknowledgement contains the bot's tag, so handling it would answer itself, forever. Any OTHER
  // bot's tag is not refused here — see `selfAuthoredCheck`'s own doc for the three cases.
  const self = selfAuthoredCheck({ event, selfBotId });
  if (self.refuse) {
    return err(MentionParseErrors.selfAuthored({ reason: self.reason, surface: "channel" }));
  }
  // The same refusal the DM path has always applied, extended here for parity: Slack can dispatch app_mention
  // for an EDIT that newly introduces a tag (message_changed), not only a fresh human message. A person
  // speaking carries no subtype at all, so refusing the whole class — rather than special-casing edits — is
  // the same conservative direction this file already takes for DMs, and a subtype nobody here has seen is
  // still refused BY NAME in the log rather than silently.
  const subtype = required({ event, key: "subtype" });
  if (subtype !== undefined) {
    return err(MentionParseErrors.hasSubtype({ subtype, surface: "channel" }));
  }
  const core = coreFields({ event });
  if ("missing" in core) {
    return err(MentionParseErrors.missingFields({ missing: core.missing, surface: "channel" }));
  }
  return ok(mentionOf({ core, event, surface: "channel" }));
}

/**
 * Read a raw `message` event into a {@link Mention}, accepting a message in a 1:1 DM that explicitly tags
 * this install's bot and comes from anyone but this install's own app.
 *
 * @param event the raw `payload.event` object
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known
 * @param selfUserId this install's own Slack USER id from `auth.test` — what the DM's text must tag.
 *   `undefined` (an `auth.test` that never resolved) refuses every DM rather than admitting one it cannot
 *   check, the same fail-closed direction {@link selfAuthoredCheck} takes for an unknown identity
 * @returns the mention, or the reason it was refused
 */
export function parseDirectMessage({
  event,
  selfBotId,
  selfUserId,
}: {
  event: Readonly<Record<string, unknown>>;
  selfBotId: string | undefined;
  selfUserId: string | undefined;
}): Result<Mention, MentionParseError> {
  const eventType = required({ event, key: "type" });
  if (eventType !== "message") {
    return err(MentionParseErrors.notMessage({ eventType }));
  }
  const channelType = required({ event, key: "channel_type" });
  if (channelType !== DIRECT_MESSAGE_CHANNEL_TYPE) {
    // `mpim` lands here on purpose. A group DM has an audience, and the turn answers with the OWNER's lens.
    return err(MentionParseErrors.notDirectMessage({ channelType }));
  }
  // The sharpest refusal here: our own answer lands in the channel we are listening to, so our OWN DM must
  // never wake us. A DM from any OTHER bot is not refused here — see `selfAuthoredCheck`'s own doc.
  const self = selfAuthoredCheck({ event, selfBotId });
  if (self.refuse) {
    return err(MentionParseErrors.selfAuthored({ reason: self.reason, surface: "dm" }));
  }
  const subtype = required({ event, key: "subtype" });
  if (subtype !== undefined) {
    // Named rather than swallowed: a subtype refused here that turns out to be a person speaking is a fact
    // this line puts in the log, instead of a message that vanished.
    return err(MentionParseErrors.hasSubtype({ subtype, surface: "dm" }));
  }
  // The DM-tag ruling, applied before any field is read so a refused DM produces nothing at all. The
  // tag is matched against the RAW text, because `stripMentionTags` is what removes it and that runs later.
  if (selfUserId === undefined) {
    return err(MentionParseErrors.dmNotAddressed({ reason: "self-identity-unknown" }));
  }
  if (!taggedIn({ text: typeof event["text"] === "string" ? event["text"] : "", userId: selfUserId })) {
    return err(MentionParseErrors.dmNotAddressed({ reason: "no-tag" }));
  }
  const core = coreFields({ event });
  if ("missing" in core) {
    return err(MentionParseErrors.missingFields({ missing: core.missing, surface: "dm" }));
  }
  return ok(mentionOf({ core, event, surface: "dm" }));
}

/**
 * The two `channel_type` values a public or private CHANNEL message arrives with. `im` is the DM path and
 * `mpim` is refused exactly as it always has been — see {@link parseDirectMessage}'s own note.
 */
const CHANNEL_CONVERSATION_TYPES: ReadonlySet<string> = new Set(["channel", "group"]);

/**
 * Whether this event is a reply whose thread ROOT this install's own bot user wrote — the one check the
 * whole third addressing shape turns on, lifted out so it can be read on its own.
 *
 * Everything it cannot answer refuses: an absent `thread_ts` (a top-level message), a `thread_ts` equal to
 * the event's own `ts` (the root itself, arriving back as an event), an unresolved `selfUserId`, an absent
 * `parent_user_id`, or a root somebody else wrote.
 *
 * @param event the raw `payload.event` object
 * @param selfUserId this install's own Slack USER id from `auth.test`
 * @returns the reason it is not one, or `undefined` when it is
 */
function notOurThreadReply({
  event,
  selfUserId,
}: {
  event: Readonly<Record<string, unknown>>;
  selfUserId: string | undefined;
}): MentionParseError | undefined {
  const threadTs = required({ event, key: "thread_ts" });
  if (threadTs === undefined) {
    return MentionParseErrors.notThreadReply({ reason: "no-thread-ts" });
  }
  if (threadTs === required({ event, key: "ts" })) {
    return MentionParseErrors.notThreadReply({ reason: "is-the-root" });
  }
  if (selfUserId === undefined) {
    return MentionParseErrors.threadRootNotOurs({ reason: "self-identity-unknown" });
  }
  const parentUserId = required({ event, key: "parent_user_id" });
  if (parentUserId === undefined) {
    return MentionParseErrors.threadRootNotOurs({ reason: "no-parent-user-id" });
  }
  if (parentUserId !== selfUserId) {
    return MentionParseErrors.threadRootNotOurs({ reason: "another-author" });
  }
  return undefined;
}

/**
 * Read a raw channel `message` event into a {@link Mention}, accepting ONLY a reply whose thread root is a
 * post this install's own bot made, in a conversation thread-reply addressing has been switched on for.
 *
 * The root check is `parent_user_id` — Slack's own field on a threaded `message`, carrying the USER id of
 * the thread's first message. It is compared for exact equality with `selfUserId`, the same `auth.test`
 * identity {@link parseDirectMessage} matches its tag against, so this is an id check and never a display
 * name. What it proves is "authored by this install's bot user", which is one step short of "posted through
 * the door": today those are the same set, because AGENTS.md rule 3 puts every bot post through the door and
 * a post made as the owner carries the owner's own user id rather than the bot's. A future as-the-bot path that
 * bypassed the door would inherit addressability, which is the one thing to check before adding one.
 *
 * Everything the field cannot answer refuses: an absent `parent_user_id`, an unresolved `selfUserId`, a root
 * somebody else wrote. That is the same fail-closed direction as {@link selfAuthoredCheck}'s unknown case.
 *
 * `listen recover`'s sweep does NOT pick these up. It decides "addressed" with {@link taggedIn} (see
 * `./recover.ts`'s own `addressed`), and a reply under a bot post carries no tag, so a reply that arrives
 * while nothing is listening is excluded as `not-addressed` — a no-op by design, exactly as rule 2 says a
 * tag arriving with no visible session is.
 *
 * @param event the raw `payload.event` object
 * @param enabledChannels the conversations thread-reply addressing is switched on for — empty is the default
 *   and refuses every channel, so this whole path is inert until one is named
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known
 * @param selfUserId this install's own Slack USER id from `auth.test` — what the thread root's author must be
 * @returns the mention, or the reason it was refused
 */
export function parseChannelThreadReply({
  event,
  enabledChannels,
  selfBotId,
  selfUserId,
}: {
  event: Readonly<Record<string, unknown>>;
  enabledChannels: readonly string[];
  selfBotId: string | undefined;
  selfUserId: string | undefined;
}): Result<Mention, MentionParseError> {
  const eventType = required({ event, key: "type" });
  if (eventType !== "message") {
    return err(MentionParseErrors.notMessage({ eventType }));
  }
  const channelType = required({ event, key: "channel_type" });
  if (channelType === undefined || !CHANNEL_CONVERSATION_TYPES.has(channelType)) {
    // `mpim` lands here, refused in the words it has always been refused in: a group DM has an audience, and
    // the turn answers with the OWNER's lens. That decision is the owner's and is not reopened here.
    return err(MentionParseErrors.notDirectMessage({ channelType }));
  }
  // Our own scheduled post is the ROOT of every thread this path answers in, and our own reply lands in the
  // same thread — so without this the first answer would address itself, forever, with no tag needed.
  const self = selfAuthoredCheck({ event, selfBotId });
  if (self.refuse) {
    return err(MentionParseErrors.selfAuthored({ reason: self.reason, surface: "channel" }));
  }
  const subtype = required({ event, key: "subtype" });
  if (subtype !== undefined) {
    return err(MentionParseErrors.hasSubtype({ subtype, surface: "channel" }));
  }
  const channel = required({ event, key: "channel" });
  if (channel === undefined) {
    return err(MentionParseErrors.missingFields({ missing: ["channel"], surface: "channel" }));
  }
  if (!enabledChannels.includes(channel)) {
    return err(MentionParseErrors.threadRepliesNotEnabled({ channel }));
  }
  const notOurs = notOurThreadReply({ event, selfUserId });
  if (notOurs !== undefined) {
    return err(notOurs);
  }
  const core = coreFields({ event });
  if ("missing" in core) {
    return err(MentionParseErrors.missingFields({ missing: core.missing, surface: "channel" }));
  }
  return ok(mentionOf({ core, event, surface: "channel" }));
}

/**
 * Read any raw Slack event into a {@link Mention} — the ONE door the transport calls.
 *
 * Dispatches on the event type, and then on the conversation, so all three rules live behind a single
 * contract: an `app_mention` is a channel tag, a `message` in a 1:1 DM is a tagged DM, a `message`
 * anywhere else is a candidate thread reply under one of this bot's own posts, and anything else is refused
 * with the type named. Splitting the `message` arm on `channel_type` HERE rather than inside one parse is
 * what keeps {@link parseDirectMessage} byte-for-byte the function the DM-tag ruling produced.
 *
 * @param event the raw `payload.event` object
 * @param enabledChannels the conversations thread-reply addressing is switched on for; empty — the default —
 *   means no channel `message` is ever an address, which is this listener's behaviour before that feature
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known
 * @param selfUserId this install's own Slack USER id from `auth.test` — the tag a DM must carry to be
 *   address, and the author a thread reply's root must have
 * @returns the mention, or every reason it was refused
 */
export function parseMentionEvent({
  event,
  enabledChannels = [],
  selfBotId,
  selfUserId,
}: {
  event: Readonly<Record<string, unknown>>;
  enabledChannels?: readonly string[];
  selfBotId: string | undefined;
  selfUserId: string | undefined;
}): Result<Mention, MentionParseError> {
  const eventType = required({ event, key: "type" });
  if (eventType === "app_mention") {
    return parseAppMention({ event, selfBotId });
  }
  if (eventType === "message") {
    const channelType = required({ event, key: "channel_type" });
    if (channelType === DIRECT_MESSAGE_CHANNEL_TYPE) {
      return parseDirectMessage({ event, selfBotId, selfUserId });
    }
    return parseChannelThreadReply({ enabledChannels, event, selfBotId, selfUserId });
  }
  return err(MentionParseErrors.unknownEventType({ eventType }));
}
