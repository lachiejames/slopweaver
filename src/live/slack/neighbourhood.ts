/**
 * Pure channel-neighbourhood projection and selection for an agent-directed Slack read.
 *
 * This module never decides whether channel context is relevant. It gives the visible agent a compact,
 * bounded view when the agent explicitly asks for one, preserves a permalink for every candidate worth
 * opening, and accounts for every older/newer channel-visible message it withheld.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackProjectionError } from "./errors.js";
import { type SlackNeighbourhoodError, SlackNeighbourhoodErrors } from "./neighbourhoodErrors.js";
import type { SlackThreadTarget } from "./permalink.js";
import { projectSlackMessage } from "./projection.js";
import { compareSlackTimestamps } from "./selection.js";
import type { VisibleSlackAuthor, VisibleSlackMessage } from "./types.js";

/** Maximum normalized text characters carried by one compact channel summary. */
const PREVIEW_CHARACTERS = 240;

/** One channel-visible message, compact enough to scan before deciding whether to open its permalink. */
export interface ChannelMessageSummary {
  readonly ts: string;
  /** The instant {@link ts} names — see `VisibleSlackMessage.tsIso` for why both are carried. */
  readonly tsIso: string;
  readonly relation: "parent" | "reply";
  readonly permalink: string;
  readonly author: VisibleSlackAuthor;
  readonly textPreview: string;
  /** Exact normalized text characters omitted after {@link textPreview}. */
  readonly textWithheldCharacters: number;
  readonly replyCount: number;
  readonly blockCount: number;
  readonly attachmentCount: number;
  readonly fileCount: number;
}

/** The independently bounded channel layer around a thread parent. */
export interface SlackNeighbourhood {
  readonly anchorTs: string;
  /** The instant {@link anchorTs} names — see `VisibleSlackMessage.tsIso` for why both are carried. */
  readonly anchorTsIso: string;
  readonly around: number;
  /** Older channel-visible messages, chronological. */
  readonly before: readonly ChannelMessageSummary[];
  /** Newer channel-visible messages, chronological. */
  readonly after: readonly ChannelMessageSummary[];
  readonly withheldBefore: number;
  readonly withheldAfter: number;
  readonly pageCount: number;
  readonly cursorExhausted: true;
}

/** One projected channel-history row before it is compacted. */
interface ProjectedHistoryMessage {
  readonly message: VisibleSlackMessage;
  readonly replyCount: number;
}

/** Collapse whitespace so the preview stays one physical line without inventing a semantic summary. */
function normalizedText({ text }: { text: string }): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/** Slack's optional thread reply count, kept conservative when absent or malformed. */
function replyCountOf({ raw }: { raw: Readonly<Record<string, unknown>> }): number {
  const count = raw["reply_count"];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/** Turn one strict projected row into its cheap navigational summary. */
function summaryOf({ projected }: { projected: ProjectedHistoryMessage }): ChannelMessageSummary {
  const text = normalizedText({ text: projected.message.text });
  const textPreview = text.slice(0, PREVIEW_CHARACTERS);
  return {
    attachmentCount: projected.message.attachments.length,
    author: projected.message.author,
    blockCount: projected.message.blocks.length,
    fileCount: projected.message.files.length + projected.message.blockFileRefs.length,
    permalink: projected.message.permalink,
    relation: projected.message.relation,
    replyCount: projected.replyCount,
    textPreview,
    textWithheldCharacters: text.length - textPreview.length,
    ts: projected.message.ts,
    tsIso: projected.message.tsIso,
  };
}

/**
 * Strictly project complete `conversations.history` rows for compact channel navigation.
 *
 * History arrives newest-first; success returns chronological summaries. Any malformed visible-content row
 * or duplicate timestamp refuses the whole layer, because silently dropping one would make residue counts
 * false.
 *
 * @param rawMessages every history row after cursor exhaustion
 * @param target the parsed Slack target supplying workspace and channel identity
 * @returns chronological compact summaries, or every reason the layer could not be trusted
 */
export function projectChannelHistory({
  rawMessages,
  target,
}: {
  rawMessages: readonly unknown[];
  target: SlackThreadTarget;
}): Result<readonly ChannelMessageSummary[], SlackProjectionError | SlackNeighbourhoodError> {
  const projected: ProjectedHistoryMessage[] = [];
  const seen = new Set<string>();
  for (const raw of rawMessages) {
    if (!isRecord(raw)) {
      return err(SlackNeighbourhoodErrors.malformedRow());
    }
    const ts = raw["ts"];
    if (typeof ts !== "string" || ts.length === 0) {
      return err(SlackNeighbourhoodErrors.missingTs());
    }
    if (seen.has(ts)) {
      return err(SlackNeighbourhoodErrors.duplicateMessage({ ts }));
    }
    const rowThreadTs = typeof raw["thread_ts"] === "string" ? raw["thread_ts"] : ts;
    const message = projectSlackMessage({
      raw,
      target: {
        addressedReply: rowThreadTs !== ts,
        addressedTs: ts,
        channel: target.channel,
        threadTs: rowThreadTs,
        workspace: target.workspace,
      },
    });
    if (message.isErr()) {
      return err(message.error);
    }
    seen.add(ts);
    projected.push({ message: message.value, replyCount: replyCountOf({ raw }) });
  }
  const chronological = projected.toSorted((left, right) =>
    compareSlackTimestamps({ left: left.message.ts, right: right.message.ts }),
  );
  return ok(chronological.map((entry) => summaryOf({ projected: entry })));
}

/**
 * Select channel-visible messages immediately before and after the thread parent.
 *
 * @param messages complete chronological channel history summaries
 * @param anchorTs the thread parent around which channel context is requested
 * @param around messages to retain on each side
 * @param pageCount history pages consumed before cursor exhaustion
 * @returns the bounded layer with exact residue, or `err` when its anchor/bound is invalid
 */
export function selectNeighbourhood({
  messages,
  anchorTs,
  around,
  pageCount,
}: {
  messages: readonly ChannelMessageSummary[];
  anchorTs: string;
  around: number;
  pageCount: number;
}): Result<SlackNeighbourhood, SlackNeighbourhoodError> {
  if (!Number.isSafeInteger(around) || around < 0) {
    return err(SlackNeighbourhoodErrors.invalidAround({ around }));
  }
  const anchorIndex = messages.findIndex((message) => message.ts === anchorTs);
  if (anchorIndex < 0) {
    return err(SlackNeighbourhoodErrors.anchorNotFound({ anchorTs }));
  }
  const beforeStart = Math.max(0, anchorIndex - around);
  const afterEnd = Math.min(messages.length, anchorIndex + around + 1);
  return ok({
    after: messages.slice(anchorIndex + 1, afterEnd),
    anchorTs,
    // Taken off the anchor summary rather than re-derived, so the two can never disagree about one message.
    anchorTsIso: messages[anchorIndex]!.tsIso,
    around,
    before: messages.slice(beforeStart, anchorIndex),
    cursorExhausted: true,
    pageCount,
    withheldAfter: messages.length - afterEnd,
    withheldBefore: beforeStart,
  });
}
