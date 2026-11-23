/**
 * Inngest's own five decisions about walking its dashboard. The engine is `kit/pageWalk.ts`.
 *
 * What is genuinely this platform's, and nothing else: how to learn the environment a page hangs off, how to
 * grade where the browser settled, what a first-party call reduces to, that a settle on the dashboard's own
 * sign-in page means the session has ended, and how long to let a page settle. The
 * declared/attempted/reached/photographed accounting, the lost-session stop, the duplicate-picture check and
 * the artifact addressing are the kit's, because every one of them is a property a copy silently loses.
 *
 * ## The environment slug is LEARNED, never configured
 *
 * The dashboard sends a signed-in browser at its bare origin to that session's own default environment, so
 * the slug falls out of where the client lands. Reading it from a setting would make the walk assert an
 * environment this account may not have; reading it from the client makes the walk describe the account it
 * is actually looking at. It is also the one part of a settled URL nothing here quotes: an environment slug
 * is this organisation's own name for a deployment target.
 *
 * ## A sign-in landing STOPS the walk
 *
 * A walk that only CLASSIFIES routes for an anonymous browser expects a sign-in wall on every gated route, and
 * stopping at the first would abandon the rest. Here the walk's whole purpose is what a SIGNED-IN session
 * sees, so a sign-in landing means the session is gone and every page after it would be a false gap.
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
  INNGEST_APP_ORIGIN,
  type InngestBrowserPage,
  inngestPageUrl,
  inngestPhotographPolicy,
  isInngestSignInLanding,
} from "./browserPages.js";
import { type InngestObservedCall, reduceInngestCalls } from "./browserReduction.js";
import { InngestAtlasErrors, inngestAtlasErrorLines } from "./errors.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * Eight seconds. The dashboard renders every list from its own GraphQL calls after first paint, and this
 * walk's whole GraphQL census is those calls — a short settle photographs a skeleton AND loses the surface
 * the walk exists to find. Reproduce by comparing the stored `callCount` for the apps page across two
 * settles: `slopweaver atlas inngest read --kind page --query apps --json`.
 *
 * @internal
 */
export const INNGEST_PAGE_SETTLE_MS = 8_000;

/**
 * What one declared Inngest page's visit came to.
 *
 * @internal
 */
export type InngestPageObservation = PageObservation<InngestObservedCall>;

/** What an Inngest walk produced. @internal */
export type InngestBrowserWalkResult = PageWalkResult<InngestObservedCall>;

/** A URL, or `null` when it cannot be read. */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * How one visited page's reachability is graded.
 *
 * A page counts as reached only when the browser settled where it was asked — the kit's
 * {@link addressDisagreement}, which is the same origin, the same path, and every query parameter this
 * atlas's own declaration named. A parameter the CLIENT appends is tolerated, because it is the client
 * restoring its own view state and that is a different fact from having been sent elsewhere.
 *
 * No settled path is ever quoted in a reason: it can carry the environment slug, an app's external id or a
 * function slug, and every one of those is this organisation's own name for something.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 */
export function inngestPageOutcome({
  requestedUrl,
  capture,
}: {
  requestedUrl: string;
  capture: PageCapture;
}): PageOutcome {
  const settled = parseUrl({ url: capture.finalUrl });
  const disagreement = addressDisagreement({ finalUrl: capture.finalUrl, requestedUrl });
  if (settled === null || disagreement === "unreadable") {
    return { redirected: true, unreachableBecause: "the browser settled on an address this atlas cannot read" };
  }
  if (isInngestSignInLanding({ finalUrl: capture.finalUrl })) {
    return {
      redirected: true,
      unreachableBecause: "the dashboard sent this browser to its sign-in page, so this session is no longer signed in",
    };
  }
  if (disagreement === "origin") {
    return {
      redirected: true,
      unreachableBecause: `the client sent this address to ${settled.origin}, which is not where it was asked to go`,
    };
  }
  if (disagreement !== null) {
    return {
      redirected: true,
      unreachableBecause: `the dashboard did not keep this address — it answered ${String(capture.statusCode)} and settled on a different path under ${settled.origin}`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/**
 * The environment slug out of a settled dashboard URL, which is `/env/<slug>/…`.
 *
 * @param finalUrl where the client landed
 * @returns the slug, or `null` when the client landed somewhere with no environment segment
 *
 * @internal
 */
export function environmentSlugFromFinalUrl({ finalUrl }: { finalUrl: string }): string | null {
  const settled = parseUrl({ url: finalUrl });
  if (settled === null) {
    return null;
  }
  const segments = settled.pathname.split("/").filter((segment) => segment !== "");
  if (segments[0] !== "env") {
    return null;
  }
  // A client that landed on the bare `/env` has no environment segment to read.
  const slug = segments[1];
  if (slug === undefined) {
    return null;
  }
  return slug;
}

/**
 * Learn the environment by asking for the bare origin and reading where the client sent it.
 *
 * @param transport the bound page transport
 * @returns the environment slug, `null` when the client landed somewhere with no environment segment, or the
 *   reason the client could not be reached at all
 */
async function resolveEnvironment({ transport }: { transport: BrowserPageTransport }): Promise<Result<string | null>> {
  const probe = await transport.visit({ settleMs: INNGEST_PAGE_SETTLE_MS, url: `${INNGEST_APP_ORIGIN}/` });
  if (probe.isErr()) {
    // The probe asks for the bare ORIGIN, which carries no environment slug, so quoting the transport's own
    // message is safe HERE and nowhere else — every other visit is addressed at a URL that can carry one.
    return err(
      inngestAtlasErrorLines({ error: InngestAtlasErrors.dashboardUnreachable({ detail: probe.error.message }) }),
    );
  }
  if (isInngestSignInLanding({ finalUrl: probe.value.finalUrl })) {
    return err(inngestAtlasErrorLines({ error: InngestAtlasErrors.signedOut() }));
  }
  return ok(environmentSlugFromFinalUrl({ finalUrl: probe.value.finalUrl }));
}

/**
 * Everything Inngest contributes to a walk of its dashboard.
 *
 * @param pages the declared pages, read out of the published generation rather than hand-listed
 * @param artifactPathFor where a screenshot of one digest is stored
 * @returns the spec `walkDeclaredPages` runs
 *
 * @internal
 */
export function inngestPageWalkSpec({
  pages,
  artifactPathFor,
}: {
  pages: readonly InngestBrowserPage[];
  artifactPathFor: (input: { sha256: string }) => string;
}): PageWalkSpec<InngestBrowserPage, InngestObservedCall> {
  return {
    artifactPathFor,
    gradeOutcome: ({ requestedUrl, capture }) => inngestPageOutcome({ capture, requestedUrl }),
    pages,
    photographPolicy: ({ page }) => inngestPhotographPolicy({ page }),
    progressLabel: "inngest dashboard",
    reduceCalls: ({ responses }) => reduceInngestCalls({ responses }),
    resolveRoot: ({ transport }) => resolveEnvironment({ transport }),
    rootMissingBecause:
      "this page hangs off an environment and the probe found no environment segment in the client's own landing URL",
    sessionLostOn: ({ capture }) => isInngestSignInLanding({ finalUrl: capture.finalUrl }),
    settleMs: INNGEST_PAGE_SETTLE_MS,
    signedOutHint: "the browser session was lost — sign in to Inngest in your own Chrome and run the walk again",
    urlFor: ({ root, page }) => inngestPageUrl({ environmentSlug: root, page }),
  };
}

/**
 * Walk every declared Inngest dashboard page.
 *
 * @param pages the declared pages
 * @param artifactPathFor where a screenshot of one digest is stored
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param progress where a line of progress goes; omitted discards it
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkInngestDashboard({
  pages,
  artifactPathFor,
  transport,
  writeArtifact,
  progress,
}: {
  pages: readonly InngestBrowserPage[];
  artifactPathFor: (input: { sha256: string }) => string;
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  progress?: (input: { line: string }) => void;
}): Promise<Result<InngestBrowserWalkResult>> {
  return walkDeclaredPages({
    spec: inngestPageWalkSpec({ artifactPathFor, pages }),
    transport,
    writeArtifact,
    ...(progress === undefined ? {} : { progress }),
  });
}
