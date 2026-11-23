/**
 * The page inventory the walk is judged against, and how a declared page becomes a URL.
 *
 * ## The denominator is DECLARED, which is what makes the coverage claim checkable
 *
 * A crawler cannot prove its own completeness — "we visited everything we found" is a claim about the
 * crawler. So the walk is judged against {@link TRELICA_BROWSER_PAGES}, a list it did not choose: a declared
 * page never reached is a gap this atlas can NAME, where a page a crawler never noticed is not.
 *
 * ## Why the list is maintained here rather than fetched, and the gap that admits it
 *
 * MEASURED: the application's own navigation lives behind a menu BUTTON rather than in links,
 * so a page that only navigates and observes cannot read the nav out of the rendered document — the walk
 * found exactly one anchor on a signed-in admin page, back to the catalogue. Its route table lives in a
 * lazily-loaded client bundle, and the shell bundle declares only the routes below the product's own areas.
 * So the vendor publishes no manifest of its navigation surface and this list is a fact about this
 * repository, which is why `gaps.ts` carries `provider-publishes-no-page-inventory` as a permanent open gap
 * rather than letting the list quietly pass for the platform's own.
 *
 * Every route here was OBSERVED to exist — either declared in the shell bundle's own route table or landed
 * on and rendered with the application's own chrome. None is a guess.
 *
 * ## Reachability is graded on origin, path AND what the page actually did
 *
 * MEASURED in the same sitting, and it is the trap the sibling Notion walk paid for: this is a single-page
 * application, so a route the app does not have still answers HTTP 200 with the product's own title and an
 * empty shell. `/Apps`, `/Users`, `/Admin` and `/Settings` all did exactly that — 200, the product name as
 * the title, and not one first-party call. So a page counts as REACHED only when it settled where it was
 * asked AND either titled itself something other than the bare product name or caused at least one
 * first-party call. Status alone would have graded four non-existent routes as covered.
 *
 * ## A page that can render provider-written text is never photographed
 *
 * A screenshot is pixels, so nothing can re-hold what it shows the way `providerText.ts` re-holds a stored
 * field. The run list, the integrations page and the audit log each render text an integration's provider
 * wrote — a failure message, a connection's last error — so they are listed in
 * {@link TRELICA_UNPHOTOGRAPHED_PAGES} and walked by nobody. What they hold is read through the API, where
 * that text is held only as a closed value.
 */

/** One page this atlas declares the platform to have. */
export interface TrelicaBrowserPage {
  /** The stable surface name a coverage cell and a gap are keyed on. Carries no tenant label. */
  readonly name: string;
  /** The path beneath the tenant origin. */
  readonly path: string;
  /** What a reader learns from this page, in English. */
  readonly holds: string;
}

/**
 * Every page the walk asks for.
 *
 * Ordered so the cheapest confirmation of a live session comes first: if the catalogue does not render, the
 * session is gone and everything after it would be thirty false page gaps that have nothing to do with the
 * pages.
 */
export const TRELICA_BROWSER_PAGES: readonly TrelicaBrowserPage[] = [
  {
    holds: "the end-user application catalogue — what staff are offered, and what they may request",
    name: "catalog",
    path: "/Catalog",
  },
  {
    holds: "the requests staff have raised against catalogue applications",
    name: "catalog-requests",
    path: "/Catalog/AppRequests",
  },
  {
    holds: "the people this tenant knows about, and the roles it defines",
    name: "people",
    path: "/People",
  },
  {
    holds: "spend across applications, and which data sources it was assembled from",
    name: "spend",
    path: "/Spend",
  },
  {
    holds: "AI spend and token consumption per app, team, person, model and API key — the cost explorer",
    name: "ai-consumption",
    path: "/Consumption",
  },
  {
    holds: "the AI spend budgets this tenant has set, with how much of each is used and its runway",
    name: "ai-consumption-budgets",
    path: "/Consumption/Budgets",
  },
  {
    holds: "the alerts this tenant raises on AI spend and consumption",
    name: "ai-consumption-alerts",
    path: "/Consumption/Alerts",
  },
  {
    holds: "the administrator's application hub — every application with its owners, users and status",
    name: "apps-hub",
    path: "/Apps/Hub",
  },
  {
    holds: "the governance tasks assigned across the tenant",
    name: "home-tasks",
    path: "/Home/Tasks",
  },
  {
    holds: "the tenant's own dashboard — the landing view of the whole product",
    name: "home-dashboard",
    path: "/Home/Dashboard",
  },
  {
    holds: "the reports this tenant can run",
    name: "reports",
    path: "/Reports",
  },
  {
    holds: "the signed-in person's own profile and preferences",
    name: "profile",
    path: "/Profile",
  },
  {
    holds: "the published API's own documentation browser — the surface `publishedSpec.ts` compiles",
    name: "api-docs",
    path: "/api/docs",
  },
  {
    holds: "the contracts recorded against applications, with their renewal dates and values",
    name: "contracts",
    path: "/Contracts",
  },
  {
    holds: "the devices this tenant knows about, and which source reported each",
    name: "devices",
    path: "/Assets",
  },
  {
    holds: "access reviews and who holds access to what",
    name: "access",
    path: "/Access",
  },
  {
    holds: "the vendor and application assessments this tenant has run",
    name: "assessments",
    path: "/Assessments",
  },
  {
    holds: "every workflow this tenant has defined — its trigger, its owner, whether it is enabled, and its run counts",
    name: "workflows",
    path: "/Admin/Flow/Search",
  },
  {
    holds: "the teams this tenant defines",
    name: "teams",
    path: "/Admin/Teams",
  },
  {
    holds: "the tenant's organisation settings",
    name: "settings",
    path: "/Admin/Profile",
  },
];

/**
 * The pages that exist and are deliberately not walked, because each renders text an integration's provider wrote
 * and a screenshot of it could not be held. Every one is read through the API instead.
 */
export const TRELICA_UNPHOTOGRAPHED_PAGES: readonly TrelicaBrowserPage[] = [
  {
    holds: "every workflow run across every workflow, with each failed step's provider message",
    name: "workflow-runs",
    path: "/Admin/FlowItems",
  },
  {
    holds: "the integrations this tenant has connected, with each connection's last provider error",
    name: "integrations",
    path: "/Admin/Integrations",
  },
  {
    holds: "the tenant's own audit log, whose entries can quote an integration's error",
    name: "audit-log",
    path: "/Admin/Audits",
  },
];

/**
 * What a settled path is held as when it is not one this atlas declares. A client redirect can land on a path whose
 * segments carry a value — a run's id, a slug a provider wrote — so only a declared path is ever held as written.
 *
 * @internal
 */
export const TRELICA_UNDECLARED_PATH = "a path this atlas does not declare";

/**
 * A settled path as the atlas may hold it: the declared page path it equals, walked or not, else the fixed marker.
 *
 * @param pathname the path the client settled on, as the browser reported it
 * @returns the declared path, or {@link TRELICA_UNDECLARED_PATH}
 */
export function trelicaDeclaredPath({ pathname }: { pathname: string }): string {
  const declared = [...TRELICA_BROWSER_PAGES, ...TRELICA_UNPHOTOGRAPHED_PAGES].find((page) => page.path === pathname);
  if (declared === undefined) {
    return TRELICA_UNDECLARED_PATH;
  }
  return declared.path;
}

/**
 * The bare product title, which a route the application does not have also renders.
 *
 * MEASURED on four non-existent routes. Kept as a constant because grading a single-page
 * application on HTTP status alone counts every one of them as reached — the same class the Vanta walk
 * closed with a measured not-found title, arrived at here from the opposite direction: there is no
 * not-found page at all, only the shell.
 *
 * @internal
 */
export const TRELICA_SHELL_TITLE = "1Password SaaS Manager";

/**
 * The URL one declared page is asked for at.
 *
 * @param page the declared page
 * @param tenantOrigin this installation's tenant origin
 * @returns the absolute URL to visit
 */
export function trelicaPageUrl({ page, tenantOrigin }: { page: TrelicaBrowserPage; tenantOrigin: string }): string {
  return `${tenantOrigin}${page.path}`;
}

/**
 * Whether a settled page is the application's empty shell rather than the page that was asked for.
 *
 * @param title the document title the page settled on
 * @param firstPartyCallCount how many of the tenant's own calls the page made while it rendered
 * @returns whether this looks like a route the application does not have
 */
export function isTrelicaEmptyShell({
  title,
  firstPartyCallCount,
}: {
  title: string;
  firstPartyCallCount: number;
}): boolean {
  return title.trim() === TRELICA_SHELL_TITLE && firstPartyCallCount === 0;
}
