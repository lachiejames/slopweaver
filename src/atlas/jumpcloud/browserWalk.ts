/**
 * JumpCloud's own decisions about walking its administrator console. The engine is `kit/pageWalk.ts`.
 *
 * What is genuinely this platform's: how to learn whether the console is signed in, how to grade where a
 * HASH-ROUTED client settled, what a first-party call reduces to, and that a settle on the sign-in page or the
 * end-user portal means the administrator session has ended. The declared/attempted/reached/photographed
 * accounting, the lost-session stop, the duplicate-picture check and the artifact addressing are the kit's.
 *
 * ## Grading reads the fragment, because on this client the fragment IS the page
 *
 * Every console page shares one origin and one path, so the kit's `addressDisagreement` — which ignores a
 * fragment on purpose — agrees about every one of them. {@link jumpcloudPageOutcome} asks it first (a settle
 * on another origin or path is still a failure) and then asks `hashRouteDisagreement`, which is where an
 * unknown route the client sends home actually shows up. The admin landmark is the console's own document
 * title: the end-user portal and the sign-in page both render a different one.
 *
 * ## A reason may quote the settled ROUTE, redacted
 *
 * A route can carry an object id (`#/users/<id>/details`), so the settled route is passed through the same
 * segment redaction the call reduction uses before it is written into a reason. Naming where the client
 * went is the most useful thing a pruned-route row can say.
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
  hashRouteDisagreement,
  hashRouteOf,
  isSignInSettle,
  JUMPCLOUD_ADMIN_TITLE,
  JUMPCLOUD_CONSOLE_ORIGIN,
  JUMPCLOUD_CONSOLE_PAGES,
  type JumpcloudConsolePage,
  jumpcloudConsolePageUrl,
} from "./browserPages.js";
import { JUMPCLOUD_SEGMENTS, type JumpcloudObservedCall, reduceJumpcloudCalls } from "./browserReduction.js";
import { jumpcloudConsoleArtifactPath } from "./consoleStore.js";
import { JumpcloudConsoleWalkErrors } from "./errors.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * Eight seconds, the settle the route probes that declared `browserPages.ts` were taken at
 * (`slopweaver browser open <url> --settle 8000`). The console renders its shell first and each list after
 * its own `/api/` calls resolve, so the settle is sized for the list, not the shell.
 *
 * @internal
 */
export const JUMPCLOUD_PAGE_SETTLE_MS = 8_000;

/** The route the probe asks for — the console's own home, which every signed-in administrator can see. */
const PROBE_ROUTE = "home";

/** What one declared console page's visit came to. */
export type JumpcloudPageObservation = PageObservation<JumpcloudObservedCall>;

/**
 * What a console walk produced.
 *
 * @internal
 */
export type JumpcloudConsoleWalkResult = PageWalkResult<JumpcloudObservedCall>;

/** Every non-empty segment of `path`, a value segment replaced by its placeholder. */
function redactedSegments({ path }: { path: string }): string[] {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const placeholder = JUMPCLOUD_SEGMENTS({ segment });
      return placeholder === null ? segment : placeholder.placeholder;
    });
}

/** The settled hash route with every value segment redacted, safe to quote in a reason. */
function redactedRoute({ finalUrl }: { finalUrl: string }): string {
  const route = hashRouteOf({ url: finalUrl });
  if (route === null) {
    return "an unreadable route";
  }
  return `#/${redactedSegments({ path: route.path }).join("/")}`;
}

/**
 * The address a page settled on, as it may be STORED: origin, path and hash route with every value segment
 * redacted, and a fragment parameter kept by NAME only. A query outside the fragment is dropped whole — on a
 * settle off the console (an identity provider, say) it is where a token rides.
 *
 * @param finalUrl the address the browser settled on, empty for a page the walk never got to
 * @returns the redacted address, empty for an empty one, or `unreadable` for one that does not parse
 */
export function redactedConsoleAddress({ finalUrl }: { finalUrl: string }): string {
  if (finalUrl === "") {
    return "";
  }
  const route = hashRouteOf({ url: finalUrl });
  if (route === null) {
    return "unreadable";
  }
  const { origin, pathname } = new URL(finalUrl);
  const path = redactedSegments({ path: pathname }).join("/");
  const names = [...new Set(route.params.keys())].toSorted();
  const query = names.length === 0 ? "" : `?${names.map((name) => `${name}={value}`).join("&")}`;
  return `${origin}/${path}#/${redactedSegments({ path: route.path }).join("/")}${query}`;
}

/**
 * How one visited console page's reachability is graded.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 */
export function jumpcloudPageOutcome({
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
  if (isSignInSettle({ finalUrl: capture.finalUrl })) {
    return {
      redirected: true,
      unreachableBecause:
        "the browser was sent to JumpCloud's sign-in page or end-user portal, so the administrator session is no longer signed in",
    };
  }
  if (disagreement !== null) {
    return {
      redirected: true,
      unreachableBecause: `the console did not keep this address — it settled on a different ${disagreement} than it was asked for`,
    };
  }
  const route = hashRouteDisagreement({ finalUrl: capture.finalUrl, requestedUrl });
  if (route === "unreadable") {
    return { redirected: true, unreachableBecause: "the console settled on a hash route this atlas cannot read" };
  }
  if (route === "route") {
    return {
      redirected: true,
      unreachableBecause: `the console client sent this route to ${redactedRoute({ finalUrl: capture.finalUrl })}, so it names no page of its own`,
    };
  }
  if (route === "route-query") {
    return {
      redirected: true,
      unreachableBecause: "the console client dropped view state this route was asked to carry",
    };
  }
  if (capture.title !== JUMPCLOUD_ADMIN_TITLE) {
    return {
      redirected: false,
      unreachableBecause: `the page did not render the administrator console — its title was not "${JUMPCLOUD_ADMIN_TITLE}"`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/**
 * Ask for the console's home and read whether the browser is holding an administrator session.
 *
 * The console has no per-organisation root, so a signed-in session resolves to the console origin itself;
 * the probe exists for the sign-in check, which stops the walk before it grades every page a failure.
 *
 * @param transport the bound page transport
 * @returns the console origin, or why the console could not be walked at all
 */
async function resolveConsoleRoot({ transport }: { transport: BrowserPageTransport }): Promise<Result<string | null>> {
  const probe = await transport.visit({
    settleMs: JUMPCLOUD_PAGE_SETTLE_MS,
    url: `${JUMPCLOUD_CONSOLE_ORIGIN}/#/${PROBE_ROUTE}`,
  });
  if (probe.isErr()) {
    // The probe asks for a fixed public address, so quoting the transport's message is safe here.
    return err([JumpcloudConsoleWalkErrors.transportFailed({ cause: probe.error.message }).message]);
  }
  if (isSignInSettle({ finalUrl: probe.value.finalUrl })) {
    return err([JumpcloudConsoleWalkErrors.signedOut().message]);
  }
  return ok(JUMPCLOUD_CONSOLE_ORIGIN);
}

/**
 * Everything JumpCloud contributes to a walk of its administrator console.
 *
 * @internal
 */
export const JUMPCLOUD_PAGE_WALK_SPEC: PageWalkSpec<JumpcloudConsolePage, JumpcloudObservedCall> = {
  artifactPathFor: ({ sha256 }) => jumpcloudConsoleArtifactPath({ sha256 }),
  gradeOutcome: ({ requestedUrl, capture }) => jumpcloudPageOutcome({ capture, requestedUrl }),
  pages: JUMPCLOUD_CONSOLE_PAGES,
  // Every reached page is photographed, the users list included. The API channel already holds every user
  // attribute in full under the every-family ruling, and the picture is what the owner asked a walk to
  // prove, so withholding it would withhold the proof and protect nothing the atlas does not already hold.
  photographPolicy: () => null,
  progressLabel: "jumpcloud console",
  reduceCalls: ({ responses }) => reduceJumpcloudCalls({ responses }),
  resolveRoot: ({ transport }) => resolveConsoleRoot({ transport }),
  rootMissingBecause: "the console probe did not resolve, so no page was addressed",
  sessionLostOn: ({ capture }) => isSignInSettle({ finalUrl: capture.finalUrl }),
  settleMs: JUMPCLOUD_PAGE_SETTLE_MS,
  signedOutHint:
    "the administrator session was lost — sign in to the JumpCloud admin console in your own Chrome and run the walk again",
  urlFor: ({ page }) => jumpcloudConsolePageUrl({ page }),
};

/**
 * Walk every declared console page.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param progress where a line of progress goes; omitted discards it
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkJumpcloudConsole({
  transport,
  writeArtifact,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  progress?: (input: { line: string }) => void;
}): Promise<Result<JumpcloudConsoleWalkResult>> {
  return walkDeclaredPages({
    spec: JUMPCLOUD_PAGE_WALK_SPEC,
    transport,
    writeArtifact,
    ...(progress === undefined ? {} : { progress }),
  });
}
