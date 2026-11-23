/** GitHub's issue-label read/add, adapted from the one sanctioned write client. */

import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** One issue's or pull request's labels, as read or as GitHub confirmed storing them. */
export interface IssueLabels {
  readonly labels: readonly string[];
  readonly htmlUrl: string;
}

/** Which label names the repository itself defines, and whether the paginated read reached the end. */
export interface DefinedLabels {
  readonly names: readonly string[];
  readonly truncated: boolean;
}

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubLabelApi {
  definedLabels(args: { owner: string; repo: string }): ResultAsync<DefinedLabels, IngestError>;
  read(args: { owner: string; repo: string; number: number }): ResultAsync<IssueLabels, IngestError>;
  add(args: {
    owner: string;
    repo: string;
    number: number;
    labels: readonly string[];
  }): ResultAsync<readonly string[], IngestError>;
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the defined-label preflight, the issue read and the add mutation
 */
export function makeGithubLabelApi({ privacy, token }: { privacy: GithubWritePrivacy; token: string }): GithubLabelApi {
  const api = makeGithubWriteApi({ privacy, token });
  return {
    add: ({ owner, repo, number, labels }) => api.addIssueLabels({ labels, number, owner, repo }),
    definedLabels: ({ owner, repo }) => api.repoLabels({ owner, repo }),
    read: ({ owner, repo, number }) => api.issueLabels({ number, owner, repo }),
  };
}
