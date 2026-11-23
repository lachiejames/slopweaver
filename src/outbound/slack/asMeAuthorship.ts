/**
 * Whether a message posted under the OWNER's name is one Slopweaver sent, so `slack correct --as me` may strike a
 * claim in it.
 *
 * The bot lane's ownership guard (`./lifecycleGuards.ts` `messageOwnership`) proves a message is ours by the bot's own
 * `bot_id` and card metadata. A message the owner's user token posted carries the owner's `user` beside the APP's
 * `bot_id`, never the bot's, so such a message was refused and had to be fixed by hand with `slack edit --as me`.
 * The proof on this lane is the as-me draft register instead: a `released` event naming exactly this channel and ts,
 * whose parked row went out as the owner (no `actor: "bot"`) under the same user the token is now.
 *
 * Slack's own `chat.update` authorisation on the user token already stops an edit of anybody else's message; what
 * this adds is the line between a message SLOPWEAVER sent as the owner and one the owner typed, which the fleet never
 * rewrites. Pure, over facts the shell has already read.
 */
import type { PostedMessage } from "../../corpus/slack/writeTransport.js";
import { type SlackDraftLog, skippedLinesTouching } from "./draftLog.js";
import type { ParkedSlackDraft } from "./draftRegister.js";
import type { ReadSlackMessage } from "./lifecycleGuards.js";

/** What the register and the read-back say about one as-me message. */
export type AsMeAuthorshipVerdict =
  | { readonly kind: "owned"; readonly draftId: string }
  | {
      readonly kind: "not-owner-message";
      readonly messageUserId: string | undefined;
      readonly botId: string | undefined;
    }
  | { readonly kind: "no-released-row" }
  | { readonly kind: "ambiguous-release"; readonly draftIds: readonly string[] }
  | { readonly kind: "row-unreadable"; readonly draftId: string }
  | { readonly kind: "bot-row"; readonly draftId: string }
  | { readonly kind: "other-author"; readonly draftId: string; readonly authorId: string | undefined };

/**
 * Decide whether the as-me draft register proves Slopweaver sent this message under the owner's name.
 *
 * Every check fails closed: no user `auth.test` could name, two rows claiming the one message, a passed-over line
 * that may touch the row, and a row parked before `authorId` existed are each a refusal — absence is not identity.
 *
 * @param log the parsed register; a row any passed-over line may touch is treated as unread, never as proof
 * @param posted the channel and ts the correction targets
 * @param message the message read back under the owner's user token
 * @param selfUserId the user `auth.test` names for that token, absent when it named none
 * @returns `owned` with the row that sent it, or which check refused
 */
export function asMeAuthorship({
  log,
  posted,
  message,
  selfUserId,
}: {
  log: SlackDraftLog;
  posted: PostedMessage;
  message: ReadSlackMessage;
  selfUserId: string | undefined;
}): AsMeAuthorshipVerdict {
  // The owner's user token posts through Slopweaver's app, so the message carries that app's `bot_id` beside the `user`:
  // the user is the identity, and the released row below is the proof.
  if (selfUserId === undefined || message.userId !== selfUserId) {
    return { botId: message.botId, kind: "not-owner-message", messageUserId: message.userId };
  }
  const releases = releasesOf({ log, posted });
  const draftIds = [...new Set(releases.map((release) => release.id))];
  const [draftId] = draftIds;
  if (draftId === undefined) {
    return { kind: "no-released-row" };
  }
  if (draftIds.length > 1) {
    return { draftIds, kind: "ambiguous-release" };
  }
  // A passed-over line naming this row, or naming none, may be the park that says who it went out as.
  if (skippedLinesTouching({ id: draftId, log }).length > 0) {
    return { draftId, kind: "row-unreadable" };
  }
  for (const { parked } of releases) {
    if (parked === undefined) {
      return { draftId, kind: "row-unreadable" };
    }
    if (parked.actor === "bot") {
      return { draftId, kind: "bot-row" };
    }
    if (parked.authorId !== selfUserId) {
      return { authorId: parked.authorId, draftId, kind: "other-author" };
    }
  }
  return { draftId, kind: "owned" };
}

/**
 * Every `released` event naming this message, each paired with the park of its row that stood when it went out.
 *
 * Read in log order rather than off the fold, because a row re-parked AFTER its release overwrites the folded draft:
 * the later park would otherwise lend its author to a message an earlier version of the row sent.
 */
function releasesOf({
  log,
  posted,
}: {
  log: SlackDraftLog;
  posted: PostedMessage;
}): readonly { readonly id: string; readonly parked: ParkedSlackDraft | undefined }[] {
  const standing = new Map<string, ParkedSlackDraft>();
  const releases: { readonly id: string; readonly parked: ParkedSlackDraft | undefined }[] = [];
  for (const event of log.events) {
    if (event.kind === "parked") {
      standing.set(event.id, event.draft);
    } else if (event.kind === "released" && event.channel === posted.channel && event.ts === posted.ts) {
      releases.push({ id: event.id, parked: standing.get(event.id) });
    }
  }
  return releases;
}

/**
 * The refusal a verdict that is not `owned` prints, naming what was checked and what to do instead.
 *
 * @param verdict the refusing verdict
 * @param posted the message the correction targeted
 * @returns one line saying why nothing was changed
 */
export function asMeAuthorshipRefusal({
  verdict,
  posted,
}: {
  verdict: Exclude<AsMeAuthorshipVerdict, { kind: "owned" }>;
  posted: PostedMessage;
}): string {
  const target = `${posted.channel}/${posted.ts}`;
  switch (verdict.kind) {
    case "not-owner-message": {
      let who = "no user Slack names";
      if (verdict.messageUserId !== undefined) {
        who = `user ${verdict.messageUserId}`;
      } else if (verdict.botId !== undefined) {
        who = `bot ${verdict.botId}`;
      }
      return (
        `slack correct --as me refused ${target}: it was posted by ${who}, not the user this token signs in as. ` +
        "A bot message is corrected without --as me. Nothing was changed."
      );
    }
    case "no-released-row":
      return (
        `slack correct --as me refused ${target}: no released row in the as-me draft register names this message, ` +
        "so nothing proves Slopweaver sent it rather than the owner typing it. A message the owner typed is the owner's to correct. " +
        "Nothing was changed."
      );
    case "ambiguous-release":
      return (
        `slack correct --as me refused ${target}: ${verdict.draftIds.join(", ")} each say they released this ` +
        "message, so the register cannot say which went out. Nothing was changed."
      );
    case "row-unreadable":
      return (
        `slack correct --as me refused ${target}: the register says ${verdict.draftId} sent it, but a line this ` +
        "version cannot read may touch that row, so it proves nothing. Nothing was changed."
      );
    case "bot-row":
      return (
        `slack correct --as me refused ${target}: ${verdict.draftId} was released as the bot, not as the owner. ` +
        "Correct it without --as me. Nothing was changed."
      );
    case "other-author": {
      let author = "no user (parked before the register named one)";
      if (verdict.authorId !== undefined) {
        author = verdict.authorId;
      }
      return (
        `slack correct --as me refused ${target}: ${verdict.draftId} was recorded under ${author}, ` +
        "not the user this token signs in as, so it proves nothing. Nothing was changed."
      );
    }
    default: {
      const unhandled: never = verdict;
      return unhandled;
    }
  }
}
