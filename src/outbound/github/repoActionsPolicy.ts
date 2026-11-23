/**
 * The reads and writes `github repo --enable-actions` needs, over the sanctioned no-SDK-retry write context. Turning
 * Actions on spends hosted runner minutes and, on a public repository, lets outside code reach a runner, so the verb
 * previews first and sends only on the preview's digest (`../../cli/commands/github/repoActionsPolicyRun.ts`).
 */

import { getRepoActionsVia, type RepoActionsState } from "../../corpus/github/repoActions.js";
import {
  countSelfHostedRunnersVia,
  type ForkApprovalPolicy,
  getForkApprovalPolicyVia,
  getSelectedActionsVia,
  getWorkflowTokenPolicyVia,
  type SelectedActionsPolicy,
  setForkApprovalForAllOutsidersVia,
  setGithubOwnedActionsOnlyVia,
  setReadOnlyWorkflowTokenVia,
  setRepoActionsEnabledVia,
  type WorkflowTokenPolicy,
} from "../../corpus/github/repoActionsPolicy.js";
import { getRepoLifecycleVia, type RepoLifecycleState } from "../../corpus/github/repoLifecycle.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type {
  ForkApprovalPolicy,
  SelectedActionsPolicy,
  WorkflowTokenPolicy,
} from "../../corpus/github/repoActionsPolicy.js";

/** One repository address. */
interface Address {
  owner: string;
  repo: string;
}

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRepoActionsPolicyApi {
  repository(args: Address): ResultAsync<RepoLifecycleState, IngestError>;
  actions(args: Address): ResultAsync<RepoActionsState, IngestError>;
  selectedActions(args: Address): ResultAsync<SelectedActionsPolicy, IngestError>;
  workflowToken(args: Address): ResultAsync<WorkflowTokenPolicy, IngestError>;
  forkApproval(args: Address): ResultAsync<ForkApprovalPolicy, IngestError>;
  selfHostedRunners(args: Address): ResultAsync<number, IngestError>;
  /** `allowedActions` sends `allowed_actions` in the same request; left out, the mode is not sent. */
  setActionsEnabled(args: Address & { enabled: boolean; allowedActions?: "selected" }): ResultAsync<void, IngestError>;
  setGithubOwnedActionsOnly(args: Address): ResultAsync<void, IngestError>;
  setReadOnlyWorkflowToken(args: Address): ResultAsync<void, IngestError>;
  setForkApprovalForAllOutsiders(args: Address): ResultAsync<void, IngestError>;
}

/**
 * Build the production client on the write lane's context: SDK retries off, so each write is sent once.
 *
 * @param privacy the outbound privacy check every write is judged by before it is sent
 * @param token the GitHub token
 * @returns the six reads and four writes the Actions policy needs
 */
export function makeGithubRepoActionsPolicyApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubRepoActionsPolicyApi {
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    actions: (input) => getRepoActionsVia({ ctx, input }),
    forkApproval: (input) => getForkApprovalPolicyVia({ ctx, input }),
    repository: (input) => getRepoLifecycleVia({ ctx, input }),
    selectedActions: (input) => getSelectedActionsVia({ ctx, input }),
    selfHostedRunners: (input) => countSelfHostedRunnersVia({ ctx, input }),
    setActionsEnabled: (input) => setRepoActionsEnabledVia({ ctx, input }),
    setForkApprovalForAllOutsiders: (input) => setForkApprovalForAllOutsidersVia({ ctx, input }),
    setGithubOwnedActionsOnly: (input) => setGithubOwnedActionsOnlyVia({ ctx, input }),
    setReadOnlyWorkflowToken: (input) => setReadOnlyWorkflowTokenVia({ ctx, input }),
    workflowToken: (input) => getWorkflowTokenPolicyVia({ ctx, input }),
  };
}
