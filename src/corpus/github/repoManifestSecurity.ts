/**
 * The two security settings `github repo --apply-manifest` sets once a repository is public: secret scanning with
 * push protection, and private vulnerability reporting. On the write lane's context (`./writeCtx.ts`), so each
 * write is sent once. Both are read and written only on a public repository; a private one on a free plan has
 * neither, and the apply lists them as waiting rather than asking.
 *
 * A status GitHub omitted is an error, never "disabled": an absent status read as off would plan a write the
 * repository may not need, and one read as on would report a setting applied that was never read.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** Secret scanning and its push protection. */
export interface SecretScanningSettings {
  readonly secretScanning: boolean;
  readonly pushProtection: boolean;
}

/** One `security_and_analysis` status, refused by name unless it is `enabled` or `disabled`. */
function statusOf({ value, field }: { value: { status?: string } | null | undefined; field: string }): boolean {
  if (value?.status === "enabled") {
    return true;
  }
  if (value?.status === "disabled") {
    return false;
  }
  throw new Error(`GitHub's repository read gave no ${field} status, so it is unknown`);
}

/** A status as GitHub spells it. */
function statusWord({ on }: { on: boolean }): "enabled" | "disabled" {
  return on ? "enabled" : "disabled";
}

/**
 * Read secret scanning and push protection. Repeatable.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns both switches
 */
export function getSecretScanningVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<SecretScanningSettings, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const security = (await ctx.client.rest.repos.get({ owner, repo })).data.security_and_analysis;
      return {
        pushProtection: statusOf({
          field: "secret_scanning_push_protection",
          value: security?.secret_scanning_push_protection,
        }),
        secretScanning: statusOf({ field: "secret_scanning", value: security?.secret_scanning }),
      };
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Set secret scanning and push protection in one `PATCH`. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and both switches
 * @returns nothing on GitHub's acceptance
 */
export function setSecretScanningVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly settings: SecretScanningSettings };
}): ResultAsync<void, IngestError> {
  const { owner, repo, settings } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.update({
        owner,
        repo,
        security_and_analysis: {
          secret_scanning: { status: statusWord({ on: settings.secretScanning }) },
          secret_scanning_push_protection: { status: statusWord({ on: settings.pushProtection }) },
        },
      });
    },
    operation: "github.repos.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read whether private vulnerability reporting is on. Repeatable.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns true when it is on
 */
export function getPrivateVulnerabilityReportingVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<boolean, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const enabled: unknown = (await ctx.client.rest.repos.checkPrivateVulnerabilityReporting({ owner, repo })).data
        .enabled;
      if (typeof enabled !== "boolean") {
        throw new Error("GitHub's private vulnerability reporting read gave no state, so it is unknown");
      }
      return enabled;
    },
    operation: "github.repos.checkPrivateVulnerabilityReporting",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Turn private vulnerability reporting on or off. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the state it takes
 * @returns nothing on GitHub's acceptance
 */
export function setPrivateVulnerabilityReportingVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly enabled: boolean };
}): ResultAsync<void, IngestError> {
  const { owner, repo, enabled } = input;
  return safeProviderCall({
    execute: async () => {
      if (enabled) {
        await ctx.client.rest.repos.enablePrivateVulnerabilityReporting({ owner, repo });
        return;
      }
      await ctx.client.rest.repos.disablePrivateVulnerabilityReporting({ owner, repo });
    },
    operation: enabled
      ? "github.repos.enablePrivateVulnerabilityReporting"
      : "github.repos.disablePrivateVulnerabilityReporting",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
