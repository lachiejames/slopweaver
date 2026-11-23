/**
 * Resolving the GraphQL Hive access token, and saying honestly when there isn't one.
 *
 * Two routes, in precedence order, and every Hive atlas verb resolves through both:
 *
 * 1. `HIVE_ACCESS_TOKEN` in the environment, when it is set;
 * 2. the secrets store — `$SLOPWEAVER_HOME/secrets/graphql-hive-token`, the file `slopweaver secrets set`
 *    writes.
 *
 * The second route is what a SCHEDULED run stands on: a recipe slot has no shell profile to export from,
 * and the Vanta atlas went stale for exactly that reason (`atlas/vanta/credentialFiles.ts`).
 *
 * ## Absent is an ORDINARY state here, not an error
 *
 * Access to Hive through an SSO assignment signs a browser in and mints no API token at all. So an install
 * with no token is an expected starting state, and this module's job is to return a typed
 * `CREDENTIAL_MISSING` naming every place it looked rather than to throw — `sync.ts` turns that into a
 * `not-configured` coverage cell carrying the exact steps that would fill it, and still exits 0.
 */
import { readFileSync } from "node:fs";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { type HiveApiError, HiveApiErrors } from "./errors.js";

/** The environment variable checked before the secrets store. */
export const HIVE_TOKEN_ENV = "HIVE_ACCESS_TOKEN";

/** The secrets-store file name the token is written to. */
export const HIVE_TOKEN_SECRET = "graphql-hive-token";

/**
 * Resolve the access token from the environment, else the secrets store under `home`.
 *
 * @param env the environment, consulted first
 * @param home the state home whose `secrets/` directory is the second route
 * @returns the token, or the typed reason there is none
 */
export function resolveHiveToken({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<string, HiveApiError> {
  const fromEnv = env[HIVE_TOKEN_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return ok(fromEnv);
  }
  const path = secretFilePath({ home, name: HIVE_TOKEN_SECRET });
  const fromFile = readTokenFile({ path });
  if (fromFile.isErr()) {
    return err(fromFile.error);
  }
  if (fromFile.value !== null) {
    return ok(fromFile.value);
  }
  return err(HiveApiErrors.credentialMissing({ checked: [`$${HIVE_TOKEN_ENV}`, path] }));
}

/**
 * Read the secret file, distinguishing "not there" from "there and unreadable".
 *
 * A missing file is the ordinary unconfigured state and answers `null`; anything else — a permission
 * refusal, a directory where a file should be — is a typed failure, because reporting it as "not
 * configured" would send a reader to write a token that is already written.
 *
 * @param path the resolved secret path
 * @returns the trimmed token, `null` when no file exists, or why the file could not be read
 */
function readTokenFile({ path }: { path: string }): Result<string | null, HiveApiError> {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (value.length === 0) {
      return err(HiveApiErrors.credentialUnreadable({ path, reason: "the file is empty" }));
    }
    return ok(value);
  } catch (error: unknown) {
    if (isNotFound({ error })) {
      return ok(null);
    }
    return err(HiveApiErrors.credentialUnreadable({ path, reason: errorMessage({ error }) }));
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
