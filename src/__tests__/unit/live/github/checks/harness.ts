/**
 * The fixtures every live checks test file shares: the pull request identity a parse is read for, the GraphQL
 * payload one head commit's status-check rollup arrives in, and a checks snapshot with every field defaulted.
 * Pure data; nothing here touches a disk or a provider.
 */
import type { GithubChecksSnapshot } from "../../../../../live/github/checks.js";
import type { GithubCheck, SupersededGithubCheck } from "../../../../../live/github/checksDedupe.js";

/** The pull request every parse in these files is read for. */
export const IDENTITY = "acme/widget#9";

/**
 * The GraphQL payload of one pull request whose head commit `abc123` carries a status-check rollup.
 *
 * @param hasNextPage whether GitHub reports more contexts past this page
 * @returns the raw `data` a checks read hands the parser
 */
export function rollupData({
  state = "PENDING",
  contexts = [],
  hasNextPage = false,
}: {
  state?: string;
  contexts?: readonly unknown[];
  hasNextPage?: boolean;
}): unknown {
  return {
    repository: {
      pullRequest: {
        commits: {
          nodes: [
            {
              commit: {
                oid: "abc123",
                statusCheckRollup: {
                  contexts: { nodes: contexts, pageInfo: { hasNextPage } },
                  state,
                },
              },
            },
          ],
        },
      },
    },
  };
}

/**
 * A checks snapshot with just the fields `formatChecksLine` reads, everything else defaulted.
 *
 * @returns a snapshot on head `abc123` carrying the given checks
 */
export function checksSnapshot({
  checks = [],
  rollupState = "PENDING",
  supersededChecks = [],
  truncated = false,
}: {
  checks?: readonly GithubCheck[];
  rollupState?: string;
  supersededChecks?: readonly SupersededGithubCheck[];
  truncated?: boolean;
} = {}): GithubChecksSnapshot {
  return {
    baseRef: undefined,
    checks,
    headSha: "abc123",
    mergeable: undefined,
    residue: [],
    rollupState,
    supersededChecks,
    truncated,
  };
}
