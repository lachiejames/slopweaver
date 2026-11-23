/**
 * Who a Slack member id is, as the console draws it — a name a reader recognises, with the id on hover.
 *
 * A parked draft reading `you (U0SYN000001)` and `@U0SYN000003` leaves the owner unable to tell what an id
 * resolves to, or whether the post goes as them or as the bot, so a name stands in for it.
 * The names come from `slack draft list --json`'s `people`, which the CLI resolves off member bronze; this
 * module only chooses what to draw. An id nobody named is drawn as the id — an invented name on a draft the owner
 * presses is the one thing a label here must never be.
 *
 * Imports only `./slackEscapes`, which undoes Slack's own wire escaping. Pure: ids and a roster in, labels out.
 */
import { slackTokenPlainly, slackUnescaped, slackWireWords, type WireToken } from "./slackEscapes";

/** Which store an org-chart fact was read from — the hover card names it beside the fact. */
export type OrgFactSource = "google-admin" | "vanta";

/**
 * Where a member sits in the organisation, joined by the CLI off the Google directory and the Vanta atlas by their
 * trusted email (`src/corpus/members/orgChart.ts`). The owner wants people's titles beside which Vanta group and
 * which team they are in.
 */
export interface PersonOrg {
  /** Google's title, else Vanta's job title, with the store it came from. */
  readonly title: { readonly value: string; readonly source: OrgFactSource } | undefined;
  /** Google's department — the team. */
  readonly department: string | undefined;
  /** Google's org unit path. */
  readonly orgUnit: string | undefined;
  /** Vanta's employment status as Vanta spells it (`CURRENT`, `ON_LEAVE`). */
  readonly vantaStatus: string | undefined;
  /** Their Vanta groups, the most specific first. */
  readonly vantaGroups: readonly string[];
}

/** One member's names, as the roster carries them, and the 72px picture Slack draws them with. */
export interface SlackPersonName {
  readonly name: string | undefined;
  readonly handle: string | undefined;
  /** Carried by the drafts reading; a roster read off another verb has no picture to give. */
  readonly avatarUrl?: string | undefined;
  /** Their role, off their own Slack profile — the identity hover card's position line. */
  readonly title?: string | undefined;
  /** Whether Slack says they have left — drawn greyed, "(deactivated)" on hover, the way Slack draws them. */
  readonly deactivated?: boolean | undefined;
  /** Whether no other current member shares their first name, so a row naming only that first name means them. */
  readonly firstNameUnique?: boolean | undefined;
  /** Whether no other current member's name is theirs or starts with it, so a row naming it whole means them. */
  readonly nameUnique?: boolean | undefined;
  /** Where they sit in the organisation, when the CLI joined them to the directory or Vanta. */
  readonly org?: PersonOrg | undefined;
}

/** The roster a draft reading carries, keyed by Slack member id. */
export type SlackPeople = ReadonlyMap<string, SlackPersonName>;

/** What a label draws, and what its hover says. */
export interface PersonLabel {
  readonly text: string;
  readonly title: string;
}

/**
 * A key spelled as a Slack member or group id, with or without a leading `@`: an id, not a name, so a chip never
 * draws it in place of its own target's id. Its grammar is the one the draft register parses an id by, any length,
 * so a short id the parser accepts is never drawn as a name. Slack's
 * own wire spelling of a group id, `subteam^S…` or `!subteam^S…`, is an id too.
 */
const ID_SPELLED_KEY = /^[@!]*(?:subteam\^)?[UWS][A-Z0-9]+$/;

/** Every character a reader cannot see on a chip: spaces of every kind, controls, formats and default-ignorables. */
const UNSEEN = /[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** {@link UNSEEN} at either end of a key. */
const UNSEEN_EDGES =
  /^[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]+|[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]+$/gu;

/**
 * A recorded key as a chip may draw it: trimmed of every unseen edge character, and `undefined` when what it shows
 * spells an id or nothing, so the chip draws its own target's id. What it shows is read after NFKC with every unseen
 * character removed, so no character a reader cannot see slips an id past the check. Every chip and label on the card
 * reads a key through this one function, a person's and a group's alike.
 *
 * @param key the key the author wrote, when the draft recorded one
 * @returns the key to draw, its leading `@` kept, or `undefined` when the chip draws its target's id
 */
export function recordedNameKey({ key }: { key: string | undefined }): string | undefined {
  if (key === undefined) {
    return undefined;
  }
  const shown = key.normalize("NFKC").replaceAll(UNSEEN, "");
  if (shown === "" || shown === "@" || ID_SPELLED_KEY.test(shown)) {
    return undefined;
  }
  // Trimmed by the same set, so an edge character `trim` misses (U+0085) cannot keep a leading `@`.
  return key.replace(UNSEEN_EDGES, "");
}

/** A member id as a whole destination — a DM addressed by user id, as `slack post --channel U…` records one. */
const MEMBER_ID = /^[UW][A-Z0-9]+$/;

/**
 * The picture Slack draws beside `id`, when member bronze holds one — never a borrowed face for an id it does not.
 *
 * @param id the Slack member id
 * @param people the roster the reading carried
 * @returns the 72px avatar address, or `undefined` for initials
 */
export function avatarOf({ id, people }: { id: string | undefined; people: SlackPeople }): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  return people.get(id)?.avatarUrl;
}

/**
 * The member a direct message recorded against a member id is WITH — the face Slack puts in that DM's header.
 * A `D…` conversation id names no member, so it answers nothing rather than a guess.
 *
 * @param channel the destination the draft was recorded against
 * @returns the member id, or `undefined` when the destination is not one member
 */
export function directMessagePeer({ channel }: { channel: string }): string | undefined {
  return MEMBER_ID.test(channel) ? channel : undefined;
}

/**
 * The name the roster holds for `id`, when it holds a real one.
 *
 * @returns the trimmed name, or `undefined` when the roster has none
 */
function nameOf({ id, people }: { id: string; people: SlackPeople }): string | undefined {
  const name = people.get(id)?.name?.trim();
  if (name === undefined || name === "") {
    return undefined;
  }
  return name;
}

/**
 * A member's label: their name, else the bare id. The hover is always the id.
 *
 * @param id the Slack member id
 * @param people the roster the reading carried
 * @returns what to draw and what to show on hover
 */
export function personLabel({ id, people }: { id: string; people: SlackPeople }): PersonLabel {
  const name = nameOf({ id, people });
  if (name === undefined) {
    return { text: id, title: id };
  }
  return { text: name, title: id };
}

/**
 * What a card's sentence calls the person a label names (chips only in the properties, a first
 * name everywhere else): their first name when no other current member shares it, else their whole name, and the
 * label's own text when the roster names nobody by its hover id — a group's key, a handle, a bare id.
 *
 * @param label a person or group label, its hover the member id
 * @param people the roster the reading carried
 * @returns the words a sentence draws
 */
export function spokenName({ label, people }: { label: PersonLabel; people: SlackPeople }): string {
  const name = nameOf({ id: label.title, people });
  if (name === undefined) {
    return label.text;
  }
  if (people.get(label.title)?.firstNameUnique === true) {
    // The name is trimmed, so everything before its first space is its first word.
    return name.replace(/\s.*$/su, "");
  }
  return name;
}

/**
 * A mention chip's label: the roster's name, else the key the author wrote when it is a handle rather than an
 * id, else the id. The leading `@` is the chip's to draw, so it is stripped here.
 *
 * @param id the member id the mention notifies
 * @param recordedKey the key the author wrote in the form, when the draft recorded one for this id
 * @param people the roster the reading carried
 * @returns what to draw and what to show on hover
 */
export function mentionLabel({
  id,
  recordedKey,
  people,
}: {
  id: string;
  recordedKey: string | undefined;
  people: SlackPeople;
}): PersonLabel {
  const name = nameOf({ id, people });
  if (name !== undefined) {
    return { text: name, title: id };
  }
  const key = recordedNameKey({ key: recordedKey });
  if (key === undefined) {
    return { text: id, title: id };
  }
  return { text: key.replace(/^@/, ""), title: id };
}

/**
 * A user group's label: the key the author recorded, else the handle Slack's wire carried (`<!subteam^S…|@handle>`),
 * else "a group" — never the `S…` id, which names nothing a reader knows (measured, a Queue card read
 * `@S0SYN000012` where Slack draws `@platform`). No group roster reaches the console, so a group is never looked up
 * as a person. Each candidate is read through {@link recordedNameKey}, so one spelled as an id falls through. The
 * leading `@` is the chip's to draw, so it is stripped here; the id is always the hover.
 *
 * @param groupId the subteam id the mention notifies
 * @param recordedKey the key the author wrote in the form, when the draft recorded one for this group
 * @param handle the handle the wire carried after the `|`, already unescaped, when it carried one
 * @returns what to draw and what to show on hover
 */
export function groupLabel({
  groupId,
  recordedKey,
  handle,
}: {
  groupId: string;
  recordedKey: string | undefined;
  handle: string | undefined;
}): PersonLabel {
  const recorded = groupNameOf({ candidate: recordedKey, groupId });
  if (recorded !== undefined) {
    return { text: recorded, title: groupId };
  }
  const written = groupNameOf({ candidate: handle, groupId });
  if (written !== undefined) {
    return { text: written, title: groupId };
  }
  return { text: "a group", title: groupId };
}

/**
 * One candidate for a group's name with its `@` stripped, or `undefined` when it is absent, spelled as an id, or shows
 * the group's own id anywhere in what a reader sees — so no spelling around the id can draw it.
 */
function groupNameOf({ candidate, groupId }: { candidate: string | undefined; groupId: string }): string | undefined {
  const key = recordedNameKey({ key: candidate });
  if (key === undefined || key.normalize("NFKC").replaceAll(UNSEEN, "").includes(groupId)) {
    return undefined;
  }
  return key.replace(/^@/, "");
}

/**
 * Where a parked draft is going and who it is to, in words — the half of the card header that has to read
 * _"post this to Kyle in a direct message"_ rather than the Slack id it was recorded against. A prompt reading
 * `Post this to U0SYN000025 as you?` leaves the owner unable to tell which name it refers to, so a name and a
 * channel replace the member id.
 *
 * A DM addressed by member id is to that member, named off the roster. A `D…` conversation id says only that
 * it is a direct message: the id alone does not say with whom, a person it tags need not be its peer, and a
 * guessed name is the one thing this must never draw. In a channel the people it is to are the people it
 * tags, once each, groups left out because a group is not a person; a channel the recording read could not
 * name is drawn as its id.
 *
 * A thread reply says so — `a thread in #dev` — because a reply read as a channel post is the mistake that sent
 * two parked replies out top-level under the owner's name.
 *
 * @param channel the destination the draft was recorded against — a channel, a `D…` DM or a member id
 * @param channelName what the recording read called the channel, when it could say
 * @param mentions the mentions the draft recorded, in order
 * @param people the roster the reading carried
 * @param threaded whether it replies inside a thread rather than posting top-level
 * @returns where it goes, and the labels of who it is to (empty when it is to nobody in particular)
 */
export function draftDestination({
  channel,
  channelName,
  mentions,
  people,
  threaded,
}: {
  channel: string;
  channelName: string | undefined;
  mentions: readonly { readonly key: string; readonly target: string; readonly kind: string }[];
  people: SlackPeople;
  threaded: boolean;
}): { readonly where: string; readonly to: readonly PersonLabel[] } {
  const place = draftPlace({ channel, channelName, mentions, people });
  if (!threaded) {
    return place;
  }
  return { to: place.to, where: `a thread in ${place.where}` };
}

/**
 * Where a held draft lands, as its card's top-right stamp says it: `in thread` or `top level`. The top right is
 * where the owner reads first, and the placement is the fact they misread there, so the stamp is short and
 * concise. `top level` never claims the post is not a reply: a conversation can run at a channel's top level.
 *
 * @param threaded whether it replies inside a thread rather than posting top-level
 * @returns the stamp's words
 */
export function draftPlacement({ threaded }: { threaded: boolean }): "in thread" | "top level" {
  if (threaded) {
    return "in thread";
  }
  return "top level";
}

/** The conversation a draft lands in, and who it is to, before any thread is said. */
function draftPlace({
  channel,
  channelName,
  mentions,
  people,
}: {
  channel: string;
  channelName: string | undefined;
  mentions: readonly { readonly key: string; readonly target: string; readonly kind: string }[];
  people: SlackPeople;
}): { readonly where: string; readonly to: readonly PersonLabel[] } {
  if (MEMBER_ID.test(channel)) {
    return { to: [personLabel({ id: channel, people })], where: "a direct message" };
  }
  if (channel.startsWith("D")) {
    return { to: [], where: "a direct message" };
  }
  const seen = new Set<string>();
  const persons = mentions.filter((mention) => {
    if (mention.kind !== "person" || seen.has(mention.target)) {
      return false;
    }
    seen.add(mention.target);
    return true;
  });
  const tagged = taggedLabels({ mentions: persons, people });
  if (channelName !== undefined) {
    return { to: tagged, where: `#${channelName}` };
  }
  return { to: tagged, where: channel };
}

/**
 * The message a thread reply goes under, in words — `under Jonah's message: "the pool exhausted at 09:12"` — or
 * `under the thread rooted at <ts>` for a row recorded before the parent was read. The author is named off the
 * roster, the id where it cannot be.
 *
 * @param thread the root `ts`, and its author and text when the recording read them
 * @param people the roster the reading carried
 * @returns the phrase, starting at `under`
 */
export function draftParentInWords({
  thread,
  people,
}: {
  thread: { readonly ts: string; readonly parentUserId: string | undefined; readonly parentText: string | undefined };
  people: SlackPeople;
}): string {
  if (thread.parentText === undefined) {
    return `under the thread rooted at ${thread.ts}`;
  }
  const said = mentionsAsSlackDraws({ people, text: thread.parentText });
  if (thread.parentUserId === undefined) {
    return `under the message: "${said}"`;
  }
  return `under ${spokenName({ label: personLabel({ id: thread.parentUserId, people }), people })}'s message: "${said}"`;
}

/**
 * The conversation a draft lands in, as the context line names it — `#dev`, the channel id when the recording read
 * could not name it, or `a direct message`.
 */
function contextPlace({ channel, channelName }: { channel: string; channelName: string | undefined }): string {
  if (MEMBER_ID.test(channel) || channel.startsWith("D")) {
    return "a direct message";
  }
  if (channelName === undefined) {
    return channel;
  }
  return `#${channelName}`;
}

/** The first sentence of a message — up to its first `.`, `!` or `?` that ends a word — else the whole of it. */
function firstSentence({ text }: { text: string }): string {
  const oneLine = text.replaceAll(/\s+/gu, " ").trim();
  const end = /[.!?](?=\s|$)/u.exec(oneLine);
  if (end === null) {
    return oneLine;
  }
  return oneLine.slice(0, end.index + 1);
}

/**
 * A card's context line: where a draft lands, and — for a thread reply — whose thread and how it opens.
 *
 * It reads `on your thread in #<channel>: "<the root's first sentence>"`, a mention in that sentence rendered as the
 * plain `@` and the person's name. Plain words, no chips: the people row carries the chips, by id, and a chip inside a
 * sentence is the defect this card head was rebuilt to end. Every word is a record
 * field or a constant.
 *
 * @param channel the destination the draft was recorded against — a channel, a `D…` DM or a member id
 * @param channelName what the recording read called the channel, when it could say
 * @param thread the root it replies under, with the root's author and text when the recording read them, or
 *   `undefined` for a top-level post
 * @param yourId the owner's own member id, so a thread they started reads as `your thread` — `undefined` on a bot row, whose
 *   author is not the owner
 * @param people the roster the reading carried
 * @returns the line, starting at its preposition
 */
export function draftContextInWords({
  channel,
  channelName,
  thread,
  yourId,
  people,
}: {
  channel: string;
  channelName: string | undefined;
  thread: { readonly parentUserId: string | undefined; readonly parentText: string | undefined } | undefined;
  yourId: string | undefined;
  people: SlackPeople;
}): string {
  const place = contextPlace({ channel, channelName });
  if (thread === undefined) {
    return `in ${place}`;
  }
  if (thread.parentText === undefined) {
    return `in a thread in ${place}`;
  }
  const opens = firstSentence({ text: mentionsAsSlackDraws({ people, text: thread.parentText }) });
  const author = thread.parentUserId;
  if (author === undefined) {
    return `on a thread in ${place}: "${opens}"`;
  }
  if (author === yourId) {
    return `on your thread in ${place}: "${opens}"`;
  }
  return `on ${spokenName({ label: personLabel({ id: author, people }), people })}'s thread in ${place}: "${opens}"`;
}

/** A person mention's target as Slack's wire text spells it, the `@U…` of `<@U…>` or `<@U…|label>`. */
const WIRE_MENTION = /^@([UW][A-Z0-9]+)$/u;

/** A user-group mention's target as Slack's wire text spells it, the `!subteam^S…` of `<!subteam^S…|@handle>`. */
const WIRE_GROUP = /^!subteam\^([A-Z0-9]+)$/u;

/**
 * A `@here`, `@channel` or `@everyone` target as Slack's wire text spells it, and `!group`, Slack's older spelling of
 * `@channel`, which it draws as one.
 */
const WIRE_BROADCAST = /^!(here|channel|everyone|group)$/u;

/**
 * A message's text with each person mention drawn as Slack draws it, `@name` — plain words rather than a citation
 * chip, because this sits inside the draft preview (`docs/console/identity-chips.md`) — and every other token and
 * escape as Slack draws it, so a card never reads `&amp;` or a raw `<https://…|label>`.
 *
 * @returns the text, every person named off the roster, else its label, else its id; a group by its handle, else as
 *   a group; a broadcast as `@here`; anything else by {@link slackTokenPlainly}; `&amp;` as `&`
 */
function mentionsAsSlackDraws({ text, people }: { text: string; people: SlackPeople }): string {
  return slackWireWords({ drawToken: (token) => tokenAsSlackDraws({ people, token }), text });
}

/**
 * One wire token as Slack draws it: a person named off the roster, else its label, else its id; a group by
 * {@link groupLabel}; a broadcast as `@here`; a link, channel or date by {@link slackTokenPlainly}, so a link reads as
 * its label, else its address.
 *
 * @param people the roster that names a tagged person
 * @returns the words the token reads as
 */
export function tokenAsSlackDraws({ token, people }: { token: WireToken; people: SlackPeople }): string {
  const label = token.label === undefined ? undefined : slackUnescaped({ text: token.label });
  const person = WIRE_MENTION.exec(token.target);
  if (person !== null) {
    return `@${mentionLabel({ id: person[1], people, recordedKey: label }).text}`;
  }
  const group = WIRE_GROUP.exec(token.target);
  if (group !== null) {
    return `@${groupLabel({ groupId: group[1], handle: label, recordedKey: undefined }).text}`;
  }
  const broadcast = WIRE_BROADCAST.exec(token.target);
  if (broadcast !== null) {
    return broadcastWords({ which: broadcast[1] });
  }
  return slackTokenPlainly({ token });
}

/** A broadcast as Slack draws it, `@here`, with the legacy `!group` drawn as the `@channel` it means. */
function broadcastWords({ which }: { which: string }): string {
  if (which === "group") {
    return "@channel";
  }
  return `@${which}`;
}

/**
 * A destination as the card header says it — `to Kyle in a direct message`, `to Ari and Sadie in #dev`, or
 * `in #dev` for a message to nobody in particular.
 *
 * @param to the names of who it is to, in order
 * @param where the destination as {@link draftDestination} words it
 * @returns the phrase, starting at its preposition
 */
export function addressedInWords({ to, where }: { to: readonly string[]; where: string }): string {
  const last = to.at(-1);
  if (last === undefined) {
    return `in ${where}`;
  }
  if (to.length === 1) {
    return `to ${last} in ${where}`;
  }
  return `to ${to.slice(0, -1).join(", ")} and ${last} in ${where}`;
}

/**
 * Who a draft tags, one label per recorded mention, in the order recorded: a person by {@link mentionLabel},
 * a group by {@link groupLabel} — the key the author wrote, else "a group", never its id (a group is never looked up
 * as a person) — so the head and tag summary draw what the message preview draws. The hover is the target id.
 *
 * @param mentions the mentions the draft recorded — the key written, the id it notifies, and which kind
 * @param people the roster the reading carried
 * @returns the labels
 */
export function taggedLabels({
  mentions,
  people,
}: {
  mentions: readonly { readonly key: string; readonly target: string; readonly kind: string }[];
  people: SlackPeople;
}): readonly PersonLabel[] {
  return mentions.map((mention) => {
    if (mention.kind === "person") {
      return mentionLabel({ id: mention.target, people, recordedKey: mention.key });
    }
    return groupLabel({ groupId: mention.target, handle: undefined, recordedKey: mention.key });
  });
}
