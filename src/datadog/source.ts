/**
 * Where this install's Datadog configuration comes from — the ONE effectful edge every Datadog caller reads
 * through, so `./config.ts` can stay a pure judge of a record it is handed.
 *
 * Datadog is an ordinary connector: each person mints their own two keys and stores them like every other
 * credential, and the org's site is that install's own config (everything lives inside
 * slopweaver, built so anyone at any company can install it and connect their own accounts). So:
 *
 * - **the keys** resolve through `tokenFromEnvOrHomeFile` in `../config.ts`, the one resolver every credential
 *   goes through — `DD_API_KEY`/`DD_APP_KEY` first, so a shell that exports them keeps working, then the store's
 *   `datadog-api-key` and `datadog-app-key`. The API key is the org's; the application key is personal and
 *   carries its creator's own Datadog permissions, so two colleagues' installs legitimately read different data;
 * - **the site** resolves from `DD_SITE`, then `profile.json`'s `datadog.site` — CONFIG, never a secret, and
 *   never in `secrets/`. Nothing here supplies a default: an unset site stays unset, and `resolveSite` refuses
 *   it, because a query aimed at the wrong site answers with silence rather than an error.
 *
 * Every resolver takes the same `home`, so a `--home B` run can never pair B's ledger with A's key or A's site.
 */
import { slopweaverHome, tokenFromEnvOrHomeFile } from "../config.js";
import type { Result } from "../lib/result.js";
import { loadProfile } from "../profileStore.js";
import { type DatadogConfig, resolveDatadogConfig } from "./config.js";
import type { DatadogConfigError } from "./configErrors.js";
import { datadogSiteRefusal } from "./siteGuard.js";

/** What {@link loadDatadogConfig} resolves, re-exported so a caller of this edge needs no second import. */
export type { DatadogConfig };

/** An environment record, the shape every Datadog judge in `./config.ts` and `./siteGuard.ts` reads. */
type EnvRecord = Readonly<Record<string, string | undefined>>;

/**
 * This install's Datadog site, unvalidated: `DD_SITE` when set, else `profile.json`'s `datadog.site`.
 *
 * Unvalidated on purpose — `resolveSite` is the one place a site is judged, and it names the accepted values
 * when this is wrong. A corrupt `profile.json` reads as no site, and `loadProfile` says so once on stderr.
 *
 * @param home the Slopweaver home whose `profile.json` to read (defaults to {@link slopweaverHome})
 * @param env the environment to read `DD_SITE` from (defaults to `process.env`)
 * @returns the raw site, or undefined when neither names one
 */
export function datadogSite({ home, env = process.env }: { home?: string; env?: EnvRecord } = {}): string | undefined {
  const fromEnv = env["DD_SITE"];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  if (home === undefined) {
    return datadogSite({ env, home: slopweaverHome() });
  }
  const profile = loadProfile({ home });
  if (profile === undefined) {
    return undefined;
  }
  return profile.datadog.site;
}

/**
 * The environment with ONLY `DD_SITE` filled in from this install's config — for a judge that needs the site and
 * its hatch but no key, the browser guards and the PreToolUse hook among them, so neither reads a secret file.
 *
 * @param env the environment to start from, hatches included
 * @param home the Slopweaver home whose `profile.json` to read (defaults to {@link slopweaverHome})
 * @returns `env` with `DD_SITE` resolved
 */
export function withDatadogSite({ env, home }: { env: EnvRecord; home?: string }): EnvRecord {
  return { ...env, DD_SITE: datadogSite({ env, ...(home === undefined ? {} : { home }) }) };
}

/**
 * The site guard's refusal for one address, judged against the site of the home the verb was given — what every
 * browser verb asks before it opens or navigates a page, so none of them pairs `--home B` with A's site.
 *
 * @param url the address about to be opened, absolute
 * @param command what is being refused, as the refusal's first line names it
 * @param home the Slopweaver home whose `profile.json` names the site
 * @returns the four-line refusal, or `undefined` to allow
 */
export function datadogSiteRefusalFor({
  url,
  command,
  home,
}: {
  url: string;
  command: string;
  home: string;
}): string | undefined {
  return datadogSiteRefusal({ command, env: withDatadogSite({ env: process.env, home }), url });
}

/**
 * The environment with all three Datadog values resolved for this install — each key from its environment name
 * or the secrets store, the site from `DD_SITE` or `profile.json`.
 *
 * @param home the Slopweaver home to resolve every value from (defaults to {@link slopweaverHome})
 * @param env the environment to start from (defaults to `process.env`)
 * @returns `env` with `DD_API_KEY`, `DD_APP_KEY` and `DD_SITE` resolved
 */
export function datadogEnv({ home, env = process.env }: { home?: string; env?: EnvRecord } = {}): EnvRecord {
  const scope = { env, ...(home === undefined ? {} : { home }) };
  return {
    ...env,
    DD_API_KEY: tokenFromEnvOrHomeFile({ ...scope, envNames: ["DD_API_KEY"], secretName: "datadog-api-key" }),
    DD_APP_KEY: tokenFromEnvOrHomeFile({ ...scope, envNames: ["DD_APP_KEY"], secretName: "datadog-app-key" }),
    DD_SITE: datadogSite(scope),
  };
}

/**
 * Resolve this install's Datadog configuration, or every reason it cannot be — the call every Datadog verb makes.
 *
 * @param home the Slopweaver home to resolve the keys and site from (defaults to {@link slopweaverHome})
 * @param env the environment to start from (defaults to `process.env`)
 * @returns the verified-shape configuration, or every reason one could not be built
 */
export function loadDatadogConfig({ home, env = process.env }: { home?: string; env?: EnvRecord } = {}): Result<
  DatadogConfig,
  DatadogConfigError
> {
  return resolveDatadogConfig({ env: datadogEnv({ env, ...(home === undefined ? {} : { home }) }) });
}
