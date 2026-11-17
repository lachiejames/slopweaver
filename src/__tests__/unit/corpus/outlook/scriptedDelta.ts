/**
 * A scripted delta seam over the fake mailbox: plain data, no mock. Each request is keyed by what it asked
 * for (`first:<folderId>` for an initial round, else the link itself) and answered from that key's list in
 * order, so the same key can answer differently the second time, as an expired link then a fresh round does.
 * Every key asked is recorded, so a test asserts the exact order a round walked. Every value is synthetic.
 */
import { err, type Result } from "#lib/result.js";
import type { MessageDeltaPage, OutlookApi, PageStart } from "../../../../live/outlook/apiCore.js";
import { type OutlookError, OutlookErrors } from "../../../../live/outlook/errors.js";
import type { GraphDeltaMessage } from "../../../../live/outlook/graphWire.js";
import { type FakeMailbox, fakeMailbox, fakeOutlookApi, wireMessage } from "../../../fakeOutlookMailbox.js";

/** One scripted answer to a delta request. */
export type DeltaAnswer = Result<MessageDeltaPage, OutlookError>;

/**
 * A synthetic link on Graph's own host, as a real round hands back.
 *
 * @returns the link, the same spelling the fake mailbox's own delta arm answers with
 */
export function linkTo({ name }: { name: string }): string {
  return `https://graph.microsoft.com/v1.0/fake-delta/${name}`;
}

/**
 * The key a request is scripted under.
 *
 * @returns `first:<folderId>` for an initial round, else the link
 */
function deltaKey({ start }: { start: PageStart<{ readonly folderId: string }> }): string {
  if ("first" in start) {
    return `first:${start.first.folderId}`;
  }
  return start.link;
}

/**
 * A tombstone: a message removed from, or moved out of, the folder being read.
 *
 * @returns the delta item carrying `@removed`
 */
export function tombstone({ id }: { id: string }): GraphDeltaMessage {
  return { ...wireMessage({ id }), "@removed": { reason: "deleted" } };
}

/**
 * The fake mailbox's seam with `messageDelta` answered from a script.
 *
 * @param answers each key's answers, in the order they are given
 * @param mailbox the mailbox every other method reads; a fresh one when omitted
 * @returns the seam, and every key it was asked, in order
 */
export function scriptedDeltaApi({
  answers,
  mailbox = fakeMailbox(),
}: {
  answers: Readonly<Record<string, readonly DeltaAnswer[]>>;
  mailbox?: FakeMailbox;
}): { api: OutlookApi; asked: string[] } {
  const asked: string[] = [];
  const api: OutlookApi = {
    ...fakeOutlookApi({ mailbox }),
    messageDelta: async ({ start }) => {
      const key = deltaKey({ start });
      // How many times this key was asked before now is which of its answers this request gets.
      const index = asked.filter((earlier) => earlier === key).length;
      asked.push(key);
      const answer = answers[key]?.[index];
      if (answer === undefined) {
        return err(OutlookErrors.apiFailed({ message: `unscripted delta request: ${key}` }));
      }
      return answer;
    },
  };
  return { api, asked };
}
