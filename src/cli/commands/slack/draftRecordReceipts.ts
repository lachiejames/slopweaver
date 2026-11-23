/**
 * The receipts a `slack draft record` parks with, judged once the rendered message exists, for both identities
 * (`./draftRecordRun.ts`, `./draftRecordBotRun.ts`). A bot card renders with no Slack read, so its receipts refuse
 * before any; an as-me render reads the channel's surface and a mentioned person's membership to resolve the message,
 * so its receipts refuse after those and before the identity check, the conversation read and `auth.test`. The rule is `../../../outbound/slack/draftReceipts.ts`;
 * this is the one effectful step it needs — whether a row this one re-cuts was sent back for its receipts, read off the
 * register and the relay ledger only when the recording calls itself `--self-evident`, the one shape that fact refuses.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { SlackDraftErrors } from "../../../outbound/slack/draftErrors.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { receiptsOfRecording } from "../../../outbound/slack/draftReceipts.js";
import { sentBackForReceipts } from "../../../outbound/slack/draftSentBack.js";
import type { ParkedDraftReceipts } from "../../../outbound/slack/receiptsLine.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { NOTHING_PARKED } from "./draftMedia.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * The row's receipts, or why it may not park.
 *
 * @param deps the injected world, for the register and the relay ledger
 * @param options the parsed record: its declaration, its files, its act and the rows it re-cuts
 * @param payload the rendered message, which the links are read off
 * @returns the receipts (`undefined` for a bump that owes none), or the refusal lines
 */
export function recordingReceipts({
  deps,
  options,
  payload,
}: {
  deps: Pick<SlackDraftDeps, "readLog" | "readSteerReceipts">;
  options: DraftRecordOptions;
  payload: unknown;
}): Result<ParkedDraftReceipts | undefined> {
  /** The rule over this recording, given which re-cut row (if any) was sent back for its receipts. */
  const judged = ({ sentBackFor }: { sentBackFor: string | undefined }): Result<ParkedDraftReceipts | undefined> =>
    receiptsOfRecording({
      bump: options.act === "bump",
      declared: options.receipts,
      media: options.media.length,
      payload,
      sentBackFor,
    }).mapErr((refusal) => [...refusal.lines, NOTHING_PARKED]);
  // Judged first without the ledger: only a recording that would park as self-evident can be refused by it, so a
  // link, a file, `--tried` or a refusal of its own never costs the read.
  const unread = judged({ sentBackFor: undefined });
  if (unread.isErr() || unread.value?.kind !== "self-evident") {
    return unread;
  }
  const sentBack = sentBackOf({ deps, options });
  if (sentBack.isErr()) {
    return err(sentBack.error);
  }
  return judged({ sentBackFor: sentBack.value });
}

/**
 * Which re-cut row was sent back for receipts, asked only of a `--self-evident` re-cut. A ledger line that does not
 * read as a receipt refuses the whole question: its ruling may be the one that sent the row back, and read as none it
 * would let the self-evident claim through (no silent fallback).
 */
function sentBackOf({
  deps,
  options,
}: {
  deps: Pick<SlackDraftDeps, "readLog" | "readSteerReceipts">;
  options: DraftRecordOptions;
}): Result<string | undefined> {
  const { home, receipts, supersedes } = options;
  if (receipts.kind !== "self-evident" || supersedes.length === 0) {
    return ok(undefined);
  }
  const relays = deps.readSteerReceipts({ home });
  if (relays.isErr()) {
    return err([SlackDraftErrors.sentBackUnreadable({ cause: relays.error.message }).message, NOTHING_PARKED]);
  }
  const { rows, undecoded } = relays.value;
  if (undecoded > 0) {
    const cause = `${String(undecoded)} of its line(s) are not receipts this build can read, and any of them may be their ruling`;
    return err([SlackDraftErrors.sentBackUnreadable({ cause }).message, NOTHING_PARKED]);
  }
  const items = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  return ok(sentBackForReceipts({ items, receipts: rows, supersedes }));
}
