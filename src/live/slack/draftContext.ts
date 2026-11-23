/**
 * The conversation a parked draft lands in, as it stands NOW — the pure half of `slack draft context`.
 *
 * A queue card drawing a draft alone misleads: a draft can look right from memory while the thread has moved on,
 * so the owner has to step into Slack to see what came before it. The card now draws the live conversation
 * above the draft, and this module shapes what `slack draft context <id> --json` hands it: a thread reply's WHOLE
 * thread, or a top-level post's channel tail — the last few top-level messages, which is where the post lands.
 *
 * What it deliberately is not: `slack read-thread`. That verb downloads every attachment's bytes and its only
 * channel mode walks the channel's complete history; a card opened a dozen times a day needs neither. Each
 * message keeps its Block Kit verbatim — the card draws rich text through the same components the draft is drawn
 * with — and an attachment is COUNTED, never fetched. Rows are projected by `./projection.ts`, the same strict
 * projection `read-thread` uses, so a malformed row refuses the read rather than vanishing from it.
 *
 * The same raw rows also say what moved since the draft was written (`./draftContextSince.ts`), so the card can tell
 * the owner whether they are reacting to a stale picture.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ParkedSlackDraft } from "../../outbound/slack/draftRegister.js";
import { projectChannelRows } from "./channelRows.js";
import { type DraftContextScope, type SinceDrafted, sinceDrafted } from "./draftContextSince.js";
import type { SlackProjectionError } from "./errors.js";
import type { SlackThreadTarget } from "./permalink.js";
import { projectSlackThread } from "./projection.js";
import type { VisibleSlackAuthor, VisibleSlackMessage } from "./types.js";

/**
 * How many of a channel's newest top-level messages a top-level draft is drawn under: one `conversations.history`
 * page, enough to see what the room is talking about when the post lands, and short enough to sit above a draft
 * without becoming the wall rule 7 forbids. A thread is read WHOLE instead, because a reply answers all of it.
 */
export const CHANNEL_CONTEXT_MESSAGES = 6;

/** One message as the card draws it: who, when, where it lives, and its content exactly as Slack returned it. */
export interface DraftContextMessage {
  readonly ts: string;
  /** The instant `ts` names, derived by the projection — never computed here. */
  readonly tsIso: string;
  readonly permalink: string;
  readonly author: VisibleSlackAuthor;
  /** Slack's own subtype — a join, a bot message — when it gave one. */
  readonly subtype?: string;
  /** The top-level mrkdwn text; often empty on an app's message, whose content lives in `attachments`. */
  readonly text: string;
  /** Block Kit content, verbatim. */
  readonly blocks: readonly unknown[];
  /** Legacy attachments (an app card's wrapper), verbatim. */
  readonly attachments: readonly unknown[];
  /** Files the message carries, top-level and Block Kit alike. Counted, never fetched. */
  readonly fileCount: number;
  /** Replies under it, as `conversations.history` reported them — only a channel-tail message carries any. */
  readonly replyCount: number;
  readonly edited: boolean;
}

/** What `slack draft context <id> --json` prints. */
export interface DraftContextDocument {
  readonly kind: "slopweaver.slack.draft-context";
  /** `2` since the document carries {@link DraftContextDocument.sinceDrafted}. */
  readonly schemaVersion: 2;
  readonly id: string;
  readonly observedAtIso: string;
  readonly scope: DraftContextScope;
  readonly channel: string;
  /** The thread root a reply goes under — present exactly when `scope` is `thread`. */
  readonly threadTs?: string;
  /** Where the card links out to: the thread root's permalink, or the channel itself. */
  readonly link: string;
  /** Whether older messages exist than the channel tail shows. Always false for a thread, which is read whole. */
  readonly earlierWithheld: boolean;
  /** Oldest first, the order Slack draws them. */
  readonly messages: readonly DraftContextMessage[];
  /** What moved here since the draft was written, measured off these same rows. */
  readonly sinceDrafted: SinceDrafted;
}

/** The card's view of one projected message, plus the reply count only a history row carries. */
function contextMessageOf({
  message,
  replyCount,
}: {
  message: VisibleSlackMessage;
  replyCount: number;
}): DraftContextMessage {
  return {
    attachments: message.attachments,
    author: message.author,
    blocks: message.blocks,
    edited: message.editedTs !== undefined,
    fileCount: message.files.length + message.blockFileRefs.length,
    permalink: message.permalink,
    replyCount,
    text: message.text,
    ts: message.ts,
    tsIso: message.tsIso,
    ...(message.subtype === undefined ? {} : { subtype: message.subtype }),
  };
}

/** A channel's newest rows, projected oldest first (`./channelRows.ts`) and drawn as the card draws them. */
function channelMessages({
  rows,
  channel,
  workspace,
}: {
  rows: readonly unknown[];
  channel: string;
  workspace: string;
}): Result<readonly DraftContextMessage[], SlackProjectionError> {
  return projectChannelRows({ channel, rows, workspace }).map((projected) =>
    projected.map((row) => contextMessageOf({ message: row.message, replyCount: row.replyCount })),
  );
}

/**
 * Shape what one live read returned into the document the card draws.
 *
 * @param draft the parked row: its id, and the recording instant and read the "since drafted" delta is measured from
 * @param rows the raw rows: every `conversations.replies` row for a thread, or one `conversations.history` page
 * @param threadTs the root a thread reply goes under, or `undefined` for a top-level post
 * @param hasMore Slack's `has_more` on the history page — older messages than the tail exist
 * @param workspace the workspace origin off `auth.test`, which every permalink is built from
 * @returns the document, or the projection's refusal when a row is not one it can vouch for
 */
export function draftContextDocument({
  draft,
  channel,
  threadTs,
  rows,
  hasMore,
  workspace,
  observedAtIso,
}: {
  draft: Pick<ParkedSlackDraft, "id" | "readThrough" | "tsIso">;
  channel: string;
  threadTs: string | undefined;
  rows: readonly unknown[];
  hasMore: boolean;
  workspace: string;
  observedAtIso: string;
}): Result<DraftContextDocument, SlackProjectionError> {
  const scope: DraftContextScope = threadTs === undefined ? "channel" : "thread";
  const base = {
    id: draft.id,
    kind: "slopweaver.slack.draft-context",
    observedAtIso,
    schemaVersion: 2,
    sinceDrafted: sinceDrafted({ draft, hasMore, rawMessages: rows, scope }),
  } as const;
  if (threadTs === undefined) {
    const messages = channelMessages({ channel, rows, workspace });
    if (messages.isErr()) {
      return err(messages.error);
    }
    return ok({
      ...base,
      channel,
      earlierWithheld: hasMore,
      link: `${workspace}/archives/${channel}`,
      messages: messages.value,
      scope: "channel",
    });
  }
  const target: SlackThreadTarget = { addressedReply: false, addressedTs: threadTs, channel, threadTs, workspace };
  const thread = projectSlackThread({ rawMessages: rows, target });
  if (thread.isErr()) {
    return err(thread.error);
  }
  const messages = thread.value.messages.map((message) => contextMessageOf({ message, replyCount: 0 }));
  // `projectSlackThread` refuses a thread whose root it never saw, so the first message is the root.
  return ok({
    ...base,
    channel,
    earlierWithheld: false,
    link: messages[0]!.permalink,
    messages,
    scope: "thread",
    threadTs,
  });
}

/** A user mention in mrkdwn: `<@U…>`, optionally labelled. */
const MRKDWN_USER = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

/** Every `user` element's id anywhere under a Block Kit node, in document order. */
function blockUserIds({ node, into }: { node: unknown; into: Set<string> }): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      blockUserIds({ into, node: child });
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const userId = node["user_id"];
  if (node["type"] === "user" && typeof userId === "string") {
    into.add(userId);
  }
  for (const value of Object.values(node)) {
    blockUserIds({ into, node: value });
  }
}

/**
 * Every Slack member id the conversation would show a reader — each author, each `<@U…>` in the text, each
 * `user` element in the blocks and attachments — so the verb can name them off member bronze and the card never
 * prints a bare id where a person's name belongs.
 *
 * @param messages the conversation, as the document carries it — a draft's context or the console's channel window
 * @returns the distinct member ids, first-seen order
 */
export function draftContextMemberIds({
  messages,
}: {
  messages: readonly Pick<DraftContextMessage, "attachments" | "author" | "blocks" | "text">[];
}): readonly string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.author.userId !== undefined) {
      ids.add(message.author.userId);
    }
    for (const match of message.text.matchAll(MRKDWN_USER)) {
      const userId = match.at(1);
      if (userId !== undefined) {
        ids.add(userId);
      }
    }
    blockUserIds({ into: ids, node: message.blocks });
    blockUserIds({ into: ids, node: message.attachments });
  }
  return [...ids];
}
