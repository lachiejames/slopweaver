/**
 * Knock's own five decisions about walking its dashboard. The engine is `kit/pageWalk.ts`.
 *
 * What is genuinely this platform's, and nothing else: how to learn the account and environment a page
 * hangs off, how to grade where the browser settled, what a first-party call reduces to, that a settle on a
 * Knock sign-in wall means the session has ended, and how long to let a page settle. The
 * declared/attempted/reached/photographed accounting, the lost-session stop, the duplicate-picture check
 * and the artifact addressing are the kit's, because every one of them is a property a copy silently loses.
 *
 * ## Reachability is graded on the ADDRESS, and the interesting failure is a silent rewrite
 *
 * The Knock dashboard is a single-page client that answers a route an account's plan does not open by
 * rewriting the address to the environment overview and returning 200. So a 404 is not the failure mode: a
 * page that has moved, or that this member's role does not open, looks exactly like a success until the
 * settled address is compared to the requested one. That comparison is the kit's `addressDisagreement`,
 * which {@link knockPageOutcome} turns into this platform's own sentences, and it is why the
 * duplicate-screenshot check in the kit matters here — every route silently rewritten to the overview
 * would otherwise be one more reached page sharing that one picture.
 *
 * The comparison used to be the PATH alone, which is the loose half of the pair the kit replaced. A
 * dashboard page whose identity lives in a query parameter — `…/controls?controlId=…` — was graded reached
 * when the client settled on a SIBLING of it, and the duplicate-screenshot check does not save that case:
 * two different controls render two different pictures, so the row is unique and reads `synced` while
 * evidencing the wrong object.
 *
 * ## A settled path is never quoted into a reason
 *
 * It carries the account slug, which identifies the organisation (`browserPages.ts`), so a reason says what
 * happened and not where. The requested ROUTE PATTERN is safe to name — this atlas declared it, and it
 * carries `[slug]` rather than a slug — and that is what a reader needs to act.
 */
import type { BrowserPageTransport, PageCapture } from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import {
  addressDisagreement,
  type PageObservation,
  type PageOutcome,
  type PageWalkResult,
  type PageWalkSpec,
  walkDeclaredPages,
} from "../kit/pageWalk.js";

import {
  isKnockSignInUrl,
  KNOCK_BROWSER_PAGES,
  KNOCK_ROOT_PROBE_PATH,
  type KnockBrowserPage,
  knockPageUrl,
  knockPhotographPolicy,
  knockRootFromFinalUrl,
} from "./browserPages.js";
import { type KnockObservedCall, reduceKnockCalls } from "./browserReduction.js";
import { KnockAtlasErrors, knockAtlasErrorLines } from "./errors.js";
import { knockPageArtifactPath } from "./store.js";
import { KNOCK_DASHBOARD_ORIGIN } from "./surfaceNaming.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * Six seconds, matching the Clerk, Notion and Xero walks rather than the Vanta walk's four: the dashboard
 * renders a settings page from a chain of its own Management API calls rather than in one pass, and the
 * deferred half of that chain is where the calls behind the browser-only pages live — which is the whole
 * reason this walk exists.
 *
 * @internal
 */
export const KNOCK_PAGE_SETTLE_MS = 6_000;

/** What one declared Knock page's visit came to. */
export type KnockPageObservation = PageObservation<KnockObservedCall>;

/**
 * What a Knock walk produced.
 *
 * @internal
 */
export type KnockBrowserWalkResult = PageWalkResult<KnockObservedCall>;

/** The account and environment every page hangs off. */
export interface KnockDashboardRoot {
  readonly account: string;
  readonly environment: string | null;
}

/**
 * Where this walk's root comes from, decided once at the flag parse so no `null` travels past it: a `--root`
 * the invocation supplied, or — when it supplied none — the landing probe.
 */
export type KnockRootSeed = { readonly from: "flag"; readonly root: KnockDashboardRoot } | { readonly from: "probe" };

/**
 * How one visited page's reachability is graded.
 *
 * A page counts as reached only when the browser settled where it was asked — the kit's
 * {@link addressDisagreement}, which is the same origin, the same path, and every query parameter this
 * atlas's own declaration named. A parameter the CLIENT appends is tolerated, because it is the dashboard
 * restoring its own view state — a saved filter, a selected tab — and that is a different fact from having
 * been sent elsewhere.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 *
 * @internal
 */
export function knockPageOutcome({
  requestedUrl,
  capture,
}: {
  requestedUrl: string;
  capture: PageCapture;
}): PageOutcome {
  const disagreement = addressDisagreement({ finalUrl: capture.finalUrl, requestedUrl });
  if (disagreement === "unreadable") {
    return { redirected: true, unreachableBecause: "the browser settled on an address this atlas cannot read" };
  }
  if (isKnockSignInUrl({ finalUrl: capture.finalUrl })) {
    return {
      redirected: true,
      unreachableBecause: "the browser was sent to a Knock sign-in wall, so this session is no longer signed in",
    };
  }
  if (disagreement === "origin") {
    return {
      redirected: true,
      unreachableBecause: "the dashboard sent this address to another origin, which is not where it was asked to go",
    };
  }
  if (disagreement !== null) {
    // The settled path is NOT quoted: it carries the account slug, which may not leave this process. The
    // requested page's own route pattern is what the caller already has.
    return {
      redirected: true,
      unreachableBecause: `the dashboard client did not keep this address — it answered ${String(capture.statusCode)} and rewrote the route to a different page of the same account, which is what it does with a route this member's role cannot open`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/**
 * Learn the account and environment, by asking the dashboard where it sends the bare origin.
 *
 * One navigation answers both: a signed-in dashboard redirects `/` to the account and environment it last
 * showed. A session that last left on an account-level page — settings, or the agent workspace — answers
 * the account and NO environment, which is a real state rather than a failure: the walk then holds the 31
 * account-scoped pages and records the 26 environment-scoped ones as rootless, with `rootMissingBecause`
 * naming the one-word fix.
 *
 * There is deliberately no second probe and no remembered root, and the difference from the Clerk walk is
 * worth stating rather than leaving as an omission. Clerk needed both because its application list is
 * server-rendered and carries neither identifier anywhere a probe can see. Knock's landing redirect carries
 * the account slug in the address bar every time, so a fallback would be a path nothing exercises — and an
 * untested recovery path is worse than a named gap.
 *
 * @param transport the bound page transport
 * @param seed the root the invocation supplied, used instead of probing, or the instruction to probe
 * @returns the root, `null` when the landing named no account, or the reason the dashboard was unreachable
 */
async function resolveDashboardRoot({
  transport,
  seed,
}: {
  transport: BrowserPageTransport;
  seed: KnockRootSeed;
}): Promise<Result<KnockDashboardRoot | null>> {
  if (seed.from === "flag") {
    return ok(seed.root);
  }
  const probe = await transport.visit({
    settleMs: KNOCK_PAGE_SETTLE_MS,
    url: `${KNOCK_DASHBOARD_ORIGIN}${KNOCK_ROOT_PROBE_PATH}`,
  });
  if (probe.isErr()) {
    // The probe asks for the bare ORIGIN, which carries no identifier, so quoting the transport's own
    // message is safe HERE and nowhere else — every other visit is addressed at a URL that carries one.
    return err(knockAtlasErrorLines({ error: KnockAtlasErrors.rootUnreachable({ detail: probe.error.message }) }));
  }
  if (isKnockSignInUrl({ finalUrl: probe.value.finalUrl })) {
    return err(knockAtlasErrorLines({ error: KnockAtlasErrors.signedOut() }));
  }
  return ok(knockRootFromFinalUrl({ finalUrl: probe.value.finalUrl }));
}

/**
 * Everything Knock contributes to a walk of its dashboard.
 *
 * A factory rather than a constant because one of the five decisions depends on this INVOCATION: whether a
 * root was supplied rather than probed for.
 *
 * The engine's root is a `string | null`, and this walk needs two slugs, so the root is carried as
 * `<account>/<environment>` — encoded here and decoded in {@link knockPageUrl}'s caller — rather than
 * widening a kit contract five other atlases satisfy for one platform's convenience.
 *
 * @param seed the root the invocation supplied, or the instruction to probe for one
 * @returns the spec `kit/pageWalk.ts` drives
 *
 * @internal
 */
export function knockPageWalkSpec({
  seed,
}: {
  seed: KnockRootSeed;
}): PageWalkSpec<KnockBrowserPage, KnockObservedCall> {
  return {
    artifactPathFor: ({ sha256 }) => knockPageArtifactPath({ sha256 }),
    gradeOutcome: ({ requestedUrl, capture }) => knockPageOutcome({ capture, requestedUrl }),
    pages: KNOCK_BROWSER_PAGES,
    photographPolicy: ({ page }) => knockPhotographPolicy({ page }),
    progressLabel: "knock dashboard",
    reduceCalls: ({ responses }) => reduceKnockCalls({ responses }),
    resolveRoot: async ({ transport }) => {
      const resolved = await resolveDashboardRoot({ seed, transport });
      return resolved.isErr() ? err(resolved.error) : ok(encodeRoot({ root: resolved.value }));
    },
    rootMissingBecause:
      "this page hangs off an account slug and an environment slug, and the dashboard's landing redirect" +
      " named no account — which happens when the session has never opened one. Open the Knock dashboard in" +
      " your own Chrome, land on an environment, and run the walk again, or pass" +
      " `slopweaver atlas knock walk --root <account>/<environment>` taking both segments from the" +
      " dashboard's own address bar",
    sessionLostOn: ({ capture }) => isKnockSignInUrl({ finalUrl: capture.finalUrl }),
    settleMs: KNOCK_PAGE_SETTLE_MS,
    signedOutHint:
      "the browser session was lost — sign in to the Knock dashboard in your own Chrome and run the walk again",
    urlFor: ({ root, page }) => knockPageUrl({ page, root: decodeRoot({ root }) }),
  };
}

/**
 * Pack the two slugs into the one string the walk engine carries.
 *
 * @param root the resolved root, or `null` when none was found
 * @returns `<account>/<environment>`, `<account>/` when there is no environment, or `null`
 * @internal
 */
export function encodeRoot({ root }: { root: KnockDashboardRoot | null }): string | null {
  if (root === null) {
    return null;
  }
  return root.environment === null ? `${root.account}/` : `${root.account}/${root.environment}`;
}

/**
 * Unpack what {@link encodeRoot} wrote.
 *
 * @param root the packed root, or `null`
 * @returns the two slugs, or `null` when there is no root
 * @internal
 */
export function decodeRoot({ root }: { root: string | null }): KnockDashboardRoot | null {
  if (root === null) {
    return null;
  }
  const [account = "", environment = ""] = root.split("/");
  return account === "" ? null : { account, environment: environment === "" ? null : environment };
}

/**
 * Walk every declared Knock dashboard page.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param seed the root the invocation supplied, or the instruction to probe for one
 * @param progress where a line of progress goes; omitted discards it
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkKnockDashboard({
  transport,
  writeArtifact,
  seed,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  seed: KnockRootSeed;
  progress?: (input: { line: string }) => void;
}): Promise<Result<KnockBrowserWalkResult>> {
  return walkDeclaredPages({
    spec: knockPageWalkSpec({ seed }),
    transport,
    writeArtifact,
    ...(progress === undefined ? {} : { progress }),
  });
}
