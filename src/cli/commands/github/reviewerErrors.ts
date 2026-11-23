/**
 * Every typed refusal `slopweaver github reviewer list|pick|read|backfill` can give before it writes the
 * register, and the one factory the verb and its tests build them through. The parse that raises most of them is
 * `./reviewerArgs.ts`; `backfill`'s GitHub and bronze refusals are raised in `./reviewerBackfillRun.ts`.
 */

/** The invocation will not parse: every problem found, for the usage line to follow. */
export interface ReviewerUsageError {
  readonly code: "USAGE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** `pick` named a pull request the last reading does not hold. */
export interface ReviewerPrNotInReadingError {
  readonly code: "PR_NOT_IN_READING";
  readonly message: string;
  readonly target: string;
}

/** `pick`'s bare repository name matches more than one repository in the reading. */
export interface ReviewerPrAmbiguousError {
  readonly code: "PR_AMBIGUOUS";
  readonly message: string;
  readonly target: string;
}

/** `read`'s quote is not in the message it names — the reading would rest on words the message does not hold. */
export interface ReviewerQuoteNotInMessageError {
  readonly code: "QUOTE_NOT_IN_MESSAGE";
  readonly message: string;
  readonly permalink: string;
}

/** `read` named a message that neither links the pull request nor sits in a thread whose root does. */
export interface ReviewerMessageDoesNotLinkError {
  readonly code: "MESSAGE_DOES_NOT_LINK";
  readonly message: string;
  readonly permalink: string;
}

/** `read` could not read the message it names through the Slack door. */
export interface ReviewerMessageUnreadableError {
  readonly code: "MESSAGE_UNREADABLE";
  readonly message: string;
  readonly permalink: string;
}

/** `backfill` could not read the GitHub bronze it takes the author's pull requests from. */
export interface ReviewerBronzeUnreadableError {
  readonly code: "BRONZE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** `backfill` could not read, whole, the code-owner teams GitHub applied to one pull request. */
export interface ReviewerTeamsUnreadError {
  readonly code: "TEAMS_UNREAD";
  readonly message: string;
}

/**
 * `backfill` read one pull request's code owners and GitHub carried more requests or reviews than the query's
 * fixed page. Distinct from {@link ReviewerTeamsUnreadError} because a rerun asks for the same page and gets
 * the same answer, so it is held back rather than retried.
 */
export interface ReviewerTeamsTruncatedError {
  readonly code: "TEAMS_TRUNCATED";
  readonly message: string;
}

/** Every way `github reviewer` refuses before it writes the register. */
export type GithubReviewerError =
  | ReviewerUsageError
  | ReviewerPrNotInReadingError
  | ReviewerPrAmbiguousError
  | ReviewerQuoteNotInMessageError
  | ReviewerMessageDoesNotLinkError
  | ReviewerMessageUnreadableError
  | ReviewerBronzeUnreadableError
  | ReviewerTeamsUnreadError
  | ReviewerTeamsTruncatedError;

/** The factory the verb and its tests both build refusals through. */
export const GithubReviewerErrors = {
  ambiguous: ({ target }: { target: string }): ReviewerPrAmbiguousError => ({
    code: "PR_AMBIGUOUS",
    message: `${target} names more than one repository in the last github landing reading — pass owner/name`,
    target,
  }),
  bronzeUnreadable: ({ path, cause }: { path: string; cause: string }): ReviewerBronzeUnreadableError => ({
    code: "BRONZE_UNREADABLE",
    message: `the GitHub bronze at ${path} could not be read: ${cause}`,
    path,
  }),
  noGithubToken: (): ReviewerTeamsUnreadError => ({
    code: "TEAMS_UNREAD",
    message: "no GitHub token configured — `slopweaver secrets status` names where it is read from",
  }),
  teamsTruncated: (): ReviewerTeamsTruncatedError => ({
    code: "TEAMS_TRUNCATED",
    message:
      "GitHub returned more review requests or reviews than the fixed page carries, so a team could be missing " +
      "and a rerun reads the same page",
  }),
  teamsUnread: ({ cause }: { cause: string }): ReviewerTeamsUnreadError => ({
    code: "TEAMS_UNREAD",
    message: cause,
  }),
  doesNotLink: ({ permalink, target }: { permalink: string; target: string }): ReviewerMessageDoesNotLinkError => ({
    code: "MESSAGE_DOES_NOT_LINK",
    message: `${permalink} does not link ${target}, and neither does any message in the thread it sits in`,
    permalink,
  }),
  messageUnreadable: ({ permalink, why }: { permalink: string; why: string }): ReviewerMessageUnreadableError => ({
    code: "MESSAGE_UNREADABLE",
    message: `${permalink} could not be read: ${why}`,
    permalink,
  }),
  quoteNotInMessage: ({ permalink }: { permalink: string }): ReviewerQuoteNotInMessageError => ({
    code: "QUOTE_NOT_IN_MESSAGE",
    message: `--quote is not in ${permalink}'s text — quote the line exactly as Slack holds it, mentions as <@U…>`,
    permalink,
  }),
  notInReading: ({ target }: { target: string }): ReviewerPrNotInReadingError => ({
    code: "PR_NOT_IN_READING",
    message: `${target} is not an open pull request in the last github landing reading`,
    target,
  }),
  usage: ({ reasons }: { reasons: readonly string[] }): ReviewerUsageError => ({
    code: "USAGE",
    message: reasons.join("; "),
    reasons,
  }),
} as const;
