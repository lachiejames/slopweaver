/**
 * The concrete Slack ACTION an ask offers — the exact drafted message, who it tags, and the one to three
 * places it could go — and the rules that refuse one a card could not honestly draw.
 *
 * ## Why an ask carries an action at all
 *
 * A card that says "there is a draft" without showing it gives the owner nothing to react to. What helps on the
 * queue is a drafted message written out and a native Slack preview of how it would read posted into a channel
 * or a thread, with holding it as the other option: post it there, tag these people, or hold.
 *
 * So the decision on the card stops being "what should I do about this" and becomes "send THIS, to THERE,
 * or hold" — which is a decision the owner can take in one breath, and {@link ./askShape.ts}'s ruling one step
 * further on.
 *
 * ## The console composes NOTHING (`AGENTS.md` rule 2)
 *
 * Every byte of the draft is authored by a visible session and recorded by a verb. The card renders what
 * the register holds and says the absence out loud where it holds nothing. That is why this file sits in
 * `src/` rather than in the console: the recording side owns the shape, and the console reads it.
 *
 * ## The body is bounded HERE, not folded there
 *
 * A fold on the console would hide half of a message that is about to be POSTED at full length, so the cap
 * has to bite where the draft is recorded. {@link ACTION_BODY_MAX_WORDS} is `../briefing/caps.ts`'s own
 * `WHAT_MAX_WORDS` given 80 percent more room, reached by import rather than restated: a draft posted as the owner
 * has to carry the context a reader in the room needs, which the card's own `what` does not.
 *
 * **A message that goes out in parts is several messages, never one body.** `followUps` carries each part after
 * the first, capped on its own and sent on its own ({@link ACTION_MAX_FOLLOW_UPS}); a blank line inside one body
 * would preview, and post, as one message.
 *
 * One destination's own rules are `./askActionDestination.ts`: this file is about the MESSAGE.
 *
 * Pure: no filesystem, no clock, no environment. The caller supplies the text.
 */

import { WHAT_MAX_WORDS } from "../briefing/caps.js";
import { wordCount } from "../briefing/text.js";
import { validateComposeForm } from "../live/gmail/compose.js";

import { destinationKey, destinationProblems, peopleProblems } from "./askActionDestination.js";

/**
 * The longest a drafted message may run, in words — `WHAT_MAX_WORDS` in `../briefing/caps.ts`, 80 percent longer.
 *
 * A draft cut to 57 words lost critical context, so the cap carries 80 percent more room.
 */
export const ACTION_BODY_MAX_WORDS = Math.round(WHAT_MAX_WORDS * 1.8);

/**
 * The longest a drafted message may run, in characters.
 *
 * A second axis over the same text, because the word cap alone does not bound a paste: a Datadog trace id
 * or a run URL is one "word" and two hundred characters, and six of those is the wall of text rule 7
 * exists to stop. Chosen rather than measured — 800 was roughly six full lines of the console's message
 * column, and it grew by the same 80 percent as {@link ACTION_BODY_MAX_WORDS}, so a draft at the word cap is
 * not refused by this one for ordinary prose.
 */
export const ACTION_BODY_MAX_CHARS = 1440;

/** The most lines a drafted message may carry, so the preview stays one message rather than a document. */
export const ACTION_BODY_MAX_LINES = 6;

/**
 * The most destinations one action may offer.
 *
 * Three, because the card also draws HOLD and `../briefing/caps.ts`'s `MAX_OPTIONS` is four: past that the
 * card stops being readable, which is what {@link ./askShape.ts}'s `MIN_OPTIONS` records from the other end.
 */
export const ACTION_MAX_DESTINATIONS = 3;

/**
 * The most messages one action may send AFTER its first, each posted on its own.
 *
 * Two drafts to one person can be a first message plus a second that adds to it. One body could only carry them
 * merged, so the card would preview — and the command would post — one message where the owner wants two. Two
 * follow-ups, so three messages at most: past that it is a thread of its own, not a reply.
 */
export const ACTION_MAX_FOLLOW_UPS = 2;

/** The most people one drafted message may tag, so the preview's mention row stays one line. */
export const ACTION_MAX_MENTIONS = 8;

/** The version a mail action carries — the discriminant that tells it from the Slack one. */
export const MAIL_ACTION_VERSION = 2;

/**
 * The longest a drafted MAIL body may run, in characters.
 *
 * A mail is not a Slack message and the Slack caps do not fit it: the email this was built for lists ten
 * compliance concerns, one short paragraph each, which no six-line cap could hold. What keeps it off the
 * card as a wall of text is the SHAPE rather than the cap — the card draws the headers and a few lines, and
 * the whole body lives on its own preview page. Chosen rather than measured: roughly four printed pages.
 */
export const MAIL_BODY_MAX_CHARS = 12_000;

/** The most recipients one drafted mail may carry across To, Cc and Bcc. */
const MAIL_MAX_RECIPIENTS = 12;

/** A Gmail API message id, as every id the door has printed: sixteen lowercase hex digits. */
const GMAIL_MESSAGE_ID = /^[0-9a-f]{16}$/u;

/**
 * The concrete MAIL action an ask offers — one message, previewed as the mail client would draw it, that
 * becomes a Gmail DRAFT in the owner's own mailbox only when the owner presses. Nothing is ever sent from here:
 * sending is `gmail send`'s own approved second act. The console shows a mail-native draft preview, and the Gmail
 * draft is created only on that press.
 */
export interface MailAskAction {
  /** `2` — {@link MAIL_ACTION_VERSION}, and the field a mail action is told apart from a Slack one by. */
  readonly version: typeof MAIL_ACTION_VERSION;
  readonly kind: "mail";
  /** Who would send it: the owner, from their own mailbox, exactly as the Slack action's `me`. */
  readonly actor: "me";
  /** The address the preview draws in From — checked against the bound Gmail account before a draft exists. */
  readonly from: string;
  /** The message exactly as `gmail draft --form` takes it. */
  readonly form: {
    readonly to: readonly string[];
    readonly cc: readonly string[];
    readonly bcc: readonly string[];
    readonly subject: string;
    readonly body: string;
  };
  /**
   * The message this mail ANSWERS, when it is a reply — the Gmail message id `gmail draft --reply-to` takes, so the
   * press drafts it inside that thread rather than as a new mail beside it. Absent on a new mail.
   *
   * A press on a card answering a vendor's meeting ask that drafted a new mail to everyone on the thread
   * scatters the conversation, so a reply stays in its own thread.
   */
  readonly replyTo?: { readonly messageId: string };
}

/** The concrete action an ask offers: a Slack message, or a mail that becomes a Gmail draft. */
export type AskAction = SlackAskAction | MailAskAction;

/**
 * Every way a mail action would make its card lie, empty when it is well-formed.
 *
 * The form rules are `gmail draft`'s own ({@link ../live/gmail/compose.validateComposeForm}), reached
 * rather than restated, so a preview the register accepts is one the draft verb will also accept.
 *
 * @param action the mail action a verb is about to record
 * @returns one sentence per rule it broke
 */
function mailActionProblems({ action }: { action: MailAskAction }): readonly string[] {
  const problems: string[] = [];
  const checked = validateComposeForm({ form: action.form });
  if (checked.isErr()) {
    problems.push(...checked.error);
  }
  if (!/^[^\s@<>]+@[^\s@<>]+$/u.test(action.from)) {
    problems.push(`from: ${action.from} is not a bare address — the preview draws exactly one sender`);
  }
  if (action.form.subject.trim().length === 0) {
    problems.push("subject: a draft the owner is asked to create names what it is about");
  }
  if (action.form.body.length > MAIL_BODY_MAX_CHARS) {
    problems.push(
      `body: runs ${String(action.form.body.length)} characters against a cap of ${String(MAIL_BODY_MAX_CHARS)}`,
    );
  }
  const recipients = action.form.to.length + action.form.cc.length + action.form.bcc.length;
  if (recipients > MAIL_MAX_RECIPIENTS) {
    problems.push(`the mail has ${String(recipients)} recipients against a cap of ${String(MAIL_MAX_RECIPIENTS)}`);
  }
  if (action.replyTo !== undefined && !GMAIL_MESSAGE_ID.test(action.replyTo.messageId)) {
    problems.push(`replyTo: ${action.replyTo.messageId} is not a Gmail message id (sixteen lowercase hex characters)`);
  }
  return problems;
}

/** One person the drafted message tags, by the id the body spells and the name a reader recognises. */
export interface AskMention {
  readonly userId: string;
  readonly label: string;
}

/** One place the drafted message could go. */
export type AskDestination =
  | {
      readonly kind: "channel";
      readonly channel: string;
      /** What the card calls it — `#delivery`, as the owner would read it. */
      readonly label: string;
      /** One line naming what posting there costs, exactly as an option's trade-off does. */
      readonly tradeoff: string;
      readonly url?: string;
    }
  | {
      readonly kind: "thread";
      readonly channel: string;
      /** The root message's `ts`, so `slack reply` binds to the thread rather than opening a new one. */
      readonly threadTs: string;
      readonly label: string;
      readonly tradeoff: string;
      readonly permalink?: string;
    }
  | {
      readonly kind: "dm";
      /** An ALREADY-OPEN conversation — `slack dm open` is what creates one, and a preview never does. */
      readonly conversation: string;
      /** Who is in it. One renders as a direct message, several as a group DM. */
      readonly recipients: readonly AskMention[];
      readonly label: string;
      readonly tradeoff: string;
    };

/** The concrete Slack action an ask offers, as the register holds it. */
export interface SlackAskAction {
  /** `1` — the only version this build writes, and the field a newer one is told apart by. */
  readonly version: 1;
  /**
   * Who would send it. Fixed at `me` in this version: the console's existing composer posts as the owner, and
   * drawing bot chrome over a command that posts under the owner's own name would be a lie about the message.
   */
  readonly actor: "me";
  /** The message exactly as it would be posted — Slack mrkdwn, the bytes the send verb receives. */
  readonly body: string;
  /**
   * Further messages posted after `body`, in order, each on its own, to the same destination — OMITTED when
   * there are none, so every line recorded before this field existed stays byte-identical and valid.
   */
  readonly followUps?: readonly string[];
  /** Every person any MESSAGE tags. Membership of a DM is not a mention, which is why these are two fields. */
  readonly mentions: readonly AskMention[];
  readonly destinations: readonly AskDestination[];
}

/**
 * Every message the action sends, in the order they are posted — `body` first, then each follow-up.
 *
 * @param action the Slack action
 * @returns one entry per message, never empty
 */
export function actionMessages({ action }: { action: SlackAskAction }): readonly string[] {
  if (action.followUps === undefined) {
    return [action.body];
  }
  return [action.body, ...action.followUps];
}

/**
 * Every `<@U…>` the body tags OUTSIDE a code span, in order, each once.
 *
 * @param body the drafted message
 * @returns the member ids the message would really notify
 */
export function activeMentionIds({ body }: { body: string }): readonly string[] {
  const out: string[] = [];
  // A mention inside backticks is literal text in Slack and notifies nobody, so it is not a mention here
  // either — stripping the spans first is what keeps the two readings the same.
  const uncoded = body.replace(/```[\s\S]*?```/gu, " ").replace(/`[^`\n]*`/gu, " ");
  for (const match of uncoded.matchAll(/<@([UW][A-Z0-9]{2,})>/gu)) {
    const [, id = ""] = match;
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/** Every way the drafted message itself breaks a cap, empty when it is well-formed. */
function bodyProblems({ body }: { body: string }): readonly string[] {
  if (body.trim().length === 0) {
    return ["the drafted message is empty — an action the owner cannot read is not an action"];
  }
  const problems: string[] = [];
  const words = wordCount({ text: body });
  if (words > ACTION_BODY_MAX_WORDS) {
    problems.push(
      `the drafted message runs ${String(words)} words against a cap of ${String(ACTION_BODY_MAX_WORDS)} — ` +
        "the card shows what would really be posted, so shortening it here shortens the post",
    );
  }
  if (body.length > ACTION_BODY_MAX_CHARS) {
    problems.push(
      `the drafted message runs ${String(body.length)} characters against a cap of ` +
        `${String(ACTION_BODY_MAX_CHARS)}`,
    );
  }
  const lines = body.split("\n").length;
  if (lines > ACTION_BODY_MAX_LINES) {
    problems.push(`the drafted message runs ${String(lines)} lines against a cap of ${String(ACTION_BODY_MAX_LINES)}`);
  }
  return problems;
}

/**
 * Every way the follow-up messages break a rule of their own, each named by its position, empty when they are
 * well-formed or there are none.
 */
function followUpProblems({ action }: { action: SlackAskAction }): readonly string[] {
  if (action.followUps === undefined) {
    return [];
  }
  const problems: string[] = [];
  if (action.followUps.length === 0) {
    problems.push("the action records an empty follow-up list — omit the field when there is one message");
  }
  if (action.followUps.length > ACTION_MAX_FOLLOW_UPS) {
    problems.push(
      `the action sends ${String(action.followUps.length)} follow-ups against a cap of ` +
        `${String(ACTION_MAX_FOLLOW_UPS)} — past that it is a thread of its own, not a reply`,
    );
  }
  action.followUps.forEach((followUp, index) => {
    problems.push(...bodyProblems({ body: followUp }).map((one) => `follow-up ${String(index + 1)}: ${one}`));
  });
  // Several top-level posts in a channel is one wall in several halves — the voice rule is one top-level message
  // in public. A thread or a DM is where the owner drips across short replies, so those carry follow-ups.
  for (const destination of action.destinations.filter((one) => one.kind === "channel")) {
    problems.push(
      `${destination.label} is a new top-level message, and follow-ups there would be several top-level posts — ` +
        "offer a thread or a DM for a message that goes out in parts",
    );
  }
  return problems;
}

/** Every way the messages' tags and the action's own mention list disagree, empty when they match exactly. */
function mentionAgreementProblems({ action }: { action: SlackAskAction }): readonly string[] {
  const problems: string[] = [];
  const tagged = [...new Set(actionMessages({ action }).flatMap((message) => activeMentionIds({ body: message })))];
  const declared = action.mentions.map((one) => one.userId);
  for (const id of tagged.filter((one) => !declared.includes(one))) {
    problems.push(`the drafted message tags ${id} and the action does not name them — the card would understate it`);
  }
  for (const id of declared.filter((one) => !tagged.includes(one))) {
    problems.push(`the action names ${id} and the drafted message does not tag them — the card would overstate it`);
  }
  return problems;
}

/** Every way the list of destinations is not a set of distinct real places, empty when it is. */
function destinationsProblems({ action }: { action: SlackAskAction }): readonly string[] {
  const problems: string[] = [];
  if (action.destinations.length === 0) {
    problems.push("the action offers nowhere to send it — a draft with no destination is not a decision");
  }
  if (action.destinations.length > ACTION_MAX_DESTINATIONS) {
    problems.push(
      `the action offers ${String(action.destinations.length)} destinations against a cap of ` +
        `${String(ACTION_MAX_DESTINATIONS)}, because the card draws HOLD beside them`,
    );
  }
  const seen = new Set<string>();
  for (const destination of action.destinations) {
    const key = destinationKey({ destination });
    if (seen.has(key)) {
      problems.push(`${destination.label} is offered twice — two options that do the same thing are one option`);
    }
    seen.add(key);
    problems.push(...destinationProblems({ destination }));
  }
  return problems;
}

/**
 * Every way an action would make the card lie, in the order a refusal should print them.
 *
 * A plain list rather than a typed union, for {@link ./askShape.ts}'s own stated reason: the behaviour
 * here IS the multiplicity of what is wrong, and one discriminated error loses it
 * (`.claude/rules/error-handling.md` § "When NOT to introduce a union").
 *
 * The mention rule is the one worth naming. Every message's `<@U…>` tokens and `mentions` must agree EXACTLY,
 * because the card draws its mention row off the second while Slack notifies off the first — and a card
 * saying it tags two people over a message that tags three breaks the promise of a draft written out to look
 * at, in the one way the owner would not catch.
 *
 * @param action the action a verb is about to record
 * @returns one sentence per rule it broke, empty when it is well-formed
 */
export function askActionProblems({ action }: { action: AskAction }): readonly string[] {
  if (action.version === MAIL_ACTION_VERSION) {
    return mailActionProblems({ action });
  }
  const problems: string[] = [...bodyProblems({ body: action.body }), ...followUpProblems({ action })];
  if (action.mentions.length > ACTION_MAX_MENTIONS) {
    problems.push(
      `the drafted message tags ${String(action.mentions.length)} people against a cap of ` +
        `${String(ACTION_MAX_MENTIONS)}`,
    );
  }
  problems.push(...peopleProblems({ people: action.mentions, what: "a mention" }));
  problems.push(...mentionAgreementProblems({ action }));
  problems.push(...destinationsProblems({ action }));
  return problems;
}
