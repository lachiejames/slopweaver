/**
 * Why an approving `github reviewer pick` parked no ask (`./reviewerAsk.ts`). Each is a reason the pick row
 * still stands and nothing was sent; `message` is what the verb prints above that fact.
 */

/** Another approve of the same person on the same pull request holds the ask's lock. */
export interface AskLockedError {
  readonly code: "ASK_LOCKED";
  readonly message: string;
  readonly reviewer: string;
}

/** A held draft linking the pull request is a `D…` DM Slack would not say the member of. */
export interface DmUnresolvedError {
  readonly code: "DM_UNRESOLVED";
  readonly message: string;
  readonly channels: readonly string[];
}

/** `slack draft record` refused the park; its own reasons already reached stderr. */
export interface ParkRefusedError {
  readonly code: "PARK_REFUSED";
  readonly message: string;
  readonly exitCode: number;
}

/** `slack draft record` parked the ask but printed a report this verb cannot read. */
export interface ParkReportUnreadableError {
  readonly code: "PARK_REPORT_UNREADABLE";
  readonly message: string;
}

/** The store could not say who is on the identity roster, so the ask's card could not name its person. */
export interface RosterUnreadableError {
  readonly code: "ROSTER_UNREADABLE";
  readonly message: string;
}

/** Every way an approve's ask can fail to be found or parked. */
export type ReviewAskError =
  AskLockedError | DmUnresolvedError | ParkRefusedError | ParkReportUnreadableError | RosterUnreadableError;

/** The factory for {@link ReviewAskError}. */
export const ReviewAskErrors = {
  askLocked: ({ reviewer, holder }: { reviewer: string; holder: string }): AskLockedError => ({
    code: "ASK_LOCKED",
    message:
      `another approve of ${reviewer} is parking an ask to them right now (${holder}); asks to one person are one ` +
      "batch, so this press parked nothing. Once that one has parked, re-run this approve and the recorder names " +
      "the batch to write",
    reviewer,
  }),
  dmUnresolved: ({ channels }: { channels: readonly string[] }): DmUnresolvedError => ({
    channels,
    code: "DM_UNRESOLVED",
    message:
      `a held draft linking this pull request is a DM (${channels.join(", ")}) Slack would not say whose it is, ` +
      "so it may already be this ask; read it with `slopweaver slack draft list` and park by hand if it is not",
  }),
  parkRefused: ({ exitCode }: { exitCode: number }): ParkRefusedError => ({
    code: "PARK_REFUSED",
    exitCode,
    message: `slack draft record refused the ask (exit ${String(exitCode)}); its reasons are above`,
  }),
  parkReportUnreadable: ({ detail }: { detail: string }): ParkReportUnreadableError => ({
    code: "PARK_REPORT_UNREADABLE",
    message: `slack draft record parked the ask but printed a report this verb cannot read: ${detail}`,
  }),
  rosterUnreadable: ({ detail }: { detail: string }): RosterUnreadableError => ({
    code: "ROSTER_UNREADABLE",
    message: `the identity roster could not be read, so no ask was parked: ${detail}`,
  }),
} as const;
