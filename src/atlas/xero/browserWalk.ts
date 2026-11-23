/**
 * Xero's own five decisions about walking its web client. The engine is `kit/pageWalk.ts`.
 *
 * What is genuinely this platform's, and nothing else: how to learn the root a page hangs off, how to grade
 * where the browser settled, what a first-party call reduces to, that a settle on Xero's sign-in origin
 * means the session has ended, and how long to let a page settle. The declared/attempted/reached/photographed
 * accounting, the lost-session stop, the duplicate-picture check and the artifact addressing are the kit's,
 * because every one of them is a property a copy silently loses.
 *
 * ## Reachability is graded on origin and path, and the origin half is the load-bearing one
 *
 * Xero's client migrated in stages, so the interesting failure is not a 404 — it is a 200 on a DIFFERENT
 * origin, which is what a legacy route does when the surface has moved. Naming which origin it settled on is
 * safe and is the most useful thing the row can carry: an origin holds no organisation short code, which is
 * why it is the one part of a settled URL a reason here ever quotes.
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

import type { XeroBrowserPage } from "./browserPageEntries.js";
import {
  appRootFromFinalUrl,
  isSignInOrigin,
  XERO_APP_PROBE_PATH,
  XERO_BROWSER_PAGES,
  XERO_LOGIN_ORIGIN,
  XERO_WEB_ORIGIN,
  xeroPageUrl,
} from "./browserPages.js";
import { reduceXeroCalls, type XeroObservedCall } from "./browserReduction.js";
import { XeroAtlasErrors, xeroAtlasErrorLines } from "./errors.js";
import { xeroPageArtifactPath } from "./store.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * Six seconds, matching the Notion walk rather than the Vanta walk's four: Xero's client renders a page body
 * from a chain of its own calls rather than in one pass, so a short settle photographs a skeleton and
 * captures a fraction of the traffic the walk exists to see.
 *
 * @internal
 */
export const XERO_PAGE_SETTLE_MS = 6_000;

/** What one declared Xero page's visit came to. */
export type XeroPageObservation = PageObservation<XeroObservedCall>;

/**
 * What a Xero walk produced.
 *
 * @internal
 */
export type XeroBrowserWalkResult = PageWalkResult<XeroObservedCall>;

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
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 */
export function xeroPageOutcome({
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
  if (isSignInOrigin({ finalUrl: capture.finalUrl })) {
    return {
      redirected: true,
      unreachableBecause: "the browser was sent to Xero's sign-in origin, so this session is no longer signed in",
    };
  }
  if (disagreement === "origin") {
    return {
      redirected: true,
      unreachableBecause: `the client sent this address to ${settled.origin}, which is not where it was asked to go`,
    };
  }
  if (disagreement !== null) {
    // The settled path is not quoted: it can carry the organisation short code, which may not leave this
    // process.
    return {
      redirected: true,
      unreachableBecause: `the Xero client did not keep this address — it answered ${String(capture.statusCode)} and settled on a different path under ${settled.origin}`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/**
 * Whether Xero's own sign-in origin keeps this browser — asked only after the app probe FAILED.
 *
 * A signed-out probe does not always land on the sign-in page: MEASURED, the redirect tore the
 * probe's page down mid-visit and the transport answered "went away underneath the call", so every scheduled
 * resync recorded a dead browser and no sign-in card was ever raised for the one step that was the owner's. The seat on
 * `recipe-failing-resync-atlas-xero-2026-09-26t14-00-00.000z-a1` measured the signed-out half that day:
 * `slopweaver browser shot --raw --url https://login.xero.com/` settled on `/identity/user/login` with an empty
 * "Log in to your account" form. The signed-in half — sent on into the app — is NOT measured.
 *
 * The criterion is {@link showsSignIn}, the same one the walk's `sessionLostOn` applies, and that is the point:
 * the visit goes through the walk's noting transport, which records a wall exactly when `sessionLostOn` holds,
 * so any other test here would let the walk answer "unreachable" while the resync raised a sign-in card — two
 * verdicts on one visit. The wall is noted at `login.xero.com`, the page the owner opens.
 *
 * @param transport the walk's bound (noting) transport
 * @returns true only when the visit settled on the sign-in page; any failure answers false, keeping the probe's error
 */
async function signInOriginKept({ transport }: { transport: BrowserPageTransport }): Promise<boolean> {
  const check = await transport.visit({ settleMs: XERO_PAGE_SETTLE_MS, url: `${XERO_LOGIN_ORIGIN}/` });
  return check.isOk() && showsSignIn({ capture: check.value });
}

/**
 * Whether a capture settled on Xero's sign-in page: its origin, answering without an HTTP error.
 *
 * The status half is so an outage page on `login.xero.com` is never carded as the owner's sign-in;
 * a `null` status — the transport saw no document response — still reads as the sign-in origin.
 */
function showsSignIn({ capture }: { capture: PageCapture }): boolean {
  const errored = capture.statusCode !== null && capture.statusCode >= 400;
  return isSignInOrigin({ finalUrl: capture.finalUrl }) && !errored;
}

/**
 * Learn the app root by asking for the bare origin and reading where the client sent it.
 *
 * @param transport the bound page transport
 * @returns the app root, `null` when the client landed somewhere with no short-code segment, or the reason
 *   the client could not be reached at all
 */
async function resolveAppRoot({ transport }: { transport: BrowserPageTransport }): Promise<Result<string | null>> {
  const probe = await transport.visit({
    settleMs: XERO_PAGE_SETTLE_MS,
    url: `${XERO_WEB_ORIGIN}${XERO_APP_PROBE_PATH}`,
  });
  if (probe.isErr()) {
    if (await signInOriginKept({ transport })) {
      return err(xeroAtlasErrorLines({ error: XeroAtlasErrors.signedOut() }));
    }
    // The probe asks for the bare ORIGIN, which carries no short code, so quoting the transport's own
    // message is safe HERE and nowhere else — every other visit is addressed at a URL that can carry one.
    return err(xeroAtlasErrorLines({ error: XeroAtlasErrors.webClientUnreachable({ detail: probe.error.message }) }));
  }
  if (showsSignIn({ capture: probe.value })) {
    return err(xeroAtlasErrorLines({ error: XeroAtlasErrors.signedOut() }));
  }
  return ok(appRootFromFinalUrl({ finalUrl: probe.value.finalUrl }));
}

/**
 * Everything Xero contributes to a walk of its web client.
 *
 * @internal
 */
export const XERO_PAGE_WALK_SPEC: PageWalkSpec<XeroBrowserPage, XeroObservedCall> = {
  artifactPathFor: ({ sha256 }) => xeroPageArtifactPath({ sha256 }),
  gradeOutcome: ({ requestedUrl, capture }) => xeroPageOutcome({ capture, requestedUrl }),
  // This platform photographs every page it reaches: nothing it renders is withheld from a picture.
  photographPolicy: () => null,
  pages: XERO_BROWSER_PAGES,
  progressLabel: "xero browser",
  reduceCalls: ({ responses }) => reduceXeroCalls({ responses }),
  resolveRoot: ({ transport }) => resolveAppRoot({ transport }),
  rootMissingBecause:
    "this page hangs off the modern app root and the probe found no organisation short code in the client's own landing URL",
  sessionLostOn: ({ capture }) => showsSignIn({ capture }),
  settleMs: XERO_PAGE_SETTLE_MS,
  signedOutHint: "the browser session was lost — sign in to Xero in your own Chrome and run the walk again",
  urlFor: ({ root, page }) => xeroPageUrl({ appRoot: root, page }),
};

/**
 * Walk every declared Xero page.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param progress where a line of progress goes; omitted discards it
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkXeroBrowser({
  transport,
  writeArtifact,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  progress?: (input: { line: string }) => void;
}): Promise<Result<XeroBrowserWalkResult>> {
  return walkDeclaredPages({
    spec: XERO_PAGE_WALK_SPEC,
    transport,
    writeArtifact,
    ...(progress === undefined ? {} : { progress }),
  });
}
