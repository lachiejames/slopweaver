/**
 * Which window-notice lines — a drift from the owner's stated plan (`./driftWatch.ts`), a stray from ISO in work hours
 * (`./isoStrayWatch.ts`), a steered deliverable at risk (`./steerRiskNotice.ts`) — the voice has been told to say, for the whole server process rather than one plan call, so a
 * line whose answer the page lost is never said twice — not on a retry, and not on the fresh call a rollover made
 * before it. The same shape, and the same `globalThis` symbol reason, as `./meetingLedger.ts`. Each kind claims under
 * its own prefix ({@link driftClaimId}, {@link isoNudgeClaimId}), so two page-minted ids can never collide. A notice id
 * is minted once per notice by the page, so claims are small and a process holds few.
 */

import { ISO_STRAY_AGAIN_MS } from "./isoStrayWatch";

/** The window-notice lines claimed, by claim id, and when the newest ISO nudge was. */
export class TalkNoticeLedger {
  private readonly claimed = new Set<string>();
  private lastIsoNudgeMs: number | undefined = undefined;

  /**
   * Whether an ISO nudge claimed at this instant would follow the last one by less than {@link ISO_STRAY_AGAIN_MS}.
   * The page keeps the cadence, but a page whose watch was lost mints a fresh id the claims never saw, so the hour
   * between nudges is held here too, for the whole process.
   *
   * @param nowMs the instant a nudge would be claimed at
   * @returns true while the last one is under an hour old
   */
  isoNudgeTooSoon({ nowMs }: { nowMs: number }): boolean {
    return this.lastIsoNudgeMs !== undefined && nowMs - this.lastIsoNudgeMs < ISO_STRAY_AGAIN_MS;
  }

  /**
   * Note an ISO nudge claimed, which starts the hour {@link isoNudgeTooSoon} holds.
   *
   * @param nowMs the instant it was claimed
   */
  isoNudgeClaimedAt({ nowMs }: { nowMs: number }): void {
    this.lastIsoNudgeMs = nowMs;
  }

  /**
   * Whether a line has been claimed already.
   *
   * @param claimId the line's prefixed id, from {@link driftClaimId} or {@link isoNudgeClaimId}
   * @returns true once any call claimed it
   */
  has({ claimId }: { claimId: string }): boolean {
    return this.claimed.has(claimId);
  }

  /**
   * Claim a line before it is said: one whose write timed out may still have been spoken.
   *
   * @param claimId the line's prefixed id, from {@link driftClaimId} or {@link isoNudgeClaimId}
   */
  claim({ claimId }: { claimId: string }): void {
    this.claimed.add(claimId);
  }
}

/**
 * A drift line's claim id.
 *
 * @param noticeId the page's id for one drift
 * @returns the id the ledger holds it under
 */
export function driftClaimId({ noticeId }: { noticeId: string }): string {
  return `drift:${noticeId}`;
}

/**
 * An ISO nudge's claim id.
 *
 * @param noticeId the page's id for one nudge
 * @returns the id the ledger holds it under
 */
export function isoNudgeClaimId({ noticeId }: { noticeId: string }): string {
  return `iso-nudge:${noticeId}`;
}

/**
 * A steer-risk line's claim id. Keyed on the note's step id, which the server read, so one note is said once however
 * many pages ask.
 *
 * @param stepId the steer note's hand-step id
 * @returns the id the ledger holds it under
 */
export function steerRiskClaimId({ stepId }: { stepId: string }): string {
  return `steer-risk:${stepId}`;
}

const KEY = Symbol.for("slopweaver.talk.noticeLedger");

/**
 * The one ledger for this server process, made on first use.
 *
 * @returns the process-global ledger
 */
export function processTalkNoticeLedger(): TalkNoticeLedger {
  const holder = globalThis as typeof globalThis & { [KEY]?: TalkNoticeLedger };
  let found = holder[KEY];
  if (found === undefined) {
    found = new TalkNoticeLedger();
    holder[KEY] = found;
  }
  return found;
}
