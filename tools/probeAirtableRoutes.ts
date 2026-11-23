/**
 * Re-measure which Airtable browser routes exist, without an Airtable account.
 *
 * ```bash
 * yarn tsx tools/probeAirtableRoutes.ts            # print each route's evidence class
 * yarn tsx tools/probeAirtableRoutes.ts --verify   # exit non-zero if any row disagrees with the inventory
 * ```
 *
 * The method, and why it works at all: Airtable answers an unauthenticated request to a route that EXISTS
 * and is gated with `302 → /login?continue=<the route>`, and a route that does not exist with a flat `404`.
 * So the redirect is a positive existence signal, and {@link CONTROL_ROUTE} is in every run to prove the
 * negative still fires — a probe whose control stops answering 404 is a probe measuring nothing.
 *
 * A `200` is deliberately NOT treated as existence. Airtable is a single-page application whose shell
 * renders for a signed-out visitor at paths that resolve to nothing, including `/{baseId}` with an invented
 * base id, so `src/atlas/airtable/browserPages.ts` records those as `shell-200-ambiguous`.
 *
 * Every parameterised route is probed with an obviously synthetic identifier. No real base, workspace or
 * enterprise id appears here or in the inventory this checks — those are provider identifiers this
 * repository may not carry.
 */
import { AIRTABLE_BROWSER_PAGES, type AirtableRouteEvidence } from "../src/atlas/airtable/browserPages.js";

const ORIGIN = "https://airtable.com";

/** Proves the negative still fires. A run whose control stops answering 404 has measured nothing. */
const CONTROL_ROUTE = "/nope-not-a-real-route-zzz";

/** Stand-ins for the identifiers a real route carries, chosen to be impossible to mistake for real ones. */
const SYNTHETIC: Readonly<Record<string, string>> = {
  "{baseId}": "appXXXXXXXXXXXXXX",
  "{enterpriseAccountId}": "entXXXXXXXXXXXXXX",
  "{pageBundleId}": "pbdXXXXXXXXXXXXXX",
  "{tableId}": "tblXXXXXXXXXXXXXX",
  "{viewId}": "viwXXXXXXXXXXXXXX",
  "{workspaceId}": "wspXXXXXXXXXXXXXX",
};

/** One route template with every parameter replaced by a synthetic identifier. */
function concreteRoute({ route }: { route: string }): string {
  return Object.entries(SYNTHETIC).reduce((path, [parameter, stand]) => path.split(parameter).join(stand), route);
}

/**
 * Whether a redirect target is the marketing site, by HOST rather than by string prefix.
 *
 * A `startsWith("https://www.airtable.com")` test is what this replaced, and CodeQL was right to refuse it:
 * `https://www.airtable.com.example.invalid/` also starts with that string, so the prefix classifies an
 * attacker-chosen host as Airtable's own. Parsing and comparing the host exactly is the only form that
 * cannot be extended past the authority component.
 *
 * It matters here even though this is a dev tool that trusts nothing it reads. The classification decides
 * what `browserPages.ts` records about a route, so a mis-parsed redirect would put a wrong evidence class
 * into a committed inventory — and the whole point of that inventory is that its evidence is measured.
 *
 * @param location the `Location` header, which is not guaranteed to be a URL at all
 * @returns whether it points at Airtable's marketing host
 */
function isMarketingHost({ location }: { location: string }): boolean {
  try {
    return new URL(location).host === "www.airtable.com";
  } catch {
    return false;
  }
}

/** What one unauthenticated request establishes about a route. `null` means the route does not exist. */
async function probe({ route }: { route: string }): Promise<AirtableRouteEvidence | null> {
  const path = concreteRoute({ route });
  const response = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  if (response.status === 404) {
    return null;
  }
  if (response.status === 302 && location.startsWith("/login?continue=")) {
    return "auth-gated-redirect";
  }
  if (response.status === 301 && isMarketingHost({ location })) {
    return "marketing-redirect";
  }
  return "shell-200-ambiguous";
}

/** Probe every declared route plus the control, and report — or refuse — depending on the mode. */
async function main(): Promise<void> {
  const verifying = process.argv.slice(2).includes("--verify");
  const control = await probe({ route: CONTROL_ROUTE });
  if (control !== null) {
    process.stderr.write(
      `probeAirtableRoutes: the control ${CONTROL_ROUTE} no longer answers 404, so a redirect proves` +
        " nothing. Airtable has changed how it handles unknown paths; re-derive the method before trusting" +
        " any row below\n",
    );
    process.exit(1);
  }
  const disagreements: string[] = [];
  for (const page of AIRTABLE_BROWSER_PAGES) {
    const found = await probe({ route: page.route });
    const shown = found ?? "absent-404";
    process.stdout.write(`${page.route.padEnd(46)} ${shown}\n`);
    if (shown !== page.evidence) {
      disagreements.push(`  ${page.route}: inventory says ${page.evidence}, probe says ${shown}`);
    }
  }
  if (verifying && disagreements.length > 0) {
    process.stderr.write(
      `probeAirtableRoutes: ${String(disagreements.length)} route(s) moved:\n${disagreements.join("\n")}\n` +
        "update src/atlas/airtable/browserPages.ts in the same commit, with the new measurement date\n",
    );
    process.exit(1);
  }
  process.stdout.write(`control ${CONTROL_ROUTE} answered 404, so the probe is measuring something\n`);
}

void main();
