/**
 * The environment, resolved into a configuration that is safe to hand a Datadog client.
 *
 * Three values and no guesswork: `DD_API_KEY`, `DD_APP_KEY` and `DD_SITE`. This module is pure — it
 * reads a RECORD it is given, never `process.env` — so every rejection below is a unit test rather
 * than a machine it happened to run on. `./source.ts` builds that record per install: each key from its
 * environment name or the secrets store, the site from `DD_SITE` or `profile.json`'s `datadog.site`.
 *
 * ## Why `DD_SITE` is required rather than defaulted
 *
 * The SDK falls back to `datadoghq.com` (US1) when the site is unset, and Datadog sites are isolated
 * orgs: a query aimed at the wrong one does not error, it returns *nothing*, which is indistinguishable
 * from "there was no data" at every call site downstream. That is the exact failure this package exists
 * to eliminate, so an unset `DD_SITE` is a hard refusal.
 *
 * Defaulting to any one site is rejected for the same reason a default that is right on one machine is a
 * silent wrong answer on every other one — this package never picks a site on a caller's behalf.
 *
 * ## Nothing here ever renders a key
 *
 * A credential is reduced to a boolean and a length before it can reach a message — a shape plus a length
 * can between them reconstruct a short value, so no error below quotes a value or any part of one.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type DatadogConfigError, DatadogConfigErrors, datadogConfigErrorLines } from "./configErrors.js";

/**
 * The Datadog sites the SDK knows how to build a host for.
 *
 * Mirrored from the SDK's `server1` site variable rather than imported, because the SDK publishes that
 * union only as an inline type parameter on the server constant and not as a named export. Declaring it
 * here is the trade: this list must be checked when the SDK is upgraded, and in exchange an unknown site
 * is rejected by name at startup instead of producing a host that resolves to nothing.
 */
export const DD_SITES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
  "datadoghq.eu",
  "ddog-gov.com",
  "us2.ddog-gov.com",
  "uk1.datadoghq.com",
] as const;

export type DdSite = (typeof DD_SITES)[number];

/**
 * The web-console host per site, which is NOT derivable from the API host by one rule.
 *
 * A regional site is its own console host (`ap1.datadoghq.com`), while the two unprefixed sites put the
 * console on an `app.` subdomain (`datadoghq.com` → `app.datadoghq.com`). Writing that as a total record
 * over {@link DdSite} rather than a string transform means adding a site to the union above is a COMPILE
 * error until its console host is supplied — the alternative silently emits a plausible host that 404s,
 * and a dead evidence link is worse than no link because it is only discovered by a human clicking it.
 *
 * Follows Datadog's own documented host pattern per site. The `ap2` row follows the owner's word:
 * the console is `ap2.datadoghq.com` with no `app.` prefix. `app.ap2.datadoghq.com` does resolve, but to the
 * data INTAKE, not the console (`dig +short app.ap2.datadoghq.com` → `orange.intake.ap2.datadoghq.com.`), so a
 * link on it is dead; the bot once posted three into a team channel, and `./invalidConsoleHost.ts` is what
 * now refuses the whole derived class on every outbound write.
 *
 * `as const satisfies` rather than an annotation, so the values stay literals: {@link DdConsoleHost} is their
 * union, and a caller asked for one cannot be handed a hand-typed string.
 */
const CONSOLE_HOSTS = {
  "datadoghq.com": "app.datadoghq.com",
  "us3.datadoghq.com": "us3.datadoghq.com",
  "us5.datadoghq.com": "us5.datadoghq.com",
  "ap1.datadoghq.com": "ap1.datadoghq.com",
  "ap2.datadoghq.com": "ap2.datadoghq.com",
  "datadoghq.eu": "app.datadoghq.eu",
  "ddog-gov.com": "app.ddog-gov.com",
  "us2.ddog-gov.com": "us2.ddog-gov.com",
  "uk1.datadoghq.com": "uk1.datadoghq.com",
} as const satisfies Readonly<Record<DdSite, string>>;

/** A real Datadog web-console host — one of {@link CONSOLE_HOSTS}'s values, never a hand-typed string. */
export type DdConsoleHost = (typeof CONSOLE_HOSTS)[DdSite];

/** Every real console host, read off {@link CONSOLE_HOSTS} so a site added there is recognised here too. */
const CONSOLE_HOST_SET: ReadonlySet<string> = new Set(Object.values(CONSOLE_HOSTS));

/**
 * Whether a hostname is one of Datadog's own web-console hosts, on any site — never a suffix match, so
 * `docs.datadoghq.com`, an API or intake host, a look-alike and the dead `app.ap2.datadoghq.com` all answer no.
 *
 * @param hostname a URL's hostname, compared case-insensitively
 * @returns true only for a host {@link CONSOLE_HOSTS} names
 */
export function isDatadogConsoleHost({ hostname }: { hostname: string }): boolean {
  return CONSOLE_HOST_SET.has(hostname.toLowerCase());
}

/**
 * The two console pages a person mints their own Datadog keys on, DERIVED from the site rather than written
 * for one: a hard-coded site's page is a sign-in wall on every other org's install. Built on
 * {@link consoleHostFor}, because the console is not always the site (`datadoghq.com` → `app.datadoghq.com`).
 *
 * @param site the install's Datadog site
 * @returns the API-key and application-key settings pages on that site's console
 */
export function datadogKeyPages({ site }: { site: DdSite }): { readonly apiKeys: string; readonly appKeys: string } {
  const origin = `https://${CONSOLE_HOSTS[site]}/organization-settings`;
  return { apiKeys: `${origin}/api-keys`, appKeys: `${origin}/application-keys` };
}

/**
 * The shape of a Datadog API key: 32 lowercase hex characters.
 *
 * Matched to catch a stale, truncated or half-pasted value before anything is called, where the failure
 * is one line instead of an opaque 403 several layers down. Exported so `secrets set datadog-api-key` refuses
 * the same malformed paste before it is written.
 */
export const API_KEY_SHAPE = /^[0-9a-f]{32}$/;

/**
 * The shape of a Datadog APPLICATION key: 40 characters of URL-safe alphanumerics.
 *
 * Deliberately NOT `[0-9a-f]{40}`, which is the obvious guess and is wrong — a real application key is
 * issued spanning upper case, lower case, digits and `_`/`-`, so a hex-only pattern would emit a permanent
 * false warning on a correctly configured machine, and a preflight that cries wolf gets ignored.
 */
export const APP_KEY_SHAPE = /^[A-Za-z0-9_-]{40}$/;

/** A verified-shape Datadog configuration. The only thing the client constructor accepts. */
export interface DatadogConfig {
  readonly apiKey: string;
  readonly appKey: string;
  readonly site: DdSite;
  /** The REST host, e.g. `api.us3.datadoghq.com`. */
  readonly apiHost: string;
  /** The web-console host, e.g. `us3.datadoghq.com`. Used only to build evidence links. */
  readonly consoleHost: DdConsoleHost;
}

/** True when `value` is one of the sites the SDK can address. A predicate, so positional per the rules. */
function isDdSite(value: string): value is DdSite {
  return DD_SITES.some((site) => site === value);
}

/**
 * Grade one required credential variable, accumulating a reason rather than throwing on the first miss.
 *
 * A value that is present but all whitespace is treated as unset: that is what it behaves like at every
 * call site, and calling it "set" would be the more misleading of the two answers.
 *
 * @param name the environment variable's name
 * @param secretName the secrets-store name the same credential is stored under
 * @param raw the environment's value, or `undefined` when unset
 * @param shape the shape its issuer uses
 * @param shapeLabel how that shape reads in a message — describes the format, never a value
 * @returns the trimmed value, or the reasons it is unusable
 */
function requireCredential({
  name,
  secretName,
  raw,
  shape,
  shapeLabel,
}: {
  name: string;
  secretName: string;
  raw: string | undefined;
  shape: RegExp;
  shapeLabel: string;
}): Result<string, DatadogConfigError> {
  const value = raw === undefined ? "" : raw.trim();
  if (value === "") {
    return err(DatadogConfigErrors.credentialMissing({ name, secretName, shapeLabel }));
  }
  if (!shape.test(value)) {
    return err(DatadogConfigErrors.credentialMalformed({ length: value.length, name, shapeLabel }));
  }
  return ok(value);
}

/**
 * Resolve a Datadog configuration from an environment, or say precisely what is wrong with it.
 *
 * EVERY problem is reported, not just the first: a machine missing both keys should learn that in one run
 * rather than one variable per attempt.
 *
 * @param env the environment to read — passed in, never reached for, so this stays pure
 * @returns the verified configuration, or every reason one could not be built
 */
export function resolveDatadogConfig({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<DatadogConfig, DatadogConfigError> {
  const errors: string[] = [];

  const apiKey = requireCredential({
    name: "DD_API_KEY",
    raw: env["DD_API_KEY"],
    secretName: "datadog-api-key",
    shape: API_KEY_SHAPE,
    shapeLabel: "32 lowercase hex characters",
  });
  if (apiKey.isErr()) {
    errors.push(...datadogConfigErrorLines({ error: apiKey.error }));
  }

  const appKey = requireCredential({
    name: "DD_APP_KEY",
    raw: env["DD_APP_KEY"],
    secretName: "datadog-app-key",
    shape: APP_KEY_SHAPE,
    shapeLabel: "40 letters, digits, underscores or dashes",
  });
  if (appKey.isErr()) {
    errors.push(...datadogConfigErrorLines({ error: appKey.error }));
  }

  const site = resolveSite({ raw: env["DD_SITE"] });
  if (site.isErr()) {
    errors.push(...datadogConfigErrorLines({ error: site.error }));
  }

  if (apiKey.isErr() || appKey.isErr() || site.isErr()) {
    return err(DatadogConfigErrors.configInvalid({ reasons: errors }));
  }
  return ok({
    apiKey: apiKey.value,
    appKey: appKey.value,
    site: site.value,
    apiHost: `api.${site.value}`,
    consoleHost: CONSOLE_HOSTS[site.value],
  });
}

/**
 * Resolve `DD_SITE`, listing the accepted values when it is wrong.
 *
 * The list is printed rather than merely "invalid site": the values are non-obvious (`datadoghq.eu` has
 * no region prefix, `us3` does) and a reader who typed one wrong cannot guess the right one.
 *
 * Exported on its own, not just through {@link resolveDatadogConfig}, for a caller that needs a
 * console host but has no API/app key to check — a browser-driven capture, for one.
 *
 * @param raw the environment's `DD_SITE`, or `undefined` when unset
 * @returns the site, or why it was rejected
 */
export function resolveSite({ raw }: { raw: string | undefined }): Result<DdSite, DatadogConfigError> {
  const value = (raw === undefined ? "" : raw.trim()).toLowerCase();
  if (value === "") {
    return err(DatadogConfigErrors.siteMissing({ acceptedSites: DD_SITES }));
  }
  if (!isDdSite(value)) {
    return err(DatadogConfigErrors.siteInvalid({ acceptedSites: DD_SITES, value }));
  }
  return ok(value);
}

/** Whether this install names a Datadog site the SDK can address, without saying which. */
export type DatadogSiteState = "set" | "unset" | "invalid";

/**
 * Judge a raw site the way {@link resolveSite} does, down to the one word `secrets status --json` reports, so the
 * console's Integrations catalog never calls Datadog connected on its two keys while every Datadog verb would refuse
 * for want of a site.
 *
 * @param raw the site `DD_SITE` or `profile.json` names, or `undefined` when neither does
 * @returns `set` for an addressable site, `unset` for none, `invalid` for one the SDK cannot address
 */
export function datadogSiteState({ raw }: { raw: string | undefined }): DatadogSiteState {
  const resolved = resolveSite({ raw });
  if (resolved.isOk()) {
    return "set";
  }
  return resolved.error.code === "SITE_MISSING" ? "unset" : "invalid";
}

/**
 * The console host for a site, for callers holding a site but no full config.
 *
 * @param site the Datadog site
 * @returns the web-console host
 */
export function consoleHostFor({ site }: { site: DdSite }): DdConsoleHost {
  return CONSOLE_HOSTS[site];
}
