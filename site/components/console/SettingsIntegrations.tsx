"use client";

/**
 * Integrations, the section Settings opens on: every integration this console reads through, searchable, filtered by
 * status, needs-attention first and then A to Z, each card opening its own page with the Configure steps
 * (`./IntegrationPage.tsx`). The rules for status, search and order are `../../lib/integrationCatalog.ts`, which
 * states the reasons.
 *
 * A status is read off `secrets status --all --json`, the same reading every paste field's receipt takes, so a key
 * pasted on an integration's page moves its card the moment the re-read lands. Until that reading is in hand the cards
 * draw with no status and the filters wait, rather than calling every integration Available.
 */
import { type ReactElement, useState } from "react";

import {
  type CatalogEntry,
  catalogShown,
  filterCounts,
  INTEGRATION_FILTER_LABELS,
  INTEGRATION_FILTERS,
  type IntegrationFilter,
  integrationStatusOf,
} from "../../lib/integrationCatalog";
import { guideOf } from "../../lib/integrationGuides";
import { INTEGRATIONS } from "../../lib/integrations";
import { ReadStandIn, StaleReadings } from "../live/LiveMarks";
import { readSecretStore, type SecretStoreReading } from "../live/readSecrets";
import { readyValueOf, useLive } from "../live/useLive";
import { IntegrationPage } from "./IntegrationPage";
import { StatusPill } from "./IntegrationStatusPill";

/** The live slug the statuses read (`../../lib/liveVerbs.ts`), shared with every paste field's receipt. */
const STATUS_SLUG = "secrets";

/** What the reading is, mid-sentence, for its spinner and its staleness mark. */
const STATUS_SUBJECT = "which integrations are connected";

/** No store rows and no site: the reading before it lands, which the caller draws no status off. */
const UNREAD: SecretStoreReading = { datadogSite: "unset", rows: [] };

/** A filter chip. */
const CHIP_ROW =
  "cursor-pointer rounded-full border border-solid border-border bg-transparent px-[0.6rem] py-[0.1rem] text-[0.76rem] text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground disabled:cursor-default disabled:opacity-60";

/**
 * Every integration as a catalog entry. With no reading yet each one is drawn Available for sorting only; the caller
 * hides the status while `known` is false.
 *
 * @param reading the store's rows and Datadog site verdict, or `undefined` while unread
 * @returns the entries, and whether their statuses are real
 */
function entriesOf({ reading }: { reading: SecretStoreReading | undefined }): {
  entries: readonly CatalogEntry[];
  known: boolean;
} {
  // Unread, nothing is stored as far as sorting knows, and the caller draws no status off it.
  if (reading === undefined) {
    return { entries: entriesFrom({ reading: UNREAD }), known: false };
  }
  return { entries: entriesFrom({ reading }), known: true };
}

/**
 * Every integration as a catalog entry, its status read off one store reading.
 *
 * @param reading the store's rows and Datadog site verdict the statuses are read off
 * @returns the entries, in registry order
 */
function entriesFrom({ reading }: { reading: SecretStoreReading }): readonly CatalogEntry[] {
  return INTEGRATIONS.map((integration) => ({
    integration,
    pitch: guideOf({ id: integration.id }).pitch,
    status: integrationStatusOf({ datadogSite: reading.datadogSite, files: reading.rows, integration }),
  }));
}

/**
 * One integration's card: its initial, name, pitch and status.
 *
 * @param known whether the status is a real reading, else it is left off
 * @param open opens the integration's page
 * @returns the card
 */
function Card({ entry, known, open }: { entry: CatalogEntry; known: boolean; open: () => void }): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={open}
        data-integration={entry.integration.id}
        className="grid h-full w-full cursor-pointer content-start gap-1 rounded-[10px] border border-solid border-border bg-(--c-panel) p-3 text-left text-foreground hover:bg-muted/60"
      >
        <span className="flex items-start justify-between gap-2">
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-[8px] bg-muted text-[0.82rem] font-[700]"
          >
            {entry.integration.label.charAt(0)}
          </span>
          {known && <StatusPill status={entry.status} />}
        </span>
        <span className="text-[0.86rem] font-[600]">{entry.integration.label}</span>
        <span className="truncate text-[0.76rem] text-muted-foreground">{entry.pitch}</span>
      </button>
    </li>
  );
}

/**
 * The search box and the status chips, each chip carrying the count it would show.
 *
 * @param known whether statuses are read, so the chips can filter
 * @returns the toolbar
 */
function Toolbar({
  query,
  setQuery,
  filter,
  setFilter,
  counts,
  known,
}: {
  query: string;
  setQuery: (query: string) => void;
  filter: IntegrationFilter;
  setFilter: (filter: IntegrationFilter) => void;
  counts: Readonly<Record<IntegrationFilter, number>>;
  known: boolean;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        aria-label="search integrations"
        placeholder="Search integrations"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        className="sw-glass-control min-w-0 flex-[1_1_14rem] rounded-lg border border-solid px-[0.6rem] py-[0.4rem] text-[0.84rem] text-foreground"
      />
      <fieldset aria-label="filter by status" className="m-0 flex min-w-0 flex-wrap gap-[0.35rem] border-0 p-0">
        {INTEGRATION_FILTERS.map((each) => (
          <button
            key={each}
            type="button"
            className={CHIP_ROW}
            aria-pressed={each === filter}
            disabled={!known && each !== "all"}
            onClick={() => {
              setFilter(each);
            }}
          >
            {INTEGRATION_FILTER_LABELS[each]}
            {known && <b className="ml-1 font-[600] text-foreground">{String(counts[each])}</b>}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * The catalog: heading, toolbar, cards, and the line saying how they are ordered.
 *
 * @param open opens one integration's page
 * @returns the catalog
 */
function Catalog({
  entries,
  known,
  open,
}: {
  entries: readonly CatalogEntry[];
  known: boolean;
  open: (id: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<IntegrationFilter>("all");
  const shown = catalogShown({ entries, filter: known ? filter : "all", query });
  const counts = filterCounts({ entries, query });
  return (
    <>
      <Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} counts={counts} known={known} />
      {shown.length === 0 ? (
        <p className="m-0 text-[0.84rem] text-muted-foreground">No integration matches that.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-[0.6rem] p-0">
          {shown.map((entry) => (
            <Card
              key={entry.integration.id}
              entry={entry}
              known={known}
              open={() => {
                open(entry.integration.id);
              }}
            />
          ))}
        </ul>
      )}
      <p className="m-0 text-[0.74rem] text-muted-foreground">Needs attention first, then A to Z.</p>
    </>
  );
}

/**
 * The Integrations section: the catalog, or one integration's page when the address names it.
 *
 * @param item the integration open, by id, read off the hash
 * @param openItem opens one integration, or the catalog again with no item
 * @returns the section
 */
export function SettingsIntegrations({
  item,
  openItem,
}: {
  item: string | undefined;
  openItem: (target: { item?: string }) => void;
}): ReactElement {
  const status = useLive<SecretStoreReading>({ read: readSecretStore, slug: STATUS_SLUG });
  const { entries, known } = entriesOf({ reading: readyValueOf({ state: status }) });
  const opened = entries.find((entry) => entry.integration.id === item);
  if (opened !== undefined) {
    return (
      <IntegrationPage
        integration={opened.integration}
        status={known ? opened.status : undefined}
        back={() => {
          openItem({});
        }}
      />
    );
  }
  return (
    <section aria-label="integrations" className="grid gap-4">
      <div className="grid gap-1 pr-10">
        <h2 className="m-0 text-[1rem] font-[650]">Integrations</h2>
        <p className="m-0 text-[0.84rem] text-muted-foreground">
          What Slopweaver can read for you. None is required; connect the tools you actually use.
        </p>
      </div>
      <StaleReadings row readings={[{ state: status, subject: STATUS_SUBJECT }]} />
      {status.phase !== "ready" && <ReadStandIn state={status} subject={STATUS_SUBJECT} />}
      <Catalog
        entries={entries}
        known={known}
        open={(id) => {
          openItem({ item: id });
        }}
      />
    </section>
  );
}
