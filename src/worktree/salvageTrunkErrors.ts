/**
 * Why a salvage declines on its history check — `./salvageTrunkHistory`'s reads of the tree's HEAD, the remote's live
 * trunk and the root commits each reaches. A git failure and a verdict are separate codes: a read that failed has not
 * shown the history is foreign, and a foreign root is not a failure to read.
 */

/** `git rev-parse HEAD` failed in the tree, or answered nothing. */
interface HeadUnreadableError {
  readonly code: "HEAD_UNREADABLE";
  readonly message: string;
}

/** The remote's live trunk could not be named, or its root commits listed — a read failure, never a verdict. */
interface TrunkUnreadableError {
  readonly code: "TRUNK_UNREADABLE";
  readonly message: string;
  readonly remote: string;
}

/** The root commits of the sha to be pushed could not be listed — a read failure, never a verdict. */
interface HistoryUnreadableError {
  readonly code: "HISTORY_UNREADABLE";
  readonly message: string;
  readonly sha: string;
}

/** The VERDICT: the sha reaches a root commit the remote's live trunk does not, so it carries another history. */
interface ForeignRootError {
  readonly code: "FOREIGN_ROOT";
  readonly message: string;
  readonly remote: string;
  readonly roots: readonly string[];
}

/** The commit to push could not be read after the capture's steps. */
interface PushShaUnreadableError {
  readonly code: "PUSH_SHA_UNREADABLE";
  readonly message: string;
}

/** The commit to push does not descend from the HEAD the check accepted, so nobody checked it. */
interface NotDescendantError {
  readonly code: "NOT_DESCENDANT";
  readonly message: string;
}

/** Why a salvage declines on the history check, before the capture or before the push. */
export type SalvageTrunkError =
  | ForeignRootError
  | HeadUnreadableError
  | HistoryUnreadableError
  | NotDescendantError
  | PushShaUnreadableError
  | TrunkUnreadableError;

/** Why git could not be asked, for a message. */
const why = ({ cause }: { cause: unknown }): string =>
  cause instanceof Error ? cause.message : "git could not be asked";

/** The one way each {@link SalvageTrunkError} is built, so its message is the decline a salvage prints. */
export const SalvageTrunkErrors = {
  foreignRoot: ({ remote, roots }: { remote: string; roots: readonly string[] }): ForeignRootError => ({
    code: "FOREIGN_ROOT",
    message: `its history reaches ${String(roots.length)} root commit(s) ${remote}'s live trunk does not, so it carries another history — nothing was pushed`,
    remote,
    roots,
  }),
  headUnreadable: ({ cause }: { cause: unknown }): HeadUnreadableError => ({
    code: "HEAD_UNREADABLE",
    message: `\`git rev-parse HEAD\` could not name its HEAD commit (${why({ cause })}), so there is nothing to push — nothing was captured`,
  }),
  historyUnreadable: ({ sha, cause }: { sha: string; cause: unknown }): HistoryUnreadableError => ({
    code: "HISTORY_UNREADABLE",
    message: `the root commits of ${sha.slice(0, 8)} could not be listed (${why({ cause })}) — nothing was pushed`,
    sha,
  }),
  notDescendant: (): NotDescendantError => ({
    code: "NOT_DESCENDANT",
    message: "the commit to push does not descend from the HEAD checked against the trunk — nothing was pushed",
  }),
  pushShaUnreadable: ({ cause }: { cause: unknown }): PushShaUnreadableError => ({
    code: "PUSH_SHA_UNREADABLE",
    message: `could not read the commit to push — ${why({ cause })}`,
  }),
  trunkUnreadable: ({ remote, cause }: { remote: string; cause: unknown }): TrunkUnreadableError => ({
    code: "TRUNK_UNREADABLE",
    message: `${remote}'s live trunk could not be read (${why({ cause })}); \`git fetch ${remote}\` and prune again — nothing was pushed`,
    remote,
  }),
} as const;
