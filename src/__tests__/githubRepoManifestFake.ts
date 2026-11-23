/**
 * A plain fake for the `github repo --apply-manifest` client: one repository's settings in memory, answering reads
 * from its own state and applying each write to it, recording every read and write. No mock library.
 *
 * It answers the way a free personal plan does: on a repository that is not public, the protection read is a 403
 * carrying GitHub's plan sentence and the two security reads fail too, so a run that reads them there is caught.
 */
import { errAsync, okAsync } from "neverthrow";

import type { IngestError } from "../lib/ingestError.js";
import type { ResultAsync } from "../lib/result.js";
import type { BranchProtectionState, GithubRepoManifestApi } from "../outbound/github/repoManifest.js";
import type { ManifestWorld } from "./githubRepoManifestWorld.js";

/** A provider failure carrying an HTTP status and a message, as the boundary produces one. */
function httpError({
  status,
  message,
  operation,
}: {
  status: number;
  message: string;
  operation: string;
}): IngestError {
  return { kind: "http", message, operation, provider: "github", status };
}

/** GitHub's own sentence for a feature a private free-plan repository lacks. */
const PLAN_SENTENCE = "Upgrade to GitHub Pro or make this repository public to enable this feature.";

/** Record one write and apply it as the world says. */
function write({
  world,
  step,
  apply,
}: {
  world: ManifestWorld;
  step: string;
  apply: () => void;
}): ResultAsync<void, IngestError> {
  world.sent.push(step);
  if (world.afterSend?.step === step) {
    world.afterSend.change({ world });
  }
  if (world.gone === true) {
    return errAsync(httpError({ message: "HTTP 404", operation: `github.fake.${step}`, status: 404 }));
  }
  if (world.refused === step) {
    return errAsync(httpError({ message: "HTTP 422", operation: `github.fake.${step}`, status: 422 }));
  }
  if (world.appliedButErrored === step) {
    apply();
    return errAsync(httpError({ message: "HTTP 502", operation: `github.fake.${step}`, status: 502 }));
  }
  if (world.ignored !== step) {
    apply();
  }
  return okAsync(undefined);
}

/** Record one read once its answer is taken, then let another actor change the world as the world says. */
function answered<T>({ world, what, answer }: { world: ManifestWorld; what: string; answer: T }): T {
  world.reads.push(what);
  if (world.afterRead?.read === what) {
    world.afterRead.change({ world });
  }
  return answer;
}

/** A read the free plan refuses on a repository that is not public, or that the world refuses outright. */
function publicOnlyRead<T>({
  world,
  what,
  value,
}: {
  world: ManifestWorld;
  what: string;
  value: () => T;
}): ResultAsync<T, IngestError> {
  if (world.repository.visibility !== "public") {
    const refusal = httpError({ message: PLAN_SENTENCE, operation: `github.fake.${what}`, status: 403 });
    return errAsync(answered({ answer: refusal, what, world }));
  }
  if (world.refusedRead === what) {
    const refusal = httpError({ message: "Resource not accessible", operation: `github.fake.${what}`, status: 403 });
    return errAsync(answered({ answer: refusal, what, world }));
  }
  return okAsync(answered({ answer: value(), what, world }));
}

/** The client's write methods, which each send through `write`. */
type ManifestWrites = Pick<
  GithubRepoManifestApi,
  | "createLabel"
  | "replaceTopics"
  | "setBranchProtection"
  | "setDependabotAlerts"
  | "setPrivateVulnerabilityReporting"
  | "setSecretScanning"
  | "updateRepository"
>;

/** The client's read methods: every method that is not a write. */
type ManifestReads = Omit<GithubRepoManifestApi, keyof ManifestWrites>;

/** The protection GitHub stores for a protection write: the fields sent, and every field the write clears. */
function storedProtection({
  protection,
}: {
  protection: Parameters<GithubRepoManifestApi["setBranchProtection"]>[0]["protection"];
}): BranchProtectionState {
  return {
    allowDeletions: protection.allowDeletions,
    allowForcePushes: protection.allowForcePushes,
    allowForkSyncing: false,
    enforceAdmins: protection.enforceAdmins,
    kind: "protected",
    lockBranch: false,
    pushRestrictions: null,
    requiredConversationResolution: protection.requiredConversationResolution,
    requiredLinearHistory: protection.requiredLinearHistory,
    requiredStatusChecks: {
      contexts: [...protection.requiredStatusChecks.contexts],
      strict: protection.requiredStatusChecks.strict,
    },
    requiresPullRequestReviews: false,
  };
}

/** One repository patch, recorded under the step it carries and applied to the repository's own fields. */
function updateRepository({
  world,
  patch,
}: {
  world: ManifestWorld;
  patch: Parameters<GithubRepoManifestApi["updateRepository"]>[0]["patch"];
}): ResultAsync<void, IngestError> {
  const { features, merge } = patch;
  let step = "merge-settings";
  if ("description" in patch) {
    step = "description";
  } else if (features !== undefined) {
    step = "features";
  }
  return write({
    apply: () => {
      world.repository = {
        ...world.repository,
        ...("description" in patch ? { description: patch.description } : {}),
        ...(features === undefined ? {} : { features }),
        ...(merge === undefined ? {} : { merge }),
      };
    },
    step,
    world,
  });
}

/** The fake's writes, each recorded and applied as the world says. */
function manifestWrites({ world }: { world: ManifestWorld }): ManifestWrites {
  return {
    createLabel: ({ label }) =>
      write({
        apply: () => {
          world.labels.push(label);
        },
        step: `label-create:${label.name}`,
        world,
      }),
    replaceTopics: ({ topics }) =>
      write({
        apply: () => {
          world.topics = [...topics];
        },
        step: "topics",
        world,
      }),
    setBranchProtection: ({ protection }) =>
      write({
        apply: () => {
          world.protection = storedProtection({ protection });
        },
        step: "branch-protection-main",
        world,
      }),
    setDependabotAlerts: ({ enabled }) =>
      write({
        apply: () => {
          world.dependabotAlerts = enabled;
        },
        step: "dependabot-alerts",
        world,
      }),
    setPrivateVulnerabilityReporting: ({ enabled }) =>
      write({
        apply: () => {
          world.privateVulnerabilityReporting = enabled;
        },
        step: "private-vulnerability-reporting",
        world,
      }),
    setSecretScanning: ({ settings }) =>
      write({
        apply: () => {
          world.secretScanning = { ...settings };
        },
        step: "secret-scanning",
        world,
      }),
    updateRepository: ({ patch }) => updateRepository({ patch, world }),
  };
}

/** The fake's reads, each recorded and answered from the world's own state. */
function manifestReads({ world }: { world: ManifestWorld }): ManifestReads {
  return {
    branchProtection: () => publicOnlyRead({ value: () => world.protection, what: "branch-protection", world }),
    dependabotAlerts: () =>
      okAsync(
        answered({ answer: world.gone === true ? false : world.dependabotAlerts, what: "dependabot-alerts", world }),
      ),
    label: ({ name }) => {
      const answer = world.labels.find((label) => label.name.toLowerCase() === name.toLowerCase());
      return okAsync(answered({ answer, what: `label:${name}`, world }));
    },
    labels: () => okAsync(answered({ answer: [...world.labels], what: "labels", world })),
    privateVulnerabilityReporting: () =>
      publicOnlyRead({
        value: () => world.privateVulnerabilityReporting,
        what: "private-vulnerability-reporting",
        world,
      }),
    repository: () => {
      if (world.gone === true) {
        const gone = httpError({ message: "HTTP 404", operation: "github.fake.repository", status: 404 });
        return errAsync(answered({ answer: gone, what: "repository", world }));
      }
      return okAsync(answered({ answer: world.repository, what: "repository", world }));
    },
    secretScanning: () => publicOnlyRead({ value: () => world.secretScanning, what: "secret-scanning", world }),
    topics: () => okAsync(answered({ answer: [...world.topics], what: "topics", world })),
  };
}

/**
 * A settings client over one repository.
 *
 * @param world the settings the fake reads and writes
 * @returns the client
 */
export function manifestFake({ world }: { world: ManifestWorld }): GithubRepoManifestApi {
  return { ...manifestReads({ world }), ...manifestWrites({ world }) };
}
