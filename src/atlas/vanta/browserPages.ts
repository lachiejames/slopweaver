/**
 * The Vanta web client's navigation surface, and the two rules a walk of it must obey.
 *
 * ## The tenant slug is never written down
 *
 * Vanta's own URLs are `app.vanta.com/c/<tenant>/<page>`, and that tenant slug is the organisation's own
 * name — a private identifier this repository may not carry, in source or in a fixture. So every page below
 * is a path RELATIVE to the tenant root, and the root itself is learned at run time from where Vanta
 * redirects a bare path: ask for `/tests` while signed in and the client lands on `/c/<tenant>/tests`.
 * {@link tenantRootFromFinalUrl} is that inference, and it is the only place the slug exists.
 *
 * ## Every page carries explicit query state, because the client restores the owner's
 *
 * MEASURED, and the reason this is a rule rather than a nicety: a read-only visit to
 * `https://app.vanta.com/tests` settled on
 * `…/tests?framework=iso27001_2022&status=NEEDS_REMEDIATION&status=OVERDUE&status=DUE_SOON&search=Password+policy`
 * — the filter and search the owner had left on that page in their own browser. A walk that navigates to a
 * bare path therefore photographs a FILTERED view and under-reports without ever failing. Every page here
 * states the query it wants, so what the walk sees is what the walk asked for.
 */

/**
 * The page title Vanta's client renders for a route it does not have.
 *
 * MEASURED, and it is the reason reachability is judged on the TITLE rather than the status: the
 * client is a single-page app, so a route it has never heard of still answers **HTTP 200** and still paints
 * a chrome full of first-party GraphQL calls. A walk grading on `statusCode` would have marked
 * `/contracts` — a route this tenant does not have at all — as reached, photographed its not-found page,
 * and counted its navigation chrome as evidence the surface was covered. That is precisely the failure the
 * both-surfaces bar exists to catch, one layer down.
 *
 * @internal
 */
export const VANTA_NOT_FOUND_TITLE = "Page not found - Vanta";

/**
 * Whether a visited page is the client's own not-found route.
 *
 * @param title the page title the browser settled on
 * @returns whether Vanta rendered its not-found page
 */
export function isVantaNotFound({ title }: { title: string }): boolean {
  return title.trim() === VANTA_NOT_FOUND_TITLE;
}

/** One page of the Vanta web client this atlas walks. */
export interface VantaBrowserPage {
  /** The surface name its coverage cell is reported under, matching `inventory.ts`. */
  readonly surface: string;
  /** The path beneath the tenant root, with no leading slash. */
  readonly path: string;
  /**
   * The query state that overrides whatever the owner last left on this page.
   *
   * A value here must be NON-EMPTY to have any effect. Measured: `?page=1` on the policy list wins and the
   * page stays where it was asked, while `?search=` is ignored entirely and the client restores the search
   * and status filters it had stored — so an empty string is not a way to clear a filter, it is a way to
   * believe you cleared one. Where no overriding value is known, leave this empty and let `redirected`
   * record honestly that the client chose the view.
   */
  readonly query: Readonly<Record<string, string>>;
  readonly description: string;
}

/**
 * The bare path a walk asks for FIRST, purely to learn the tenant root from where Vanta sends it.
 *
 * `/tests` rather than `/` because the root redirects to whichever page the client last showed, while a
 * named page redirects only to add the tenant segment.
 */
export const VANTA_TENANT_PROBE_PATH = "/tests";

/** The origin every Vanta page hangs off. The one absolute URL in this atlas's browser channel. */
export const VANTA_WEB_ORIGIN = "https://app.vanta.com";

/**
 * Infer the tenant root from where a bare path actually landed.
 *
 * @param finalUrl the URL the browser settled on after asking for {@link VANTA_TENANT_PROBE_PATH}
 * @returns the tenant root, e.g. `https://app.vanta.com/c/<tenant>`, or `null` when the URL is not that shape
 */
export function tenantRootFromFinalUrl({ finalUrl }: { finalUrl: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== VANTA_WEB_ORIGIN) {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const [marker, tenant] = segments;
  if (marker !== "c" || tenant === undefined || tenant.length === 0) {
    return null;
  }
  return `${VANTA_WEB_ORIGIN}/c/${tenant}`;
}

/**
 * The tenant root for a slug the OPERATOR supplied, rather than one inferred from a redirect.
 *
 * The slug never enters this repository — it arrives on `--tenant`, in `VANTA_TENANT_SLUG`, or from
 * `$SLOPWEAVER_HOME/secrets/vanta-tenant-slug` — so this builds the same shape
 * {@link tenantRootFromFinalUrl} reads, for the verbs that cite a page without walking to it.
 *
 * @param tenantSlug the organisation's own Vanta slug
 * @returns the tenant root, e.g. `https://app.vanta.com/c/<tenant>`
 */
export function vantaTenantRootFromSlug({ tenantSlug }: { tenantSlug: string }): string {
  return `${VANTA_WEB_ORIGIN}/c/${encodeURIComponent(tenantSlug)}`;
}

/**
 * The citation a controls answer points at: the Controls list itself.
 *
 * The LIST, for an answer that is about the controls surface rather than about one control. For one control
 * there is {@link vantaControlPage}. Vanta's Manage API hands back no URL for a control and
 * `projection.ts` records `deepLinkStatus: "unavailable"` for exactly that reason, so the per-control URL
 * is not guessed: a walk of the controls index comes back REDIRECTED and
 * Vanta's own client rewrites the address to `controls?controlId=<providerId>` for a real control. The
 * shape is the client's, not this atlas's guess — and `atlas vanta shot` still LOADS it before recording it
 * as a deep link, so the atlas never holds a link it has not seen resolve.
 *
 * @param tenantSlug the organisation's own Vanta slug
 * @param label what the citation is called where it is displayed
 * @returns the citation
 */
export function vantaControlsCitation({ tenantSlug, label }: { tenantSlug: string; label: string }): {
  readonly label: string;
  readonly url: string;
} {
  return { label, url: `${vantaTenantRootFromSlug({ tenantSlug })}/controls` };
}

/**
 * The query parameter Vanta's own client selects one control with.
 *
 * MEASURED: a walk asked for the bare controls index and the client settled on
 * `…/controls?controlId=policies-password-complexity-gdpr&status=NEEDS_ATTENTION`, restoring the control
 * the owner last had open. The `status` half is a filter and is not required; this half is the selection.
 *
 * @internal
 */
export const VANTA_CONTROL_QUERY_PARAM = "controlId";

/**
 * The declared page for ONE control — its own view of the controls index.
 *
 * ## The value it carries is the providerId, and that is the trap
 *
 * `controlId` is the control's PROVIDER id, never the `externalId` a human reads off a report: `DCH-108` is
 * `0syn0001` and `HRS-52` is `0syn0002`, while `CRY-56` is `data-encrypted-gdpr`. So a URL cannot be built
 * from the id in a document — it needs the atlas's own control set as a lookup table, which is what
 * `controlShot.ts` does before a single page is asked for.
 *
 * The query is non-empty by construction, which matters here more than anywhere else in this file: an empty
 * query lets the client restore whichever control the owner last had open, and this page's whole purpose is
 * to be a picture of the control that was ASKED for.
 *
 * @param providerId the control's provider id, from the atlas's own control kind
 * @returns the declared page
 */
export function vantaControlPage({ providerId }: { providerId: string }): VantaBrowserPage {
  return {
    description: `the control view for ${providerId}`,
    path: "controls",
    query: { [VANTA_CONTROL_QUERY_PARAM]: providerId },
    surface: vantaControlSurface({ providerId }),
  };
}

/**
 * The surface name one control's page is recorded under.
 *
 * Prefixed so a control page can never collide with a declared collection page, and so a reader scanning
 * `browser-page` rows can tell the twelve navigation surfaces from the controls photographed on request.
 *
 * @param providerId the control's provider id
 * @returns the surface name
 */
export function vantaControlSurface({ providerId }: { providerId: string }): string {
  return `control:${providerId}`;
}

/**
 * The absolute URL for one page beneath a tenant root.
 *
 * @param tenantRoot the root from {@link tenantRootFromFinalUrl}
 * @param page the page to address
 * @returns the absolute URL, query state included
 */
export function vantaPageUrl({ tenantRoot, page }: { tenantRoot: string; page: VantaBrowserPage }): string {
  const url = new URL(`${tenantRoot}/${page.path}`);
  for (const [key, value] of Object.entries(page.query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * The risk register — the one risk address anything has measured. Vanta's client has no per-risk route a walk has
 * ever reached, so a bare risk id a card names (`TTX-2`) cites this page rather than an address nobody measured.
 */
export const VANTA_RISK_REGISTER_PAGE: VantaBrowserPage = {
  // Measured: `/risks` is not a route at all — it renders the client's not-found page, and before the
  // title check existed the walk credited that page's navigation chrome as a covered risk surface.
  description: "the risk register",
  path: "risk-management/risk-register",
  query: {},
  surface: "risks-collection",
};

/**
 * Every page the browser channel walks.
 *
 * The list is the atlas's own claim about what the web client contains, so a page Vanta adds is a gap this
 * atlas does not know it has until someone adds it here — which is the same closed-inventory property
 * `inventory.ts` holds for the Manage API, and is why the walk cannot discover its own scope.
 */
export const VANTA_BROWSER_PAGES: readonly VantaBrowserPage[] = [
  {
    description: "every test, unfiltered by framework or status",
    path: "tests",
    query: {},
    surface: "tests-collection",
  },
  {
    description: "every control",
    path: "controls",
    query: {},
    surface: "controls-collection",
  },
  {
    description: "the policy list, from its first page",
    path: "policies",
    // Measured: without this the client restored `?afterCursor=…&page=2`, so the walk photographed the
    // SECOND page of policies and would have reported it as the list.
    query: { page: "1" },
    surface: "policies-collection",
  },
  {
    description: "the document and evidence list",
    path: "documents",
    query: {},
    surface: "evidence-collection",
  },
  VANTA_RISK_REGISTER_PAGE,
  {
    description: "the vendor register",
    path: "vendors",
    query: {},
    surface: "vendors-collection",
  },
  {
    description: "every person, with their onboarding and offboarding state",
    path: "people",
    query: {},
    surface: "people-collection",
  },
  {
    description: "every monitored computer",
    path: "computers",
    query: {},
    surface: "computers-collection",
  },
  {
    description: "connected integrations",
    path: "integrations",
    query: {},
    surface: "integrations-collection",
  },
  {
    description:
      "every audit — the one kind with no Manage API surface at all, because GET /v1/audits answers HTTP 403 on this credential",
    path: "audits",
    query: {},
    surface: "audits-collection",
  },
  {
    // MEASURED: the trust centre is not an absent API surface; a claim of "no Manage API surface, every
    // path answers 404" would rest on guessed paths.
    // Vanta's own published document declares THIRTY GET operations under `/trust-centers/{slugId}`, none
    // of which this atlas has called — see `generated/getEndpoints.ts`. The browser page is still the right
    // page to walk; the claim about the API beside it was false.
    description:
      "the trust centre. Its 30 documented Manage API operations are all keyed by a trust-centre slug this atlas does not yet read, so none has been called — they are `not-fetched` rows, not an absent surface",
    path: "trust-center",
    query: {},
    surface: "trust-center-collection",
  },
  {
    description: "reports",
    path: "reports",
    query: {},
    surface: "reports-collection",
  },
];

/*
 * Contracts, and why no page above claims them.
 *
 * Contracts are not reachable data as an admin in the browser, so they are out of scope. MEASURED, for this
 * tenant: `GET /v1/contracts` answers HTTP 403, and every candidate route in the web client —
 * `/contracts`, `/contracts/list`, `/vendor-contracts` — renders {@link VANTA_NOT_FOUND_TITLE}, while
 * `/vendors/contracts` simply redirects to the vendor register. So contracts are absent from BOTH channels
 * rather than API-refused and browser-reachable, which makes the 403 an entitlement this organisation does
 * not hold rather than a ceiling any role or channel could lift.
 *
 * Stated here rather than silently omitted, because a fact that contradicts an expectation of reachable
 * contracts must be visible rather than quietly dropped.
 */
