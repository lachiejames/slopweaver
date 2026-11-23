/**
 * What a `gmail read` REPORTS about the messages it read, beyond the messages themselves: which thread it was
 * of, and the residue lines that say what the read did not establish.
 *
 * Split from `./read.ts`, which drives the read and assembles the document, so each statement here is tested
 * directly on a list of parsed messages rather than only through a fake mailbox. Pure.
 */
import type { ParsedGmailMessage } from "./parse.js";

/**
 * The thread id a read reports. A retained message always carries the `threadId` parsing REQUIRED of it, so
 * the first one names the thread. A read that retained no message has no parsed thread id at all — every
 * message it was answered with lacked an id or a thread id — and the address the caller asked for is then the
 * only statement of which thread was read; the read's own residue says how many messages went unshown.
 *
 * @param messages the messages the read retained, in the order Gmail returned them
 * @param address the message or thread id the caller asked for
 * @returns the first retained message's own thread id, or the requested address when none was retained
 */
export function readThreadId({
  messages,
  address,
}: {
  messages: readonly ParsedGmailMessage[];
  address: string;
}): string {
  const [first] = messages;
  if (first === undefined) {
    return address;
  }
  return first.threadId;
}

/**
 * The residue lines a message or thread read always owes its reader.
 *
 * @param messages the messages the read retained
 * @returns one line per thing the read did not establish — metadata-only attachments, HTML-flattened bodies,
 *   messages with no readable body — and none when there is nothing to say
 */
export function messageResidue({ messages }: { messages: readonly ParsedGmailMessage[] }): readonly string[] {
  const residue: string[] = [];
  const attachments = messages.reduce((total, message) => total + message.attachments.length, 0);
  if (attachments > 0) {
    residue.push(
      `${String(attachments)} attachment(s) reported by name, media type and size only — no bytes were downloaded`,
    );
  }
  const htmlOnly = messages.filter((message) => message.bodyFormat === "html").length;
  if (htmlOnly > 0) {
    residue.push(`${String(htmlOnly)} message(s) had no plain-text alternative, so their body was flattened from HTML`);
  }
  const empty = messages.filter((message) => message.bodyFormat === "none").length;
  if (empty > 0) {
    residue.push(`${String(empty)} message(s) carried no readable text body at all`);
  }
  return residue;
}
