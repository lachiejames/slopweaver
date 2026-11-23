/**
 * The browser navigation surface of `console.prisma.io`, and the measured reason it is two routes rather
 * than twenty.
 *
 * ## The probe that works on every sibling atlas does not work here, and that is the finding
 *
 * The Figma and Airtable inventories were built by an unauthenticated probe against a control: an invented
 * path answers 404, a real one answers something else, and the difference is the evidence. MEASURED,
 * that method yields nothing at all on this origin. `/workspaces`, `/settings`, `/integrations`,
 * `/admin`, `/account`, `/new`, `/robots.txt`, `/sitemap.xml` and the invented control
 * `/zzz-not-a-real-route-control` **all answer the identical `302 → /login`**. The authentication gate sits
 * in front of the router, so a signed-out request cannot tell a real page from one nobody has built.
 *
 * Declaring `/settings` here as "auth-gated" would therefore be declaring it on exactly the evidence that
 * supports declaring `/zzz-not-a-real-route-control`. This file does not do that. The inventory is what was
 * actually established, and the emptiness beyond it is stated as a gap rather than filled with plausible
 * guesses — `docs/atlas-intent/settled-decisions.md`'s "honest about where it thinks it's got gaps", applied to the case
 * where being honest means the list is short.
 *
 * ## The application's OWN route manifest agrees, which is what turns an inference into a measurement
 *
 * The console is a React Router single-page application and embeds `window.__reactRouterManifest` in the
 * HTML it serves a signed-out visitor. That manifest declares four entries — `root`, an `_authentication`
 * layout, `_authentication.login` at path `login`, and an `_index` — so **the application itself tells an
 * anonymous client it has two addressable paths and nothing else.** The rest of the route tree is served
 * only after authentication; the `routes-*.js` chunk the page preloads carries no route table at all.
 *
 * Reproduce both halves:
 *
 * ```bash
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --console          # print each route's evidence class
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --console --verify # exit non-zero if a row moved
 * ```
 *
 * ## What this means for the browser surface, which NEVER shrinks
 *
 * `docs/atlas-intent/02-both-surfaces.md` makes both surfaces mandatory and the owner's ruling makes the
 * browser half permanent. Nothing here weakens either. The console surface is DECLARED, its ceiling is
 * measured, and `descriptor.ts` carries a `console-walk` surface as `declared-unfilled` naming exactly what
 * would fill it: a walk in the owner's own work Chrome, signed in. What this atlas will not do is
 * manufacture an inventory a probe never established — and a signed-out console is graded signed-out and
 * becomes a card for the owner, never a credential a session types.
 */

/**
 * What an unauthenticated request established about one console route.
 *
 * - `public-200` — it answered `200` with no session, so it exists and renders to anybody.
 * - `json-endpoint` — it answered a JSON error rather than the sign-in redirect, so it exists and is an
 *   endpoint rather than a page. Distinguishable from the control, which is what makes it evidence.
 * - `manifest-declared` — the application's own signed-out route manifest names it. Independent of the
 *   HTTP probe and, on this origin, stronger than it.
 * - `indistinguishable-from-control` — it answered exactly what an invented path answers. Establishes
 *   NOTHING about this route. No row in this file carries it; the class exists so the probe tool has a
 *   verdict to print for a candidate, and so this vocabulary can say out loud what the origin does.
 * @internal
 */
export const PRISMA_CONSOLE_EVIDENCE = [
  "public-200",
  "json-endpoint",
  "manifest-declared",
  "indistinguishable-from-control",
] as const;

/**
 * What an unauthenticated request established about one console route.
 * @internal
 */
export type PrismaConsoleEvidence = (typeof PRISMA_CONSOLE_EVIDENCE)[number];

/** One route in the declared console navigation surface. */
export interface PrismaConsoleRoute {
  /** What a signed-out probe or the signed-out route manifest established. */
  readonly evidence: PrismaConsoleEvidence;
  /** What this route is, in a reader's words rather than Prisma's. */
  readonly holds: string;
  /** The route, on the console origin. Never carries a real identifier. */
  readonly route: string;
  /**
   * Whether a walk should photograph this page. The owner's ruling: settings and admin pages get a
   * screenshot; a page whose content is the organisation's own data does not.
   */
  readonly screenshot: boolean;
}

/** The origin every console route hangs off. */
export const PRISMA_CONSOLE_ORIGIN = "https://console.prisma.io";

/**
 * Every console route this atlas has actually established, sorted.
 *
 * Two, and the shortness is the measurement rather than a stub. `/` is in here as `manifest-declared`
 * rather than `public-200` because its HTTP answer is the same `302 → /login` the control gets — only the
 * application's own manifest, which declares an `_index` at the root, distinguishes it. That is exactly the
 * distinction the two evidence classes exist to keep.
 */
export const PRISMA_CONSOLE_ROUTES: readonly PrismaConsoleRoute[] = [
  {
    evidence: "manifest-declared",
    holds:
      "the console's index. Its HTTP answer is indistinguishable from the control's, and the signed-out" +
      " route manifest's `_index` entry is what establishes it exists; what it renders to a signed-in" +
      " person is a question only a walk answers",
    route: "/",
    screenshot: false,
  },
  {
    evidence: "public-200",
    holds:
      "the sign-in page, and the only page of this product a signed-out browser can see. It is also where" +
      " the route manifest is served from, so it is the source of everything else known about this origin",
    route: "/login",
    screenshot: true,
  },
  {
    evidence: "json-endpoint",
    holds:
      "the sign-out endpoint. It answers `400 application/json` to a request carrying no session rather" +
      " than the redirect everything else answers, which is what tells it apart from the control — so it" +
      " exists, and it is an endpoint rather than a page a walk would photograph",
    route: "/logout",
    screenshot: false,
  },
];

/**
 * What the signed-out route manifest declared, pinned so a change is a diff rather than a rediscovery.
 *
 * The count is the load-bearing part: four entries, of which two carry an addressable path. If Prisma ever
 * ships a manifest listing the whole route tree to anonymous visitors, this number moves and the probe tool
 * refuses — which is the day this atlas can compile a real console inventory without a walk.
 */
export const PRISMA_CONSOLE_MANIFEST = {
  /** Where it is embedded. */
  servedFrom: "https://console.prisma.io/login",
  /** The global it is assigned to in that page. */
  global: "window.__reactRouterManifest",
  /** How many route entries it declares to a signed-out client. */
  declaredEntries: 4,
  /** Their ids, sorted, so a renamed route is visible. */
  declaredIds: ["root", "routes/_authentication", "routes/_authentication.login", "routes/_index"],
  /** How many of those carry a path a browser can be sent to. */
  addressablePaths: 2,
} as const;

/**
 * The control every console verdict is measured against.
 *
 * It answers `302 → /login`, exactly like every real route, which is the whole finding. On every sibling
 * atlas the control answers 404 and its failure would invalidate the method; here it AGREES with the real
 * routes, and it is the agreement that has to hold. If this control ever starts answering 404, the origin
 * has begun discriminating and a real inventory becomes compilable — so the probe tool refuses on that
 * change too, in the opposite direction from every other atlas.
 */
export const PRISMA_CONSOLE_CONTROL = "/zzz-not-a-real-route-control";

/**
 * The routes a signed-out probe cannot tell apart from the control, kept as CANDIDATES rather than as
 * inventory.
 *
 * They are not declared routes and this atlas does not claim they exist. They are here so a walk has a
 * starting frontier and so a reader can see that the question was asked rather than skipped — every one was
 * requested and every one answered exactly what {@link PRISMA_CONSOLE_CONTROL} answered.
 * `/robots.txt` and `/sitemap.xml` are in the list deliberately: a reader who assumed a web application
 * serves those learns from the atlas that this one does not.
 */
export const PRISMA_CONSOLE_CANDIDATES: readonly string[] = [
  "/account",
  "/admin",
  "/auth/callback",
  "/consent",
  "/integrations",
  "/invite",
  "/new",
  "/oauth/authorize",
  "/reset-password",
  "/robots.txt",
  "/settings",
  "/signup",
  "/sitemap.xml",
  "/verify",
  "/workspaces",
];
