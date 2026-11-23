/**
 * The send half of `github repo --apply-manifest`: send a planned apply's steps one at a time, each confirmed by its
 * own read before the next is sent. Planning and the preview live in `./repoManifestRun.ts`.
 *
 * Nothing is rolled back, exactly as `./repoActionsPolicyRun.ts` does not: undoing a step that landed would be a
 * second write nobody approved. A step whose send errors is read back once, since GitHub may have applied it
 * anyway, and the run continues only when that read shows it landed. A stop names every section confirmed and the
 * sections still waiting for the repository to be public, and the next act is a fresh preview.
 */

import { formatIngestError, type IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result, type ResultAsync } from "../../../lib/result.js";
import type { GithubRepoManifestApi } from "../../../outbound/github/repoManifest.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import type { ApprovedWriteOutcome } from "./repoApprovedWrite.js";
import {
  descriptionMatches,
  labelMatches,
  MANIFEST_PROTECTED_BRANCH,
  manifestStepLabel,
  PUBLIC_ONLY_SECTIONS,
  protectionMatches,
  type RepoManifestStep,
  settingsMatch,
  topicsMatch,
} from "./repoManifestPlan.js";

/** One repository address. */
interface Address {
  readonly owner: string;
  readonly repo: string;
}

/** Send one step once. */
function sendStep({
  api,
  address,
  step,
}: {
  api: GithubRepoManifestApi;
  address: Address;
  step: RepoManifestStep;
}): ResultAsync<void, IngestError> {
  switch (step.kind) {
    case "description":
      return api.updateRepository({ ...address, patch: { description: step.description } });
    case "topics":
      return api.replaceTopics({ ...address, topics: step.topics });
    case "features":
      return api.updateRepository({ ...address, patch: { features: step.features } });
    case "merge-settings":
      return api.updateRepository({ ...address, patch: { merge: step.merge } });
    case "label-create":
      return api.createLabel({ ...address, label: step.label });
    case "dependabot-alerts":
      return api.setDependabotAlerts({ ...address, enabled: step.enabled });
    case "branch-protection-main":
      return api.setBranchProtection({ ...address, branch: MANIFEST_PROTECTED_BRANCH, protection: step.protection });
    case "secret-scanning":
      return api.setSecretScanning({ ...address, settings: step.settings });
    case "private-vulnerability-reporting":
      return api.setPrivateVulnerabilityReporting({ ...address, enabled: step.enabled });
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

/** Whether a read-back shows the step landed, or the read's own failure. */
async function stepHolds({
  api,
  address,
  step,
}: {
  api: GithubRepoManifestApi;
  address: Address;
  step: RepoManifestStep;
}): Promise<Result<boolean, IngestError>> {
  switch (step.kind) {
    case "description":
      return (await api.repository(address)).map((read) =>
        descriptionMatches({ desired: step.description, live: read.description }),
      );
    case "features":
      return (await api.repository(address)).map((read) =>
        settingsMatch({ desired: step.features, live: read.features }),
      );
    case "merge-settings":
      return (await api.repository(address)).map((read) => settingsMatch({ desired: step.merge, live: read.merge }));
    case "topics":
      return (await api.topics(address)).map((live) => topicsMatch({ desired: step.topics, live }));
    case "label-create":
      return (await api.label({ ...address, name: step.label.name })).map(
        (live) => live !== undefined && labelMatches({ desired: step.label, live }),
      );
    case "dependabot-alerts":
      return (await api.dependabotAlerts(address)).map((live) => live === step.enabled);
    case "branch-protection-main":
      return (await api.branchProtection({ ...address, branch: MANIFEST_PROTECTED_BRANCH })).map((live) =>
        protectionMatches({ desired: step.protection, live }),
      );
    case "secret-scanning":
      return (await api.secretScanning(address)).map(
        (live) =>
          live.secretScanning === step.settings.secretScanning && live.pushProtection === step.settings.pushProtection,
      );
    case "private-vulnerability-reporting":
      return (await api.privateVulnerabilityReporting(address)).map((live) => live === step.enabled);
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

/**
 * What changed about the repository since the plan read it: gone, a different repository at the address, or, for
 * a public-only step, no longer public. Empty when it is still the one planned. Asked before each send, so a
 * public-only setting is never sent to a repository made private mid-run, and after each read-back, so a 404 a
 * read maps to a state ("alerts off", "unprotected") is never taken as confirmation once the repository is gone.
 */
async function repositoryDrift({
  api,
  address,
  id,
  publicOnly,
}: {
  api: GithubRepoManifestApi;
  address: Address;
  id: number;
  publicOnly: boolean;
}): Promise<readonly string[]> {
  const read = await api.repository(address);
  if (read.isErr()) {
    return [`the repository could not be read: ${formatIngestError({ error: read.error })}`];
  }
  if (read.value.id !== id) {
    return [`${address.owner}/${address.repo} is now repository id ${read.value.id}, not the planned ${id}`];
  }
  if (publicOnly && read.value.visibility !== "public") {
    return [`the repository is ${read.value.visibility} now, so its public-only settings were not sent`];
  }
  return [];
}

/**
 * Whether one sent step is confirmed, and when it is not, why, each in GitHub's or the read's own words. A read-back
 * that answered and showed the step did not land is unconfirmed with no cause: every call answered.
 */
interface StepConfirmation {
  readonly confirmed: boolean;
  readonly causes: readonly string[];
}

/** Judge one sent step from its send, its read-back and the repository's drift after that read. */
function judgeStep({
  step,
  sent,
  read,
  after,
}: {
  step: RepoManifestStep;
  sent: Result<void, IngestError>;
  read: Result<boolean, IngestError>;
  after: readonly string[];
}): StepConfirmation {
  const readMatched = read.isOk() && read.value;
  if (readMatched && after.length === 0) {
    return { causes: [], confirmed: true };
  }
  const causes: string[] = [];
  if (sent.isErr()) {
    causes.push(`send: ${formatIngestError({ error: sent.error })}`);
  }
  if (read.isErr()) {
    causes.push(`read-back: ${formatIngestError({ error: read.error })}`);
  }
  if (readMatched) {
    // Its own read matched, but only a repository still at the address makes that read evidence.
    causes.push(`read-back: "${manifestStepLabel({ step })}" read as sent, unconfirmed until the repository re-reads`);
  }
  causes.push(...after.map((cause) => `after read-back: ${cause}`));
  return { causes, confirmed: false };
}

/** Send one step and confirm it landed on the repository planned; a drift before the send sends nothing. */
async function sendAndConfirm({
  api,
  address,
  id,
  step,
}: {
  api: GithubRepoManifestApi;
  address: Address;
  id: number;
  step: RepoManifestStep;
}): Promise<StepConfirmation> {
  const publicOnly = PUBLIC_ONLY_SECTIONS.some((section) => section === step.kind);
  const before = await repositoryDrift({ address, api, id, publicOnly });
  if (before.length > 0) {
    return { causes: before.map((cause) => `before send: ${cause}`), confirmed: false };
  }
  const sent = await sendStep({ address, api, step });
  const read = await stepHolds({ address, api, step });
  const after = await repositoryDrift({ address, api, id, publicOnly: false });
  return judgeStep({ after, read, sent, step });
}

/**
 * Apply every step in order, confirming each before the next is sent, and stop at the first that is not confirmed.
 *
 * @param api the settings client
 * @param address the repository the steps are sent to
 * @param fullName the repository's name as the plan read it, for the outcome and a stop
 * @param id the repository id the plan read, which every send and read-back must still find at the address
 * @param steps the planned steps, in send order
 * @param waiting the public-only sections left for a second pass, named in the outcome and a stop
 * @returns the confirmed outcome, or the stop naming what landed
 */
export async function applyRepoManifestSteps({
  api,
  address,
  fullName,
  id,
  steps,
  waiting,
}: {
  api: GithubRepoManifestApi;
  address: Address;
  fullName: string;
  id: number;
  steps: readonly RepoManifestStep[];
  waiting: readonly string[];
}): Promise<GithubVerbResult<ApprovedWriteOutcome>> {
  const landed: string[] = [];
  for (const step of steps) {
    const { confirmed, causes } = await sendAndConfirm({ address, api, id, step });
    if (!confirmed) {
      const failedStep = manifestStepLabel({ step });
      return err(GithubVerbErrors.repoManifestIncomplete({ causes, failedStep, fullName, landed, waiting }));
    }
    landed.push(manifestStepLabel({ step }));
  }
  const rest = waiting.length === 0 ? "" : `; still waiting for public: ${waiting.join(", ")}`;
  return ok({ fields: { landed, waiting }, line: `the settings manifest is applied to ${fullName}${rest}` });
}
