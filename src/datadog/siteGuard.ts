/**
 * Refuse a Datadog CONSOLE address on any site other than this install's own.
 *
 * An agent opening the US1 console host instead of the install's own site is a common mistake, so it is banned.
 * That host is the one every Datadog doc example uses, and a `browser open` usage example once carried it too.
 *
 * ## Why the site comes from the install, not a committed constant
 *
 * The site is a per-install VALUE, and `docs/constraints/partition.md` § the partition resolves one of those at runtime
 * rather than in git. `profile.json`'s `datadog.site` is that value, `DD_SITE` winning over it, and
 * `./source.ts` overlays it as `DD_SITE` before a caller reaches here: `resolveSite` is what pins the SDK
 * client, the atlas walk and `datadog shot`, so this guard reads the same resolver and there is ONE source of
 * the site. An unset or unknown site refuses every console host — `config.ts` explains why no site is a safe
 * default.
 *
 * ## What it judges
 *
 * Console hosts (`consoleHostFor` over every site), and the derived DEAD ones `./invalidConsoleHost.ts` names.
 * `docs.datadoghq.com`, `www.datadoghq.com` and the API hosts are not consoles and pass; an API call on the wrong
 * site is `resolveDatadogConfig`'s problem.
 *
 * The dead hosts are judged here, not only on outbound writes, because a page OPENED on one is the same mistake
 * reaching the owner's screen instead of a channel. MEASURED: the console voice's `browser` look opened
 * an `app.`-prefixed regional monitor edit page, landed on a Datadog sign-in wall, and reported that Datadog
 * opened at a login screen. The link was the wrong one, and the owner sees that mistake all the time. A guard that
 * judged only REAL console hosts let a host that is no console at all fall straight through every open path it
 * guards.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { consoleHostFor, DD_SITES, resolveSite } from "./config.js";
import { datadogConfigErrorLines } from "./configErrors.js";
import { invalidDatadogConsoleHosts } from "./invalidConsoleHost.js";

/** The escape hatch this guard reads. Ambient: opening a page sends nothing anywhere. */
export const DATADOG_SITE_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_DATADOG_SITE";

/** Every Datadog console host, one per site. */
const CONSOLE_HOSTS: ReadonlySet<string> = new Set(DD_SITES.map((site) => consoleHostFor({ site })));

/**
 * Why one address is on the wrong Datadog site or on a dead derived host, or `undefined` when it is neither.
 *
 * @param url the address about to be opened, absolute
 * @param ddSite the environment's `DD_SITE`, or `undefined` when unset
 * @returns what the refusal should say about this address, or `undefined` to allow it
 */
export function wrongDatadogSite({ url, ddSite }: { url: string; ddSite: string | undefined }): string | undefined {
  let host: string;
  try {
    // A trailing root dot names the same host (`app.datadoghq.com.`), so it is judged as that host.
    host = new URL(url).hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    return undefined;
  }
  const site = resolveSite({ raw: ddSite });
  const dead = invalidDatadogConsoleHosts({ text: host }).find((hit) => hit.invalidHost === host);
  if (dead !== undefined) {
    const consoleHost = site.isOk() ? consoleHostFor({ site: site.value }) : dead.correctHost;
    return `${host} is not a Datadog console — no site serves one there, so it opens a sign-in wall; the console is https://${consoleHost}`;
  }
  if (!CONSOLE_HOSTS.has(host)) {
    return undefined;
  }
  if (site.isErr()) {
    return `${host} is a Datadog console, and this install's site cannot be checked: ${datadogConfigErrorLines({ error: site.error }).join("; ")}`;
  }
  const expected = consoleHostFor({ site: site.value });
  if (host === expected) {
    return undefined;
  }
  return `${host} is not this install's Datadog site — DD_SITE is ${site.value}, so the console is https://${expected}`;
}

/**
 * The four-line refusal for opening an address on the wrong Datadog site, or `undefined` when the address is
 * fine or the hatch is open.
 *
 * @param url the address about to be opened, absolute
 * @param command what is being refused, as the refusal's first line names it
 * @param env the environment carrying `DD_SITE` and the hatch
 * @returns the refusal, or `undefined` to allow
 */
export function datadogSiteRefusal({
  url,
  command,
  env,
}: {
  url: string;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  return datadogSiteHatchRefusal({ command, detail: wrongDatadogSite({ ddSite: env["DD_SITE"], url }), env });
}

/**
 * The same four-line refusal for a detail a narrower caller judged itself — `browser present` holds a Datadog
 * host to this install's console more tightly than this guard can for every verb — so its hatch and wording
 * stay this guard's own.
 *
 * @param detail why the address is refused, or `undefined` when the caller found nothing wrong
 * @param command what is being refused, as the refusal's first line names it
 * @param env the environment carrying the hatch
 * @returns the refusal, or `undefined` to allow
 */
export function datadogSiteHatchRefusal({
  detail,
  command,
  env,
}: {
  detail: string | undefined;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (detail === undefined || env[DATADOG_SITE_OVERRIDE_ENV] === "1") {
    return undefined;
  }
  return hatchRefusal({ detail, hatch: { ...hatchFor({ id: "datadog-site" }), command } });
}
