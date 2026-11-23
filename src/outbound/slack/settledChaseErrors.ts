/**
 * The typed failures of the settled-chase hold (`./settledChase.ts`): a chase or review ask whose pull request is
 * already closed or merged, one linking a pull request GitHub says is not there, one whose pull request could not
 * be read, and one whose pull-request link names no number this reader can parse. Per `.claude/rules/error-handling.md` the union stands alone; the draft register's own failures are
 * `./draftErrors.ts`.
 */

/** The pull request the row chases is already closed or merged, so the ask moves nothing forward. */
export interface ChaseSubjectSettledError {
  readonly code: "CHASE_SUBJECT_SETTLED";
  readonly message: string;
  readonly url: string;
  /** GitHub's own word for how it ended: `CLOSED` or `MERGED`. */
  readonly state: string;
}

/** GitHub says the linked pull request does not exist, so the card would send the team to nothing. */
export interface ChaseSubjectAbsentError {
  readonly code: "CHASE_SUBJECT_ABSENT";
  readonly message: string;
  readonly url: string;
}

/** The linked pull request's state could not be read, so whether the ask is moot is unknown. */
export interface ChaseSubjectUnreadError {
  readonly code: "CHASE_SUBJECT_UNREAD";
  readonly message: string;
  readonly url: string;
}

/** A github.com pull-request link names no pull request this reader can parse, so its state was never read. */
export interface ChaseSubjectUnnamedError {
  readonly code: "CHASE_SUBJECT_UNNAMED";
  readonly message: string;
  readonly url: string;
}

/** The one place a settled-chase refusal is constructed, so a test builds what the real code builds. */
export const ChaseSubjectErrors = {
  absent: ({ act, url }: { act: string; url: string }): ChaseSubjectAbsentError => ({
    code: "CHASE_SUBJECT_ABSENT",
    message: `this ${act} links ${url}, which GitHub says does not exist, so the card would send the team to nothing — fix the link`,
    url,
  }),
  settled: ({ act, state, url }: { act: string; state: string; url: string }): ChaseSubjectSettledError => ({
    code: "CHASE_SUBJECT_SETTLED",
    message:
      `this ${act} links ${url}, which GitHub says is already ${state.toLowerCase()}: asking the team to move a ` +
      `finished pull request spends their attention for nothing. If the ask is moot, skip ` +
      `the thread and name it so in the board row; if it is about follow-on work, link that work instead`,
    state,
    url,
  }),
  unnamed: ({ act, url }: { act: string; url: string }): ChaseSubjectUnnamedError => ({
    code: "CHASE_SUBJECT_UNNAMED",
    message:
      `this ${act} links ${url}, a pull-request address whose number this check cannot read, so whether the ask ` +
      `is moot was never checked — link the pull request as https://github.com/<owner>/<repo>/pull/<number>`,
    url,
  }),
  unread: ({ act, url }: { act: string; url: string }): ChaseSubjectUnreadError => ({
    code: "CHASE_SUBJECT_UNREAD",
    message:
      `this ${act} links ${url}, whose state GitHub did not answer (no token, a rate limit or a transport ` +
      `failure), so whether the ask is moot is unknown — record it again once \`slopweaver github read ${url}\` answers`,
    url,
  }),
} as const;
