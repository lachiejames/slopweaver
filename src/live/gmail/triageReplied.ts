/**
 * Whether the last word in a thread is the owner's REPLY — the one triage rule about a THREAD rather than a sender.
 *
 * An install that declares the `last-reply` structural rule (`./triageRules.ts`) archives mail whose thread's last
 * reply is the owner's; one that does not cards it like any other mail. Nobody is waiting on the owner in such a
 * thread: if the other side writes again, that new message is the thread's newest, the rule stops holding, and the
 * mail is carded as usual. Pure: `./triageRead.ts` fetches the threads.
 *
 * The owner's newest message must be a reply, not merely theirs. Two of the owner's own messages are not one: a
 * FORWARD (a `Fwd:` or `Fw:` subject) passes the thread to someone else while its sender may still be waiting on the
 * owner, and a message the owner sent to themselves sits in their INBOX as well as SENT, a reminder kept on purpose.
 * Both leave the thread carded. A snoozed thread that comes back with the owner's reply newest is not distinguishable
 * here, and is archived: the owner's ruling covers it, and archived mail stays searchable.
 */
import { type GmailMessage, getHeader } from "./parse.js";

/** A forward's subject prefix, in the spellings mail clients write. */
const FORWARD_SUBJECT = /^\s*(?:fwd?|fw)\s*:/iu;

/**
 * Whether a thread's newest message is a reply the owner sent. Answers false whenever order cannot be read — a member
 * with no numeric `internalDate`, or two members tied for newest — because the rule archives, and a guess is not the
 * owner's word.
 * A draft carries `DRAFT`, never `SENT`, so an unsent reply never counts.
 *
 * @param thread every message in the thread, as a `metadata` thread fetch returned them
 * @returns true only when the newest message carries `SENT`, does not also sit in the INBOX, and is not a forward
 */
export function lastMessageIsOwners({ thread }: { thread: readonly GmailMessage[] }): boolean {
  const dated = thread.map((message) => ({ at: Number(message.internalDate), message }));
  if (dated.length === 0 || dated.some(({ at }) => !Number.isFinite(at) || at <= 0)) {
    return false;
  }
  const newestAt = Math.max(...dated.map(({ at }) => at));
  const newest = dated.filter(({ at }) => at === newestAt);
  if (newest.length !== 1) {
    return false;
  }
  const { message } = newest[0]!;
  const sent = message.labelIds?.includes("SENT") === true;
  const keptInInbox = message.labelIds?.includes("INBOX") === true;
  const subject = getHeader({ headers: message.payload?.headers, name: "Subject" });
  const forwarded = subject !== undefined && FORWARD_SUBJECT.test(subject);
  return sent && !keptInInbox && !forwarded;
}
