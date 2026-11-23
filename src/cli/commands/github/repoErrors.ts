/**
 * The repository-administration half of {@link GithubVerbErrors}: a rename, transfer or archive GitHub accepted
 * whose read-back does not show the repository where the write put it. Composed into the one factory by
 * `./errors.ts`; import that, not this.
 *
 * None of these messages advises sending the write again. Each write is irreversible, and a transfer in
 * particular completes asynchronously — the next act is a read of the named address, never a second send.
 */
import type { GithubWriteUnconfirmedError } from "./errors.js";

/** The factory methods for repository administration read-backs, composed into `GithubVerbErrors`. */
export const githubRepoErrorFactories = {
  repoArchiveUnconfirmed: ({ fullName }: { fullName: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message: `GitHub accepted archiving ${fullName} but the read-back does not show the same repository archived`,
    subject: fullName,
  }),
  repoRenameUnconfirmed: ({ source, target }: { source: string; target: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `GitHub accepted renaming ${source} to ${target} but the read-back of ${target} is not the same repository ` +
      "under that name; read both addresses before anything else, and do not send the rename again",
    subject: target,
  }),
  repoTransferUnconfirmed: ({
    source,
    target,
    attempts,
  }: {
    source: string;
    target: string;
    attempts: number;
  }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `GitHub accepted transferring ${source} to ${target}, but ${String(attempts)} reads of ${target} did not ` +
      "find the same repository there. A transfer completes asynchronously and may still be in progress, or may " +
      "be waiting on the receiving owner to accept it; read the destination later, and do not send the " +
      "transfer again",
    subject: target,
  }),
} as const;
