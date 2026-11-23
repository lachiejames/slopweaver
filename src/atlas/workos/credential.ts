/**
 * Resolving the WorkOS API key, and saying honestly when there isn't one.
 *
 * Two routes, in precedence order, and every WorkOS atlas verb that reads CONTENT resolves through both:
 *
 * 1. `WORKOS_API_KEY` in the environment, when it is set;
 * 2. the secrets store — `$SLOPWEAVER_HOME/secrets/workos-api-key`, the file `slopweaver secrets set`
 *    writes.
 *
 * The second route is what a SCHEDULED run stands on: a recipe slot has no shell profile to export from,
 * and the Vanta atlas once went stale across scheduled runs for exactly that reason
 * (`atlas/vanta/credentialFiles.ts`).
 *
 * ## Absent is an ORDINARY state here, and it costs less than it does elsewhere
 *
 * Access to WorkOS can arrive as an identity provider's SaaS-management account record, which is evidence
 * that a login exists and mints no API key at all. So an install with no key is an expected starting
 * state. What makes this atlas different from Hive's is that the missing key costs it only the CONTENT
 * half: the route map is measured with no credential by design (`routeProbe.ts`), so a `CREDENTIAL_MISSING`
 * here leaves a filled surface standing beside a `not-configured` one rather than emptying the generation.
 */
import { readFileSync } from "node:fs";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { type WorkosApiError, WorkosApiErrors } from "./errors.js";

/** The environment variable checked before the secrets store. */
export const WORKOS_API_KEY_ENV = "WORKOS_API_KEY";

/** The secrets-store file name the key is written to. */
export const WORKOS_API_KEY_SECRET = "workos-api-key";

/**
 * Resolve the API key from the environment, else the secrets store under `home`.
 *
 * @param env the environment, consulted first
 * @param home the state home whose `secrets/` directory is the second route
 * @returns the key, or the typed reason there is none
 */
export function resolveWorkosApiKey({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<string, WorkosApiError> {
  const fromEnv = env[WORKOS_API_KEY_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return ok(fromEnv);
  }
  const path = secretFilePath({ home, name: WORKOS_API_KEY_SECRET });
  const fromFile = readKeyFile({ path });
  if (fromFile.isErr()) {
    return err(fromFile.error);
  }
  if (fromFile.value !== null) {
    return ok(fromFile.value);
  }
  return err(WorkosApiErrors.credentialMissing({ checked: [`$${WORKOS_API_KEY_ENV}`, path] }));
}

/**
 * Read the secret file, distinguishing "not there" from "there and unreadable".
 *
 * A missing file is the ordinary unconfigured state and answers `null`; anything else — a permission
 * refusal, a directory where a file should be — is a typed failure, because reporting it as "not
 * configured" would send a reader to write a key that is already written.
 *
 * @param path the resolved secret path
 * @returns the trimmed key, `null` when no file exists, or why the file could not be read
 */
function readKeyFile({ path }: { path: string }): Result<string | null, WorkosApiError> {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (value.length === 0) {
      return err(WorkosApiErrors.credentialUnreadable({ path, reason: "the file is empty" }));
    }
    return ok(value);
  } catch (error: unknown) {
    if (isNotFound({ error })) {
      return ok(null);
    }
    return err(WorkosApiErrors.credentialUnreadable({ path, reason: errorMessage({ error }) }));
  }
}

/**
 * Whether a caught filesystem error is an ordinary "no such file".
 *
 * @param error the caught value
 * @returns `true` when the file simply does not exist
 */
function isNotFound({ error }: { error: unknown }): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
