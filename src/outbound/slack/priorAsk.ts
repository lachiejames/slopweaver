/**
 * A question the team already answered is never asked again unless something materially changed, and then only
 * with the proof in front of the owner.
 *
 * If a team answers an ask ("yes, it is expected, here is why") and a month later the same thing is asked
 * again, that is a public mistake. The default is to withhold or drop it. The only other shape is a Queue card
 * carrying our earlier message, their answer, and proof of what changed: a claim that something changed needs
 * charts, not assertion. The owner decides.
 *
 * ## The declaration, and why it is one
 *
 * `slack draft record` reads a draft's AUTHORED words with `./ownerDmAsk.ts`'s tell — an ask phrase or a closing
 * question mark, never a link label, a code run or a quote. A message that asks DECLARES whether that question
 * was asked before: `--asked-before none`, or `--asked-before <permalink>` naming our earlier message. The
 * recorder then reads that earlier thread live, and anybody else's reply after ours makes it ANSWERED: it parks
 * only with `--changed "<what>"` and `--changed-media <png,…>` (the proof), or `--not-answered "<why>"` where the
 * replies there do not answer it. A silent omission becomes an explicit claim, journalled on the row.
 *
 * ## An answer at the top of the channel
 *
 * A reply to our message posted at the top level of the channel is still a reply, and a bump over it makes the
 * owner look silly. A one-to-one DM's top level is read as the conversation itself, every later word an answer, because
 * that is where an answer there lands. A CHANNEL's top level is read too, but through `./topLevelAnswer.ts`'s
 * rule, because most of what follows ours there is the channel moving on: a clear tie is an answer like any
 * other (record nothing, the owner's "Discard"), and an ambiguous one refuses until the recorder says why it may not
 * answer, so the card holds it for the owner's judgement.
 *
 * ## Residue, stated rather than discovered
 *
 * - `none` is the recorder's word, and nothing here checks it: a search of the owner's sent history for the same
 *   question is the stacked follow-up, held back because its match threshold is not yet measured.
 * - "Somebody else replied" is a proxy for "answered"; `--not-answered` is the way through for "will look".
 * - A channel's top level is read for one business day after ours and judged by a rule over who and when, never
 *   over what the post says: an unrelated post can tie, and is quoted when it does; a late answer does not.
 * - Whether a picture is a CHART is not decidable here; that it is a picture that passed visual-evidence
 *   admission is.
 *
 * Pure: no network, no clock, no filesystem. The read is `../../live/slack/priorAskRead.ts`.
 */
import { compareSlackTimestamps } from "../../live/slack/selection.js";
import { authoredCells } from "../artifact/aboveFold.js";
import { asMeSequences, authoredWordsOf } from "../artifact/runs.js";
import type { AsMeArtifact, SlackBotArtifact } from "../artifact/types.js";
import {
  type ParkedPriorAsk,
  type ParkedPriorMessage,
  type ParkedSlackDraftMedia,
  PRIOR_ANSWERS_KEPT,
  THREAD_PARENT_MAX_CHARS,
} from "./draftRegister.js";
import { askedWords } from "./ownerDmAsk.js";
import { topLevelTieOf } from "./topLevelAnswer.js";

/** What `--asked-before` and its companions declared. */
export type AskedBefore =
  | { readonly kind: "none" }
  | {
      readonly kind: "prior";
      readonly permalink: string;
      /** `--changed`: what materially changed since they answered. Given exactly with {@link changedMedia}. */
      readonly changed?: string | undefined;
      /** `--changed-media`: the pictures that show it, as paths. Empty when no change is declared. */
      readonly changedMedia: readonly string[];
      /** `--not-answered`: why the replies there do not answer the question. */
      readonly notAnswered?: string | undefined;
    };

/** A recording's declaration, or `undeclared` where the recorder gave none. */
export type AskedBeforeDeclaration = AskedBefore | "undeclared";

/** One message of the earlier exchange, as the read returns it. */
export interface PriorReadMessage {
  readonly ts: string;
  readonly userId?: string | undefined;
  readonly botId?: string | undefined;
  /** An app's message carries its app id; an app never answers for the team. */
  readonly appId?: string | undefined;
  /** A system row — a join, a topic change — is not an answer. Absent on an ordinary message. */
  readonly subtype?: string | undefined;
  readonly text: string;
}

/** The earlier exchange, read whole: the message the link addressed, and everything read around it. */
export interface PriorRead {
  /** The `ts` of the message the permalink names — our earlier ask. */
  readonly addressedTs: string;
  /** The thread, and a one-to-one DM's top level — every later word by somebody else there is an answer. */
  readonly messages: readonly PriorReadMessage[];
  /**
   * A CHANNEL's top-level messages after ours, empty for a DM. Never merged into {@link messages}: only the one
   * `./topLevelAnswer.ts` ties to ours is an answer.
   */
  readonly channelTopLevel: readonly PriorReadMessage[];
}

/** A channel top-level post tied to our ask, as the judgement keeps it. */
interface PriorTopLevelTie {
  /** `answers` reads as an answer; `may-answer` is the owner's to judge. */
  readonly kind: "answers" | "may-answer";
  readonly post: ParkedPriorMessage;
}

/** What the read of an earlier ask found. */
export type PriorJudgement =
  | { readonly kind: "not-found" }
  | { readonly kind: "not-ours"; readonly userId: string | undefined }
  | {
      readonly kind: "read";
      readonly ours: ParkedPriorMessage;
      /**
       * Every answer by anybody else after ours, the channel top-level post tied to it included, oldest first —
       * the row keeps the first {@link PRIOR_ANSWERS_KEPT}.
       */
      readonly answers: readonly ParkedPriorMessage[];
      /** The channel top-level post tied to ours, also in {@link answers}; absent when none is. */
      readonly topLevelTie?: PriorTopLevelTie | undefined;
      readonly readThroughTs: string;
    };

/** Message subtypes that are still somebody's words: a reply broadcast to the channel, a file with a comment. */
const WORD_SUBTYPES: ReadonlySet<string> = new Set(["thread_broadcast", "file_share"]);

/** Inline code and a link or mention in raw mrkdwn — somebody else's words or an identifier, never the asker's. */
const PLAIN_SKIPPED = /`[^`]*`|<[^>]*>/gu;

/** A quoted line in raw mrkdwn. */
const PLAIN_QUOTE = /^&gt;.*$|^>.*$/gmu;

/**
 * The words an as-me draft asks in, or `undefined` when it asks nothing. A typed form is read run by run; the
 * `plain` form is raw mrkdwn, so its code, links, mentions and quoted lines are struck first.
 *
 * @param artifact the validated, linkified as-me form
 * @returns the words that asked, as `./ownerDmAsk.ts` reports them
 */
export function askingWords({ artifact }: { artifact: AsMeArtifact }): string | undefined {
  if (artifact.kind === "plain") {
    return askedWords({ text: artifact.text.replace(PLAIN_QUOTE, " ").replace(PLAIN_SKIPPED, " ") });
  }
  for (const { runs } of asMeSequences({ artifact })) {
    const asked = askedWords({ text: authoredWordsOf({ runs }) });
    if (asked !== undefined) {
      return asked;
    }
  }
  return undefined;
}

/**
 * The words a bot draft asks in, or `undefined` when it asks nothing — read over every authored cell, the detail
 * included, because a finding's question is as often below the fold as above it.
 *
 * @param artifact the admitted bot form
 * @returns the words that asked
 */
export function askingWordsOfBot({ artifact }: { artifact: SlackBotArtifact }): string | undefined {
  for (const cell of authoredCells({ artifact })) {
    const asked = askedWords({ text: cell.text });
    if (asked !== undefined) {
      return asked;
    }
  }
  return undefined;
}

/**
 * One read message as the row keeps it.
 *
 * @param message the message as read
 * @returns its `ts`, author and text cut to {@link THREAD_PARENT_MAX_CHARS}
 */
function keptMessage({ message }: { message: PriorReadMessage }): ParkedPriorMessage {
  return {
    text: message.text.slice(0, THREAD_PARENT_MAX_CHARS),
    ts: message.ts,
    ...(message.userId === undefined ? {} : { userId: message.userId }),
  };
}

/**
 * Judge an earlier ask from its read: the addressed message must be ours, and every message strictly after it by
 * anybody who is neither us nor a bot is an answer. A message BEFORE ours is never one — asking inside somebody
 * else's thread does not make its root an answer — and a bot's reply is an automation, not the team.
 *
 * @param read the earlier exchange, read whole
 * @param selfUserId the asking identity's own Slack user id — the owner's for an as-me row, the bot's for a bot row
 * @returns not found, not ours, or ours with its answers and how far the read went
 */
export function judgePriorAsk({ read, selfUserId }: { read: PriorRead; selfUserId: string }): PriorJudgement {
  const ours = read.messages.find((message) => message.ts === read.addressedTs);
  if (ours === undefined) {
    return { kind: "not-found" };
  }
  if (ours.userId !== selfUserId) {
    return { kind: "not-ours", userId: ours.userId };
  }
  const inConversation = read.messages
    .filter((message) => compareSlackTimestamps({ left: message.ts, right: read.addressedTs }) > 0)
    .filter((message) => message.userId !== selfUserId && message.botId === undefined)
    .filter((message) => message.subtype === undefined || WORD_SUBTYPES.has(message.subtype));
  const tie = topLevelTieOf({ ask: ours, posts: read.channelTopLevel });
  const tied = tie === undefined ? [] : [tie.post];
  const answers = [...new Map([...inConversation, ...tied].map((message) => [message.ts, message])).values()].toSorted(
    (left, right) => compareSlackTimestamps({ left: left.ts, right: right.ts }),
  );
  // The THREAD's read alone: the channel is read after it, so channel traffic must never carry this mark past a
  // reply posted between the two reads. A recorded tie is matched by its ts at release instead.
  const readThroughTs = read.messages
    .map((message) => message.ts)
    .reduce((newest, ts) => (compareSlackTimestamps({ left: ts, right: newest }) > 0 ? ts : newest), ours.ts);
  return {
    answers: answers.map((message) => keptMessage({ message })),
    kind: "read",
    ours: keptMessage({ message: ours }),
    readThroughTs,
    ...(tie === undefined ? {} : { topLevelTie: { kind: tie.kind, post: keptMessage({ message: tie.post }) } }),
  };
}

/** How to look for an earlier ask, named in every refusal that asks the recorder to. */
const HOW_TO_LOOK =
  "Look before declaring: `slopweaver store hits` over the owner's own sent messages for the question's distinctive " +
  "terms, then `slopweaver store around` or `slopweaver slack read-thread <link>` on a hit to read what was said.";

/** Why there is no override, said rather than left for a reader to wonder about. */
const NO_HATCH =
  "There is deliberately NO escape hatch here: every way through is a declaration a recorder can always make, " +
  "and an override would be a documented way to re-ask an answered question with nothing shown.";

/**
 * Why a draft that asks must declare whether it asked before — nothing when it asks nothing or declared.
 *
 * @param asked the words that asked, or `undefined` when the draft asks nothing
 * @param declared what the recording declared
 * @returns the hold's lines, or nothing
 */
export function undeclaredAskRefusal({
  asked,
  declared,
}: {
  asked: string | undefined;
  declared: AskedBeforeDeclaration;
}): readonly string[] {
  if (asked === undefined || declared !== "undeclared") {
    return [];
  }
  return [
    `this draft asks a question ("${asked}"), so the recording says whether it was asked before: pass ` +
      "`--asked-before none`, or `--asked-before <permalink of our earlier message>`. A " +
      "question the team already answered is not asked again unless something materially changed.",
    HOW_TO_LOOK,
    NO_HATCH,
  ];
}

/**
 * The hold an AMBIGUOUS top-level post puts on a re-ask: it may answer ours, so it is the owner's to judge, never a bump
 * sent over it.
 *
 * @param permalink our earlier message's link, as declared
 * @param post the top-level post that may answer it
 * @returns the hold's lines
 */
function heldTopLevelRefusal({ permalink, post }: { permalink: string; post: ParkedPriorMessage }): readonly string[] {
  let by = "somebody Slack did not name";
  if (post.userId !== undefined) {
    by = post.userId;
  }
  return [
    `--asked-before ${permalink}: a message ${by} posted at the top of the channel after ours MAY answer it: ` +
      `"${post.text}". A person reading the channel would see it, so a bump over it can read as a public mistake.`,
    "If it answers the question, record nothing (a clear answer means discard the bump). If it " +
      'is unclear, say why it may not: `--not-answered "<why>"`. If it answers but something MATERIALLY changed, ' +
      'show it as any answer does: `--changed "<what changed>" --changed-media <png,…>`. Either way the Queue card ' +
      "shows the owner our message and theirs, and the owner decides: hold the bump for the owner's judgment if " +
      "it is ambiguous.",
    NO_HATCH,
  ];
}

/**
 * Why an earlier ask, once read, refuses this draft — nothing when it may park.
 *
 * @param declared the earlier ask the recording named
 * @param judgement what the read of it found
 * @returns the hold's lines, or nothing
 */
export function priorAskRefusal({
  declared,
  judgement,
}: {
  declared: Extract<AskedBefore, { kind: "prior" }>;
  judgement: PriorJudgement;
}): readonly string[] {
  if (judgement.kind === "not-found") {
    return [
      `--asked-before ${declared.permalink}: the thread read whole and holds no message at that link, so there is ` +
        "no earlier ask to show the owner. Name our earlier message's own link.",
      NO_HATCH,
    ];
  }
  if (judgement.kind === "not-ours") {
    let by = "an author Slack did not name";
    if (judgement.userId !== undefined) {
      by = judgement.userId;
    }
    return [
      `--asked-before ${declared.permalink} is a message by ${by}, not by the ` +
        "identity this draft goes out under: the earlier ask is OUR message. Name that one; a thread somebody " +
        "else opened is read from our message in it.",
      HOW_TO_LOOK,
      NO_HATCH,
    ];
  }
  const [first] = judgement.answers;
  const shown = declared.changed !== undefined || declared.notAnswered !== undefined;
  if (first === undefined || shown) {
    return [];
  }
  const tie = judgement.topLevelTie;
  if (tie?.kind === "may-answer" && judgement.answers.length === 1) {
    return heldTopLevelRefusal({ permalink: declared.permalink, post: tie.post });
  }
  const count = judgement.answers.length;
  let where = "";
  if (tie?.kind === "answers" && tie.post.ts === first.ts) {
    where = " It was posted at the top of the channel, the next person's message after ours.";
  } else if (tie?.kind === "answers") {
    where = ` One was posted at the top of the channel, the next person's message after ours: "${tie.post.text}".`;
  }
  return [
    `--asked-before ${declared.permalink}: that question was ANSWERED — ${String(count)} ` +
      `${count === 1 ? "reply" : "replies"} by somebody else after ours, the first: "${first.text}".${where} ` +
      "Asking it again with nothing changed reads as a public mistake, so the default is to " +
      "drop it: record nothing, and drop any held row that carries it " +
      '(`slopweaver slack draft drop <id> --note "answered at <link>"`).',
    'If something MATERIALLY changed, show it: `--changed "<what changed>" --changed-media <png,…>` — at least ' +
      "one picture, a chart of the change, since a claim that something changed needs charts. " +
      'If the replies there do not answer the question, say so: `--not-answered "<why>"`. Either way ' +
      "the Queue card shows the owner our message and theirs, and the owner decides.",
    NO_HATCH,
  ];
}

/**
 * The row's `priorAsk` once every hold has passed.
 *
 * @param declared what the recording declared
 * @param judgement what the read found, for a declared earlier ask
 * @param proof the stored pictures, for a declared change
 * @returns the row field, or `undefined` for a draft that asks nothing and declared nothing
 */
export function parkedPriorAsk({
  declared,
  judgement,
  proof,
}: {
  declared: AskedBeforeDeclaration;
  judgement: Extract<PriorJudgement, { kind: "read" }> | undefined;
  proof: readonly ParkedSlackDraftMedia[];
}): ParkedPriorAsk | undefined {
  if (declared === "undeclared") {
    return undefined;
  }
  if (declared.kind === "none" || judgement === undefined) {
    return { kind: "none" };
  }
  return {
    answerCount: judgement.answers.length,
    answers: judgement.answers.slice(0, PRIOR_ANSWERS_KEPT),
    kind: "prior",
    ours: judgement.ours,
    permalink: declared.permalink,
    readThroughTs: judgement.readThroughTs,
    ...(declared.changed === undefined ? {} : { changed: declared.changed }),
    ...(proof.length === 0 ? {} : { proof }),
    ...(declared.notAnswered === undefined ? {} : { notAnswered: declared.notAnswered }),
  };
}

/**
 * The answers an earlier ask gained since a row recorded it — what a release refuses on: any answer newer than the
 * recording's THREAD read that the row did not record (a top-level tie the row did record, say a may-answer the owner was
 * shown, is not new). A clear top-level tie the row did not record counts too, however old: a deleted post can
 * expose an earlier one as the answer. The row keeps only its first {@link PRIOR_ANSWERS_KEPT}
 * answers, so a tie past those refuses as well, the safe direction.
 *
 * @param priorAsk the row's recorded earlier ask
 * @param judgement the earlier ask, read again at release
 * @returns the unrecorded replies newer than the recording read, and an unrecorded clear tie, oldest first
 */
export function answersSinceRecording({
  priorAsk,
  judgement,
}: {
  priorAsk: Extract<ParkedPriorAsk, { kind: "prior" }>;
  judgement: Extract<PriorJudgement, { kind: "read" }>;
}): readonly ParkedPriorMessage[] {
  const newer = (answer: ParkedPriorMessage): boolean =>
    compareSlackTimestamps({ left: answer.ts, right: priorAsk.readThroughTs }) > 0;
  const recorded = new Set(priorAsk.answers.map((answer) => answer.ts));
  const since = judgement.answers.filter((answer) => newer(answer) && !recorded.has(answer.ts));
  const tie = judgement.topLevelTie;
  if (tie?.kind !== "answers" || recorded.has(tie.post.ts) || newer(tie.post)) {
    return since;
  }
  return [tie.post, ...since].toSorted((left, right) => compareSlackTimestamps({ left: left.ts, right: right.ts }));
}
