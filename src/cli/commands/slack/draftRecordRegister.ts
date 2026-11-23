/**
 * What the as-me draft register refuses before `slack draft record` reads Slack, under either identity. Split out
 * of `./draftRecordRun.ts` because both recorders, `--as me` there and `--as bot` in `./draftRecordBotRun.ts`, ask it.
 */
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { sameThreadRefusal } from "../../../outbound/slack/draftSameThread.js";
import { supersedeRefusal } from "../../../outbound/slack/draftSpent.js";
import { followupOfRefusals } from "../../../outbound/slack/sharedFindings.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { NOTHING_PARKED } from "./draftMedia.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * Why the register refuses this recording — under either identity — before any Slack read: a `--followup-of` naming
 * no shared finding, aimed off its thread, or spending a card already spent (`../../../outbound/slack/sharedFindings.ts`);
 * a re-cut naming a row already spent; or a reply into a thread that already holds one under the same identity and is
 * not named by `--supersedes` (`../../../outbound/slack/draftSameThread.ts`). One register read serves all three.
 *
 * @param deps the injected world, for the register read
 * @param options the parsed record, naming its thread and the rows it re-cuts
 * @returns the refusal lines, or nothing when the register lets it park
 */
export function registerRefusals({
  deps,
  options,
}: {
  deps: Pick<SlackDraftDeps, "readLog">;
  options: DraftRecordOptions;
}): readonly string[] {
  const { actor, channel, followupOf, supersedes, threadTs } = options;
  if (supersedes.length === 0 && threadTs === undefined && followupOf === undefined) {
    return [];
  }
  const log = parseSlackDraftLog({ lines: deps.readLog({ home: options.home }) });
  const items = foldSlackDraftLog({ log });
  // Asked again under the lock by `./draftPark.ts`; asked here too so a spent card costs no Slack read.
  const followup = followupOfRefusals({ draft: options, events: log.events, skipped: log.skipped, supersedes });
  if (followup.length > 0) {
    return [...followup, NOTHING_PARKED];
  }
  const spent = supersedes.flatMap((id) => {
    const refusal = supersedeRefusal({ id, items });
    return refusal === undefined ? [] : [refusal];
  });
  if (spent.length > 0) {
    return spent;
  }
  const sameThread = sameThreadRefusal({ actor, channel, items, supersedes, threadTs });
  if (sameThread.length > 0) {
    return [...sameThread, NOTHING_PARKED];
  }
  return [];
}
