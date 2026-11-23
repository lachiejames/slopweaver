/**
 * The effectful half of `meeting-prep-due`: read the tag ledger, ask the store whether the due meeting's page is
 * published, then judge.
 *
 * Every read is local — the ledger `page tag` appends and the local store — so a pass opens no provider connection.
 * The store is asked about ONE page, the due meeting's, and only when a meeting is due: a pass with
 * nothing due never opens it, so a store that is down cannot make a quiet hour unmeasurable. The meeting's start is
 * the one the tag recorded; `../pages/meetingTag.ts` states that residue.
 */
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../hand/consoleLink.js";
import { currentTags } from "../pages/meetingTag.js";
import { readMeetingTags } from "../pages/meetingTagStore.js";
import type { PagePublished } from "../pages/published.js";
import { consoleViewerUrl } from "../pages/url.js";

import { readHeldKeys } from "./heldKeys.js";
import { dueMeetingPrepTag, evaluateMeetingPrepDue, MEETING_PREP_DUE } from "./meetingPrepDue.js";
import type { MonitorReading } from "./types.js";

/**
 * Read and evaluate `meeting-prep-due`.
 *
 * @param home the state home the ledger, the store and the hand register live under
 * @param nowMs the instant to judge at — `--now` replays a past pass exactly
 * @param pagePublished asks the store whether a page is published — `pagePublishedInStore` in production
 * @returns the reading; a ledger, register or store that could not be read is `unmeasurable`, never `clear`
 */
export async function readMeetingPrepDue({
  home,
  nowMs,
  pagePublished,
}: {
  home: string;
  nowMs: number;
  pagePublished: PagePublished;
}): Promise<MonitorReading> {
  const read = readMeetingTags({ home });
  if (read.isErr()) {
    return { because: read.error.message, monitorId: "meeting-prep-due", state: "unmeasurable" };
  }
  const held = readHeldKeys({ definition: MEETING_PREP_DUE, home });
  if (held.isErr()) {
    // Without the card history a card the owner closed would be re-posted over their Done, so the pass answers nothing.
    return { because: held.error, monitorId: "meeting-prep-due", state: "unmeasurable" };
  }
  const tags = currentTags({ tags: read.value.tags });
  const due = dueMeetingPrepTag({ dismissed: held.value.dismissed, nowMs, tags });
  let duePublished = false;
  if (due !== undefined) {
    const published = await pagePublished({ home, slug: due.slug });
    if (published.isErr()) {
      return {
        because: `${due.slug} is tagged to a meeting starting ${due.startIso}, and the store could not say whether it is published: ${published.error.message}`,
        monitorId: "meeting-prep-due",
        state: "unmeasurable",
      };
    }
    duePublished = published.value;
  }
  return evaluateMeetingPrepDue({
    dismissed: held.value.dismissed,
    nowMs,
    // The viewer address, never the page's `file://` one: the posting form refuses a `file://` link
    // (`../hand/localFileUrl.ts`), and a page a card names opens in the desktop app's viewer. The
    // evaluator asks only for the due meeting's page, the one the store was asked about above.
    pageAddress: ({ slug }) => {
      if (slug !== due?.slug || !duePublished) {
        return undefined;
      }
      return consoleViewerUrl({ consoleBase: consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }), slug });
    },
    tags,
    unparsed: read.value.unparsed,
  });
}
