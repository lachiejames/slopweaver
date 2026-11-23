/**
 * Clerk's own five decisions about walking its dashboard. The engine is `kit/pageWalk.ts`.
 *
 * What is genuinely this platform's, and nothing else: how to learn the instance root a page hangs off, how
 * to grade where the browser settled, what a first-party call reduces to, that a settle on a Clerk sign-in
 * wall means the session has ended, and how long to let a page settle. The
 * declared/attempted/reached/photographed accounting, the lost-session stop, the duplicate-picture check
 * and the artifact addressing are the kit's, because every one of them is a property a copy silently loses.
 *
 * ## Reachability is graded on the ADDRESS, and the interesting failure is a silent redirect home
 *
 * The Clerk dashboard is a single-page client that answers a route it does not recognise by rewriting the
 * address to the instance overview and returning 200. So a 404 is not the failure mode: a page that has
 * moved, or that this account's plan does not open, looks exactly like a success until the settled address
 * is compared to the requested one. That comparison is the kit's `addressDisagreement`, which
 * {@link clerkPageOutcome} turns into this platform's own sentences, and it is why the duplicate-screenshot
 * check in the kit matters here — twenty routes silently rewritten to the overview would otherwise be
 * twenty reached pages sharing one picture.
 *
 * ## A settled path is never quoted into a reason
 *
 * It carries the application and instance identifiers (`browserPages.ts`), so a reason says what happened
 * and not where. The requested path IS safe to name — this atlas declared it — and that is what a reader
 * needs to act.
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
import type { WalkProgress } from "../kit/walkProgress.js";

import { CLERK_BROWSER_PAGES } from "./browserPages.js";
import { type ClerkObservedCall, reduceClerkCalls } from "./browserReduction.js";
import {
  CLERK_APPLICATIONS_PROBE_PATH,
  CLERK_DASHBOARD_ORIGIN,
  CLERK_INSTANCE_PROBE_PATH,
  type ClerkBrowserPage,
  clerkInstanceRootFromFinalUrl,
  clerkInstanceRootFromTraffic,
  clerkPageUrl,
  isClerkSignInUrl,
} from "./dashboardAddress.js";
import { ClerkAtlasErrors, clerkAtlasErrorLines } from "./errors.js";
import { clerkPageArtifactPath } from "./store.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * Six seconds, matching the Notion and Xero walks rather than the Vanta walk's four: the dashboard renders
 * a settings page from a chain of its own calls rather than in one pass, and the deferred half of that
 * chain is where the undocumented `dapi.clerk.com` operations live — which is the whole reason this walk
 * exists.
 *
 * @internal
 */
export const CLERK_PAGE_SETTLE_MS = 6_000;

/** What one declared Clerk page's visit came to. */
export type ClerkPageObservation = PageObservation<ClerkObservedCall>;

/**
 * What a Clerk walk produced.
 *
 * @internal
 */
export type ClerkBrowserWalkResult = PageWalkResult<ClerkObservedCall>;

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
 * atlas's own declaration named. A parameter the CLIENT appends is tolerated, because it is the dashboard
 * restoring its own view state — column visibility, a saved filter — and that is a different fact from
 * having been sent elsewhere.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 *
 * @internal
 */
export function clerkPageOutcome({
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
  if (isClerkSignInUrl({ finalUrl: capture.finalUrl })) {
    return {
      redirected: true,
      unreachableBecause: "the browser was sent to a Clerk sign-in wall, so this session is no longer signed in",
    };
  }
  if (disagreement === "origin") {
    return {
      redirected: true,
      unreachableBecause: `the dashboard sent this address to ${settled.origin}, which is not where it was asked to go`,
    };
  }
  if (disagreement !== null) {
    // The settled path is NOT quoted: it carries the application and instance identifiers, which may not
    // leave this process. The requested page's own surface name is what the caller already has.
    return {
      redirected: true,
      unreachableBecause: `the dashboard client did not keep this address — it answered ${String(capture.statusCode)} and rewrote the route to a different page of the same instance, which is what it does with a route this account cannot open`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/** What the recovered origin-probe line opens with, before the transport's own `because`. */
const ORIGIN_PROBE_FAILED_PREFIX = "clerk dashboard: bare-origin instance-root probe failed — ";

/** What the recovered origin-probe line closes with: the step the walk takes next. */
const ORIGIN_PROBE_FAILED_SUFFIX = "; trying the application-list probe";

/**
 * The first step: ask the bare origin where the dashboard sends it.
 *
 * ## A failed NAVIGATION here is one page's failure, not the dashboard's
 *
 * MEASURED: the scheduled resync refused outright on `could not navigate to
 * https://dashboard.clerk.com/: spawnSync .../node ETIMEDOUT`, a fresh walk the same day succeeded, and the
 * same refusal had stopped an earlier run. One page's navigation timing out says nothing about whether the
 * next will, so a `NAVIGATION_FAILED` is reported on `progress` and answered with no root, which hands the
 * question to the application-list probe exactly as a rootless landing does. Every OTHER transport code —
 * `SESSION_LOST`, `TRANSPORT_UNAVAILABLE`, `OFF_LEASE_ORIGIN` — is a fact about the whole run, so it still
 * refuses here, before anything else is asked for.
 *
 * A fallthrough is a DEFERRED refusal, never a cancelled one: the answer carries the very refusal the
 * failure would have produced, and {@link resolveInstanceRoot} returns it when no later step finds a root. A
 * rootless walk publishes, and a failed probe must not be able to become one.
 *
 * The progress line quotes `because`, never `message`: `message` interpolates the address, and `because` is
 * the transport's own recordable sentence. The refusal may quote `message`, and only because this one
 * address carries no identifier.
 *
 * @param transport the bound page transport
 * @param progress where the recovered navigation failure is reported; `undefined` discards it
 * @returns the root the origin landed on (`null` when none) with the refusal a failed navigation still owes
 *   (`null` when it did not fail), or why the dashboard cannot be walked at all
 */
async function rootFromOrigin({
  transport,
  progress,
}: {
  transport: BrowserPageTransport;
  progress: WalkProgress | undefined;
}): Promise<Result<{ readonly root: string | null; readonly owedRefusal: readonly string[] | null }>> {
  const probe = await transport.visit({
    settleMs: CLERK_PAGE_SETTLE_MS,
    url: `${CLERK_DASHBOARD_ORIGIN}${CLERK_INSTANCE_PROBE_PATH}`,
  });
  if (probe.isErr()) {
    const failure = probe.error;
    const refusal = clerkAtlasErrorLines({ error: ClerkAtlasErrors.dashboardUnreachable({ detail: failure.message }) });
    if (failure.code === "NAVIGATION_FAILED") {
      progress?.({ line: `${ORIGIN_PROBE_FAILED_PREFIX}${failure.because}${ORIGIN_PROBE_FAILED_SUFFIX}` });
      return ok({ owedRefusal: refusal, root: null });
    }
    return err(refusal);
  }
  if (isClerkSignInUrl({ finalUrl: probe.value.finalUrl })) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.signInWall() }));
  }
  return ok({ owedRefusal: null, root: clerkInstanceRootFromFinalUrl({ finalUrl: probe.value.finalUrl }) });
}

/**
 * Learn the instance root, in three steps, because no one of them is reliable.
 *
 * The bare origin is asked FIRST ({@link rootFromOrigin}), because it is one navigation and it usually
 * answers: a signed-in dashboard redirects it to the application and instance it last showed. When it does
 * not — MEASURED on the first real walk, where a session last left on the application list was
 * sent straight back to it and the declared pages hanging off the instance root were recorded as rootless — the application list is
 * visited and the root recovered from its own traffic (`clerkInstanceRootFromTraffic`). A failed NAVIGATION
 * of the origin is the one origin failure that also advances to this step; every other transport code
 * refuses, and that is `rootFromOrigin`'s own comment.
 *
 * The fallback is a second navigation rather than the only probe because it is strictly more work for the
 * same answer in the common case, and because a walk that never asked the origin could not tell a signed-out
 * session from a rootless one: the origin probe is where {@link isClerkSignInUrl} is checked first. The
 * application list's own landing is checked too, on EVERY path: a capture that settled on a sign-in wall is
 * the same fact whichever probe met it, and accepting it would let the remembered root start a walk of a
 * signed-out session that publishes whatever it reached before the first page noticed.
 *
 * Both live probes can still come up empty, and MEASURED on the same day they did: the application list is
 * SERVER-RENDERED, so its own traffic carries neither identifier in a URL nor in a JSON body. The third and
 * last step is therefore the root this atlas REMEMBERED from an earlier walk (`instanceRoot.ts`), which is
 * what makes a walk independent of where the owner's browser was last pointed. A live probe that succeeds
 * overwrites it, so the remembered value is never preferred over a fresh one. A FAILED application-list
 * visit still refuses rather than reaching for it: two live visits failing is not the one-page failure the
 * origin's fallthrough exists for.
 *
 * When all three steps come up empty, the answer depends on WHY the origin had no root. A rootless LANDING
 * answers `null`, and the walk records its instance pages as unaddressable. A failed origin NAVIGATION
 * answers the refusal it deferred, exactly the line it would have printed before the fallthrough existed:
 * a rootless walk still publishes, and a probe that never answered is no evidence the instance has no root.
 *
 * @param transport the bound page transport
 * @param progress where a recovered origin failure is reported; `undefined` discards it
 * @returns the instance root, `null` when the origin LANDED rootless and no later step found one, or the
 *   reason the dashboard could not be walked
 */
async function resolveInstanceRoot({
  transport,
  remembered,
  rememberRoot,
  progress,
}: {
  transport: BrowserPageTransport;
  remembered: string | null;
  rememberRoot: ClerkRootSink;
  progress: WalkProgress | undefined;
}): Promise<Result<string | null>> {
  const origin = await rootFromOrigin({ progress, transport });
  if (origin.isErr()) {
    return err(origin.error);
  }
  const fromLanding = origin.value.root;
  if (fromLanding !== null) {
    rememberRoot({ root: fromLanding });
    return ok(fromLanding);
  }
  const applications = await transport.visit({
    settleMs: CLERK_PAGE_SETTLE_MS,
    url: `${CLERK_DASHBOARD_ORIGIN}${CLERK_APPLICATIONS_PROBE_PATH}`,
  });
  if (applications.isErr()) {
    return err(
      clerkAtlasErrorLines({ error: ClerkAtlasErrors.applicationsUnreachable({ detail: applications.error.message }) }),
    );
  }
  if (isClerkSignInUrl({ finalUrl: applications.value.finalUrl })) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.signInWall() }));
  }
  const fromTraffic = clerkInstanceRootFromTraffic({
    bodies: applications.value.responses.map((response) => response.body),
    urls: applications.value.responses.map((response) => response.url),
  });
  if (fromTraffic !== null) {
    rememberRoot({ root: fromTraffic });
    return ok(fromTraffic);
  }
  if (remembered === null && origin.value.owedRefusal !== null) {
    return err(origin.value.owedRefusal);
  }
  return ok(remembered);
}

/**
 * Where a resolved instance root is handed for safe keeping.
 *
 * A SEAM rather than a direct write, so the whole walk stays pure over its inputs and a test can assert
 * that a probe remembered what it found without a file system. `instanceRoot.ts` is the real implementation.
 *
 * @internal
 */
export type ClerkRootSink = (input: { root: string }) => void;

/**
 * Everything Clerk contributes to a walk of its dashboard.
 *
 * A factory rather than a constant because two of the five decisions depend on this INSTALL: which root it
 * has remembered, and where a freshly-resolved one should be kept.
 *
 * @param remembered the instance root an earlier walk learned, or `null` when none has been
 * @param rememberRoot where a live probe's answer is handed for safe keeping
 * @returns the spec `kit/pageWalk.ts` drives
 *
 * @internal
 */
export function clerkPageWalkSpec({
  remembered,
  rememberRoot,
}: {
  remembered: string | null;
  rememberRoot: ClerkRootSink;
}): PageWalkSpec<ClerkBrowserPage, ClerkObservedCall> {
  return {
    artifactPathFor: ({ sha256 }) => clerkPageArtifactPath({ sha256 }),
    gradeOutcome: ({ requestedUrl, capture }) => clerkPageOutcome({ capture, requestedUrl }),
    // This platform photographs every page it reaches: nothing it renders is withheld from a picture.
    photographPolicy: () => null,
    pages: CLERK_BROWSER_PAGES,
    progressLabel: "clerk dashboard",
    reduceCalls: ({ responses }) => reduceClerkCalls({ responses }),
    resolveRoot: ({ transport, progress }) => resolveInstanceRoot({ progress, remembered, rememberRoot, transport }),
    rootMissingBecause:
      "this page hangs off an instance root, and none of the three probes found one: the dashboard sent the bare origin to a page carrying no instance, the application list is server-rendered so its own traffic carries none either, and no earlier walk has remembered one. Run: slopweaver atlas clerk walk --root /apps/<application>/instances/<instance>, taking the two segments from the dashboard's own address bar",
    sessionLostOn: ({ capture }) => isClerkSignInUrl({ finalUrl: capture.finalUrl }),
    settleMs: CLERK_PAGE_SETTLE_MS,
    signedOutHint:
      "the browser session was lost — sign in to the Clerk dashboard in your own Chrome and run the walk again",
    urlFor: ({ root, page }) => clerkPageUrl({ instanceRoot: root, page }),
  };
}

/**
 * Walk every declared Clerk dashboard page.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param remembered the instance root an earlier walk learned, or `null` when none has been
 * @param rememberRoot where a live probe's answer is handed for safe keeping
 * @param progress where a line of progress goes; omitted discards it
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkClerkDashboard({
  transport,
  writeArtifact,
  remembered,
  rememberRoot,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  remembered: string | null;
  rememberRoot: ClerkRootSink;
  progress?: WalkProgress;
}): Promise<Result<ClerkBrowserWalkResult>> {
  return walkDeclaredPages({
    spec: clerkPageWalkSpec({ remembered, rememberRoot }),
    transport,
    writeArtifact,
    ...(progress === undefined ? {} : { progress }),
  });
}
