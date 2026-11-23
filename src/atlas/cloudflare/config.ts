/**
 * Pure resolution of the Cloudflare atlas's two required runtime selectors — which account, and which one
 * zone gets deep reads. Neither is a credential: `cloudflareToken()` (`src/config.ts`) still resolves the
 * Bearer token separately. Selecting an account or zone by array position, or committing either as a
 * default, is exactly what this atlas must never do — see `model.ts`'s header on why `selection` exists.
 *
 * This module validates FORMAT only. Whether the configured account/zone actually exist and are reachable
 * is a live question the SDK-backed sync path answers, not this pure resolver.
 */
import { err, ok, type Result } from "../../lib/result.js";

/** The env var names checked for the account id, in precedence order after the flag. */
const CLOUDFLARE_ACCOUNT_ID_ENV_NAMES = ["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"] as const;

/** The env var name checked for the deep zone, after the flag. */
const CLOUDFLARE_DEEP_ZONE_ENV = "CLOUDFLARE_DEEP_ZONE";

/** A Cloudflare account id is a 32-character lowercase hex string. */
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;

/** The validated, format-checked selection input — not yet verified live. */
export interface CloudflareSelectionInput {
  readonly accountId: string;
  readonly deepZoneName: string;
}

/**
 * Resolve one nonblank value from a flag, then a list of env vars, in precedence order.
 *
 * @param flag the explicit flag value, if given
 * @param envNames the env var names to try next, in order
 * @param env the environment to read
 * @returns the first nonblank, trimmed value found, or `undefined`
 */
function firstNonblank({
  flag,
  envNames,
  env,
}: {
  flag: string | undefined;
  envNames: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (flag !== undefined && flag.trim().length > 0) {
    return flag.trim();
  }
  for (const name of envNames) {
    const value = env[name];
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Resolve and validate the Cloudflare account id and deep zone name, or say precisely what is missing or
 * malformed. EVERY problem is reported, not just the first.
 *
 * @param env the environment to read — passed in, never reached for, so this stays pure
 * @returns the validated selection input, or every reason it could not be resolved
 */
export function resolveCloudflareSelection({
  accountIdFlag,
  deepZoneFlag,
  env,
}: {
  accountIdFlag?: string;
  deepZoneFlag?: string;
  env: Readonly<Record<string, string | undefined>>;
}): Result<CloudflareSelectionInput> {
  const errors: string[] = [];

  const rawAccountId = firstNonblank({ env, envNames: CLOUDFLARE_ACCOUNT_ID_ENV_NAMES, flag: accountIdFlag });
  let accountId: string | undefined;
  if (rawAccountId === undefined) {
    errors.push("no Cloudflare account id configured — pass --account-id, or set CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID");
  } else {
    const normalised = rawAccountId.toLowerCase();
    if (!ACCOUNT_ID_PATTERN.test(normalised)) {
      errors.push(`--account-id/CLOUDFLARE_ACCOUNT_ID must be a 32-character hex id, got: ${rawAccountId}`);
    } else {
      accountId = normalised;
    }
  }

  const rawDeepZone = firstNonblank({ env, envNames: [CLOUDFLARE_DEEP_ZONE_ENV], flag: deepZoneFlag });
  if (rawDeepZone === undefined) {
    errors.push(`no Cloudflare deep zone configured — pass --deep-zone, or set ${CLOUDFLARE_DEEP_ZONE_ENV}`);
  }

  if (accountId === undefined || rawDeepZone === undefined) {
    return err(errors);
  }
  return ok({ accountId, deepZoneName: rawDeepZone.toLowerCase() });
}
