/**
 * Read the CrowdStrike credential triple from owner-only files, and never from an argument.
 *
 * The owner-only read itself is `lib/ownerOnlyFile.ts` — one posture in one place rather than a copy per
 * atlas, because a copy that relaxed its mode check would look exactly like the ones that had not.
 *
 * Three routes in precedence order, matching `atlas/vanta/credentialFiles.ts`: explicit file paths, then
 * the environment, then the secrets store. The third is what a SCHEDULED sync stands on — a recipe slot has
 * no shell profile to export from, and a verb that read only the environment would exit "not configured" on
 * every run until a human exported the values by hand.
 *
 * ## Three files rather than the usual two
 *
 * Falcon's API host is region-specific, and the wrong region fails the token call as a 401 that reads
 * exactly like a bad secret — an hour spent chasing the wrong thing. Storing the host beside the pair makes
 * the region a fact the install carries rather than a guess the code makes.
 *
 * The values are read and returned; they are never logged, never interpolated into an error, and never
 * printed. A refusal names the FILE, never its contents.
 */
import { existsSync } from "node:fs";

import { readOwnerOnlyFile } from "../../lib/ownerOnlyFile.js";
import { err, ok, type Result, unwrap } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "./atlasErrors.js";

/** The three values every CrowdStrike call needs. */
export interface CrowdstrikeCredentials {
  readonly apiHost: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Secret-store names, matching the allowlist in `secrets/names.ts`. */
const HOST_SECRET = "crowdstrike-api-host";
const CLIENT_ID_SECRET = "crowdstrike-client-id";
const CLIENT_SECRET_SECRET = "crowdstrike-client-secret";
const SECRET_NAMES = [HOST_SECRET, CLIENT_ID_SECRET, CLIENT_SECRET_SECRET] as const;

/** Environment variables consulted before the store. */
const HOST_ENV = "CROWDSTRIKE_API_HOST";
const CLIENT_ID_ENV = "CROWDSTRIKE_CLIENT_ID";
const CLIENT_SECRET_ENV = "CROWDSTRIKE_CLIENT_SECRET";

/** Is this string present and not just whitespace? */
function isPresent({ raw }: { raw: string | undefined }): boolean {
  return raw !== undefined && raw.trim() !== "";
}

/**
 * Normalise the stored API host into an origin.
 *
 * The owner may reasonably store `api.us-2.crowdstrike.com` or the full URL; both must resolve to the same
 * origin, and a trailing slash must not produce a double slash in every path this atlas builds.
 *
 * @param raw the stored host value
 * @returns the normalised `https://…` origin, or why it is unusable
 */
export function normaliseCrowdstrikeHost({ raw }: { raw: string }): Result<string> {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.hostEmpty() }));
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.hostNotUrl({ host: trimmed }) }));
  }
  if (parsed.protocol !== "https:") {
    return err(
      crowdstrikeAtlasErrorLines({
        error: CrowdstrikeAtlasErrors.hostNotHttps({ protocol: parsed.protocol.replace(":", "") }),
      }),
    );
  }
  return ok(parsed.origin);
}

/**
 * Resolve the credential triple from the environment, else the secrets store.
 *
 * A half-set environment is reported as an environment problem rather than silently overridden by the
 * store, and a half-populated store names the missing file rather than the variables that are not exported.
 *
 * @param env the environment, consulted first when any variable is set
 * @param home the state home whose `secrets/` directory is the fallback
 * @returns the credentials, or every reason they could not be resolved
 */
export function resolveCrowdstrikeCredentials({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<CrowdstrikeCredentials> {
  const fromEnv = [env[HOST_ENV], env[CLIENT_ID_ENV], env[CLIENT_SECRET_ENV]];
  if (fromEnv.some((raw) => isPresent({ raw }))) {
    const missing = [HOST_ENV, CLIENT_ID_ENV, CLIENT_SECRET_ENV].filter((name) => !isPresent({ raw: env[name] }));
    if (missing.length > 0) {
      return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.envPartial({ missing }) }));
    }
    // Every one was just proven present by the `missing` check above, so the assertions are honest.
    return buildCredentials({
      apiHost: env[HOST_ENV]!,
      clientId: env[CLIENT_ID_ENV]!,
      clientSecret: env[CLIENT_SECRET_ENV]!,
    });
  }

  const files = [
    { label: `secrets/${HOST_SECRET}`, name: HOST_SECRET },
    { label: `secrets/${CLIENT_ID_SECRET}`, name: CLIENT_ID_SECRET },
    { label: `secrets/${CLIENT_SECRET_SECRET}`, name: CLIENT_SECRET_SECRET },
  ].map((entry) => ({ ...entry, path: secretFilePath({ home, name: entry.name }) }));

  const absent = files.filter((entry) => !existsSync(entry.path));
  if (absent.length === files.length) {
    return err(
      crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.credentialsAbsent({ secretNames: SECRET_NAMES }) }),
    );
  }
  if (absent.length > 0) {
    return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.storePartial({ absent }) }));
  }

  const read = files.map((entry) => readOwnerOnlyFile({ label: entry.label, path: entry.path }));
  const problems = read.flatMap((result) => (result.isErr() ? [result.error.message] : []));
  if (problems.length > 0) {
    return err(problems);
  }
  // Every read succeeded — `problems` is empty — and the three entries are in the order they were built.
  const [host, id, secret] = read.map((result) => unwrap(result));
  return buildCredentials({ apiHost: host!, clientId: id!, clientSecret: secret! });
}

/** Normalise the host and assemble the triple. */
function buildCredentials({
  apiHost,
  clientId,
  clientSecret,
}: {
  apiHost: string;
  clientId: string;
  clientSecret: string;
}): Result<CrowdstrikeCredentials> {
  const host = normaliseCrowdstrikeHost({ raw: apiHost });
  if (host.isErr()) {
    return err(host.error);
  }
  return ok({ apiHost: host.value, clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}
