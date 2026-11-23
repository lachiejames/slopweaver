/**
 * What Slack's own read of the thread says about a help — the proof `witness help` rests on, rather than the
 * caller's flags or the listener's snapshot alone.
 *
 * The snapshot's own watch says a message tagging this bot passed through the tap, but the tap cannot tell a
 * responder's tag from a peer bot's echo or a tag the whitelist refused, and `--user`/`--message-ts` are
 * whatever the caller typed. So the thread is re-read and four things are checked against it: the message is a
 * REPLY in that thread, its author is the claimed asker and a person, it does not tag the bot itself, and an
 * EARLIER message there is a responder PERSON tagging this bot. A review of this change found that a peer bot writing `cc <@this bot>` opened an own watch no person ever asked for.
 *
 * Pure over the raw `conversations.replies` rows; the read is `../../cli/commands/witness/deps.ts`'s.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { taggedIn } from "../listen/mention.js";
import type { WitnessHelpRequest } from "./help.js";
import { type WitnessHelpError, WitnessHelpErrors } from "./helpErrors.js";

/** One raw row's fields this check reads, or undefined for a row that is not a message object. */
function rowOf({
  raw,
}: {
  raw: unknown;
}):
  | { readonly ts: string; readonly user: string | undefined; readonly isBot: boolean; readonly text: string }
  | undefined {
  if (!isRecord(raw) || typeof raw["ts"] !== "string") {
    return undefined;
  }
  const user = typeof raw["user"] === "string" && raw["user"].length > 0 ? raw["user"] : undefined;
  const isBot = raw["bot_id"] !== undefined || raw["subtype"] === "bot_message";
  const text = typeof raw["text"] === "string" ? raw["text"] : "";
  return { isBot, text, ts: raw["ts"], user };
}

/** Whether Slack ts `a` is strictly earlier than `b` — seconds, then the six-digit fraction, compared as numbers. */
function tsBefore({ a, b }: { a: string; b: string }): boolean {
  const [aSeconds, aFraction] = a.split(".");
  const [bSeconds, bFraction] = b.split(".");
  if (Number(aSeconds) !== Number(bSeconds)) {
    return Number(aSeconds) < Number(bSeconds);
  }
  return Number(aFraction) < Number(bFraction);
}

/**
 * Check a help against the thread as Slack holds it.
 *
 * @param rows every `conversations.replies` row of the request's thread, root first
 * @param request the message being helped, with the author the caller claims
 * @param selfUserId this bot's own Slack user id, off `auth.test`
 * @param admits the responder whitelist's verdict on one user id — the same gate a tag crosses
 * @returns ok when the thread proves the help may go ahead, else the first check it failed
 */
export function helpThreadVerdict({
  admits,
  request,
  rows,
  selfUserId,
}: {
  admits: (args: { userId: string }) => boolean;
  request: WitnessHelpRequest;
  rows: readonly unknown[];
  selfUserId: string;
}): Result<true, WitnessHelpError> {
  const { key } = request;
  const messages = rows.flatMap((raw) => {
    const row = rowOf({ raw });
    return row === undefined ? [] : [row];
  });
  const target = messages.find((row) => row.ts === key.messageTs);
  if (target === undefined || key.messageTs === key.threadTs) {
    return err(WitnessHelpErrors.notInThread({ key }));
  }
  const personAuthor = target.isBot ? undefined : target.user;
  if (personAuthor !== request.userId) {
    return err(WitnessHelpErrors.authorMismatch({ actual: personAuthor, claimed: request.userId, key }));
  }
  if (taggedIn({ text: target.text, userId: selfUserId })) {
    return err(WitnessHelpErrors.addressedToBot({ key }));
  }
  const askedIn = messages.some(
    (row) =>
      tsBefore({ a: row.ts, b: key.messageTs }) &&
      !row.isBot &&
      row.user !== undefined &&
      admits({ userId: row.user }) &&
      taggedIn({ text: row.text, userId: selfUserId }),
  );
  if (!askedIn) {
    return err(WitnessHelpErrors.noResponderTag({ key }));
  }
  return ok(true);
}
