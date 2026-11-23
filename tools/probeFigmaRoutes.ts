/**
 * Re-measure which Figma browser routes exist, without a Figma account.
 *
 * ```bash
 * yarn tsx tools/probeFigmaRoutes.ts            # print each route's evidence class
 * yarn tsx tools/probeFigmaRoutes.ts --verify   # exit non-zero if any row disagrees with the inventory
 * ```
 *
 * The method, and why it works at all: an unknown path on `www.figma.com` is normalised to a trailing slash
 * and then answers a real `404`, while a route that exists answers something else — a `302` to `/login`, a
 * `403`, a `200`, or an off-host `301`. So every non-404 is a positive signal, and {@link CONTROL_ROUTE} is
 * in every run to prove the negative still fires: a probe whose control stops answering 404 is a probe
 * measuring nothing.
 *
 * ## The one subtlety, and it is why this tool follows redirects for the control alone
 *
 * The trailing-slash normalisation is itself a `308`, so an unknown path's FIRST response is a redirect and
 * only the second is the 404. Following redirects everywhere would destroy the signal this probe depends on
 * — a `302 → /login` would resolve to the login page's own `200`. So route probes are `redirect: "manual"`
 * and the control is followed to its end.
 *
 * ## A gated redirect is graded against an INVENTED SIBLING, because the gate fires before the router
 *
 * MEASURED: `/files/team/{teamId}/zzz-not-a-real-subroute` answers exactly what
 * `/files/team/{teamId}/members` answers, because the authentication gate refuses before the router
 * resolves the leaf. So a redirect on its own establishes the gated PREFIX and nothing after it, and a
 * grade that read it as existence would put twenty unearned confirmations into a committed inventory.
 *
 * Every gated route is therefore graded by a second request whose whole job is to fail, and which of the
 * two tests applies is decided by the route's own shape:
 *
 * - **The last segment is a LITERAL** (`/settings/security`, `/files/drafts`): probe the sibling with that
 *   segment replaced by {@link INVENTED_SEGMENT}. If the sibling answers the same way, the leaf is
 *   unconfirmed — `auth-gated-prefix`. If it does not, the router reached this route's own last segment.
 * - **The last segment is a PARAMETER** (`/files/team/{teamId}`): an invented sibling is indistinguishable
 *   from the probe, since the id is already synthetic. Here the discriminator is the redirect's
 *   `resource_type` parameter, which the gate sets only once it has resolved a typed resource segment.
 *   MEASURED: `/files/team/{synthetic}` answers `resource_type=team` while
 *   {@link PREFIX_CONTROL_ROUTE} — an invented literal in the same position — answers with none.
 *
 * {@link PREFIX_CONTROL_ROUTE} is probed on every run to keep that second test honest: if an invented
 * literal ever starts carrying a `resource_type`, the parameter test has stopped discriminating and every
 * row it graded needs re-deriving.
 *
 * Every parameterised route is probed with an obviously synthetic identifier. No real team, project,
 * organisation or file id appears here or in the inventory this checks — those are provider identifiers
 * this repository may not carry.
 */
import { FIGMA_BROWSER_PAGES, type FigmaRouteEvidence } from "../src/atlas/figma/browserPages.js";

const ORIGIN = "https://www.figma.com";

/** Proves the negative still fires. A run whose control stops answering 404 has measured nothing. */
const CONTROL_ROUTE = "/nope-not-a-real-route-zzz";

/**
 * An invented literal in the position a typed resource segment occupies. Proves the parameter test still
 * discriminates: this must answer a login redirect carrying NO `resource_type`, because if an invented
 * literal ever started carrying one, `resource_type` would have stopped meaning "the gate resolved a
 * resource" and every row graded by it would need re-deriving.
 */
const PREFIX_CONTROL_ROUTE = "/files/zzz-not-a-real-section";

/** The stand-in a sibling probe substitutes for a route's own final literal segment. */
const INVENTED_SEGMENT = "zzz-not-a-real-segment";

/** Stand-ins for the identifiers a real route carries, chosen to be impossible to mistake for real ones. */
const SYNTHETIC: Readonly<Record<string, string>> = {
  "{fileKey}": "XXXXXXXXXXXXXXXXXXXXXX",
  "{folderId}": "999999999999999999",
  "{handle}": "zzz-not-a-real-handle",
  "{orgId}": "999999999999999999",
  "{projectId}": "999999999999999999",
  "{teamId}": "999999999999999999",
};

/** One route template with every parameter replaced by a synthetic identifier. */
function concreteRoute({ route }: { route: string }): string {
  return Object.entries(SYNTHETIC).reduce((path, [parameter, stand]) => path.split(parameter).join(stand), route);
}

/**
 * Whether a redirect target is Figma's own documentation site, by HOST rather than by string prefix.
 *
 * A `startsWith("https://developers.figma.com")` test would also accept
 * `https://developers.figma.com.example.invalid/`, so the prefix classifies an attacker-chosen host as
 * Figma's own. Parsing and comparing the host exactly is the only form that cannot be extended past the
 * authority component. It matters even in a dev tool that trusts nothing it reads, because the
 * classification decides what a committed inventory records — and the whole point of that inventory is
 * that its evidence is measured.
 *
 * @param location the `Location` header, which is not guaranteed to be a URL at all
 * @returns whether it points at Figma's developer-documentation host
 */
function isDeveloperHost({ location }: { location: string }): boolean {
  try {
    return new URL(location, ORIGIN).host === "developers.figma.com";
  } catch {
    return false;
  }
}

/** Whether a `/login` redirect carried a resolved `resource_type`, which is what makes it a typed one. */
function hasResourceType({ location }: { location: string }): boolean {
  try {
    return new URL(location, ORIGIN).searchParams.has("resource_type");
  } catch {
    return false;
  }
}

/** Whether a redirect target is the sign-in page on Figma's own host. */
function isLoginRedirect({ location }: { location: string }): boolean {
  try {
    const target = new URL(location, ORIGIN);
    return target.host === "www.figma.com" && target.pathname === "/login";
  } catch {
    return false;
  }
}

/**
 * What one unauthenticated request establishes about a route, before the gated grading is refined.
 *
 * A login redirect comes back as `auth-gated-prefix` here, which is the WEAKER of the two gated classes on
 * purpose: {@link gradeRoute} promotes it only once a second request has ruled the leaf in.
 */
async function probeOnce({ path }: { path: string }): Promise<{
  readonly evidence: FigmaRouteEvidence;
  readonly resourceTyped: boolean;
}> {
  const response = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  if (response.status === 404) {
    return { evidence: "absent-404", resourceTyped: false };
  }
  if (response.status === 403) {
    return { evidence: "resource-forbidden", resourceTyped: false };
  }
  if (response.status === 302 && isLoginRedirect({ location })) {
    return { evidence: "auth-gated-prefix", resourceTyped: hasResourceType({ location }) };
  }
  if (response.status === 301 && isDeveloperHost({ location })) {
    return { evidence: "offsite-redirect", resourceTyped: false };
  }
  if (response.status === 308) {
    // The trailing-slash normalisation. Follow it once: an unknown path resolves to the 404 that makes
    // every other class in this vocabulary mean something.
    const settled = await fetch(new URL(location, ORIGIN), { redirect: "follow" });
    return { evidence: settled.status === 404 ? "absent-404" : "public-200", resourceTyped: false };
  }
  return { evidence: "public-200", resourceTyped: false };
}

/** The same route with its final segment replaced by an invented literal, or `null` when it is a parameter. */
function siblingPath({ route }: { route: string }): string | null {
  const segments = concreteRoute({ route }).split("/");
  const last = segments[segments.length - 1] ?? "";
  if (route.split("/").pop()?.includes("{") === true || last.length === 0) {
    return null;
  }
  return [...segments.slice(0, -1), INVENTED_SEGMENT].join("/");
}

/**
 * What one unauthenticated request establishes about a route, with a gated redirect graded against an
 * invented sibling or against the `resource_type` control. See this file's header for both tests.
 */
async function gradeRoute({ route }: { route: string }): Promise<FigmaRouteEvidence> {
  const found = await probeOnce({ path: concreteRoute({ route }) });
  if (found.evidence !== "auth-gated-prefix") {
    return found.evidence;
  }
  const sibling = siblingPath({ route });
  if (sibling === null) {
    return found.resourceTyped ? "auth-gated-confirmed" : "auth-gated-prefix";
  }
  const invented = await probeOnce({ path: sibling });
  return invented.evidence === "auth-gated-prefix" ? "auth-gated-prefix" : "auth-gated-confirmed";
}

/** Probe every declared route plus both controls, and report — or refuse — depending on the mode. */
async function main(): Promise<void> {
  const verifying = process.argv.slice(2).includes("--verify");
  const control = await probeOnce({ path: CONTROL_ROUTE });
  if (control.evidence !== "absent-404") {
    process.stderr.write(
      `probeFigmaRoutes: the control ${CONTROL_ROUTE} no longer answers 404 (graded ${control.evidence}),` +
        " so no other answer proves anything. Figma has changed how it handles unknown paths; re-derive" +
        " the method before trusting any row below\n",
    );
    process.exit(1);
  }
  const prefixControl = await probeOnce({ path: PREFIX_CONTROL_ROUTE });
  if (prefixControl.evidence !== "auth-gated-prefix" || prefixControl.resourceTyped) {
    process.stderr.write(
      `probeFigmaRoutes: the control ${PREFIX_CONTROL_ROUTE} graded ${prefixControl.evidence} with` +
        ` resource_type=${String(prefixControl.resourceTyped)}, rather than a login redirect carrying` +
        " none. `resource_type` has stopped meaning 'the gate resolved a resource', so every" +
        " auth-gated-confirmed row in src/atlas/figma/browserPages.ts needs re-deriving\n",
    );
    process.exit(1);
  }
  const disagreements: string[] = [];
  for (const page of FIGMA_BROWSER_PAGES) {
    const found = await gradeRoute({ route: page.route });
    process.stdout.write(`${page.route.padEnd(42)} ${found}\n`);
    if (found !== page.evidence) {
      disagreements.push(`  ${page.route}: inventory says ${page.evidence}, probe says ${found}`);
    }
  }
  if (verifying && disagreements.length > 0) {
    process.stderr.write(
      `probeFigmaRoutes: ${String(disagreements.length)} route(s) moved:\n${disagreements.join("\n")}\n` +
        "update src/atlas/figma/browserPages.ts in the same commit, with the new measurement date\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    `control ${CONTROL_ROUTE} answered 404 and ${PREFIX_CONTROL_ROUTE} answered a login redirect carrying` +
      " no resource_type, so both tests are still measuring something\n",
  );
}

void main();
