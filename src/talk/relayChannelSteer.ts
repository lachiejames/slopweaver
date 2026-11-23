/**
 * What a relay's words mean for the held drafts and the card they reach — pure.
 *
 * MEASURED: walking a held bot draft parked for a programme channel, the owner said to send it to the security
 * channel instead. That relay reached the board with an empty `about`, the chair's chat line kept the head of the
 * owner's words and lost the steer off the end, the chair re-cut the draft "same channel", and a seat released it into
 * the programme channel in public. The owner's next two relays about the incident then landed on the card that happened
 * to be open, which shares nothing with them. Two answers live here:
 *
 * - **A relay about a held draft that names another channel steers it** ({@link relaySteerPlan}): the plan carries a
 *   `steered` register event (`../outbound/slack/draftRegister.ts`) a release outside that channel is refused on
 *   (`../outbound/slack/draftSteerGate.ts`), and a LEAD line the row's summary and the chair's chat line both open on,
 *   so the steer survives the 800-character cut that dropped it.
 * - **A relay whose words name a draft or channel the open card never mentions does not land on it**
 *   ({@link relayCardDisposition}): the card stays on the owner's queue and the lead tells the chair where the owner's words went.
 *
 * ## Referents are exact, never a subject guess
 *
 * A referent is a whole minted draft id (`sd-xxxxxxxx`) or a channel the draft register knows by name
 * (`../outbound/slack/draftChannelSteer.ts`). Subject matching was weighed and dropped: the owner's
 * words and a row's prose share ordinary vocabulary, and a guess that withholds a landing the owner meant costs them
 * the card.
 * A relay naming no referent lands exactly as before, except on an `ask:` whose row would not read, which nothing
 * lands on (`docs/console/card-landing.md`).
 *
 * ## Residue, stated
 *
 * A relay that identifies no single held draft — no draft id said and no `post:` card on screen, or two ids — steers
 * nothing, so the lead names the channel and asks the chair to place it. Only an `ask:` card's text is read for a
 * match; a `hand:`, `pr:`, `review:` or `act:` card lands words naming a referent only when its KEY carries one, so a
 * channel alone over a `pr:` card is withheld and the chair places it: a withheld relay costs the owner one
 * chair line, a wrong landing costs them a card that answers a question they never asked.
 *
 * Recognition reads no negation. Words naming the row's own channel AND another steer to the other, so "keep it in
 * #proj-launch-room, not #dev-alerts" holds it off the channel the owner meant. That is fail-closed on
 * purpose: the release is refused and the lead tells the chair, where letting the own channel through would release
 * "move it from #proj-launch-room to #dev-alerts" into the launch channel, which is the incident.
 */
import { channelsNamedIn, draftChannelReading, draftChannelRoster } from "../outbound/slack/draftChannelSteer.js";
import { mintedDraftIds } from "../outbound/slack/draftLiveCut.js";
import {
  DRAFT_STEER_HEARD_MAX_CHARS,
  type SlackDraftChannel,
  type SlackDraftEvent,
  type SlackDraftItem,
} from "../outbound/slack/draftRegister.js";
import { unmetChannelSteer } from "../outbound/slack/draftSteerGate.js";

/** The exact things a relay's words name. */
export interface RelayReferents {
  /** Channels the draft register knows, named in the owner's words. */
  readonly channels: readonly SlackDraftChannel[];
  /** Whole minted draft ids in the owner's words. */
  readonly draftIds: readonly string[];
}

/**
 * The exact referents in the owner's words.
 *
 * @param words the owner's words as heard or typed
 * @param items every folded draft-register row, the channel roster's source
 * @returns the channels and draft ids named
 */
export function relayReferents({ items, words }: { items: readonly SlackDraftItem[]; words: string }): RelayReferents {
  return {
    channels: channelsNamedIn({ roster: draftChannelRoster({ items }), words }),
    draftIds: mintedDraftIds({ text: words }),
  };
}

/** What the open card's own text reads as, for a card whose text decides a match. */
export type RelayCardText =
  | { readonly kind: "read"; readonly text: string }
  | { readonly kind: "unreadable"; readonly why: string }
  | { readonly kind: "not-read" };

/** Whether a relay's words land on the card it was about. */
export type RelayCardDisposition = { readonly kind: "land" } | { readonly kind: "withheld"; readonly why: string };

/**
 * An `ask:` row that will not read is no card at all, whatever the relay names: a landing there is one the close's
 * approved-draft gate reads as unreadable on every tick, and it refused the chair's close twice with no
 * draft anywhere. The relay's own row carries the words; the chair is told which card they stayed off.
 */
function unreadableAskDisposition({
  about,
  referents,
  why,
}: {
  about: string;
  referents: RelayReferents;
  why: string;
}): RelayCardDisposition {
  const { channels, draftIds } = referents;
  if (channels.length === 0 && draftIds.length === 0) {
    return { kind: "withheld", why: `${about} would not read, so the relay lands on no card (${why})` };
  }
  const named = namedList({ channels, draftIds });
  return { kind: "withheld", why: `the owner's words name ${named}, and ${about} would not read to check (${why})` };
}

/**
 * Whether the owner's words belong on the card on screen: a relay naming no referent lands, as before; one naming referents
 * lands only where the card shares one. A `post:` card is the draft itself, so it is refused only for a draft id that
 * is not its own; any other card shares a draft id or channel by its key, or, for an `ask:`, by a draft id or a channel its text
 * names. An `ask:` whose text would not read is withheld, never guessed at, whatever the relay names.
 *
 * @param about the card key the relay names, `""` for none
 * @param referents what the owner's words name ({@link relayReferents})
 * @param cardText the card's own text, read for an `ask:` card only
 * @returns land, or withhold with the reason the chair is told
 */
export function relayCardDisposition({
  about,
  cardText,
  referents,
}: {
  about: string;
  cardText: RelayCardText;
  referents: RelayReferents;
}): RelayCardDisposition {
  const { channels, draftIds } = referents;
  if (about.startsWith("ask:") && cardText.kind === "unreadable") {
    return unreadableAskDisposition({ about, referents, why: cardText.why });
  }
  if (about === "" || (channels.length === 0 && draftIds.length === 0)) {
    return { kind: "land" };
  }
  if (about.startsWith("post:")) {
    const own = about.slice("post:".length);
    const others = draftIds.filter((id) => id !== own);
    if (draftIds.length === 0 || others.length < draftIds.length) {
      return { kind: "land" };
    }
    return { kind: "withheld", why: `the owner's words name ${others.join(", ")}, not ${own}, the draft on screen` };
  }
  if (textSharesReferent({ referents, text: about })) {
    return { kind: "land" };
  }
  const named = namedList({ channels, draftIds });
  if (!about.startsWith("ask:")) {
    return { kind: "withheld", why: `the owner's words name ${named}, and ${about} carries none of them` };
  }
  if (cardText.kind === "read" && textSharesReferent({ referents, text: cardText.text })) {
    return { kind: "land" };
  }
  return { kind: "withheld", why: `the owner's words name ${named}, and ${about} mentions none of them` };
}

/** One draft id the relay steers, the event that records it, and how the chair hears it. */
export interface RelaySteer {
  readonly draftId: string;
  readonly event: Extract<SlackDraftEvent, { kind: "steered" }>;
}

/** What a relay's words mean for the held draft on screen, and the line the row and the chair open on. */
export interface RelaySteerPlan {
  /** The steer to append, when the card on screen is a held draft and the owner's words name another channel for it. */
  readonly steer: RelaySteer | undefined;
  /** The line the row's summary and the chair's chat line open on, or `undefined` when there is nothing to say. */
  readonly lead: string | undefined;
}

/**
 * Read a relay against the one held draft it identifies: a draft id the owner says, else the `post:<id>` card on screen. A
 * held row whose channel is not among those the owner's words name becomes a steer to them; a relay naming a channel that
 * identifies no single held draft is said to the chair for placing. A withheld card landing is said too.
 *
 * @param about the card key the relay names, `""` for none
 * @param anchor the relay's own anchor, `talk:<turnId>`
 * @param heard the owner's words; the steer keeps the sentences naming the channel, cut to the register's bound
 * @param items every folded draft-register row
 * @param nowIso when the steer is recorded
 * @param disposition whether the owner's words land on the card on screen ({@link relayCardDisposition})
 * @returns the steer to append, if any, and the lead line
 */
export function relaySteerPlan({
  about,
  anchor,
  disposition,
  heard,
  items,
  nowIso,
}: {
  about: string;
  anchor: string;
  disposition: RelayCardDisposition;
  heard: string;
  items: readonly SlackDraftItem[];
  nowIso: string;
}): RelaySteerPlan {
  const withheld = disposition.kind === "withheld" ? `not landed on ${about}: ${disposition.why}` : undefined;
  const named = channelsNamedIn({ roster: draftChannelRoster({ items }), words: heard });
  const target = steerTarget({ about, heard, items });
  let steer: RelaySteer | undefined;
  if (target.kind === "held") {
    steer = steerOf({ anchor, heard, items, named, nowIso, row: target.row });
  }
  // The withheld card leads, so the chair line's cut of a long lead keeps which card the owner's words stayed off.
  const parts: string[] = [];
  if (withheld !== undefined) {
    parts.push(withheld);
  }
  if (steer !== undefined) {
    const where = steer.event.channels.map((channel) => `#${channel.name}`).join(" or ");
    let was = steer.event.from.id;
    if (steer.event.from.name !== undefined) {
      was = `#${steer.event.from.name}`;
    }
    const fromId = steer.event.from.id;
    if (steer.event.channels.some((channel) => channel.id === fromId)) {
      parts.push(`the owner took ${steer.draftId} back to ${where}: the earlier steer off it no longer holds`);
    } else {
      parts.push(`the owner moved ${steer.draftId} to ${where}: re-cut it there, a release into ${was} is refused`);
    }
  } else if (named.length > 0 && target.kind === "none") {
    const channels = named.map((channel) => `#${channel.name}`).join(", ");
    parts.push(`the owner named ${channels}; ${target.why}, so none was steered — place it`);
  }
  return { lead: parts.length === 0 ? undefined : `CHANNEL: ${parts.join("; ")}`, steer };
}

/**
 * The one held draft a relay identifies: the draft id the owner's words name wins over the card on screen, because a `post:`
 * card left open while the owner names another draft is not the one they moved. Two ids identify none.
 */
function steerTarget({
  about,
  heard,
  items,
}: {
  about: string;
  heard: string;
  items: readonly SlackDraftItem[];
}): { readonly kind: "held"; readonly row: SlackDraftItem } | { readonly kind: "none"; readonly why: string } {
  const ids = mintedDraftIds({ text: heard });
  if (ids.length > 1) {
    return { kind: "none", why: `${ids.join(" and ")} are more than one draft` };
  }
  let draftId = ids[0];
  if (draftId === undefined && about.startsWith("post:")) {
    draftId = about.slice("post:".length);
  }
  if (draftId === undefined) {
    return { kind: "none", why: "no held draft is on screen" };
  }
  const row = items.find((item) => item.id === draftId);
  if (row?.state !== "held") {
    return { kind: "none", why: `${draftId} is not held` };
  }
  return { kind: "held", row };
}

/**
 * The steer a held row takes from the owner's words, or none when it already goes to a channel the owner named. Naming the row's OWN
 * channel while an older steer across its lineage still holds it off that channel is a take-back, and is recorded as
 * a steer to that channel so the latest word wins.
 */
function steerOf({
  anchor,
  heard,
  items,
  named,
  nowIso,
  row,
}: {
  anchor: string;
  heard: string;
  items: readonly SlackDraftItem[];
  named: readonly SlackDraftChannel[];
  nowIso: string;
  row: SlackDraftItem;
}): RelaySteer | undefined {
  const draftId = row.id;
  let reading = draftChannelReading({ current: row.draft.channel, named });
  if (reading.kind === "unmoved") {
    const own = named.filter((channel) => channel.id === row.draft.channel);
    if (own.length === 0 || unmetChannelSteer({ item: row, items }) === undefined) {
      return undefined;
    }
    reading = { channels: own, kind: "steered" };
  }
  const from: { id: string; name?: string } = { id: row.draft.channel };
  if (row.draft.channelName !== undefined && row.draft.channelName !== "") {
    from.name = row.draft.channelName;
  }
  return {
    draftId,
    event: {
      anchor,
      channels: reading.channels,
      from,
      heard: steerExcerpt({ channels: reading.channels, heard }),
      id: draftId,
      kind: "steered",
      tsIso: nowIso,
    },
  };
}

/**
 * The sentences of the owner's words that name a steered channel, cut to the register's bound — the part a reader of the
 * refusal needs to hear, wherever in a long utterance the owner said it.
 *
 * @param heard the owner's words
 * @param channels the channels the steer names
 * @returns at most {@link DRAFT_STEER_HEARD_MAX_CHARS} characters of the owner's words
 */
export function steerExcerpt({ channels, heard }: { channels: readonly SlackDraftChannel[]; heard: string }): string {
  const sentences = heard
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
  const naming = sentences.filter((sentence) => channelsNamedIn({ roster: channels, words: sentence }).length > 0);
  let kept = heard.trim();
  if (naming.length > 0) {
    kept = naming.join(" ");
  }
  if (kept.length <= DRAFT_STEER_HEARD_MAX_CHARS) {
    return kept;
  }
  return `${kept.slice(0, DRAFT_STEER_HEARD_MAX_CHARS - 1)}…`;
}

/**
 * Whether a card's text names any draft id or channel a relay names, read by the same recognisers the owner's words are, and a
 * channel id as a whole token: a substring would let `sd-deadbeef0` stand for `sd-deadbeef`.
 */
function textSharesReferent({ referents, text }: { referents: RelayReferents; text: string }): boolean {
  const ids = new Set(mintedDraftIds({ text }));
  if (referents.draftIds.some((id) => ids.has(id))) {
    return true;
  }
  return channelsNamedIn({ roster: referents.channels, words: text }).length > 0;
}

/** The referents as one list a reader can scan. */
function namedList({ channels, draftIds }: RelayReferents): string {
  return [...draftIds, ...channels.map((channel) => `#${channel.name}`)].join(", ");
}
