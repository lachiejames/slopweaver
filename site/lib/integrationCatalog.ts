/**
 * The Integrations catalog in Settings: each integration's status off the secrets store, and the search, filter and
 * order the catalog draws them in. Pure.
 *
 * The catalog offers search and a filter by status (installed, uninstalled, broken), with no tags or sections. The
 * ones that need attention sit at the top by default, then the rest alphabetically. A catalog that files a "missing
 * data" warning under Installed beside the healthy ones, with no filter of its own, is confusing, so an integration
 * that would draw a warning counts under Needs attention and never under Connected.
 *
 * **What a status is read from.** Which store files exist and the verb's verdict on each (`secrets status --all
 * --json`), never whether a key works: no check runs here, so "connected" means "everything it reads is stored and
 * the store reports nothing wrong with it", and the integration's page says so. A file is healthy only when stored
 * and `ok`; any other state (an expired grant cache, a loose mode, a state added after this was written) is a
 * problem, so it can never count as Connected. The three rules, per integration's own registry row
 * (`./integrations.ts`):
 *
 * - a CONSENT door (Gmail, Drive, Calendar, Outlook, Outlook Calendar) is available until its grant file exists, then
 *   connected only when the grant and its client are both healthy, since the door reads the client on every call. Its
 *   client alone is no half-finished connection: the Google client serves three doors, and a person who connected
 *   Gmail has not thereby half-connected Drive. The residue, stated: Outlook Calendar reads only its OWN grant file
 *   here, because a store row carries no scopes, so an install whose older mail grant still carries a calendar
 *   permission sees Outlook Calendar as available while the calendar verbs read over that mail grant
 *   (`src/live/outlook/calendarGrantChoice.ts`).
 * - an EITHER door (Slack) is connected when any one of its paste fields is healthy and none has a problem.
 * - every other door is connected when all its files are healthy, needs attention when only some are (one of
 *   Datadog's two keys) or any has a problem, and available when none is stored.
 * - an OPTIONAL file (Slack's app-level token, read only by `slopweaver listen`) never decides Connected or Available,
 *   but a finding on it needs attention like any other.
 * - a door needing CONFIG beside its secrets (Datadog's site, the verb's `datadogSite`) needs attention once any of
 *   its files is stored while that config is unset or invalid, since every one of its verbs refuses without it.
 */

import type { Integration } from "./integrations";

/** Where one integration stands on this install. */
export type IntegrationStatus = "connected" | "needs-attention" | "available";

/** The catalog's status filter: every integration, or one status. */
export type IntegrationFilter = "all" | IntegrationStatus;

/** The filter chips, in the order the catalog draws them. */
export const INTEGRATION_FILTERS: readonly IntegrationFilter[] = ["all", "connected", "needs-attention", "available"];

/** Each filter's chip label. */
export const INTEGRATION_FILTER_LABELS: Readonly<Record<IntegrationFilter, string>> = {
  all: "All",
  available: "Available",
  connected: "Connected",
  "needs-attention": "Needs attention",
};

/** The facts about a store file a status needs: `secrets status --all --json`'s row, projected. */
export interface StoredFile {
  readonly name: string;
  readonly stored: boolean;
  /** The verb's verdict: `ok`, `absent`, or a finding (`access-token-expired`, `loose-mode`, …). */
  readonly state: string;
}

/** One store file, judged: usable, not there, or there with something wrong. */
type FileHealth = "healthy" | "empty" | "problem";

/** One integration, with its status and the words a search matches. */
export interface CatalogEntry {
  readonly integration: Integration;
  readonly status: IntegrationStatus;
  /** The card's one line (`./integrationGuides.ts`). */
  readonly pitch: string;
}

/**
 * One store file's health: healthy only when stored and the verb reports nothing (`ok`); empty when no row names it or
 * the verb calls it absent; every other combination a problem, a state this console has never seen included.
 *
 * @returns the health
 */
function healthOf({ name, files }: { name: string; files: readonly StoredFile[] }): FileHealth {
  const row = files.find((file) => file.name === name);
  if (row === undefined || (!row.stored && row.state === "absent")) {
    return "empty";
  }
  if (row.stored && row.state === "ok") {
    return "healthy";
  }
  return "problem";
}

/**
 * A consent door's status: its grant decides whether it is begun at all, and its client must be healthy beside a
 * healthy grant, because the door reads the client on every call. A finding on the client needs attention even before
 * any grant, since consent cannot run on a broken client.
 *
 * @returns the status
 */
function consentStatusOf({
  integration,
  files,
}: {
  integration: Integration;
  files: readonly StoredFile[];
}): IntegrationStatus {
  const grant = integration.secrets.map((name) => healthOf({ files, name }));
  const client = integration.paste.map((name) => healthOf({ files, name }));
  if (client.includes("problem")) {
    return "needs-attention";
  }
  if (grant.every((health) => health === "empty")) {
    return "available";
  }
  const usable = [...grant, ...client].every((health) => health === "healthy");
  return usable ? "connected" : "needs-attention";
}

/**
 * Where one integration stands, from which of its store files exist and what the verb says of each, and, for one that
 * needs config beside its secrets, whether that config is there.
 *
 * @param files the store's rows, `secrets status --all --json` projected
 * @param datadogSite the verb's `datadogSite` verdict: `set`, `unset` or `invalid`
 * @returns the status
 */
export function integrationStatusOf({
  integration,
  files,
  datadogSite,
}: {
  integration: Integration;
  files: readonly StoredFile[];
  datadogSite: string;
}): IntegrationStatus {
  if (integration.consentVerb !== undefined) {
    return consentStatusOf({ files, integration });
  }
  const names = [...new Set([...integration.paste, ...integration.secrets])];
  const health = names.map((name) => healthOf({ files, name }));
  const healthy = health.filter((each) => each === "healthy").length;
  // An optional file connects nothing on its own, but a finding on one is still something to fix.
  const problem =
    health.includes("problem") || integration.optional.some((name) => healthOf({ files, name }) === "problem");
  if (healthy === 0 && !problem) {
    return "available";
  }
  // Begun, so a missing site is something to fix: the keys alone reach nothing.
  const configMissing = integration.config === "datadog-site" && datadogSite !== "set";
  if (problem || configMissing) {
    return "needs-attention";
  }
  if (integration.pasteEither || healthy === names.length) {
    return "connected";
  }
  return "needs-attention";
}

/**
 * Whether an entry matches a search: its name, another name it goes by, its id or its pitch, case-insensitively. An
 * empty search matches everything.
 *
 * @returns true when every word of the query is in one of them
 */
export function entryMatches({ entry, query }: { entry: CatalogEntry; query: string }): boolean {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  const haystack = [entry.integration.label, entry.integration.id, entry.pitch, ...entry.integration.aliases]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The catalog's order: needs attention first, then A to Z by name.
 *
 * @returns a new array in that order
 */
export function catalogOrder({ entries }: { entries: readonly CatalogEntry[] }): readonly CatalogEntry[] {
  return entries.toSorted((a, b) => {
    const attention = Number(b.status === "needs-attention") - Number(a.status === "needs-attention");
    if (attention !== 0) {
      return attention;
    }
    return a.integration.label.localeCompare(b.integration.label, "en");
  });
}

/**
 * How many entries each filter would show for a search, so a chip's count agrees with what pressing it draws.
 *
 * @returns the count per filter
 */
export function filterCounts({
  entries,
  query,
}: {
  entries: readonly CatalogEntry[];
  query: string;
}): Readonly<Record<IntegrationFilter, number>> {
  const matched = entries.filter((entry) => entryMatches({ entry, query }));
  const count = (status: IntegrationStatus): number => matched.filter((entry) => entry.status === status).length;
  return {
    all: matched.length,
    available: count("available"),
    connected: count("connected"),
    "needs-attention": count("needs-attention"),
  };
}

/**
 * What the catalog draws for a search and a filter, in its order.
 *
 * @returns the entries shown
 */
export function catalogShown({
  entries,
  query,
  filter,
}: {
  entries: readonly CatalogEntry[];
  query: string;
  filter: IntegrationFilter;
}): readonly CatalogEntry[] {
  const kept = entries.filter(
    (entry) => entryMatches({ entry, query }) && (filter === "all" || entry.status === filter),
  );
  return catalogOrder({ entries: kept });
}
