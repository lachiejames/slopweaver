/**
 * Vanta's own five decisions about walking its web client. The engine is `kit/pageWalk.ts`.
 *
 * What is genuinely this platform's, and nothing else: how to learn the tenant root a page hangs off, how
 * to grade where the browser settled, what a first-party call reduces to, that a settle on Vanta's sign-in
 * wall means the session has ended, and how long to let a page settle. The declared/attempted/reached/
 * PHOTOGRAPHED accounting, the lost-session stop, the duplicate-picture check and the artifact addressing
 * are the kit's.
 *
 * ## Why this walk was rewritten onto the engine rather than given a screenshot flag
 *
 * MEASURED: this walk reached every declared page, published the operations it observed, and stored ZERO
 * images — `find ~/.slopweaver/atlas/vanta -name '*.png'` returned nothing where the Notion atlas's own
 * screenshots were found. The
 * transport had been photographing every page all along and the walk was discarding
 * {@link PageCapture.screenshotPng} without recording that it had. Its own module header said "photograph
 * each", which is the shape of failure a hand-written walk produces and the engine cannot: an atlas whose
 * coverage cell reads `synced` while it holds no evidence at all. Vanta was the last hand-written walk, so
 * the fix is the migration rather than a sixth copy of the kit's forty lines.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A declared page may 404, may be gated behind an entitlement, or may land somewhere else entirely. Each is
 * a COMPLETED attempt against a real declaration, recorded on that page's own row — never a walk failure,
 * and never a page silently credited to wherever it landed. That distinction is exactly what the bar
 * "if the owner can find it in the browser and the atlas cannot return it" tests.
 *
 * ## A redirect is how the saved-state trap SURFACES rather than something to tolerate
 *
 * The Vanta client restores the filters the owner last left on a page, so a bare path lands on a filtered
 * view. `browserPages.ts` defends against that by stating each page's query, and this walk is the second
 * half: a page that did not settle where it was asked is marked redirected, so a page whose state was
 * overridden by the client anyway is visible rather than quietly under-reported. The engine then refuses to
 * photograph it, because a picture of somewhere the declaration does not describe evidences nothing.
 *
 * **This is deliberately WHOLE-URL equality (`browser/pageTransport.ts`'s `isRedirected`), and it must stay
 * so.** The kit's `addressDisagreement`, which every other walking atlas now grades on, answers a different
 * question: *is this the page we asked for*, tolerating anything the client appends. What this walk asks is
 * *did we see the view we asked for*, and under a subset rule every page declaring an empty query would be
 * satisfied by whatever filter the client restored. That removes the one signal this channel was built on.
 */
import type { BrowserPageTransport, PageCapture } from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import {
  type PageObservation,
  type PageOutcome,
  type PageWalkResult,
  type PageWalkSpec,
  walkDeclaredPages,
} from "../kit/pageWalk.js";

import {
  isVantaNotFound,
  tenantRootFromFinalUrl,
  VANTA_BROWSER_PAGES,
  VANTA_TENANT_PROBE_PATH,
  VANTA_WEB_ORIGIN,
  type VantaBrowserPage,
  vantaPageUrl,
} from "./browserPages.js";
import { reduceVantaCalls, type VantaObservedCall } from "./browserReduction.js";
import { VantaEvidenceErrors, vantaEvidenceErrorLines } from "./evidenceErrors.js";
import { vantaPageArtifactPath } from "./store.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * @internal
 */
export const VANTA_PAGE_SETTLE_MS = 4_000;

/** What one declared Vanta page's visit came to. */
export type VantaPageObservation = PageObservation<VantaObservedCall>;

/**
 * What a Vanta browser walk produced.
 *
 * @internal
 */
export type VantaBrowserWalkResult = PageWalkResult<VantaObservedCall>;

/**
 * How one visited page's reachability is graded.
 *
 * ## Judged on the TITLE, never the status
 *
 * Vanta's client is a single-page app, so a route it has never heard of still answers HTTP 200 and still
 * paints a chrome full of first-party GraphQL calls — see
 * {@link ../browserPages.js#VANTA_NOT_FOUND_TITLE}.
 *
 * ## Redirected means a different PAGE, not a different address
 *
 * MEASURED on the first full live run of this walk, and it is why this is not a whole-URL
 * comparison. The client restores the view state the owner last left on a page — a filter, a search, a
 * selected row — by APPENDING to the address it was given. A walk grading on the whole URL called every
 * declared page carrying a restored filter redirected on that run, and the engine then refused to photograph any of them,
 * correctly by its own rule: a picture of somewhere the declaration does not describe evidences nothing.
 * But the declaration DID describe them. They were the right pages wearing the owner's filters.
 *
 * So a page is redirected when the browser settled on a different origin or path, or when any query the
 * declaration ASKED FOR came back missing or changed. A parameter the client ADDED is tolerated. That
 * distinction is load-bearing rather than lenient, and the control page is why: every control lives at the
 * same path and is identified only by `controlId`, so a path-only comparison would let the control the
 * owner last had open be photographed under the id of the one that was asked for — which is precisely the
 * failure the whole per-control capture exists to avoid. The asked-for query is checked as a SUBSET, so
 * `controls?controlId=X` settling on `controls?controlId=X&status=NEEDS_ATTENTION` is held and settling on
 * `controls?controlId=Y` is not.
 *
 * The saved-state trap `browserPages.ts` documents is not lost by this: the row still carries `finalUrl`
 * beside `requestedUrl`, and a page whose asked-for query was overridden is still marked redirected, which
 * is the case that trap is actually about.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 *
 * @internal
 */
export function vantaPageOutcome({
  requestedUrl,
  capture,
}: {
  requestedUrl: string;
  capture: PageCapture;
}): PageOutcome {
  const redirected = !settledWhereAsked({ finalUrl: capture.finalUrl, requestedUrl });
  if (isVantaNotFound({ title: capture.title })) {
    return {
      redirected,
      unreachableBecause: `the Vanta client has no such route — it answered ${String(capture.statusCode)} and rendered its not-found page`,
    };
  }
  return { redirected, unreachableBecause: null };
}

/**
 * Whether the browser settled on the page that was asked for, allowing the client its own added view state.
 *
 * An address neither side can parse is treated as NOT where it was asked — the safe direction, since the
 * only consequence is a page that is recorded rather than photographed.
 *
 * @param requestedUrl the URL the walk asked for
 * @param finalUrl where the browser settled
 * @returns whether every asked-for part of the address survived
 */
function settledWhereAsked({ requestedUrl, finalUrl }: { requestedUrl: string; finalUrl: string }): boolean {
  let asked: URL;
  let settled: URL;
  try {
    asked = new URL(requestedUrl);
    settled = new URL(finalUrl);
  } catch {
    return false;
  }
  if (asked.origin !== settled.origin || asked.pathname !== settled.pathname) {
    return false;
  }
  for (const [key, value] of asked.searchParams) {
    if (settled.searchParams.get(key) !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Learn the tenant root by asking for one bare path and reading where the client sent it.
 *
 * @param transport the bound page transport
 * @returns the tenant root, or why it could not be established
 */
async function resolveTenantRoot({ transport }: { transport: BrowserPageTransport }): Promise<Result<string | null>> {
  const probe = await transport.visit({
    settleMs: VANTA_PAGE_SETTLE_MS,
    url: `${VANTA_WEB_ORIGIN}${VANTA_TENANT_PROBE_PATH}`,
  });
  if (probe.isErr()) {
    // The probe asks for a bare path under the ORIGIN, which carries no tenant slug, so quoting the
    // transport's own message is safe HERE and nowhere else — every other visit is addressed at a URL that
    // carries one.
    return err(
      vantaEvidenceErrorLines({ error: VantaEvidenceErrors.tenantProbeFailed({ detail: probe.error.message }) }),
    );
  }
  return ok(tenantRootFromFinalUrl({ finalUrl: probe.value.finalUrl }));
}

/**
 * Everything Vanta contributes to a walk of its web client.
 *
 * A factory rather than a constant so a caller can walk a page list of its own — the control shot walks the
 * same client, with the same five decisions, over pages derived from the atlas's own control set.
 *
 * ## A seeded root is one page load, and for a one-page run it is HALF the run
 *
 * The probe that learns the tenant is a real navigation, so a run of one control costs two page loads and
 * the discovery one is a single point of failure in front of the work. MEASURED by the session
 * driving this verb: a retry of one control spent its whole budget on `could not reach the Vanta web client
 * to learn its tenant: … ETIMEDOUT` and never reached the control at all. Since a one-id retry is the
 * remedy this verb recommends for a page that did not load, making that retry twice as likely to fail as
 * the run it is retrying is the wrong shape. So a caller that already knows the slug — it is in
 * `$SLOPWEAVER_HOME/secrets/vanta-tenant-slug`, `tenantSlug.ts` resolves it — seeds the root and the probe
 * never runs. A caller that does not still probes, unchanged.
 *
 * Seeding does NOT cure the walk's navigate failures, and `../../cli/commands/vanta/walkRun.ts`'s own
 * `seededRootFor` carries that measurement rather than repeating it here: seeded walks of the whole declared
 * list still lost pages. This buys one page load, not reliability.
 *
 * @param pages the declared list this walk is graded against
 * @param seededRoot a tenant root the caller already knows, or `null` to learn one by probing
 * @returns the spec `kit/pageWalk.ts` drives
 *
 * @internal
 */
export function vantaPageWalkSpec({
  pages,
  seededRoot,
}: {
  pages: readonly VantaBrowserPage[];
  seededRoot: string | null;
}): PageWalkSpec<VantaBrowserPage, VantaObservedCall> {
  return {
    artifactPathFor: ({ sha256 }) => vantaPageArtifactPath({ sha256 }),
    gradeOutcome: ({ requestedUrl, capture }) => vantaPageOutcome({ capture, requestedUrl }),
    pages,
    // Vanta's console renders the organisation's own compliance posture, which this atlas already holds in
    // full. There is no page here whose picture discloses more than the generation beside it, so every one
    // is photographed and this says so out loud rather than inheriting a default.
    photographPolicy: () => null,
    progressLabel: "vanta web client",
    reduceCalls: ({ responses }) => reduceVantaCalls({ origin: VANTA_WEB_ORIGIN, responses }),
    resolveRoot: async ({ transport }) => (seededRoot === null ? resolveTenantRoot({ transport }) : ok(seededRoot)),
    rootMissingBecause:
      "this page hangs off a tenant root, and asking for the probe path landed somewhere no tenant can be" +
      " read out of — a signed-out client lands on the sign-in wall, which is the likeliest cause. Check" +
      " `slopweaver browser cookies --origin https://app.vanta.com` and run the walk again",
    // A signed-out Vanta client lands on a sign-in wall whose address carries no tenant, which is exactly
    // what the root inference reads as absent — so the same test serves both.
    sessionLostOn: ({ capture }) => tenantRootFromFinalUrl({ finalUrl: capture.finalUrl }) === null,
    settleMs: VANTA_PAGE_SETTLE_MS,
    signedOutHint: "the browser session was lost — sign in to Vanta in your own Chrome and run the walk again",
    urlFor: ({ root, page }) => (root === null ? null : vantaPageUrl({ page, tenantRoot: root })),
  };
}

/**
 * Walk every declared Vanta page.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param pages the declared list to walk; omitted walks the whole browser surface
 * @param seededRoot a tenant root the caller already knows, so the discovery navigation is skipped
 * @param progress where a line of progress goes; omitted discards it
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkVantaBrowser({
  transport,
  writeArtifact,
  pages = VANTA_BROWSER_PAGES,
  seededRoot = null,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  pages?: readonly VantaBrowserPage[];
  seededRoot?: string | null;
  progress?: (input: { line: string }) => void;
}): Promise<Result<VantaBrowserWalkResult>> {
  return walkDeclaredPages({
    spec: vantaPageWalkSpec({ pages, seededRoot }),
    transport,
    writeArtifact,
    ...(progress === undefined ? {} : { progress }),
  });
}
