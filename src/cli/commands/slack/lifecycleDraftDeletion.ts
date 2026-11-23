/**
 * The one place both `slack delete` lanes journal a confirmed deletion into the draft register, so they cannot drift in
 * what they report. The delete already happened by the time this runs, so a journal failure is reported and never
 * changes the verb's exit: re-running `slack delete` on the same message retries it, the bot lane through its
 * `TARGET_ABSENT` arm.
 */
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";

/**
 * Journal that `channel`/`ts` is gone on every draft row released there, and say what it did.
 *
 * @param deps the journal seam, the clock it stamps with, and the stdout line it reports on
 * @param home the state home whose register is written
 * @param channel the deleted message's channel
 * @param ts the deleted message's own Slack `ts`
 */
export function journalDeletedDraft({
  deps,
  home,
  channel,
  ts,
}: {
  deps: Pick<LifecycleDeps, "journalDraftDeletion" | "nowIso" | "out">;
  home: string;
  channel: string;
  ts: string;
}): void {
  const unrecorded = ({ why }: { why: string }): void => {
    logger.error({
      msg:
        `${channel}/${ts} is gone, but the draft register could not record it (${why}) — a finding ` +
        "released there may still read as owed its follow-up; re-run slack delete on it to retry",
    });
  };
  // A THROW is caught too, a lock release that cannot remove its file included: Slack already confirmed the delete,
  // so nothing here may turn its exit into an uncaught failure.
  let journalled: ReturnType<LifecycleDeps["journalDraftDeletion"]>;
  try {
    journalled = deps.journalDraftDeletion({ channel, home, nowIso: deps.nowIso(), ts });
  } catch (thrown) {
    unrecorded({ why: errorMessage({ error: thrown }) });
    return;
  }
  if (journalled.isErr()) {
    unrecorded({ why: journalled.error.message });
    return;
  }
  if (journalled.value.length > 0) {
    deps.out(`draft register: recorded deleted on ${journalled.value.join(", ")}`);
  }
}
