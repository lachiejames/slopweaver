/**
 * Read the JumpCloud administrator key from owner-only files, and never from an argument.
 *
 * Two routes in precedence order, matching `atlas/crowdstrike/credentialFiles.ts` and
 * `atlas/vanta/credentialFiles.ts`: the environment, then the secrets store. The store is what a SCHEDULED
 * sync stands on — a recipe slot has no shell profile to export from, and a verb that read only the
 * environment would exit "not configured" on every run until a human exported the value by hand.
 *
 * ## One key, two hosts
 *
 * Directory Insights authenticates with the SAME administrator key as the Directory API, against a
 * different origin. A separate secret for the same key adds nothing, so there is no `jumpcloud-insights-key` and a future session must not add one.
 *
 * ## The organisation id is OPTIONAL, and that is a measured claim
 *
 * `x-org-id` is required only of a multi-tenant JumpCloud account. This tenancy is single-org, so the
 * header is TRIMMED FROM THE REQUEST rather than sent empty — an empty `x-org-id` is a header JumpCloud
 * has to interpret, and interpreting it is not something to leave to a provider. A stored id is used when
 * present because a future multi-org account would need it, and an absent one is not an error.
 *
 * The value is read and returned; it is never logged, never interpolated into an error, and never printed.
 * A refusal names the FILE, never its contents.
 */
import { existsSync } from "node:fs";

import { readOwnerOnlyFile } from "../../lib/ownerOnlyFile.js";
import { err, ok, type Result } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { JumpcloudAtlasErrors, jumpcloudAtlasErrorLines } from "./atlasErrors.js";

/**

 * What every JumpCloud call needs, and the one thing it may do without.
 * @internal
 */
export interface JumpcloudCredentials {
  /** The administrator API key, sent as `x-api-key` to both origins. */
  readonly apiKey: string;
  /** The organisation id, or `null` when this tenancy does not need one — see this file's header. */
  readonly orgId: string | null;
}

/** Secret-store names. Both are hand-written today — see the handover doc on `secrets set`. */
const API_KEY_SECRET = "jumpcloud-api-key";
const ORG_ID_SECRET = "jumpcloud-org-id";

/** Environment variables consulted before the store. */
const API_KEY_ENV = "JUMPCLOUD_API_KEY";
const ORG_ID_ENV = "JUMPCLOUD_ORG_ID";

/** Is this string present and not just whitespace? */
function isPresent({ raw }: { raw: string | undefined }): boolean {
  return raw !== undefined && raw.trim() !== "";
}

/**
 * Read the optional organisation id, treating absence as a fact rather than a failure.
 *
 * @param env the environment, consulted first
 * @param home the state home whose `secrets/` directory is the fallback
 * @returns the id, `null` when this install has none, or why a present one could not be read
 */
function resolveOrgId({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<string | null> {
  const fromEnv = env[ORG_ID_ENV];
  if (isPresent({ raw: fromEnv })) {
    // Proven present by `isPresent`, which is why the assertion is honest rather than optimistic.
    return ok(fromEnv!.trim());
  }
  const path = secretFilePath({ home, name: ORG_ID_SECRET });
  if (!existsSync(path)) {
    return ok(null);
  }
  const read = readOwnerOnlyFile({ label: `secrets/${ORG_ID_SECRET}`, path });
  return read.isErr() ? err([read.error.message]) : ok(read.value);
}

/**
 * Resolve the administrator key from the environment, else the secrets store.
 *
 * @param env the environment, consulted first when the variable is set
 * @param home the state home whose `secrets/` directory is the fallback
 * @returns the credential, or every reason it could not be resolved
 */
export function resolveJumpcloudCredentials({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<JumpcloudCredentials> {
  const orgId = resolveOrgId({ env, home });
  if (orgId.isErr()) {
    return err(orgId.error);
  }
  const fromEnv = env[API_KEY_ENV];
  if (isPresent({ raw: fromEnv })) {
    return ok({ apiKey: fromEnv!.trim(), orgId: orgId.value });
  }
  const path = secretFilePath({ home, name: API_KEY_SECRET });
  if (!existsSync(path)) {
    return err(jumpcloudAtlasErrorLines({ error: JumpcloudAtlasErrors.apiKeyAbsent({ secretName: API_KEY_SECRET }) }));
  }
  const key = readOwnerOnlyFile({ label: `secrets/${API_KEY_SECRET}`, path });
  return key.isErr() ? err([key.error.message]) : ok({ apiKey: key.value, orgId: orgId.value });
}
