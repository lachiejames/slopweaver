/**
 * What `slopweaver perf console` walks: every fixed console route loaded cold, every sidebar item clicked warm, and the
 * flows that open something inside a page — pure data, so the walk's coverage is a unit test rather than a habit.
 * A detail page needs a live id, so it is not a route here. A pull request's and a session's are reached by their
 * in-page flow, through the first link to one the list page draws. The third, a mail preview (`/queue/mail/<slug>/<digest>`), is NOT
 * walked: its only link sits inside a queue card's panel, two presses deep, and a flow here is one press.
 *
 * The routes are the console's own (`site/app/(console)/*`), and the sidebar items are the hrefs of
 * `SIDEBAR_ENTRIES` (`site/lib/sidebarCounts.ts`), which `site/components/console/Shell.tsx` draws, Docs at its foot
 * included — `site/__tests__/unit/sidebarCounts.test.ts` holds the two lists equal, since `src/` cannot import the
 * site. Settings is a modal rather than a page, so it is an in-page flow below rather than a route. Every fixed route is
 * in the sidebar; a page outside it would still be loaded cold, marked `inSidebar: false`, and never clicked warm.
 * `/docs` is a separate root layout (Nextra), so a click to it is a full document load and is timed as one.
 */

/** One page the walk loads in a fresh browser context. */
export interface ConsoleRoute {
  /** The path, as the owner would type it. */
  readonly path: string;
  /** Whether the sidebar links to it, so it is also clicked warm. */
  readonly inSidebar: boolean;
}

/** Every fixed console route, in the sidebar's own order first and then the pages reached from a link. */
export const CONSOLE_ROUTES: readonly ConsoleRoute[] = [
  { inSidebar: true, path: "/queue" },
  { inSidebar: true, path: "/alignment" },
  { inSidebar: true, path: "/pull-requests" },
  { inSidebar: true, path: "/workstreams" },
  { inSidebar: true, path: "/automations" },
  { inSidebar: true, path: "/fleet" },
  { inSidebar: true, path: "/docs" },
];

/**
 * A page counts as drawn when this is on screen and {@link PAGE_PENDING} is not: every console page and every docs
 * page opens on one heading, and the route's `loading.tsx` skeleton carries `data-console-loading` while it stands.
 */
export const PAGE_LANDED = "h1";

/** The route-level skeleton (`site/app/(console)/loading.tsx`). */
export const PAGE_PENDING = "[data-console-loading]";

/**
 * Anything on screen that says "still loading": the route skeleton, a sidebar item mid-navigation, a busy region, a
 * pulsing placeholder bar, or a live tile that marks itself as reading.
 */
export const LOADING_SHOWN =
  '[data-console-loading], [data-nav-progress], [data-nav-pending="true"], [aria-busy="true"], .animate-pulse, [data-live-phase="loading"]';

/** One timed click: what is pressed, on which page, and what "landed" means for it. */
export interface ConsoleClick {
  /** The name a row in the table carries. */
  readonly name: string;
  /** The page the click starts on, already drawn and settled. */
  readonly from: string;
  /** The CSS selector of the thing clicked — the first match is clicked. */
  readonly target: string;
  /**
   * `page` lands on a new address — `to` when the destination is known up front, any other path when it is a link
   * the page drew. `panel` stays on the page and opens something over it.
   */
  readonly opens: "page" | "panel";
  /** The path a `page` click lands on, when it is known before the click. */
  readonly to: string | undefined;
  /** Present once the destination is drawn. */
  readonly landed: string;
  /** Present while the destination is still a skeleton, so its absence is part of "drawn". */
  readonly pending: string;
}

/**
 * The warm click sequence: from the queue, each sidebar item in turn, so every item is reached from a page that has
 * already drawn and every item is LEFT as well as entered — a page that is slow to tear down shows up as a slow click
 * away from it. The docs are a separate root layout with no console sidebar, so the walk returns from them by loading
 * the page before, and the last click is back to the queue from there.
 *
 * @param routes the routes the walk covers
 * @returns the clicks in order
 */
export function sidebarClicks({ routes }: { routes: readonly ConsoleRoute[] }): readonly ConsoleClick[] {
  const items = routes.filter((route) => route.inSidebar).map((route) => route.path);
  const start = items[0];
  if (start === undefined) {
    return [];
  }
  const click = ({ from, to }: { from: string; to: string }): ConsoleClick => ({
    from,
    landed: PAGE_LANDED,
    name: `${from} → ${to}`,
    opens: "page",
    pending: PAGE_PENDING,
    // The shell's sidebar, not its `console` nav: the Docs link sits below that nav, beside the theme picker. Each
    // link carries the work context as a query (`navHref`, `site/lib/workContext.ts`), so the path is matched with
    // or without one.
    target: `aside.sw-glass-sidebar a[href="${to}"], aside.sw-glass-sidebar a[href^="${to}?"]`,
    to,
  });
  const clicks: ConsoleClick[] = [];
  let at = start;
  for (const to of items.slice(1)) {
    clicks.push(click({ from: at, to }));
    at = to;
  }
  const lastConsole = items.findLast((path) => path !== "/docs");
  if (lastConsole !== undefined && lastConsole !== start) {
    clicks.push(click({ from: lastConsole, to: start }));
  }
  return clicks;
}

/**
 * The flows inside pages. Each selector is one the page draws for exactly the thing named, so the walk clicks what
 * the owner would click; a page that holds none (an empty queue) reports the flow as not run rather than timing nothing.
 *
 * - A queue row is a `button[data-kind]` (`site/components/console/QueueSections.tsx`); it opens the card as a
 *   `role="dialog"` slide-over, which draws `LoadingPanel`'s pulsing bars until the card's own reads arrive.
 * - A pull request on the list links to `/pull-requests/<owner>/<repo>/<number>`.
 * - A session's full-page view is `/fleet/session/<id>`; the walk reports the flow not run when `/fleet` draws no
 *   link to one.
 * - The sidebar's Settings entry is its one `aria-haspopup="dialog"` button (`ShellNav.tsx`), opening the Settings
 *   modal (`site/components/console/SettingsModal.tsx`) over the page as a `role="dialog"`.
 */
export const CONSOLE_FLOWS: readonly ConsoleClick[] = [
  {
    from: "/queue",
    landed: '[role="dialog"]',
    name: "open settings",
    opens: "panel",
    pending: '[role="dialog"] .animate-pulse',
    target: 'aside.sw-glass-sidebar button[aria-haspopup="dialog"]',
    to: undefined,
  },
  {
    from: "/queue",
    landed: '[role="dialog"]',
    name: "open a queue card",
    opens: "panel",
    pending: '[role="dialog"] .animate-pulse',
    target: "main button[data-kind]",
    to: undefined,
  },
  {
    from: "/pull-requests",
    landed: PAGE_LANDED,
    name: "open a pull request",
    opens: "page",
    pending: PAGE_PENDING,
    // The page's first link to a pull request's own view: a row's title (`PrLead`, `site/components/live/PrCard.tsx`),
    // or a census number drawn above the rows (`NotPlaced`, `PrCensus.tsx`) — both are `consolePullHref`, so either
    // opens the same detail page. Never a row's open button, which opens the slide-over in place.
    target: 'main a[href^="/pull-requests/"]',
    to: undefined,
  },
  {
    from: "/fleet",
    landed: PAGE_LANDED,
    name: "open a session",
    opens: "page",
    pending: PAGE_PENDING,
    target: 'main a[href^="/fleet/session/"]',
    to: undefined,
  },
];
