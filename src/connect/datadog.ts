/**
 * Datadog preflight: does this install have a site and both keys, and does Datadog accept them? A live
 * connector rather than a corpus source, so there is no read sample — `verifyCredentials`' two unmetered calls
 * prove both keys, and the report says where to mint a missing one ON THIS INSTALL'S SITE.
 *
 * The key pages are derived from the site (`datadogKeyPages`), never written for one org: Datadog sites are
 * separate orgs, and a link to another site's settings page is a sign-in wall. With no site there is nowhere
 * to point, so the report says to set the site first.
 *
 * Pure classifier + thin effectful shell, as every other connector here.
 */
import { createDatadogClient } from "../datadog/client.js";
import { type DdSite, datadogKeyPages, resolveSite } from "../datadog/config.js";
import { datadogConfigErrorLines } from "../datadog/configErrors.js";
import { datadogSite, loadDatadogConfig } from "../datadog/source.js";
import { verifyCredentials } from "../datadog/verifyCredentials.js";
import type { Logger } from "../lib/logger.js";
import { type ConnectCapability, type ConnectCheckReport, finaliseReport } from "./types.js";

/** The raw outcome of resolving and verifying this install's Datadog configuration. */
export interface DatadogProbe {
  /** The site, when it resolved to a real one; undefined when unset or unknown. */
  readonly site: DdSite | undefined;
  /** Every reason the configuration could not be built — empty when it was. */
  readonly configReasons: readonly string[];
  /** What Datadog said about the keys: never asked (the configuration did not resolve), accepted, or refused. */
  readonly verification: "not-run" | "verified" | "rejected";
  /** Why Datadog refused or could not be reached — empty unless `verification` is `rejected`. */
  readonly verifyReasons: readonly string[];
}

/**
 * Where to mint a missing key, or why there is nowhere to point yet.
 *
 * @param site the resolved site, when there is one
 * @returns the one-line hint
 */
function mintHint({ site }: { site: DdSite | undefined }): string {
  if (site === undefined) {
    return "set the site first — the key pages live on your org's own site";
  }
  const pages = datadogKeyPages({ site });
  return `mint your own keys at ${pages.apiKeys} and ${pages.appKeys}`;
}

/** The note every verified report carries, because two colleagues' installs differing is correct, not a fault. */
const APP_KEY_SCOPE_NOTE =
  "the application key reads with its creator's own Datadog permissions, so a colleague's install can " +
  "legitimately see different data from the same org";

/**
 * Classify a Datadog probe into a report. Pure.
 *
 * @param probe the raw probe outcome
 * @returns the finalised report
 */
export function classifyDatadog({ probe }: { probe: DatadogProbe }): ConnectCheckReport {
  if (probe.configReasons.length > 0) {
    const capabilities: readonly ConnectCapability[] = [
      ...probe.configReasons.map((reason) => ({ detail: reason, id: "config", status: "missing" as const })),
      { detail: mintHint({ site: probe.site }), id: "mint", status: "missing" },
    ];
    return finaliseReport({
      capabilities,
      errors: ["datadog: the site or a key is not configured for this install"],
      source: "datadog",
      tokenPresent: false,
    });
  }
  if (probe.verification !== "verified") {
    return finaliseReport({
      capabilities: [
        ...probe.verifyReasons.map((reason) => ({ detail: reason, id: "auth", status: "missing" as const })),
        { detail: mintHint({ site: probe.site }), id: "mint", status: "missing" },
      ],
      errors: ["datadog: the keys did not verify"],
      source: "datadog",
      tokenPresent: true,
    });
  }
  return finaliseReport({
    capabilities: [
      { detail: `both keys verified at ${String(probe.site)}`, id: "auth", status: "ok" },
      { detail: APP_KEY_SCOPE_NOTE, id: "app-key-scope", status: "ok" },
    ],
    source: "datadog",
    tokenPresent: true,
  });
}

/**
 * Resolve this install's Datadog configuration, verify both keys against Datadog, and classify.
 *
 * @param home the Slopweaver home to resolve the keys and site from, defaulting to the ambient one
 * @param logger where the Datadog client logs
 * @returns the preflight report
 */
export async function checkDatadogConnection({
  home,
  logger,
}: {
  home: string | undefined;
  logger: Logger;
}): Promise<ConnectCheckReport> {
  const scope = home === undefined ? {} : { home };
  const site = resolveSite({ raw: datadogSite(scope) });
  const resolvedSite = site.isOk() ? site.value : undefined;
  const config = loadDatadogConfig(scope);
  if (config.isErr()) {
    return classifyDatadog({
      probe: {
        configReasons: datadogConfigErrorLines({ error: config.error }),
        site: resolvedSite,
        verification: "not-run",
        verifyReasons: [],
      },
    });
  }
  const verified = await verifyCredentials({ client: createDatadogClient({ config: config.value, logger }) });
  return classifyDatadog({
    probe: {
      configReasons: [],
      site: config.value.site,
      verification: verified.isOk() ? "verified" : "rejected",
      verifyReasons: verified.isOk() ? [] : datadogConfigErrorLines({ error: verified.error }),
    },
  });
}
