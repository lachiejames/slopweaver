/**
 * Code-scanning DEFAULT SETUP — the repository switch that runs CodeQL with no workflow file — plus the org
 * security configuration attached to the repository, which is what can enforce that switch from above, the
 * repository's immutable identity an `enable` approval binds, and the two PATCHes that switch it on and off.
 *
 * Its own factory rather than more methods on `./write.ts`'s `GithubWriteApi`: that file is a
 * ratcheted offender (`.baselines/file-size-baseline.json`) and every full-interface test fake of it would
 * have to grow three stubs for a verb none of them exercise. Same lane, same client: `makeGithubWriteCtx`.
 */
import type { RestEndpointMethodTypes } from "@octokit/rest";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "../../outbound/github/writePrivacy.js";
import { getRepoAdministrationVia, type RepoAdministrationState } from "./repoAdministration.js";
import type { RepoRef, WriteCtx } from "./write.js";
import { makeGithubWriteCtx } from "./writeCtx.js";

type RawDefaultSetup = RestEndpointMethodTypes["codeScanning"]["getDefaultSetup"]["response"]["data"];
type RawRepoConfiguration =
  RestEndpointMethodTypes["codeSecurity"]["getConfigurationForRepository"]["response"]["data"];

/** A repository's code-scanning default setup, as GitHub reports it. A field is `undefined` when omitted. */
export interface DefaultSetup {
  readonly state: RawDefaultSetup["state"];
  readonly languages: readonly string[];
  readonly querySuite: RawDefaultSetup["query_suite"];
  readonly schedule: string | undefined;
  readonly updatedAt: string | undefined;
}

/** The org/enterprise security configuration attached to a repository — what can enforce default setup. */
export interface RepoSecurityConfiguration {
  /** The ATTACHMENT's status; `enforced` here is one of the two enforcement signals. */
  readonly status: RawRepoConfiguration["status"];
  readonly id: number | undefined;
  readonly name: string | undefined;
  readonly targetType: string | undefined;
  /** The CONFIGURATION's own enforcement; the other enforcement signal. */
  readonly enforcement: string | undefined;
  /** What the configuration itself says about default setup: `enabled`, `disabled` or `not_set`. */
  readonly codeScanningDefaultSetup: string | undefined;
  readonly htmlUrl: string | undefined;
}

/** GitHub's acknowledgement of a default-setup PATCH — 200 (applied) or 202 (queued) — never proof of the state. */
export interface DefaultSetupAcknowledgement {
  readonly status: number;
  readonly runUrl: string | undefined;
}

/**
 * The exact enable PATCH body, and the only one `enable` sends. Suite and languages are omitted on purpose:
 * GitHub then picks its defaults and analyses every CodeQL language it detects, which is what default setup
 * means — copying the disabled setup's stale language list would be a hidden configuration choice.
 */
export const DEFAULT_SETUP_ENABLE_BODY = { state: "configured" } as const;

/** The calls `github code-scanning` makes. Tests provide plain fakes. */
export interface GithubDefaultSetupApi {
  readonly defaultSetup: (input: RepoRef) => ResultAsync<DefaultSetup, IngestError>;
  /** `undefined` means GitHub answered 204: no configuration attached. A 403/404 is an error, never absence. */
  readonly securityConfiguration: (input: RepoRef) => ResultAsync<RepoSecurityConfiguration | undefined, IngestError>;
  readonly disableDefaultSetup: (input: RepoRef) => ResultAsync<DefaultSetupAcknowledgement, IngestError>;
  /** The repository's immutable id and canonical name — what an approval binds, since GitHub redirects a moved slug. */
  readonly repository: (input: RepoRef) => ResultAsync<RepoAdministrationState, IngestError>;
  readonly enableDefaultSetup: (input: RepoRef) => ResultAsync<DefaultSetupAcknowledgement, IngestError>;
}

/**
 * The default setup's run schedule. A repository whose default setup is `not-configured` runs no periodic
 * analysis, so GitHub sends `null` (or omits the field), read as `undefined`.
 */
function scheduleOf({ data }: { data: RawDefaultSetup }): string | undefined {
  if (data.schedule === null) {
    return undefined;
  }
  return data.schedule;
}

/**
 * When default setup was last changed. A repository whose default setup was never configured has no
 * configuration change to date, so GitHub sends `null` (or omits the field), read as `undefined`.
 */
function updatedAtOf({ data }: { data: RawDefaultSetup }): string | undefined {
  if (data.updated_at === null) {
    return undefined;
  }
  return data.updated_at;
}

/** Project GitHub's default-setup payload down to what the verb reports. An absent language list is none. */
function defaultSetupOf({ data }: { data: RawDefaultSetup }): DefaultSetup {
  const { languages = [] } = data;
  return {
    languages,
    querySuite: data.query_suite,
    schedule: scheduleOf({ data }),
    state: data.state,
    updatedAt: updatedAtOf({ data }),
  };
}

/** Project GitHub's repository-attachment payload down to what the enforcement decision reads. */
function configurationOf({ data }: { data: RawRepoConfiguration }): RepoSecurityConfiguration {
  return {
    codeScanningDefaultSetup: data.configuration?.code_scanning_default_setup,
    enforcement: data.configuration?.enforcement,
    htmlUrl: data.configuration?.html_url,
    id: data.configuration?.id,
    name: data.configuration?.name,
    status: data.status,
    targetType: data.configuration?.target_type,
  };
}

/**
 * Read a repository's default setup. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository to read
 * @returns the default setup as GitHub reports it, or the provider failure
 */
function defaultSetupVia({ ctx, input }: { ctx: WriteCtx; input: RepoRef }): ResultAsync<DefaultSetup, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.codeScanning.getDefaultSetup({ owner, repo });
      return defaultSetupOf({ data: res.data });
    },
    operation: "github.codeScanning.getDefaultSetup",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read the security configuration attached to a repository. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository to read
 * @returns the attachment, `undefined` on GitHub's 204 (none attached), or the provider failure
 */
function securityConfigurationVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<RepoSecurityConfiguration | undefined, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.codeSecurity.getConfigurationForRepository({ owner, repo });
      // The SDK types only the 200 body; the 204 "none attached" answer arrives with an empty body.
      const status: number = res.status;
      return status === 204 ? undefined : configurationOf({ data: res.data });
    },
    operation: "github.codeSecurity.getConfigurationForRepository",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Switch default setup off. Sent ONCE — the caller confirms the resulting state with a separate read.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository whose default setup is switched off
 * @returns GitHub's acknowledgement (status and any run URL), or the provider failure
 */
function disableDefaultSetupVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<DefaultSetupAcknowledgement, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.codeScanning.updateDefaultSetup({ owner, repo, state: "not-configured" });
      const data: { run_url?: string } = res.data;
      return { runUrl: data.run_url, status: res.status };
    },
    operation: "github.codeScanning.updateDefaultSetup",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Switch default setup on with {@link DEFAULT_SETUP_ENABLE_BODY}, the exact body the approval covered. Sent
 * ONCE — the caller confirms the resulting state with a separate read.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository whose default setup is switched on
 * @returns GitHub's acknowledgement (status and any run URL), or the provider failure
 */
function enableDefaultSetupVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<DefaultSetupAcknowledgement, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.codeScanning.updateDefaultSetup({ owner, repo, ...DEFAULT_SETUP_ENABLE_BODY });
      const data: { run_url?: string } = res.data;
      return { runUrl: data.run_url, status: res.status };
    },
    operation: "github.codeScanning.updateDefaultSetup",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Build the default-setup surface on the write lane's no-SDK-retry client.
 *
 * @param token the GitHub token
 * @param baseUrl override the API origin; omit in production
 * @param privacy the outbound privacy check's policy for the verb's home, judged on every write before it is sent
 * @returns the default-setup and configuration reads, the repository identity read, and the two mutations
 */
export function makeGithubDefaultSetupApi({
  token,
  baseUrl,
  privacy,
}: {
  token: string;
  baseUrl?: string;
  privacy: GithubWritePrivacy;
}): GithubDefaultSetupApi {
  const ctx = makeGithubWriteCtx({ privacy, token, ...(baseUrl === undefined ? {} : { baseUrl }) });
  return {
    defaultSetup: ({ owner, repo }) => defaultSetupVia({ ctx, input: { owner, repo } }),
    disableDefaultSetup: ({ owner, repo }) => disableDefaultSetupVia({ ctx, input: { owner, repo } }),
    enableDefaultSetup: ({ owner, repo }) => enableDefaultSetupVia({ ctx, input: { owner, repo } }),
    repository: ({ owner, repo }) => getRepoAdministrationVia({ ctx, input: { owner, repo } }),
    securityConfiguration: ({ owner, repo }) => securityConfigurationVia({ ctx, input: { owner, repo } }),
  };
}
