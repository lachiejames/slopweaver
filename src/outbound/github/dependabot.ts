/** GitHub's Dependabot alert list and single read, adapted from the one sanctioned write client. */

import type {
  DependabotAlert,
  DependabotAlertPage,
  DependabotAlertState,
  DependabotSeverity,
} from "../../corpus/github/dependabot.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type { DependabotAlert, DependabotAlertState, DependabotSeverity } from "../../corpus/github/dependabot.js";
export { DEPENDABOT_ALERT_STATES, DEPENDABOT_SEVERITIES } from "../../corpus/github/dependabot.js";

/** Injectable read surface; tests provide plain fakes. */
export interface GithubDependabotApi {
  list(args: {
    owner: string;
    repo: string;
    state: DependabotAlertState | undefined;
    severity: DependabotSeverity | undefined;
  }): ResultAsync<DependabotAlertPage, IngestError>;
  get(args: { owner: string; repo: string; alertNumber: number }): ResultAsync<DependabotAlert, IngestError>;
}

/**
 * Build the production no-SDK-retry read client.
 *
 * @param token the GitHub token
 * @returns the alert list and single read
 */
export function makeGithubDependabotApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubDependabotApi {
  const api = makeGithubWriteApi({ privacy, token });
  return {
    get: ({ owner, repo, alertNumber }) => api.dependabotAlert({ alertNumber, owner, repo }),
    list: ({ owner, repo, state, severity }) =>
      api.dependabotAlerts({
        owner,
        repo,
        ...(severity === undefined ? {} : { severity }),
        ...(state === undefined ? {} : { state }),
      }),
  };
}
