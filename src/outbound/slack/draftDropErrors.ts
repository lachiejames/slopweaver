/**
 * The typed refusals of a DROP that would end the owner's yes: retiring a row carrying it onto a re-cut that lacks it,
 * or onto nothing at all — or one whose change of meaning waits on the owner's word onto a re-cut carrying neither.
 * Its own union beside `./draftErrors.ts` because only the drop path raises or branches on it
 * (`./draftApproval.ts`'s `dropShedsApproval`); per `.claude/rules/error-handling.md` nothing here is shared.
 */

/**
 * Retiring a row carrying the owner's yes would leave it on a held re-cut carrying neither that yes nor a declared
 * change of meaning. Says nothing about whether the drop landed: a verb refusing before its append and one reading back
 * after it each say which (`./draftApproval.ts`'s `dropShedsApproval`).
 */
export interface DraftDropShedsApprovalError {
  readonly code: "DRAFT_DROP_SHEDS_APPROVAL";
  readonly message: string;
  /** The row carrying the owner's yes. */
  readonly dropped: string;
  /** The held re-cut that stands without it. */
  readonly recut: string;
}

/**
 * Dropping a row would spend the owner's yes, or their unjudged words on its card, with nothing sent and no reason in
 * front of them: the note names no cut that stands and no permalink where it went (`./draftApproval.ts`'s
 * `dropLeadsTo`).
 */
export interface DraftDropSpendsYesError {
  readonly code: "DRAFT_DROP_SPENDS_YES";
  readonly message: string;
  /** The row the drop would spend. */
  readonly dropped: string;
  /** The cut the note named that the register does not record as this row's message, when it named one. */
  readonly unlinked?: string | undefined;
}

/**
 * Retiring a row whose meaning changed and waits on the owner's word would leave it on a held re-cut carrying neither
 * that change nor their yes, so the reason leaves their Queue card unanswered (`./draftApproval.ts`'s
 * `dropShedsApproval`).
 */
export interface DraftDropShedsChangeError {
  readonly code: "DRAFT_DROP_SHEDS_CHANGE";
  readonly message: string;
  /** The row whose change waits on the owner. */
  readonly dropped: string;
  /** The held re-cut that stands without it. */
  readonly recut: string;
}

/** Every way a drop can end the owner's yes, or a change waiting on their word. */
export type DraftDropError = DraftDropShedsApprovalError | DraftDropShedsChangeError | DraftDropSpendsYesError;

/** The one place a {@link DraftDropError} is constructed, so a test builds what the real code builds. */
export const DraftDropErrors = {
  dropShedsApproval: ({ dropped, recut }: { dropped: string; recut: string }): DraftDropShedsApprovalError => ({
    code: "DRAFT_DROP_SHEDS_APPROVAL",
    dropped,
    message:
      `${dropped} carries the owner's yes and its drop note names ${recut} as its re-cut, which carries neither that ` +
      `yes nor a --meaning-changed. Approve ${recut} (\`slopweaver slack draft approve ${recut} --anchor "<anchor of ` +
      `the owner's yes>"\`) or hold it (\`slopweaver slack draft hold ${recut} --reason not-owner-yes --why "<why>"\`)`,
    recut,
  }),
  dropShedsChange: ({ dropped, recut }: { dropped: string; recut: string }): DraftDropShedsChangeError => ({
    code: "DRAFT_DROP_SHEDS_CHANGE",
    dropped,
    message:
      `${dropped}'s meaning changed and waits on the owner's word, and its drop note names ${recut} as its re-cut, ` +
      `which carries neither that change nor the owner's yes. Hold it with the change ` +
      `(\`slopweaver slack draft hold ${recut} --reason meaning-changed --why "<what changed>"\`) or, once the ` +
      `owner's word on it lands, approve it (\`slopweaver slack draft approve ${recut} --anchor "<anchor of the ` +
      `owner's yes>"\`)`,
    recut,
  }),
  dropSpendsYes: ({
    dropped,
    unlinked,
  }: {
    dropped: string;
    unlinked?: string | undefined;
  }): DraftDropSpendsYesError => ({
    code: "DRAFT_DROP_SPENDS_YES",
    dropped,
    message:
      `${dropped} carries the owner's yes, and the drop note names neither a cut that stands nor where it was sent ` +
      '(`--note "sent <permalink>[, <permalink>…]"`, each in its own channel after it was parked), so the yes would ' +
      "end unsent with no reason in front of the owner. " +
      unlinkedClause({ dropped, unlinked }) +
      "A send blocked on something real is a " +
      `hold the owner's Queue card shows: \`slopweaver slack draft hold ${dropped} --reason <thread-moved|no-fleet-slot|` +
      `slack-refused> --why "<what blocks it>"\`. Once a newer word from the owner on its card says not to send it, ` +
      `\`slopweaver slack draft hold ${dropped} --reason not-owner-yes --why "<what the owner said>"\` sets the yes down ` +
      "and the drop goes through",
    unlinked,
  }),
} as const;

/** Why the cut a drop note named does not stand for the row, when it named one; empty otherwise. */
function unlinkedClause({ dropped, unlinked }: { dropped: string; unlinked: string | undefined }): string {
  if (unlinked === undefined) {
    return "";
  }
  return (
    `The note names ${unlinked}, but nothing on record makes it ${dropped}'s message: it was not recorded with ` +
    `--supersedes ${dropped}, carries no yes inherited from it, and its words differ. A re-cut of ${dropped} is ` +
    `recorded with \`--supersedes ${dropped}\`, which carries the owner's yes and drops ${dropped} in the same act. `
  );
}
