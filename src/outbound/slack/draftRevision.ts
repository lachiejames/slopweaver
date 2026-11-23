/**
 * A parked as-me draft's words REVISED in place, live on a call, with every earlier version kept.
 *
 * The owner opens a Queue card, says what they do not like, and the console voice rewrites the draft on that card in
 * front of them; v2 shows with v1 kept, and "put it back" restores v1.
 *
 * A revision is one `revised` event carrying the new version's whole {@link DraftWords}: prepared and admitted as a
 * recording's words are (`slack draft revise`), digested over the row's own destination, identity, thread, files and
 * prior-ask proof, so a release re-prepares it exactly as it would the parked words. Body only — nothing a revision
 * carries can move where it goes or who it goes out as, because none of those fields are in the event.
 *
 * Three rows take no revision, and the fold ignores a hand-written line on any of them:
 *
 * - a row that is not held, or one going out as the bot (a card wrapper, not the owner's words);
 * - a row carrying the owner's yes: the words an approval bound are never changed under it — a hold on the approval
 *   itself sets it down first, and the revised words wait for a fresh yes;
 * - a row whose Codex pick is still owed: two drafts are on the card, and a revision would have to pick one.
 *
 * Pure: the register fold (`./draftFold.ts`) calls {@link revisedRow}; the verb calls {@link revisionRefusal}.
 */
import { isDeepStrictEqual } from "node:util";

import { type DraftWords, pickOwed } from "./draftComparison.js";
import { receiptsValid } from "./draftReceipts.js";
import { parkedDraftDigest, type SlackDraftEvent, type SlackDraftItem } from "./draftRegister.js";

/** How many lines the voice's reading of the owner's words may carry — a checklist read at a glance. */
export const REVISION_READING_MAX_ITEMS = 5;

/** How long one reading line may be. */
export const REVISION_READING_MAX_CHARS = 120;

/** How much of the owner's words a revision keeps: enough to see what was asked; the call's transcript keeps the rest. */
export const REVISION_HEARD_MAX_CHARS = 600;

/** One version of a row's words: what the card shows in its history, and what a restore puts back. */
export interface SlackDraftVersion {
  /** 1 is the words the row was parked (or picked) with; each revision is the next number. */
  readonly number: number;
  readonly atIso: string;
  readonly words: DraftWords;
  /** The owner's words asking for it, as the page transcribed them. Absent on v1. */
  readonly heard?: string | undefined;
  /** The voice's reading of what the owner asked, one checklist line each. Absent on v1. */
  readonly reading?: readonly string[] | undefined;
  /** Where the owner said it — a `talk:<turn>` anchor — when the page knew. */
  readonly anchor?: string | undefined;
  /** The earlier version this one put back, on a restore. */
  readonly restoredFrom?: number | undefined;
}

/** The `revised` event. */
export type DraftRevisedEvent = Extract<SlackDraftEvent, { kind: "revised" }>;

/**
 * Why a row cannot take a revision now, or `undefined` when it can.
 *
 * @param item the row as folded
 * @returns the refusal, naming the way forward
 */
export function revisionRefusal({ item }: { item: SlackDraftItem }): string | undefined {
  if (item.state !== "held") {
    return `${item.id} is ${item.state}; only a held draft's words are revised`;
  }
  if (item.draft.actor === "bot") {
    return `${item.id} goes out as the bot, whose words are a card, not a message; only an as-me draft is revised`;
  }
  if (item.draft.approval !== undefined) {
    return (
      `${item.id} carries the owner's yes, and the words an approval bound are never changed under it. If the owner ` +
      `wants them changed, set the yes down first: slopweaver slack draft hold ${item.id} --reason not-owner-yes ` +
      `--why "<what the owner said>"`
    );
  }
  if (pickOwed({ item })) {
    return (
      `${item.id} has two drafts on its card and neither is chosen, so there is no one draft to revise — pick first: ` +
      `slopweaver slack draft pick ${item.id} --variant <original|codex>`
    );
  }
  return undefined;
}

/**
 * Every version a row has, the first synthesised from its words when it has never been revised.
 *
 * @param item the row as folded
 * @returns the versions, oldest first; one on a row never revised
 */
export function draftVersions({ item }: { item: SlackDraftItem }): readonly SlackDraftVersion[] {
  if (item.versions !== undefined) {
    return item.versions;
  }
  return [{ atIso: wordsWrittenIso({ item }), number: 1, words: wordsOf({ item }) }];
}

/**
 * A row after a revision. Ignored, leaving the row as it was, when the row cannot take one ({@link revisionRefusal}),
 * when it is not the next version, when a restore names a version the row does not have or words that are not that
 * version's, or when the words do not bind under the row's own destination — only a hand-written or torn line meets
 * any of these, and the card keeps the words a release would really send.
 *
 * @param standing the row as folded before the event
 * @param event the revision
 * @returns the row carrying the new version as its words, or `standing` unchanged
 */
export function revisedRow({
  standing,
  event,
}: {
  standing: SlackDraftItem;
  event: DraftRevisedEvent;
}): SlackDraftItem {
  if (revisionRefusal({ item: standing }) !== undefined) {
    return standing;
  }
  const versions = draftVersions({ item: standing });
  if (event.version !== versions.length + 1 || !restoreHolds({ event, versions }) || !wordsBind({ event, standing })) {
    return standing;
  }
  const version: SlackDraftVersion = {
    atIso: event.tsIso,
    number: event.version,
    words: event.words,
    ...(event.heard === undefined ? {} : { heard: event.heard }),
    ...(event.reading === undefined ? {} : { reading: event.reading }),
    ...(event.anchor === undefined ? {} : { anchor: event.anchor }),
    ...(event.restoredFrom === undefined ? {} : { restoredFrom: event.restoredFrom }),
  };
  const { receipts: _replaced, ...unworded } = standing.draft;
  return { ...standing, draft: { ...unworded, ...event.words }, versions: [...versions, version] };
}

/**
 * A row as it was released: the words the release's digest names. A voice edit journalled while the send was in flight
 * appends after the release read the row, so the row would otherwise show words Slack never received.
 * Unchanged when the release names no digest, the row already shows it, or no version carries it.
 *
 * @param item the row as folded up to its `released` event
 * @param digest the digest the release journalled
 * @returns the row showing what went out
 */
export function sentRow({ item, digest }: { item: SlackDraftItem; digest: string | undefined }): SlackDraftItem {
  if (digest === undefined || item.draft.digest === digest) {
    return item;
  }
  const sent = item.versions?.findLast((version) => version.words.digest === digest);
  if (sent === undefined) {
    return item;
  }
  const { receipts: _replaced, ...unworded } = item.draft;
  return { ...item, draft: { ...unworded, ...sent.words } };
}

/** Whether a restore names a version the row has, with exactly that version's words. */
function restoreHolds({
  event,
  versions,
}: {
  event: DraftRevisedEvent;
  versions: readonly SlackDraftVersion[];
}): boolean {
  if (event.restoredFrom === undefined) {
    return true;
  }
  const restored = versions.find((version) => version.number === event.restoredFrom);
  // Every field, the form included: a digest binds the payload alone, so a hand-written restore could otherwise carry
  // another form that a release re-prepares to other words.
  return restored !== undefined && isDeepStrictEqual(restored.words, event.words);
}

/**
 * Whether the words bind under the row's own destination, identity, thread, files and prior-ask proof, and their
 * receipts are what their own message and the row's files carry.
 */
function wordsBind({ event, standing }: { event: DraftRevisedEvent; standing: SlackDraftItem }): boolean {
  const { authorId, channel, groupDm, media, priorAsk, threadTs } = standing.draft;
  const { digest, mentions, payload, receipts } = event.words;
  const files = media === undefined ? 0 : media.length;
  const draft = { authorId, channel, groupDm, media, mentions, payload, priorAsk, threadTs };
  const bound = parkedDraftDigest({ draft });
  return bound === digest && receiptsValid({ media: files, payload, receipts });
}

/** The row fields that date its words. */
export interface WordsDating {
  readonly draft: Pick<SlackDraftItem["draft"], "tsIso">;
  readonly pick?: Pick<NonNullable<SlackDraftItem["pick"]>, "atIso"> | undefined;
  readonly versions?: readonly Pick<SlackDraftVersion, "atIso">[] | undefined;
}

/**
 * When the row's CURRENT words were written: its newest version's instant once a voice edit revised it, else the owner's pick
 * when one chose its first words, else the park — so it also dates the v1 {@link draftVersions} synthesises. A held
 * post's Queue card is floored here (`src/handover/currencyCards.ts`), so the words the owner said that reworked it are folded
 * in rather than counted as said since.
 *
 * @param item the row as folded
 * @returns the instant the words a release would send were written
 */
export function wordsWrittenIso({ item }: { item: WordsDating }): string {
  const newest = item.versions?.at(-1);
  if (newest !== undefined) {
    return newest.atIso;
  }
  if (item.pick !== undefined) {
    return item.pick.atIso;
  }
  return item.draft.tsIso;
}

/** The row's words as one unit. */
function wordsOf({ item }: { item: SlackDraftItem }): DraftWords {
  const { advisory, digest, form, mentions, payload, receipts } = item.draft;
  return { advisory, digest, form, mentions, payload, ...(receipts === undefined ? {} : { receipts }) };
}
