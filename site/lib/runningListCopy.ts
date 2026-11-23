/**
 * What goes on the running list from the voice, and what a copy of an item carries. The owner needs a tray to
 * copy messages from the voice and paste them elsewhere, for example while hand-editing, so the voice puts out
 * something formatted to copy.
 *
 * The voice's `offer_copy` puts ONE draft of the owner's words on their running list (`./runningList.ts`) — a message,
 * a review comment, a script (scope: `src/talk/copyToolSchemas.ts`) — exactly as they would paste, say or react to it
 * (Slack mrkdwn), in a call or a typed conversation alike, never read out. Nothing here sends anything. An offer that
 * lands while a call is up is also written to the call's own file as an `offered` line (`./talkTranscript.ts`) and
 * joins the relay gate's record, so a relay the owner gives next carries the exact draft they were reacting to. The
 * text is kept byte for byte — a paste that differs from what was shown is a different message.
 *
 * ## The fold, as the owner reads a long Slack message
 *
 * The tray does not render a native Slack draft, so the owner cannot tell where a long message folds. An offer
 * therefore carries an optional `belowFold`: the head is drawn at once and the rest sits behind a "Show more" the
 * owner opens. The message copied is ONE string, {@link copyOfferText}: the head, one `\n`, then the rest — an author
 * wanting a blank line between them starts the rest with another newline. On the list that string is the item's text
 * and the fold is the line it starts on ({@link offerFoldLine}). This is the fold the voice AUTHORED, a preview of
 * where it means the message to break; Slack's own "Show more" depends on the window's width and is not reproduced
 * here.
 *
 * ## Mentions
 *
 * A message names people by tagging them, never by plain text alone. A `<@U…>` is drawn as
 * a chip with the roster's name when the console's people reading knows it ({@link copyMentionLabels}), else as its
 * id. The text copied keeps the wire's `<@U…>` either way, so a post the fleet makes from it tags the person; the
 * HTML half of a copy carries the name as plain text, and a manual paste of it into Slack is not a native mention.
 *
 * A copy carries the message twice: as HTML, which Slack's composer pastes formatted — bold, links, code — and as the
 * mrkdwn itself for anything that takes plain text. The HTML is only ever clipboard data built from the typed spans
 * `slackMrkdwn.ts` reads, every character escaped; it is never drawn into this page. Pure.
 */
import { RUNNING_LIST_LABEL_MAX, RUNNING_LIST_TEXT_MAX, type RunningListItem } from "./runningList";
import { type FencedLine, fencedLines } from "./slackEmoji";
import { type MentionLabels, type MrkdwnSpan, mrkdwnSpans, readableSpan } from "./slackMrkdwn";
import { mentionLabel, type SlackPeople } from "./slackPeople";

/**
 * The largest message one offer carries, head and fold together, in Unicode code points — the unit of the tool
 * schema's `maxLength`, and the list's own cap, so the page refuses exactly what the schema lets past: a long Slack
 * message, never a document.
 */
export const COPY_OFFER_TEXT_MAX_CODE_POINTS = RUNNING_LIST_TEXT_MAX;

/** The longest label one offer carries, in Unicode code points: the list's own cap. */
export const COPY_OFFER_LABEL_MAX_CODE_POINTS = RUNNING_LIST_LABEL_MAX;

/**
 * Half of a UTF-16 pair with no other half. JSON carries one, but the clipboard's plain half turns it into U+FFFD, so
 * what is pasted would not be what was offered: an offer holding one is refused, as the call file refuses
 * its line (`src/talk/callOffer.ts`).
 */
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * The most digits an offer's `made` carries — about 10^20 offers, past anything one window mints — so an offered line
 * has a finite worst case that fits one transcript batch, and the call file's same cap never refuses a landed offer
 * (`src/talk/callOffer.ts`).
 */
const COPY_OFFER_MADE_MAX_DIGITS = 20;

/** What an offer holding half a character is told. */
const HALF_CHARACTER = "text, below_fold and label must be whole characters: one held half of a surrogate pair";

/** One message the voice offered the owner to copy. */
export interface CopyOffer {
  /** `offer-<made>`: unique in one console window, which starts its count again. */
  readonly id: string;
  /** When it was asked, counted across the window: the id an `offered` line and a relay name it by. */
  readonly made: bigint;
  /** The head of the message, exactly as the owner pastes it: all of it when there is no fold, else what shows first. */
  readonly text: string;
  /** The rest of the message, behind "Show more"; absent when the whole message shows at once. */
  readonly belowFold?: string;
  /** What it is for ("reply to Ari"), when the voice named it. */
  readonly label?: string;
}

/**
 * An offer as it crosses JSON — into the call's file, and to anything that reads it back. `made` is a canonical
 * decimal string, since JSON has no bigint.
 */
export interface CopyOfferWire {
  readonly id: string;
  readonly made: string;
  readonly text: string;
  readonly belowFold?: string;
  readonly label?: string;
}

/**
 * Where an offer goes: `slack` for a message the owner posts in Slack under their own name, which the parked-draft shape and the
 * per-paragraph word cap bind too, `other` for a review comment,
 * a script or talking points. It decides only which check the offer meets, so it is neither on the offer, on the
 * running list nor on the call's file.
 */
export type CopyDestination = "slack" | "other";

/** An `offer_copy` call's `destination` read: where it goes, or the sentence the model hears instead. */
export type CopyDestinationResult =
  { readonly kind: "read"; readonly destination: CopyDestination } | { readonly kind: "refused"; readonly why: string };

/** What an offer naming no destination, or one the list does not know, is told. */
const NO_DESTINATION =
  "destination must be slack for a message the owner will post in Slack under their own name, or other for a review comment, a " +
  "script or talking points";

/**
 * Read `destination`, required: an offer that names none is refused rather than read as `other`, which would let a
 * Slack message past the shape check, or as `slack`, which would refuse a script the owner only says.
 *
 * @param args the tool call's arguments
 * @returns the destination, or the refusal
 */
export function copyDestinationOf({ args }: { args: Record<string, unknown> }): CopyDestinationResult {
  const destination = args["destination"];
  if (destination === "slack" || destination === "other") {
    return { destination, kind: "read" };
  }
  return { kind: "refused", why: NO_DESTINATION };
}

/** An `offer_copy` call's arguments read: the offer, or the sentence the model hears instead. */
export type CopyOfferResult =
  { readonly kind: "offered"; readonly offer: CopyOffer } | { readonly kind: "refused"; readonly why: string };

/**
 * The whole message the owner copies: the head, then — when there is a fold — one newline and the rest. One string, so the
 * clipboard, the voice-rule check, the call's file and the running list all hold the same message.
 *
 * @param offer the head and, when there is one, the fold
 * @returns the message exactly as the owner pastes it
 */
export function copyOfferText({ offer }: { offer: Pick<CopyOffer, "text" | "belowFold"> }): string {
  if (offer.belowFold === undefined) {
    return offer.text;
  }
  return `${offer.text}\n${offer.belowFold}`;
}

/**
 * An item's lines as the list draws them, cut at its fold AFTER the fences are read over the whole message: a fence
 * opened above "Show more" and closed below it is one code block, so neither half draws its shortcodes.
 *
 * @param item the message and the line its fold starts on
 * @returns the head's lines, and the fold's — `undefined` when the item has no fold
 */
export function runningListItemLines({ item }: { item: Pick<RunningListItem, "text" | "foldLine"> }): {
  readonly head: readonly FencedLine[];
  readonly fold: readonly FencedLine[] | undefined;
} {
  const lines = fencedLines({ text: item.text });
  if (item.foldLine === undefined) {
    return { fold: undefined, head: lines };
  }
  const cut = item.foldLine - 1;
  return { fold: lines.slice(cut), head: lines.slice(0, cut) };
}

/**
 * The line of {@link copyOfferText} the fold starts on, counted from 1, as the running list keeps it: the line after
 * the head's last.
 *
 * @param offer the head and, when there is one, the fold
 * @returns the line, or `undefined` for a message with no fold
 */
export function offerFoldLine({ offer }: { offer: Pick<CopyOffer, "text" | "belowFold"> }): number | undefined {
  if (offer.belowFold === undefined) {
    return undefined;
  }
  return offer.text.split("\n").length + 1;
}

/**
 * An offer as it crosses JSON: the same fields, `made` as its decimal digits.
 *
 * @param offer the offer the voice made
 * @returns the offer as the call's file keeps it
 */
export function copyOfferWire({ offer }: { offer: CopyOffer }): CopyOfferWire {
  const { belowFold, id, label, made, text } = offer;
  const wire = { id, made: made.toString(), text };
  const folded = belowFold === undefined ? wire : { ...wire, belowFold };
  return label === undefined ? folded : { ...folded, label };
}

/** `made` as JSON carries it: canonical decimal digits, no sign, no leading zero, within the page's own cap. */
const CANONICAL_MADE = new RegExp(`^(?:0|[1-9][0-9]{0,${String(COPY_OFFER_MADE_MAX_DIGITS - 1)}})$`, "u");

/** Whether a wire field is a string with something beyond whitespace in it, made of whole characters. */
function isWholeNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !LONE_SURROGATE.test(value);
}

/** An optional wire field: absent, or a nonblank string of whole characters no longer than `max` code points. */
function optionalPart({
  value,
  max,
}: {
  value: unknown;
  max: number;
}): { readonly part: string | undefined } | undefined {
  if (value === undefined) {
    return { part: undefined };
  }
  if (!isWholeNonblank(value) || Array.from(value).length > max) {
    return undefined;
  }
  return { part: value };
}

/**
 * Read an offer that crossed JSON back — the one a relay carries (`./talkRelayRequestWire.ts`) — holding it to exactly
 * what {@link offerCopyOf} lets land: an id of `offer-<made>`, canonical digits, a nonblank head, a nonblank fold or
 * none, a short label or none, every field whole characters, head and fold within the bound together. Only the five
 * fields are kept, so nothing else in the body reaches the verb.
 *
 * @param value the body's field
 * @returns the offer, or why it is not one
 */
export function copyOfferWireOf({
  value,
}: {
  value: unknown;
}): { readonly offer: CopyOfferWire } | { readonly why: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { why: "offered must be the copy-tray offer as an object" };
  }
  const held: Record<string, unknown> = { ...value };
  const { belowFold, id, label, made, text } = held;
  if (typeof made !== "string" || !CANONICAL_MADE.test(made) || typeof id !== "string" || id !== `offer-${made}`) {
    return { why: "offered must carry made as canonical digits and id as offer-<made>" };
  }
  const fold = optionalPart({ max: COPY_OFFER_TEXT_MAX_CODE_POINTS, value: belowFold });
  const named = optionalPart({ max: COPY_OFFER_LABEL_MAX_CODE_POINTS, value: label });
  if (!isWholeNonblank(text) || fold === undefined || named === undefined) {
    return { why: "offered.text, belowFold and label must be nonblank whole characters, the label a few words" };
  }
  const offer: CopyOfferWire = fold.part === undefined ? { id, made, text } : { belowFold: fold.part, id, made, text };
  if (Array.from(copyOfferText({ offer })).length > COPY_OFFER_TEXT_MAX_CODE_POINTS) {
    return { why: `offered is over the list's ${String(COPY_OFFER_TEXT_MAX_CODE_POINTS)} characters` };
  }
  return { offer: named.part === undefined ? offer : { ...offer, label: named.part } };
}

/** What an offer whose message is past the list's bound is told, in the units the schema counts. */
function overBound({ length, folded }: { length: number; folded: boolean }): string {
  const max = String(COPY_OFFER_TEXT_MAX_CODE_POINTS);
  if (folded) {
    return `text and below_fold are ${String(length)} characters together, over the list's ${max}: offer a shorter message`;
  }
  return `text is ${String(length)} characters, over the list's ${max}: offer a shorter message`;
}

/**
 * Read `below_fold`: absent, or the rest of the message — never blank, since an empty "Show more" hides nothing.
 *
 * @returns the fold, `undefined` for none, or the refusal
 */
function foldOf({ args }: { args: Record<string, unknown> }): { readonly belowFold: string | undefined } | string {
  const belowFold = args["below_fold"];
  if (belowFold === undefined) {
    return { belowFold: undefined };
  }
  if (typeof belowFold !== "string" || belowFold.trim() === "") {
    return "below_fold must be the rest of the message, behind Show more, or left out";
  }
  return { belowFold };
}

/**
 * Read `label`: absent or blank is none; anything else a few words.
 *
 * @returns the label, `undefined` for none, or the refusal
 */
function labelOf({ args }: { args: Record<string, unknown> }): { readonly label: string | undefined } | string {
  const label = args["label"];
  if (label === undefined) {
    return { label: undefined };
  }
  if (typeof label !== "string") {
    return "label must be a few words saying what the message is for, or left out";
  }
  // Code points, as the tool schema's maxLength counts them, so the page refuses exactly what the schema allows past.
  if (Array.from(label).length > COPY_OFFER_LABEL_MAX_CODE_POINTS) {
    return `label must be at most ${String(COPY_OFFER_LABEL_MAX_CODE_POINTS)} characters, a few words`;
  }
  if (label.trim() === "") {
    return { label: undefined };
  }
  return { label };
}

/**
 * Read one `offer_copy` call's arguments into an offer, or refuse it with a reason the model can act on. The text is
 * never trimmed or rewritten; whitespace only decides whether there is a message at all. The bound is on the whole
 * message the owner copies, head and fold together.
 *
 * @param args the tool call's arguments
 * @param made when it was asked, minted by the caller, which keys the offer too
 * @returns the offer, or the refusal
 */
export function offerCopyOf({ args, made }: { args: Record<string, unknown>; made: bigint }): CopyOfferResult {
  if (made < 0n || made.toString().length > COPY_OFFER_MADE_MAX_DIGITS) {
    return { kind: "refused", why: "this window has offered more messages than its call file can name: reload it" };
  }
  const id = `offer-${made}`;
  const text = args["text"];
  if (typeof text !== "string" || text.trim() === "") {
    return { kind: "refused", why: "text must be the draft of the owner's words, exactly as they will use it" };
  }
  const fold = foldOf({ args });
  if (typeof fold === "string") {
    return { kind: "refused", why: fold };
  }
  const { belowFold } = fold;
  const length = Array.from(copyOfferText({ offer: { belowFold, text } })).length;
  if (length > COPY_OFFER_TEXT_MAX_CODE_POINTS) {
    return { kind: "refused", why: overBound({ folded: belowFold !== undefined, length }) };
  }
  const named = labelOf({ args });
  if (typeof named === "string") {
    return { kind: "refused", why: named };
  }
  if ([text, belowFold, named.label].some((part) => part !== undefined && LONE_SURROGATE.test(part))) {
    return { kind: "refused", why: HALF_CHARACTER };
  }
  const offer: CopyOffer = belowFold === undefined ? { id, made, text } : { belowFold, id, made, text };
  if (named.label === undefined) {
    return { kind: "offered", offer };
  }
  return { kind: "offered", offer: { ...offer, label: named.label } };
}

/**
 * Whether an offer the voice check passed may still be written to the call it was asked on, asked after the check's
 * wait: only the very call that asked. A call is the window's count of fresh calls opened, so "some call is up" after
 * an end and a fresh start is not enough (the old call's message would land on the new call's file),
 * while a reconnect or a rollover, the same call carried on, keeps it landing. A bigint, so the count never stops
 * moving.
 *
 * @param callUp whether a call is up now
 * @param asked the fresh-call count when the offer was made
 * @param now the fresh-call count now
 * @returns true only when the asking call is the one still up
 */
export function offerStillLands({ callUp, asked, now }: { callUp: boolean; asked: bigint; now: bigint }): boolean {
  return callUp && asked === now;
}

/**
 * The names the list draws a `<@U…>` with: the roster's name for an id the console's people reading knows, and none
 * for one it does not, which then reads as its id. Never a guessed name, and never a change to the text the owner copies.
 *
 * @param people the people the console's Queue reading carries, by Slack member id
 * @returns the labels a mention chip reads
 */
export function copyMentionLabels({ people }: { people: SlackPeople }): MentionLabels {
  return {
    labelFor: ({ userId }) => {
      const label = mentionLabel({ id: userId, people, recordedKey: undefined });
      return label.text === userId ? undefined : label.text;
    },
  };
}

/** Every character HTML gives a meaning to, as its entity. */
function htmlEscaped({ text }: { text: string }): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** One span as HTML, its wire escapes read first, every character of it escaped again for HTML. */
function spanHtml({ span: wire }: { span: MrkdwnSpan }): string {
  const span = readableSpan({ span: wire });
  if (span.kind === "bold") {
    return `<b>${htmlEscaped({ text: span.text })}</b>`;
  }
  if (span.kind === "italic") {
    return `<i>${htmlEscaped({ text: span.text })}</i>`;
  }
  if (span.kind === "code") {
    return `<code>${htmlEscaped({ text: span.text })}</code>`;
  }
  if (span.kind === "link") {
    return `<a href="${htmlEscaped({ text: span.href })}">${htmlEscaped({ text: span.label })}</a>`;
  }
  if (span.kind === "mention" || span.kind === "channel") {
    return htmlEscaped({ text: span.label });
  }
  return htmlEscaped({ text: span.text });
}

/**
 * The message as the HTML a copy carries beside its mrkdwn, so a paste into Slack lands formatted: each line's spans
 * as bold, italic, code or a link, lines joined by `<br>`. A link is only ever one `slackMrkdwn.ts` accepted. A mention
 * is its label as text: the plain half of the copy is what keeps the wire's `<@U…>`.
 *
 * @param text the whole message, in Slack mrkdwn ({@link copyOfferText})
 * @param labels the names a mention is drawn with, the same the list shows
 * @returns the HTML
 */
export function copyHtmlOf({ text, labels }: { text: string; labels: MentionLabels }): string {
  return text
    .split("\n")
    .map((line) =>
      mrkdwnSpans({ labels, text: line })
        .map((span) => spanHtml({ span }))
        .join(""),
    )
    .join("<br>");
}
