/**
 * Holding a release that sent nothing, with the reason their Queue card draws (no fleet slot,
 * a Slack token or permission, or the thread having moved is a legitimate reason not to send, and it is SURFACED,
 * never swallowed). Split out of `./sendFailureJournalling.ts`, which journals the failure for `talk
 * slack-send-outcome`; this records the hold the fold and the approved-draft gate read.
 */
import { logger } from "../../../lib/logger.js";
import type { DraftHoldReason } from "../../../outbound/slack/draftRegister.js";
import type { ReleaseFreshnessError } from "../../../outbound/slack/releaseFreshness.js";
import type { SlackWriteDeps } from "./run.js";

/**
 * The hold a pre-send re-read's refusal is recorded as. A person's change, a cleared set that no longer matches, and an
 * earlier ask answered since are all the thread having moved; a destination or identity that could not be read is Slack
 * refusing the token. A malformed watermark is the register's own defect, never one of their named reasons, so it holds
 * nothing and the approved-draft gate keeps refusing until a session names it.
 *
 * @param error the re-read's refusal
 * @returns the reason to hold with, or `undefined` when the refusal is not one their card names
 */
export function freshnessHoldReason({
  error,
}: {
  error: Pick<ReleaseFreshnessError, "code">;
}): DraftHoldReason | undefined {
  switch (error.code) {
    case "SLACK_RELEASE_THREAD_MOVED":
    case "SLACK_RELEASE_CLEARANCE_MISMATCH":
    case "SLACK_RELEASE_PRIOR_ANSWERED":
      return "thread-moved";
    case "SLACK_RELEASE_THREAD_UNREADABLE":
      return "slack-refused";
    case "SLACK_RELEASE_WATERMARK_INVALID":
      return undefined;
    default: {
      const unhandled: never = error.code;
      return unhandled;
    }
  }
}

/**
 * Hold a release the pre-send re-read refused, so their Queue card says the thread moved (or Slack would not let it be
 * read) the same tick rather than reading as a send still owed. A dry run attempted nothing and holds nothing.
 *
 * @param draftId the row the release named
 * @param dryRun whether the release attempted nothing
 * @param error the re-read's refusal
 * @param home the state home the register lives under
 */
export function holdFreshnessRefusal({
  deps,
  draftId,
  dryRun,
  error,
  home,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  draftId: string;
  dryRun: boolean;
  error: ReleaseFreshnessError;
  home: string;
}): void {
  const reason = freshnessHoldReason({ error });
  if (dryRun || reason === undefined) {
    return;
  }
  appendReleaseHold({ deps, home, id: draftId, reason, why: error.message });
}

/**
 * Append one hold on a release that did not send, or say loudly that their Queue card cannot show why.
 *
 * @param id the row the release named
 * @param reason the closed-set reason their card draws
 * @param why what refused, in the refuser's own words
 */
export function appendReleaseHold({
  deps,
  home,
  id,
  reason,
  why,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  home: string;
  id: string;
  reason: DraftHoldReason;
  why: string;
}): void {
  const appended = deps.appendDraftEvent({
    event: { id, kind: "held", reason, tsIso: new Date().toISOString(), why },
    home,
  });
  if (appended.isErr()) {
    logger.error({
      msg:
        `${appended.error.message} — draft ${id} was NOT sent (${why}) and the hold saying so could not be ` +
        `recorded, so their Queue card does not show why. Record it: slopweaver slack draft hold ${id} ` +
        `--reason ${reason} --why "<what refused it>"`,
    });
  }
}
