/**
 * The push door's own refusals: a working tree that is not the commit a push would send, a head carrying proof
 * output, a commit message that may not be published, and a repository `pre-push` gate that refused. Every governed push reaches these through
 * `./githubPush.ts`'s `pushAndVerify`, so they live beside it rather than in a verb's error union.
 *
 * Each variant spells the same `code` and fields as its counterpart in `cli/commands/github/errors.ts`'s
 * `GithubVerbError`, so a verb returning one of these inside its own result needs no mapping. That is a
 * coincidence of shape kept deliberately, not a shared base type: neither union imports the other.
 */

/** A fact the push read refuses the act — a dirty working tree, or proof output in the head. */
export interface GithubPushFactRefusedError {
  readonly code: "FACT_REFUSED";
  readonly message: string;
  readonly subject: string;
}

/** A Git read the push door depends on failed, so it refuses closed. */
export interface GithubPushGitFailedError {
  readonly code: "GIT_FAILED";
  readonly message: string;
  readonly operation: string;
}

/** The repository's `pre-push` gate refused before any transport opened. */
export interface GithubPushGateFailedError {
  readonly code: "PRE_PUSH_FAILED";
  readonly message: string;
  readonly hook: string | undefined;
}

/** Every refusal the push door authors. */
export type GithubPushDoorError = GithubPushFactRefusedError | GithubPushGitFailedError | GithubPushGateFailedError;

/** The factory for {@link GithubPushDoorError}. */
export const GithubPushDoorErrors = {
  commitMessageUnpublishable: ({ refusal }: { refusal: readonly string[] }): GithubPushFactRefusedError => ({
    code: "FACT_REFUSED",
    message: refusal.join("\n"),
    subject: "commit message",
  }),
  commitMessagesUnread: ({ cause, localSha }: { cause: string; localSha: string }): GithubPushGitFailedError => ({
    code: "GIT_FAILED",
    message: `could not read the commit messages ${localSha} would publish: ${cause}; nothing was sent`,
    operation: "git log",
  }),
  proofPathCarried: ({ refusal }: { refusal: readonly string[] }): GithubPushFactRefusedError => ({
    code: "FACT_REFUSED",
    message: refusal.join("\n"),
    subject: "proof path",
  }),
  proofPathUnread: ({ cause, localSha }: { cause: string; localSha: string }): GithubPushGitFailedError => ({
    code: "GIT_FAILED",
    message: `could not list the tree of ${localSha} to check it for proof output: ${cause}; nothing was sent`,
    operation: "git ls-tree",
  }),
  pushGateRefused: ({ cause }: { cause: string }): GithubPushGateFailedError => ({
    code: "PRE_PUSH_FAILED",
    hook: undefined,
    message: `pre-push gate refused: ${cause}; nothing was sent`,
  }),
  workingTreeDirty: ({ refusal }: { refusal: readonly string[] }): GithubPushFactRefusedError => ({
    code: "FACT_REFUSED",
    message: refusal.join("\n"),
    subject: "working tree",
  }),
  workingTreeUnread: ({ cause }: { cause: string }): GithubPushGitFailedError => ({
    code: "GIT_FAILED",
    message: `could not read the working tree: ${cause}`,
    operation: "git status --porcelain",
  }),
} as const;
