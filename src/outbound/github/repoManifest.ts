/**
 * The reads and writes `github repo --apply-manifest` needs, over the sanctioned no-SDK-retry write context.
 * Branch protection, labels and security settings change who may push and what a public repository exposes, so
 * the verb previews first and sends only on the preview's digest (`../../cli/commands/github/repoManifestRun.ts`).
 */

import {
  createRepoLabelVia,
  getRepoLabelVia,
  listRepoLabelsVia,
  type RepoLabel,
} from "../../corpus/github/repoManifestLabels.js";
import {
  type BranchProtectionSettings,
  type BranchProtectionState,
  getBranchProtectionVia,
  setBranchProtectionVia,
} from "../../corpus/github/repoManifestProtection.js";
import {
  getPrivateVulnerabilityReportingVia,
  getSecretScanningVia,
  type SecretScanningSettings,
  setPrivateVulnerabilityReportingVia,
  setSecretScanningVia,
} from "../../corpus/github/repoManifestSecurity.js";
import {
  getDependabotAlertsVia,
  getRepoManifestRepositoryVia,
  getRepoTopicsVia,
  type RepoManifestRepositoryState,
  type RepoSettingsPatch,
  replaceRepoTopicsVia,
  setDependabotAlertsVia,
  updateRepoSettingsVia,
} from "../../corpus/github/repoManifestSettings.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

export type { RepoLabel } from "../../corpus/github/repoManifestLabels.js";
export type { BranchProtectionSettings, BranchProtectionState } from "../../corpus/github/repoManifestProtection.js";
export type { SecretScanningSettings } from "../../corpus/github/repoManifestSecurity.js";
export type {
  RepoFeatureSettings,
  RepoManifestRepositoryState,
  RepoMergeSettings,
} from "../../corpus/github/repoManifestSettings.js";

/** One repository address. */
interface Address {
  owner: string;
  repo: string;
}

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRepoManifestApi {
  repository(args: Address): ResultAsync<RepoManifestRepositoryState, IngestError>;
  topics(args: Address): ResultAsync<readonly string[], IngestError>;
  labels(args: Address): ResultAsync<readonly RepoLabel[], IngestError>;
  label(args: Address & { name: string }): ResultAsync<RepoLabel | undefined, IngestError>;
  dependabotAlerts(args: Address): ResultAsync<boolean, IngestError>;
  branchProtection(args: Address & { branch: string }): ResultAsync<BranchProtectionState, IngestError>;
  secretScanning(args: Address): ResultAsync<SecretScanningSettings, IngestError>;
  privateVulnerabilityReporting(args: Address): ResultAsync<boolean, IngestError>;
  updateRepository(args: Address & { patch: RepoSettingsPatch }): ResultAsync<void, IngestError>;
  replaceTopics(args: Address & { topics: readonly string[] }): ResultAsync<void, IngestError>;
  createLabel(args: Address & { label: RepoLabel }): ResultAsync<void, IngestError>;
  setDependabotAlerts(args: Address & { enabled: boolean }): ResultAsync<void, IngestError>;
  setBranchProtection(
    args: Address & { branch: string; protection: BranchProtectionSettings },
  ): ResultAsync<void, IngestError>;
  setSecretScanning(args: Address & { settings: SecretScanningSettings }): ResultAsync<void, IngestError>;
  setPrivateVulnerabilityReporting(args: Address & { enabled: boolean }): ResultAsync<void, IngestError>;
}

/**
 * Build the production client on the write lane's context: SDK retries off, so each write is sent once.
 *
 * @param token the GitHub token
 * @param privacy the outbound privacy check every write body passes before it is sent
 * @returns the eight reads and seven writes the settings apply needs
 */
export function makeGithubRepoManifestApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubRepoManifestApi {
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    branchProtection: (input) => getBranchProtectionVia({ ctx, input }),
    createLabel: (input) => createRepoLabelVia({ ctx, input }),
    dependabotAlerts: (input) => getDependabotAlertsVia({ ctx, input }),
    label: (input) => getRepoLabelVia({ ctx, input }),
    labels: (input) => listRepoLabelsVia({ ctx, input }),
    privateVulnerabilityReporting: (input) => getPrivateVulnerabilityReportingVia({ ctx, input }),
    replaceTopics: (input) => replaceRepoTopicsVia({ ctx, input }),
    repository: (input) => getRepoManifestRepositoryVia({ ctx, input }),
    secretScanning: (input) => getSecretScanningVia({ ctx, input }),
    setBranchProtection: (input) => setBranchProtectionVia({ ctx, input }),
    setDependabotAlerts: (input) => setDependabotAlertsVia({ ctx, input }),
    setPrivateVulnerabilityReporting: (input) => setPrivateVulnerabilityReportingVia({ ctx, input }),
    setSecretScanning: (input) => setSecretScanningVia({ ctx, input }),
    topics: (input) => getRepoTopicsVia({ ctx, input }),
    updateRepository: (input) => updateRepoSettingsVia({ ctx, input }),
  };
}
