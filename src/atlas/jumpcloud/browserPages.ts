/**
 * The JumpCloud administrator console's declared pages — the walk's denominator — and the rules for reading
 * where a visit settled.
 *
 * ## The list is DECLARED, from the console's own navigation, and an oracle subset makes it falsifiable
 *
 * JumpCloud publishes no manifest of its console's routes, and its left navigation is a set of fly-outs whose
 * sub-links are not in the document until one is hovered or clicked — both refused on this host by the owner's rule
 * (`browser/action.ts`: never click, hover or focus on a JumpCloud page). So the list below was declared by
 * navigating to each candidate route directly in the owner's signed-in Chrome and keeping the ones that
 * held their address and rendered a page through a full walk's settle — the bottom of this file names every
 * candidate that did not, and where the client sent it. A crawler's own discovered-route list is not a denominator
 * (`atlas-jumpcloud` § Transfers, finding 1); {@link JUMPCLOUD_ORACLE_SURFACES} is the handful MEASURED to
 * render real content, which a walk must reach or the surface is not filled whatever else it holds.
 *
 * ## The console is HASH-ROUTED, and that changes what "settled where asked" means
 *
 * Every page is `https://console.jumpcloud.com/#/<route>`: origin and path are the same for all of them, and the
 * page's identity is the FRAGMENT. The kit's `addressDisagreement` deliberately ignores a fragment, so on its
 * own it would grade the client's catch-all — measured: `#/zz-not-a-route` settles on `#/home` — as a page
 * held. {@link hashRouteDisagreement} is the missing half, and `browserWalk.ts` asks both.
 *
 * ## Query state is in the client, not the address
 *
 * The CrowdStrike walk learned that the owner's real Chrome restores a saved filter and a bare path then photographs a
 * narrowed view. This console keeps a list's filters and saved view client-side: nothing in the fragment
 * addresses them. Where the console DOES put view state in the address, it is a route segment
 * (`devices/list/unenrolled`, `mdm/apple`, `groups/device`), and those are declared as separate pages. A
 * standing gap (`console-view-state-not-addressable`) says the rest out loud rather than an empty query value
 * pretending to clear a filter.
 *
 * ## Landing on the sign-in or end-user portal is a LOST SESSION
 *
 * A signed-out browser settles on `/login/…`; the work Chrome's other JumpCloud identity is the end-user portal
 * at `/userconsole`. Both are SUCCESSFUL navigations, so {@link isSignInSettle} is checked first and stops the
 * walk rather than grading every remaining page a failure (measured: `#/home` → `/login/admin`).
 *
 * ## No declared route may DO anything
 *
 * Every route is a list or an overview. Nothing that adds, creates, imports, exports or deletes is declared —
 * `#/users/add` and `#/commands/new` are on the home page's own quick actions and are deliberately absent.
 */

/** The origin the administrator console is served from. */
export const JUMPCLOUD_CONSOLE_ORIGIN = "https://console.jumpcloud.com";

/**
 * The document title the administrator console renders on every page.
 *
 * @internal
 */
export const JUMPCLOUD_ADMIN_TITLE = "JumpCloud Admin Portal";

/**
 * The console's own left-navigation section a page sits under, as the console labels it.
 *
 * @internal
 */
export type JumpcloudConsoleSection =
  | "top"
  | "monitoring"
  | "identity-management"
  | "device-management"
  | "access"
  | "security"
  | "insights"
  | "workflows"
  | "settings";

/** One declared page of the administrator console. */
export interface JumpcloudConsolePage {
  /** The name its coverage row and its entity are reported under. Unique across the list. */
  readonly surface: string;
  /** The hash route, with no leading `#/`. */
  readonly route: string;
  /** Query state inside the fragment that overrides the client's own, or empty when none is addressable. */
  readonly query: Readonly<Record<string, string>>;
  readonly section: JumpcloudConsoleSection;
  readonly description: string;
}

/**
 * Every declared page, in navigation order.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_PAGES: readonly JumpcloudConsolePage[] = [
  {
    description: "the onboarding checklist the console opens a new administrator on",
    query: {},
    route: "getStarted",
    section: "top",
    surface: "get-started",
  },
  {
    description: "the administrator home: organisation health, user status and device fleet widgets",
    query: {},
    route: "home",
    section: "top",
    surface: "home",
  },
  {
    description: "open, acknowledged and resolved alerts, and the rules that raise them",
    query: {},
    route: "alerts",
    section: "monitoring",
    surface: "alerts",
  },
  {
    description: "the JumpCloud-provided reports, where `#/reports` sends the client",
    query: {},
    route: "reports/jumpcloud",
    section: "monitoring",
    surface: "reports",
  },
  {
    description: "every user, with state, password status and MFA enrolment",
    query: {},
    route: "users",
    section: "identity-management",
    surface: "users",
  },
  {
    description: "user groups",
    query: {},
    route: "groups/user",
    section: "identity-management",
    surface: "user-groups",
  },
  {
    description: "cloud directory integrations, where `#/directories` sends the client",
    query: {},
    route: "directories/cloud-directories",
    section: "identity-management",
    surface: "directories",
  },
  {
    description: "every managed device",
    query: {},
    route: "devices/list",
    section: "device-management",
    surface: "devices",
  },
  {
    description: "devices not enrolled in JumpCloud MDM, the banner's own link",
    query: {},
    route: "devices/list/unenrolled",
    section: "device-management",
    surface: "devices-unenrolled",
  },
  {
    description: "device groups",
    query: {},
    route: "groups/device",
    section: "device-management",
    surface: "device-groups",
  },
  {
    description: "policy management — every configured policy, where `#/policies` sends the client",
    query: {},
    route: "configurations",
    section: "device-management",
    surface: "policies",
  },
  {
    description: "commands administrators have written",
    query: {},
    route: "commands",
    section: "device-management",
    surface: "commands",
  },
  {
    description: "Apple MDM configuration, where `#/mdm` sends the client",
    query: {},
    route: "mdm/apple",
    section: "device-management",
    surface: "mdm-apple",
  },
  {
    description: "SSO applications",
    query: {},
    route: "applications",
    section: "access",
    surface: "sso-applications",
  },
  {
    description: "cloud LDAP",
    query: {},
    route: "ldap",
    section: "access",
    surface: "ldap",
  },
  {
    description: "RADIUS servers",
    query: {},
    route: "radius",
    section: "access",
    surface: "radius",
  },
  {
    description: "certificate activation, where `#/certificates` sends the client",
    query: {},
    route: "certificates/activation",
    section: "security",
    surface: "certificates",
  },
  {
    description: "Directory Insights — the event log, with its time range, service and event-type filters",
    query: {},
    route: "insights",
    section: "insights",
    surface: "directory-insights",
  },
  {
    description: "SaaS management — discovered and managed applications",
    query: {},
    route: "saas-management/applications",
    section: "insights",
    surface: "saas-applications",
  },
  {
    description: "workflow runs, where `#/workflows` sends the client",
    query: {},
    route: "workflows/overview",
    section: "workflows",
    surface: "workflows",
  },
  {
    description: "the organisation profile, where `#/settings` sends the client",
    query: {},
    route: "settings/organization",
    section: "settings",
    surface: "settings",
  },
  {
    description: "administrators and their roles",
    query: {},
    route: "settings/administrators",
    section: "settings",
    surface: "settings-administrators",
  },
];

/**
 * The pages MEASURED to render real content in the owner's console — the oracle a walk must reach.
 *
 * Independent of the list above in the one way that matters: each was confirmed by what it rendered (a users
 * table, an alerts list, a reports tab strip), not by the fact that it held its address.
 *
 * @internal
 */
export const JUMPCLOUD_ORACLE_SURFACES: readonly string[] = [
  "alerts",
  "devices",
  "directory-insights",
  "home",
  "ldap",
  "policies",
  "radius",
  "reports",
  "users",
];

/*
 * Candidates probed and deliberately NOT declared, stated rather than silently omitted.
 *
 * - The routes that held their address on a bare `browser open` probe and were sent to `#/home` by the
 *   first full walk's eight-second settle (`slopweaver atlas jumpcloud walk`): `identity-providers`,
 *   `policy-groups`, `software`, `patch-management`, `os-updates`, `remote-assist`, `privileged-access`,
 *   `access-requests`, `conditional-policies`, `mfa`, `identity-risk`, `ip-lists`. A late client redirect
 *   is the walk's own verdict that the route names no page on an account.
 * - `#/reports`, `#/directories`, `#/certificates` and `#/settings` — the client forwards each to one of
 *   its own sub-routes, which is what is declared above.
 * - `#/conditional-access`, `#/hr-directories`, `#/device-trust`, `#/administrators` — the client sends each
 *   to `#/home`, so each names nothing (`conditional-access` held its address on one probe and was sent home
 *   on the next: a late client redirect, which is exactly what the walk's settle exists to catch).
 * - `#/directory-insights`, `#/password-manager`, `#/systemInsights` — each keeps its address and renders an
 *   empty content pane beside the navigation: a route the shell accepts and no page answers.
 * - `#/users/add`, `#/devices/new/macos`, `#/commands/new` — creation flows (this file's last rule).
 */

/** A URL, or `null` when it cannot be read. */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The absolute address of one declared page.
 *
 * @param page the declared page
 * @returns `https://console.jumpcloud.com/#/<route>`, with the fragment query when the page declares one
 */
export function jumpcloudConsolePageUrl({ page }: { page: JumpcloudConsolePage }): string {
  const query = new URLSearchParams(page.query).toString();
  return `${JUMPCLOUD_CONSOLE_ORIGIN}/#/${page.route}${query.length > 0 ? `?${query}` : ""}`;
}

/** A hash route read out of a fragment: its path and the query inside it. */
export interface JumpcloudHashRoute {
  /** The route path with no leading `#` and no trailing slash, e.g. `/devices/list`. */
  readonly path: string;
  readonly params: URLSearchParams;
}

/**
 * Read the hash route out of an address.
 *
 * @param url an absolute address
 * @returns the route, or `null` when the address cannot be read
 */
export function hashRouteOf({ url }: { url: string }): JumpcloudHashRoute | null {
  const parsed = parseUrl({ url });
  if (parsed === null) {
    return null;
  }
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const [path = "", query = ""] = fragment.split("?", 2);
  return { params: new URLSearchParams(query), path: path.replace(/\/+$/, "") };
}

/**
 * Whether every fragment parameter the request carried is held in the settled fragment, value for value.
 *
 * A multiset containment, the same rule `kit/pageWalk.ts` applies to the query outside the fragment: a
 * parameter the CLIENT appends is its own view state and does not change which page this is.
 */
function requestedParamsHeld({
  requested,
  settled,
}: {
  requested: URLSearchParams;
  settled: URLSearchParams;
}): boolean {
  const remaining = new Map<string, number>();
  for (const [name, value] of settled.entries()) {
    const key = `${String(name.length)}:${name}${value}`;
    const held = remaining.get(key);
    remaining.set(key, held === undefined ? 1 : held + 1);
  }
  for (const [name, value] of requested.entries()) {
    const key = `${String(name.length)}:${name}${value}`;
    const left = remaining.get(key);
    if (left === undefined || left === 0) {
      return false;
    }
    remaining.set(key, left - 1);
  }
  return true;
}

/**
 * Which part of the hash route the browser did not keep — the half of page identity the kit cannot see.
 *
 * @param requestedUrl the address the walk asked for
 * @param finalUrl where the browser settled
 * @returns `"route"` when the route path moved, `"route-query"` when a requested fragment parameter was
 *   dropped, `"unreadable"` when either address cannot be read, or `null` when the route held
 */
export function hashRouteDisagreement({
  requestedUrl,
  finalUrl,
}: {
  requestedUrl: string;
  finalUrl: string;
}): "unreadable" | "route" | "route-query" | null {
  const requested = hashRouteOf({ url: requestedUrl });
  const settled = hashRouteOf({ url: finalUrl });
  if (requested === null || settled === null) {
    return "unreadable";
  }
  if (requested.path !== settled.path) {
    return "route";
  }
  return requestedParamsHeld({ requested: requested.params, settled: settled.params }) ? null : "route-query";
}

/**
 * Whether the browser settled on the sign-in page or the end-user portal rather than the administrator console.
 *
 * @param finalUrl where the browser settled
 * @returns whether the administrator session is not what the browser is holding
 */
export function isSignInSettle({ finalUrl }: { finalUrl: string }): boolean {
  const parsed = parseUrl({ url: finalUrl });
  if (parsed === null) {
    return false;
  }
  return parsed.pathname.startsWith("/login") || parsed.pathname.startsWith("/userconsole");
}
