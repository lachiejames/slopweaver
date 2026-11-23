/**
 * Reading the ACTION a board row publishes — the drafted Slack message an ask offers.
 *
 * Restated structurally rather than imported, exactly as `./read.ts`'s `BoardRowOption` is: `site/` never
 * imports from `src/`, so `src/handover/askAction.ts` and this file are two declarations of one wire shape.
 * The verb is the authority on whether an action is well-formed — it refuses to record one that is not —
 * so this reader's whole job is to distinguish three states, not to re-judge the rules.
 *
 * **Absent and malformed are NOT the same answer, and that is the point of a three-armed read.** A row with
 * no action is the ordinary ask: most decisions are about work rather than about a message, and a card says
 * so in one line. A row whose action will not read is a defect somewhere between the verb and this page,
 * and a card that drew "this ask offers no draft" over one would report a bug as a fact. The console runs
 * no model (`AGENTS.md` rule 2), so every sentence it prints is a field or a named absence — including this
 * one.
 */

import { type Bag, bags, str, strings, sub } from "../../lib/bag";
import { isWebUrl } from "../../lib/workspacePlacementAddress";

/** One person an action names, in a mention or as a DM recipient. */
export interface BoardRowMention {
  /** The Slack member id, `U…` or `W…` — what a real post would substitute. */
  readonly userId: string;
  /** How the card writes the name, so a reader need not resolve an id. */
  readonly label: string;
}

/** Where a drafted message could go, and what sending it there costs. */
export type BoardRowDestination =
  | {
      readonly kind: "channel";
      readonly channel: string;
      readonly label: string;
      readonly tradeoff: string;
      readonly url: string | undefined;
    }
  | {
      readonly kind: "thread";
      readonly channel: string;
      readonly threadTs: string;
      readonly label: string;
      readonly tradeoff: string;
      readonly permalink: string | undefined;
    }
  | {
      readonly kind: "dm";
      readonly conversation: string;
      readonly recipients: readonly BoardRowMention[];
      readonly label: string;
      readonly tradeoff: string;
    };

/** The concrete Slack message an ask offers, as the verb recorded it. */
export interface BoardRowAction {
  /** `me` — the draft is written to go out under the owner's identity, which the card states rather than implies. */
  readonly actor: string;
  /** The message itself, in Slack's own mrkdwn, `<@Uxxxx>` tokens and all. */
  readonly body: string;
  /** The messages posted after `body`, in order, each on its own — empty when the draft is one message. */
  readonly followUps: readonly string[];
  readonly mentions: readonly BoardRowMention[];
  readonly destinations: readonly BoardRowDestination[];
}

/**
 * The MAIL an ask offers — `src/handover/askAction.ts`'s `MailAskAction` — with the preview address and
 * digest the verb published beside it (`mailPreview`), which is what a press carries back.
 */
export interface BoardRowMail {
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string;
  readonly body: string;
  /** The Gmail message this mail answers, drafted inside its thread — undefined for a new mail. */
  readonly replyTo: string | undefined;
  /** The page that draws exactly this mail, `/queue/mail/<slug>/<digest>`. */
  readonly previewUrl: string;
  /** What `gmail draft --board <slug> --expect <digest>` checks the row still holds. */
  readonly digest: string;
}

/** What a row's `action` field turned out to be. */
export type BoardRowActionRead =
  /** The row offers no draft — the ordinary ask, and not a failure. */
  | { readonly kind: "none" }
  | { readonly kind: "action"; readonly action: BoardRowAction }
  /** The row offers a mail that becomes a Gmail draft when the owner presses. */
  | { readonly kind: "mail"; readonly mail: BoardRowMail }
  /** Something is there and it will not read. A card says THAT rather than claiming there is no draft. */
  | { readonly kind: "invalid"; readonly why: string };

/**
 * The Gmail message a row's offered mail replies to.
 *
 * @param action the row's action, as {@link rowAction} read it
 * @returns the message id, or `undefined` when the row offers no mail or a new one
 */
export function mailReplyOf({ action }: { action: BoardRowActionRead }): string | undefined {
  if (action.kind !== "mail") {
    return undefined;
  }
  return action.mail.replyTo;
}

/**
 * The action one row carries.
 *
 * @param row the row's raw bag
 * @returns which of the three states the `action` field is in
 */
export function rowAction({ row }: { row: Bag }): BoardRowActionRead {
  if (row["action"] === undefined || row["action"] === null) {
    // The verb publishes no `action` for a draft IT could not read either, so the absence alone is
    // ambiguous and `actionUnreadable` is what disambiguates it. Without this the page would draw "this ask
    // offers no draft" over a row whose draft is a defect, which is the claim this file exists to refuse.
    if (row["actionUnreadable"] === true) {
      return { kind: "invalid", why: "the recorded draft would not read when the board was published" };
    }
    return { kind: "none" };
  }
  const bag = sub({ bag: row, key: "action" });
  if (bag === undefined) {
    return { kind: "invalid", why: "the action is not an object" };
  }
  if (str({ bag, key: "kind" }) === "mail") {
    return mailOf({ bag, row });
  }
  const actor = str({ bag, key: "actor" });
  const body = str({ bag, key: "body" });
  // A blank body is no message: drawn, it would be an empty quote on a card asking the owner to read it.
  if (actor === undefined || body === undefined || body.trim() === "") {
    return { kind: "invalid", why: "the action names no actor or carries no message body" };
  }
  const followUps = followUpsOf({ bag });
  if (followUps === undefined) {
    return { kind: "invalid", why: "one of the action's follow-up messages is blank or not text" };
  }
  const destinations = destinationsOf({ bag });
  if (destinations === undefined) {
    return { kind: "invalid", why: "one of the action's destinations does not name where it would send" };
  }
  if (destinations.length === 0) {
    return { kind: "invalid", why: "the action offers nowhere to send the message" };
  }
  return {
    action: { actor, body, destinations, followUps, mentions: mentionsOf({ bag, key: "mentions" }) },
    kind: "action",
  };
}

/**
 * The follow-up messages, empty when the action records none, or `undefined` when the field is there and any
 * entry is not a non-blank string.
 *
 * All-or-nothing for {@link destinationsOf}'s reason: the card and the command are drawn off this list, so a
 * surviving subset would preview, and send, two messages of a draft the row says is three.
 */
function followUpsOf({ bag }: { bag: Bag }): readonly string[] | undefined {
  if (bag["followUps"] === undefined) {
    return [];
  }
  const messages = strings({ bag, key: "followUps" });
  if (messages === undefined || messages.some((one) => one.trim() === "")) {
    return undefined;
  }
  return messages;
}

/**
 * A mail action, read whole or named as broken — never partly drawn, because a To line missing a
 * recipient reads exactly as complete as one that has them all.
 */
function mailOf({ bag, row }: { bag: Bag; row: Bag }): BoardRowActionRead {
  const form = sub({ bag, key: "form" });
  const from = str({ bag, key: "from" });
  if (form === undefined || from === undefined) {
    return { kind: "invalid", why: "the mail names no sender or carries no form" };
  }
  const to = strings({ bag: form, key: "to" });
  const cc = strings({ bag: form, key: "cc" });
  const bcc = strings({ bag: form, key: "bcc" });
  const subject = str({ bag: form, key: "subject" });
  const body = str({ bag: form, key: "body" });
  if (to === undefined || cc === undefined || bcc === undefined || subject === undefined) {
    return { kind: "invalid", why: "the mail's form is missing a recipient list, its subject or its body" };
  }
  if (body === undefined || body.trim() === "") {
    return { kind: "invalid", why: "the mail's form is missing a recipient list, its subject or its body" };
  }
  const preview = sub({ bag: row, key: "mailPreview" });
  const previewUrl = preview === undefined ? undefined : str({ bag: preview, key: "url" });
  const digest = preview === undefined ? undefined : str({ bag: preview, key: "digest" });
  if (previewUrl === undefined || digest === undefined) {
    return { kind: "invalid", why: "the board published no preview address or digest beside the mail" };
  }
  // A reply target present and unreadable is a broken draft, never a new mail: drawn as one, the card would say
  // "a new mail" over a press that drafts a reply, or the reverse.
  let replyTo: string | undefined;
  if (bag["replyTo"] !== undefined) {
    const target = sub({ bag, key: "replyTo" });
    replyTo = target === undefined ? undefined : str({ bag: target, key: "messageId" });
    if (replyTo === undefined) {
      return { kind: "invalid", why: "the mail names a message it replies to, but not by a readable id" };
    }
  }
  return { kind: "mail", mail: { bcc, body, cc, digest, from, previewUrl, replyTo, subject, to } };
}

/**
 * Every destination, or `undefined` when ANY of them does not read whole.
 *
 * All-or-nothing rather than a surviving subset, because the options a card shows ARE these destinations:
 * dropping one silently would offer the owner two places to send a message the row says goes to three, with
 * nothing on the card saying so, and "post it to #delivery" reads exactly as complete whether or not the DM
 * beside it decoded. A counterexample is a `thread` destination
 * with no `threadTs`. An invalid action still renders — `./readAction.ts`'s caller draws the `why`.
 */
function destinationsOf({ bag }: { bag: Bag }): readonly BoardRowDestination[] | undefined {
  const raw = bags({ bag, key: "destinations" });
  if (raw === undefined) {
    return [];
  }
  const out: BoardRowDestination[] = [];
  for (const one of raw) {
    const destination = destinationOf({ bag: one });
    if (destination === undefined) {
      return undefined;
    }
    out.push(destination);
  }
  return out;
}

/** One destination, or `undefined` when its own kind's required fields are not all there. */
function destinationOf({ bag }: { bag: Bag }): BoardRowDestination | undefined {
  const kind = str({ bag, key: "kind" });
  const label = str({ bag, key: "label" });
  const tradeoff = str({ bag, key: "tradeoff" });
  if (label === undefined || tradeoff === undefined) {
    return undefined;
  }
  if (kind === "channel") {
    const channel = str({ bag, key: "channel" });
    if (channel === undefined || linkUnread({ bag, key: "url" })) {
      return undefined;
    }
    return { channel, kind: "channel", label, tradeoff, url: str({ bag, key: "url" }) };
  }
  if (kind === "thread") {
    const channel = str({ bag, key: "channel" });
    const threadTs = str({ bag, key: "threadTs" });
    if (channel === undefined || threadTs === undefined || linkUnread({ bag, key: "permalink" })) {
      return undefined;
    }
    return { channel, kind: "thread", label, permalink: str({ bag, key: "permalink" }), threadTs, tradeoff };
  }
  if (kind === "dm") {
    const conversation = str({ bag, key: "conversation" });
    if (conversation === undefined) {
      return undefined;
    }
    return { conversation, kind: "dm", label, recipients: mentionsOf({ bag, key: "recipients" }), tradeoff };
  }
  return undefined;
}

/**
 * Whether an optional link is PRESENT but will not read as an absolute web address.
 *
 * A destination's link is one of the addresses a row is placed by (`site/lib/registerPlacement.ts`), so one
 * that is there and unreadable is not the same as one that is absent: dropping it would place the row by
 * whatever else it carries while hiding the address that might contradict it.
 */
function linkUnread({ bag, key }: { bag: Bag; key: string }): boolean {
  const value = bag[key];
  if (value == null) {
    return false;
  }
  return typeof value !== "string" || !isWebUrl({ value });
}

/** The people under one key, dropping any member missing an id or a label. */
function mentionsOf({ bag, key }: { bag: Bag; key: string }): readonly BoardRowMention[] {
  const raw = bags({ bag, key });
  if (raw === undefined) {
    return [];
  }
  const out: BoardRowMention[] = [];
  for (const one of raw) {
    const userId = str({ bag: one, key: "userId" });
    const label = str({ bag: one, key: "label" });
    if (userId === undefined || label === undefined) {
      continue;
    }
    out.push({ label, userId });
  }
  return out;
}
