/**
 * Where a parked draft is going and its card head — its act, who it is to and one plain line of context — off the
 * draft reading alone (the card draws it through `./postCard.ts` `postCard`).
 *
 * Pure: a draft in, the address phrase and three card fields out.
 */
import { receiptsLine } from "../components/live/draftReceipts";
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { PostRecord } from "./postCard";
import { addressedInWords, draftContextInWords, draftDestination, spokenName } from "./slackPeople";

/**
 * A post card's address and head.
 *
 * `people` comes from the destination's `to` — the DM peer, else each person the draft tags, once — whose `title` is
 * always the member id, so a chip resolves by id and never by a name matched in prose.
 *
 * @param post the parked draft
 * @returns `addressed` — who it is to and where, in words — and the head fields: the act as recorded, the people by
 *   id, the context line, the choice between A and Codex's B or the B still owed, and the receipts line it leads with
 */
export function postHeadOf({
  post,
}: {
  post: Pick<
    ParkedDraft,
    | "act"
    | "actor"
    | "authorId"
    | "channel"
    | "channelName"
    | "comparison"
    | "mentions"
    | "leadingReceipt"
    | "people"
    | "receipts"
    | "thread"
  >;
}): {
  readonly addressed: string;
  readonly head: Pick<PostRecord, "act" | "choice" | "codexOwed" | "context" | "people" | "receiptsLine">;
} {
  const { where, to } = draftDestination({
    channel: post.channel,
    channelName: post.channelName,
    mentions: post.mentions,
    people: post.people,
    threaded: post.thread !== undefined,
  });
  const context = draftContextInWords({
    channel: post.channel,
    channelName: post.channelName,
    people: post.people,
    thread: post.thread,
    // "your thread" only on a row going out as the owner: a bot row's author is the bot, never the owner.
    yourId: post.actor === "me" ? post.authorId : undefined,
  });
  return {
    addressed: addressedInWords({ to: to.map((label) => spokenName({ label, people: post.people })), where }),
    head: {
      act: post.act,
      choice: postChoiceOf({ post }),
      codexOwed: post.comparison?.state === "pending",
      context,
      people: to.map((label) => ({ id: label.title, label: label.text })),
      receiptsLine: leadingReceiptLine({
        line: receiptsLine({ bump: post.act === "bump", receipts: post.receipts }),
        receipt: post.leadingReceipt,
      }),
    },
  };
}

/**
 * The receipts line, naming the annotated screenshot a cleared first message leads with and the note on each of its
 * boxes, so what the picture shows is above the fold before the picture is.
 *
 * @param line the receipts line `receiptsLine` printed
 * @param receipt the leading receipt, absent on a row that is not a first message in a channel
 * @returns the line, with the receipt's notes after it when there is one
 */
export function leadingReceiptLine({
  line,
  receipt,
}: {
  line: string;
  receipt: ParkedDraft["leadingReceipt"];
}): string {
  if (receipt === undefined) {
    return line;
  }
  const lead = /[.!?]$/u.test(line) ? line : `${line}.`;
  return `${lead} Leads with an annotated screenshot: ${receipt.notes.join("; ")}`;
}

/**
 * The choice a post card offers while Codex's draft sits beside the original and the owner has chosen neither.
 *
 * @param post the parked draft
 * @returns who wrote A, what wrote B and the question in those words, or `undefined` when there is nothing to choose
 */
export function postChoiceOf({ post }: { post: Pick<ParkedDraft, "comparison"> }): PostRecord["choice"] {
  const comparison = post.comparison;
  if (comparison?.codex === undefined || comparison.model === undefined) {
    return undefined;
  }
  const dropsReceipts = comparison.codexDropsReceipts;
  if (comparison.composer === "claude-code") {
    return { dropsReceipts, model: comparison.model, originalBy: "Claude's", question: "Claude's draft or Codex's?" };
  }
  return {
    dropsReceipts,
    model: comparison.model,
    originalBy: "the recording session's",
    question: "The recording session's draft or Codex's?",
  };
}
