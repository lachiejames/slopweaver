/**
 * Every way `fleet landed` fails to read main's history — one union for this one domain, per
 * `.claude/rules/error-handling.md`.
 */

/** The ref asked for, or every default, does not resolve to main in this checkout. */
export interface LandedRefUnresolvedError {
  readonly code: "REF_UNRESOLVED";
  readonly message: string;
  readonly ref: string;
}

/** A git read failed outright. */
export interface LandedGitFailedError {
  readonly code: "GIT_FAILED";
  readonly message: string;
  readonly command: string;
}

/** A git read was still running at its bound and was killed, so nothing it would have said is known. */
export interface LandedGitTimedOutError {
  readonly code: "GIT_TIMED_OUT";
  readonly message: string;
  readonly command: string;
}

/** `git log` printed a line that is not the shape it was asked for, so the history is not read around it. */
export interface LandedGitLineMalformedError {
  readonly code: "GIT_LINE_MALFORMED";
  readonly message: string;
  readonly line: string;
}

/** The checkout's `origin` does not name a GitHub repository, so no pull request can be joined. */
export interface LandedOriginUnreadableError {
  readonly code: "ORIGIN_UNREADABLE";
  readonly message: string;
}

/** Every `fleet landed` failure. */
export type LandedError =
  | LandedRefUnresolvedError
  | LandedGitFailedError
  | LandedGitTimedOutError
  | LandedGitLineMalformedError
  | LandedOriginUnreadableError;

/** Constructors for {@link LandedError}. */
export const LandedErrors = {
  gitFailed: ({ command, cause }: { command: string; cause: unknown }): LandedGitFailedError => ({
    code: "GIT_FAILED",
    command,
    message: `git ${command} failed: ${String(cause).split("\n")[0]!}`,
  }),
  gitTimedOut: ({ command, timeoutMs }: { command: string; timeoutMs: number }): LandedGitTimedOutError => ({
    code: "GIT_TIMED_OUT",
    command,
    message: `git ${command} was still running after ${String(timeoutMs / 60_000)} minutes, so it was stopped`,
  }),
  gitLineMalformed: ({ line }: { line: string }): LandedGitLineMalformedError => ({
    code: "GIT_LINE_MALFORMED",
    line,
    message: `git log printed a line that is not <sha>\\t<iso>\\t<subject>: ${line}`,
  }),
  originUnreadable: ({ why }: { why: string }): LandedOriginUnreadableError => ({
    code: "ORIGIN_UNREADABLE",
    message: `the checkout's origin names no GitHub repository: ${why}`,
  }),
  refUnresolved: ({ ref }: { ref: string }): LandedRefUnresolvedError => ({
    code: "REF_UNRESOLVED",
    message: `${ref} does not resolve here — fetch, or pass --ref; a worktree's HEAD is never read as main`,
    ref,
  }),
} as const;
