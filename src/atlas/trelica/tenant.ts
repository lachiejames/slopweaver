/**
 * Which tenant this atlas is a map OF, resolved at runtime and never written down here.
 *
 * ## The tenant host is a private identifier, so it cannot live in this repository
 *
 * This platform gives every customer its own subdomain, and that subdomain is the ORGANISATION'S OWN NAME.
 * AGENTS.md's no-private-identifiers rule forbids it here "not even split, encoded, or fragmented", so the
 * value lives in `$SLOPWEAVER_HOME/secrets/trelica-tenant-host` beside the CrowdStrike API host, which is
 * private for exactly the same reason. Nothing guesses one: an unset host is a refusal naming the file,
 * because a guessed tenant would either 404 or — worse — reach somebody else's.
 *
 * ## Two origins, and mixing them up costs an hour
 *
 * The vendor's marketing-and-login origin and the tenant's own application origin are different hosts.
 * MEASURED: a walk that addressed the login origin while signed in to the tenant landed on a
 * sign-in form and reported the whole platform signed out. So the login origin is a CONSTANT here and the
 * tenant origin is configuration, and every walk and every call addresses the second.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

import { err, ok, type Result } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { TrelicaAtlasErrors, trelicaAtlasErrorLines } from "./errors.js";

/**
 * The vendor's shared sign-in origin — a constant because it names no customer.
 *
 * It is not where an atlas reads anything: a signed-in session redirects off it to the tenant origin. It is
 * here so a walk that lands on it can SAY that it did, rather than reporting an unexplained redirect.
 *
 * @internal
 */
export const TRELICA_LOGIN_ORIGIN = "https://app.trelica.com";

/**
 * The path a tenant's OWN origin serves its sign-in form on, which a lost session lands on without leaving the tenant.
 *
 * MEASURED: signed out, the bare tenant origin settled on `<tenant>/Account/Login?ReturnUrl=%2F`, titled
 * "Log in", never touching {@link TRELICA_LOGIN_ORIGIN} — while the hand recheck, testing that origin alone, read the
 * same visit as signed in twice. Reproduce, signed out: `slopweaver browser open https://<tenant host>`.
 *
 * @internal
 */
export const TRELICA_TENANT_SIGN_IN_PATH = "/Account/Login";

/**
 * The suffix every tenant's own application origin ends in.
 *
 * The suffix names the vendor and no customer, so it is committable; the label in front of it is the
 * organisation's own name and is not. Keeping the suffix here is what lets {@link isTrelicaTenantOrigin}
 * check a host's SHAPE without this repository ever holding a real one.
 *
 * @internal
 */
export const TRELICA_TENANT_ORIGIN_SUFFIX = ".trelica.app";

/**
 * The origin the vendor's published OpenAPI documents nominate as their own server.
 *
 * Recorded because it is what makes `403` on a session cookie a FINDING rather than a mistake: the
 * published API is served from a region host that is not the tenant origin at all, and a reader needs to
 * see that the two doors are different before concluding a credential is merely missing.
 *
 * @internal
 */
export const TRELICA_PUBLISHED_API_ORIGINS = ["https://trelica.app", "https://trelica.eu"] as const;

/** The secrets-store file holding this installation's tenant host. */
const TENANT_HOST_SECRET = "trelica-tenant-host";

/** The environment variable consulted before the store, matching every other atlas's precedence. */
const TENANT_HOST_ENV = "TRELICA_TENANT_HOST";

/**
 * Whether a host has the shape of a tenant application origin.
 *
 * @param host the host to check
 * @returns whether it is a label beneath this vendor's tenant suffix
 *
 * @internal
 */
export function isTrelicaTenantHost({ host }: { host: string }): boolean {
  const lowered = host.trim().toLowerCase();
  if (!lowered.endsWith(TRELICA_TENANT_ORIGIN_SUFFIX)) {
    return false;
  }
  const label = lowered.slice(0, -TRELICA_TENANT_ORIGIN_SUFFIX.length);
  return label.length > 0 && !label.includes(".") && !label.includes("/");
}

/**
 * Whether an origin belongs to this installation's own tenant.
 *
 * Used to decide whether a captured response is first-party at all, so a walk never stores a row about the
 * analytics and error-reporting services a page also calls.
 *
 * @param origin the origin to check
 * @param tenantOrigin this installation's tenant origin
 * @returns whether the two are the same origin
 *
 * @internal
 */
export function isTrelicaTenantOrigin({ origin, tenantOrigin }: { origin: string; tenantOrigin: string }): boolean {
  return origin === tenantOrigin;
}

/**
 * Read one owner-only configuration file.
 *
 * Refuses a symlink, a non-regular file, and any mode readable by group or other — the same posture as the
 * credential readers beside it, because a tenant host is a private identifier even though it is not a
 * secret.
 *
 * @param path the resolved path
 * @returns the trimmed value, or why it could not be read
 */
function readHostFile({ path }: { path: string }): Result<string> {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if ((stats.mode & 0o077) !== 0) {
      return err(trelicaAtlasErrorLines({ error: TrelicaAtlasErrors.hostFileLoose({ path }) }));
    }
    const value = readFileSync(descriptor, "utf8").trim();
    return value.length === 0
      ? err(trelicaAtlasErrorLines({ error: TrelicaAtlasErrors.hostFileEmpty({ path }) }))
      : ok(value);
  } catch (error: unknown) {
    return err(trelicaAtlasErrorLines({ error: TrelicaAtlasErrors.hostFileUnreadable({ cause: error, path }) }));
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

/**
 * Resolve this installation's tenant origin — the environment first, then the secrets store.
 *
 * @param home the state home whose `secrets/` directory holds it
 * @param env the environment to consult; injected so this stays testable without a process-wide mutation
 * @returns the absolute tenant origin, or why there is none to use
 */
export function resolveTrelicaTenantOrigin({
  home,
  env = process.env,
}: {
  home: string;
  env?: NodeJS.ProcessEnv;
}): Result<string> {
  const path = secretFilePath({ home, name: TENANT_HOST_SECRET });
  const fromEnv = env[TENANT_HOST_ENV]?.trim();
  const host = fromEnv !== undefined && fromEnv.length > 0 ? ok(fromEnv) : readHostFile({ path });
  if (host.isErr()) {
    return err(
      trelicaAtlasErrorLines({
        error: TrelicaAtlasErrors.tenantHostUnset({ problems: host.error, secretName: TENANT_HOST_SECRET }),
      }),
    );
  }
  const value = host.value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!isTrelicaTenantHost({ host: value })) {
    return err(
      trelicaAtlasErrorLines({
        error: TrelicaAtlasErrors.tenantHostMalformed({
          secretName: TENANT_HOST_SECRET,
          suffix: TRELICA_TENANT_ORIGIN_SUFFIX,
        }),
      }),
    );
  }
  return ok(`https://${value.toLowerCase()}`);
}
