/**
 * The drafts a parking seat holds, read off disk — the effectful edge of `./parkDrafts.ts`, shared by
 * `handover park` and `session close-done` so the two park verbs never copy a different set.
 */
import { readSlackDraftLinesOrError } from "../admit/slackDraftStore.js";
import { err, type Result } from "../lib/result.js";
import { parseSlackDraftLog } from "../outbound/slack/draftLog.js";
import type { RunEvent } from "./ledger.js";
import { parkedDraftsOf } from "./parkDrafts.js";
import type { ParkedDraft } from "./parkedEvent.js";

/**
 * Every unsent message the run's seat holds: its open question's drafted action and its row's held Slack drafts.
 *
 * @param home the state home holding the Slack draft register
 * @param events the run journal's events, in order
 * @param slug the run's slug, which a held draft names as its row
 * @returns the drafts, or why the register could not be read as complete
 */
export function readParkedDrafts({
  home,
  events,
  slug,
}: {
  home: string;
  events: readonly RunEvent[];
  slug: string;
}): Result<readonly ParkedDraft[]> {
  const lines = readSlackDraftLinesOrError({ home });
  if (lines.isErr()) {
    return err([`the Slack draft register could not be read — ${lines.error.message}`]);
  }
  return parkedDraftsOf({ events, log: parseSlackDraftLog({ lines: lines.value }), slug });
}
