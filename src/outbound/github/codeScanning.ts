/** GitHub's code-scanning alert list/read/dismiss, adapted from the one sanctioned write client. */

import type {
  CodeScanningAlert,
  CodeScanningAlertPage,
  CodeScanningAlertState,
  CodeScanningDismissedReason,
} from "../../corpus/github/codeScanning.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type {
  CodeScanningAlert,
  CodeScanningAlertState,
  CodeScanningDismissedReason,
} from "../../corpus/github/codeScanning.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubAlertApi {
  list(args: {
    owner: string;
    repo: string;
    ref: string | undefined;
    state: CodeScanningAlertState | undefined;
  }): ResultAsync<CodeScanningAlertPage, IngestError>;
  get(args: { owner: string; repo: string; alertNumber: number }): ResultAsync<CodeScanningAlert, IngestError>;
  dismiss(args: {
    owner: string;
    repo: string;
    alertNumber: number;
    reason: CodeScanningDismissedReason;
    comment: string;
  }): ResultAsync<CodeScanningAlert, IngestError>;
}

/**
 * Build the production no-SDK-retry write client.
 *
 * @param token the GitHub token
 * @returns the alert list, single read and dismiss mutation
 */
export function makeGithubAlertApi({ privacy, token }: { privacy: GithubWritePrivacy; token: string }): GithubAlertApi {
  const api = makeGithubWriteApi({ privacy, token });
  return {
    dismiss: ({ owner, repo, alertNumber, reason, comment }) =>
      api.dismissCodeScanningAlert({ alertNumber, comment, owner, reason, repo }),
    get: ({ owner, repo, alertNumber }) => api.codeScanningAlert({ alertNumber, owner, repo }),
    list: ({ owner, repo, ref, state }) =>
      api.codeScanningAlerts({
        owner,
        repo,
        ...(ref === undefined ? {} : { ref }),
        ...(state === undefined ? {} : { state }),
      }),
  };
}
