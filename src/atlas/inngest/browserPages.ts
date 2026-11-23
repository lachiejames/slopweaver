/**
 * The pages a walk visits, read out of the generation the sync published rather than hand-listed.
 *
 * ## The denominator is the APPLICATION's, which is why this atlas has no candidate list
 *
 * Every sibling walk here declares a hand-written route inventory and files a standing gap saying the
 * denominator is a hand list. This one does not need to: `dashboardRoutes.ts` reads the application's own
 * route table out of the bundle it ships a signed-out visitor, so the walk's denominator is the vendor's own
 * statement of its navigation surface. A route that disappears from that table disappears from the walk on
 * the next sync, and a route Inngest adds appears without anybody noticing it.
 *
 * ## An identifier segment is never invented
 *
 * A route carrying `$slug`, `$runID` or `$eventID` names a resource this atlas has no id for, and inventing
 * one would photograph the application's own not-found page and record it as that route. Only `$envSlug` is
 * substituted, and only with the slug the RUNNING client itself landed on — see `browserWalk.ts`'s root
 * resolution. Everything else is left declared and unwalked, which the compiled channel already records.
 *
 * ## No declared route may DO anything
 *
 * The transport navigates and observes; it performs no click and no form submission. This filter is the
 * other half of the same property: `/sign-out` ends the session, and the `connect`, `callback` and `start`
 * legs of an integration route are the middle of somebody's OAuth handshake. Visiting one is not a read, so
 * none is admissible here however interesting its page would be to photograph.
 */
import type { InngestAtlasEntity } from "./model.js";
import { INNGEST_PAGE_KIND } from "./model.js";

/** The dashboard's origin. */
export const INNGEST_APP_ORIGIN = "https://app.inngest.com";

/**
 * Where the dashboard sends a signed-out browser. A settle here means the session has ended.
 *
 * @internal
 */
export const INNGEST_SIGN_IN_PATH = "/sign-in";

/**
 * The route segment whose value the running client supplies.
 *
 * @internal
 */
export const INNGEST_ENV_PARAM = "$envSlug";

/** One page the walk will visit. */
export interface InngestBrowserPage {
  /** The declared route, `$envSlug` intact — this is the entity's own provider id, so it must not be filled in. */
  readonly surface: string;
  /** Which dashboard section it sits in. */
  readonly section: string;
}

/**
 * Routes whose visit is an ACT rather than a read, matched on their own declared path.
 *
 * Each is named with the reason rather than folded into a pattern, because "this one signs you out" and
 * "this one is the middle of an OAuth handshake" are different reasons and a reader should see both.
 */
export const INNGEST_INADMISSIBLE_ROUTES: Readonly<Record<string, string>> = {
  "/settings/integrations/datadog/connect-env": "an integration connection step, which is a write",
  "/settings/integrations/datadog/finish": "an integration connection step, which is a write",
  "/settings/integrations/datadog/start": "an integration connection step, which is a write",
  "/settings/integrations/neon/connect": "an integration connection step, which is a write",
  "/settings/integrations/supabase/connect": "an integration connection step, which is a write",
  "/settings/integrations/vercel/connect": "an integration connection step, which is a write",
  "/integrations/vercel/callback": "the middle of somebody's OAuth handshake",
  "/integrations/vercel/callback/success": "the middle of somebody's OAuth handshake",
  "/intent/create-webhook": "an intent route whose whole purpose is to create a webhook",
  "/intent/setup-aws-marketplace": "an intent route that starts a marketplace subscription",
  "/create-environment": "a route whose whole purpose is to create an environment",
  "/sign-out": "it ends the session, and every page after it would be a false gap",
  "/switch-organization": "it changes which organisation the session is in",
  "/organization-setup": "an onboarding route that writes",
  "/user-setup": "an onboarding route that writes",
};

/**
 * The dashboard section one stored page entity records, or `root` when its detail does not carry one.
 *
 * The compiled channel's detail is `unknown` on the stored entity — the store validates it per kind rather
 * than at the channel — so this reads the one field it needs and falls back rather than parsing a schema it
 * does not own.
 */
function sectionOf({ detail }: { detail: unknown }): string {
  if (typeof detail === "object" && detail !== null && "section" in detail) {
    const section: unknown = (detail as Record<string, unknown>)["section"];
    return typeof section === "string" ? section : "root";
  }
  return "root";
}

/**
 * The routes whose page RENDERS a credential, and must therefore never be photographed.
 *
 * Inngest masks every credential in its own dashboard behind a reveal control this walk never clicks, so a
 * screenshot of either page shows `signkey-prod-XXXX…` or `sk-inn-api••••<last four>` rather than a secret.
 * That is the PLATFORM's property and it can change without warning, which is exactly why it is not the only
 * thing standing between this atlas and a stored secret. The refusal below is checked before the bytes are
 * ever produced (`kit/pageWalk.ts`'s `photographPolicy`), so the picture does not exist rather than being
 * deleted afterwards — clearing a reference is not withholding a file.
 *
 * The page is still WALKED: its existence, its title, its own calls and its GraphQL operations are all atlas
 * content. Only the picture is withheld, and the row says so.
 */
export const INNGEST_UNPHOTOGRAPHABLE_ROUTES: Readonly<Record<string, string>> = {
  "/env/$envSlug/manage/$ingestKeys": "the page lists this environment's event keys",
  "/env/$envSlug/manage/signing-key": "the page renders this environment's signing key",
  "/settings/api-keys": "the page lists this account's API keys",
};

/**
 * Why one page's picture may not be written, or `null` when it may.
 *
 * @param page the declared page about to be visited
 * @returns the refusal and its reason, or `null` to photograph it
 */
export function inngestPhotographPolicy({ page }: { page: InngestBrowserPage }): { refusedBecause: string } | null {
  const reason = INNGEST_UNPHOTOGRAPHABLE_ROUTES[page.surface];
  return reason === undefined ? null : { refusedBecause: reason };
}

/** Whether a declared route carries an identifier segment this atlas will not invent. */
function needsUnknownIdentifier({ routePath }: { routePath: string }): boolean {
  return routePath
    .split("/")
    .some((segment) => segment.startsWith("$") && segment !== INNGEST_ENV_PARAM && segment !== "$");
}

/**
 * The pages a walk may visit, selected from the generation's own `page` entities.
 *
 * @param entities every entity the `page` kind holds
 * @returns the admissible pages, sorted by route, each carrying the section its compiled channel recorded
 */
export function inngestWalkablePages({
  entities,
}: {
  entities: readonly InngestAtlasEntity[];
}): readonly InngestBrowserPage[] {
  const pages: InngestBrowserPage[] = [];
  for (const entity of entities) {
    if (entity.kind !== INNGEST_PAGE_KIND) {
      continue;
    }
    const routePath = entity.providerId;
    if (routePath in INNGEST_INADMISSIBLE_ROUTES || needsUnknownIdentifier({ routePath })) {
      continue;
    }
    if (routePath.endsWith("/$")) {
      continue;
    }
    pages.push({ section: sectionOf({ detail: entity.channels.compiled?.detail }), surface: routePath });
  }
  return pages.toSorted((left, right) => left.surface.localeCompare(right.surface));
}

/**
 * The absolute address one declared page is visited at.
 *
 * @param page the declared page
 * @param environmentSlug the slug the running client itself landed on, or `null` when it named none
 * @returns the URL, or `null` when the page needs an environment there is none of
 */
export function inngestPageUrl({
  page,
  environmentSlug,
}: {
  page: InngestBrowserPage;
  environmentSlug: string | null;
}): string | null {
  if (!page.surface.includes(INNGEST_ENV_PARAM)) {
    return `${INNGEST_APP_ORIGIN}${page.surface}`;
  }
  if (environmentSlug === null) {
    return null;
  }
  return `${INNGEST_APP_ORIGIN}${page.surface.replaceAll(INNGEST_ENV_PARAM, environmentSlug)}`;
}

/**
 * Whether the browser settled on the dashboard's sign-in page, which is how a lost session announces itself.
 *
 * @param finalUrl where the browser settled
 * @returns whether this page was sent to sign in
 */
export function isInngestSignInLanding({ finalUrl }: { finalUrl: string }): boolean {
  try {
    return new URL(finalUrl).pathname.startsWith(INNGEST_SIGN_IN_PATH);
  } catch {
    return false;
  }
}
