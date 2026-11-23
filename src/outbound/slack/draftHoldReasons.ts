/*
 * The closed set of reasons a held draft carrying the owner's words is not sent. A leaf with no imports, so the console's
 * mirror test (`site/__tests__/unit/draftHoldReasonsMirror.test.ts`) can bind its copy without the site build
 * resolving the register's dependencies.
 */

/** The hold reason for a draft the owner has not said yes to. */
export const NOT_OWNER_YES_REASON = "not-owner-yes" as const;

/**
 * Why a held row carrying the owner's words is not being sent now — `slack draft hold <id> --reason <code>`, or a
 * release Slack refused. A closed set, so the Queue card can say it and the tick gate can count it as a judgement
 * (`../../supervisor/approvedDraftGate.ts`). The first code and `meaning-changed` set an approval down; the other
 * three keep it, a row approved but blocked.
 */
export const DRAFT_HOLD_REASONS = [
  NOT_OWNER_YES_REASON,
  "meaning-changed",
  "thread-moved",
  "no-fleet-slot",
  "slack-refused",
] as const;

/** One of {@link DRAFT_HOLD_REASONS}. */
export type DraftHoldReason = (typeof DRAFT_HOLD_REASONS)[number];
