/** GitHub's code-scanning default-setup reads, enable and disable, on the one sanctioned write client. */

export type {
  DefaultSetup,
  DefaultSetupAcknowledgement,
  GithubDefaultSetupApi,
  RepoSecurityConfiguration,
} from "../../corpus/github/defaultSetup.js";
export { DEFAULT_SETUP_ENABLE_BODY, makeGithubDefaultSetupApi } from "../../corpus/github/defaultSetup.js";
