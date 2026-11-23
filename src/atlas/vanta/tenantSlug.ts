/**
 * Resolve which Vanta workspace a citation points at.
 *
 * The slug is the organisation's own name, so it can never be a constant in this repository at all
 * (AGENTS.md, "no private identifiers"). It arrives at run time, by the three routes every other Vanta
 * value uses — `--tenant`, then `VANTA_TENANT_SLUG`, then `$SLOPWEAVER_HOME/secrets/vanta-tenant-slug`.
 *
 * Resolved SEPARATELY from the credential pair (`credentialFiles.ts`) rather than beside it, and that
 * separation is the point: the pair mints an API token and the slug addresses a web page, so a verb holding
 * one and not the other must fail on the one it is actually missing. Folding them into a single resolver
 * would make `atlas vanta controls-evidence` report "credentials not configured" when what is absent is a
 * page address it never sends anywhere.
 *
 * Unlike the credential files, this one carries no owner-only mode check. A workspace slug is a private
 * IDENTIFIER, not a credential — it authenticates nothing, and refusing to read it at mode 0644 would be
 * ceremony that teaches the mode check means less than it does where it is real.
 */
import { existsSync, readFileSync } from "node:fs";

import { err, ok, type Result } from "../../lib/result.js";
import type { SecretName } from "../../secrets/names.js";
import { secretFilePath } from "../../stateHome.js";
import { type VantaCredentialError, VantaCredentialErrors, vantaCredentialErrorLines } from "./credentialErrors.js";

/** The environment variable naming the Vanta workspace slug. */
export const VANTA_TENANT_SLUG_ENV = "VANTA_TENANT_SLUG";

/** The secrets-store file `slopweaver secrets set` writes the slug to — the no-environment route. */
const VANTA_TENANT_SLUG_SECRET: SecretName = "vanta-tenant-slug";

/** A slug is one path segment of Vanta's own URL, so anything that would change the shape of that URL is refused. */
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Grade a candidate slug, naming the route it came from so a refusal says where to fix it. */
function gradeSlug({ raw, route }: { raw: string; route: string }): Result<string, VantaCredentialError> {
  const value = raw.trim();
  if (value === "") {
    return err(VantaCredentialErrors.tenantSlugEmpty({ route }));
  }
  if (!SLUG_PATTERN.test(value)) {
    return err(VantaCredentialErrors.tenantSlugMalformed({ route }));
  }
  return ok(value);
}

/**
 * Resolve the workspace slug from the flag, else the environment, else the secrets store.
 *
 * @param flag the `--tenant` value, or `null` when it was not passed
 * @param env the environment, consulted only when no flag was passed
 * @param home the state home whose `secrets/` directory is the last route
 * @returns the slug, or every reason it could not be resolved
 */
export function resolveVantaTenantSlug({
  flag,
  env,
  home,
}: {
  flag: string | null;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<string> {
  return resolveVantaTenantSlugTyped({ env, flag, home }).mapErr((error) => vantaCredentialErrorLines({ error }));
}

/**
 * {@link resolveVantaTenantSlug}, before its typed failure becomes the lines a caller prints — for a caller
 * that decides on WHICH failure it was, as a verb's "not configured" exit does.
 *
 * @param flag the `--tenant` value, or `null` when it was not passed
 * @param env the environment, consulted only when no flag was passed
 * @param home the state home whose `secrets/` directory is the last route
 * @returns the slug, or the typed reason it could not be resolved
 */
export function resolveVantaTenantSlugTyped({
  flag,
  env,
  home,
}: {
  flag: string | null;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<string, VantaCredentialError> {
  if (flag !== null) {
    return gradeSlug({ raw: flag, route: "--tenant" });
  }
  const fromEnv = env[VANTA_TENANT_SLUG_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return gradeSlug({ raw: fromEnv, route: VANTA_TENANT_SLUG_ENV });
  }
  const path = secretFilePath({ home, name: VANTA_TENANT_SLUG_SECRET });
  if (!existsSync(path)) {
    return err(
      VantaCredentialErrors.tenantSlugUnset({ envName: VANTA_TENANT_SLUG_ENV, secretName: VANTA_TENANT_SLUG_SECRET }),
    );
  }
  try {
    return gradeSlug({ raw: readFileSync(path, "utf8"), route: `secrets/${VANTA_TENANT_SLUG_SECRET}` });
  } catch (error: unknown) {
    return err(
      VantaCredentialErrors.tenantSlugUnreadable({ cause: error, path, secretName: VANTA_TENANT_SLUG_SECRET }),
    );
  }
}
