/**
 * Emit `src/atlas/twilio/generated/consoleRoutes.ts` from console links harvested out of Twilio's own
 * documentation.
 *
 * ## Why the declared route list is HARVESTED rather than recalled
 *
 * A walk is judged against a denominator it did not choose, so the denominator has to come from somewhere
 * checkable. Twilio publishes no authenticated console sitemap, and the console is a single-page
 * application whose navigation is not in its HTML — but Twilio's own documentation deep-links into it
 * constantly, so every route below is one Twilio itself published, and every row carries the doc page that
 * named it. A route list written from memory would look identical and be unfalsifiable.
 *
 * Reproduce the harvest — 828 depth-2 documentation landing pages from Twilio's own sitemap, every
 * `console.twilio.com/...` link on each:
 *
 * ```bash
 * curl -fsSL https://www.twilio.com/docs/sitemap.xml > sitemap.xml
 * python3 -c 'import re,sys; print("\n".join(u for u in re.findall(r"<loc>(.*?)</loc>", open("sitemap.xml").read()) if u.count("/")==5))' > landing.txt
 * while read u; do curl -fsSL "$u" | grep -oE "console\.twilio\.com/[A-Za-z0-9/_.-]+" | sort -u | sed "s|\$|\t$u|"; done < landing.txt > console-links.tsv
 * yarn tsx tools/generateTwilioConsoleRoutes.ts console-links.tsv
 * ```
 *
 * ## What the region placeholder is for
 *
 * Twilio prefixes most console routes with the account's home region — `us1`, `ie1`, `au1` — and the same
 * page is published under all three by different documentation pages. The region an account lives in is an
 * installation fact, so a declared route carries `{region}` and the walk substitutes what it discovers from
 * where the console settles. Folding the three prefixes into one placeholder is also what stops the same
 * page being declared three times and inflating the denominator.
 *
 * ## What is dropped, and why each is a rule rather than a taste
 *
 * - **Marketing entry points** (`/go`, `/account/go`, `/account/upgrade`). These are sign-up and upgrade
 *   redirects that every documentation page carries in its chrome — `/go` alone was cited by 38 of the 828
 *   pages — and none of them is a page of the console's own surface.
 * - **A route naming one specific record.** `docs/atlas-intent/06-holdings.md` is explicit that a list surface is
 *   declared once and a row never gets a route of its own, so the two harvested add-on catalogue routes
 *   carrying a marketplace listing SID are dropped while `/develop/add-ons/catalog` itself is kept.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** The region prefixes Twilio publishes the same console page under. */
const REGIONS = ["us1", "ie1", "au1"] as const;

/** Paths that are sign-up or upgrade redirects rather than console surfaces. See this file's header. */
const MARKETING_PATHS = new Set(["/go", "/account/go", "/account/upgrade"]);

/** A path segment that is a Twilio SID — 2 letters then 32 hex — so a route naming one record is dropped. */
const SID_SEGMENT = /^[A-Z]{2}[0-9a-fA-F]{32}$/;

/** One declared route as this tool assembles it. */
interface Route {
  readonly citedBy: readonly string[];
  readonly route: string;
  readonly section: string;
}

/**
 * The route with its region prefix replaced by a placeholder, or the path unchanged when it carries none.
 *
 * @param path the harvested path, leading slash included
 * @returns the path with `{region}` where a region prefix was
 */
function withRegionPlaceholder({ path }: { path: string }): string {
  for (const region of REGIONS) {
    if (path.startsWith(`/${region}/`)) {
      return `/{region}/${path.slice(region.length + 2)}`;
    }
  }
  return path;
}

/**
 * The console section one route belongs to — Twilio's own top-level grouping.
 *
 * @param route the route with its region placeholder already substituted
 * @returns the first segment past the region, or the first segment when there is none
 */
function sectionOf({ route }: { route: string }): string {
  return route.split("/").find((segment) => segment.length > 0 && segment !== "{region}") ?? "root";
}

/** Read the harvest and fold it into one row per declared route. */
function routes({ tsv }: { tsv: string }): readonly Route[] {
  const byRoute = new Map<string, Set<string>>();
  for (const row of readFileSync(tsv, "utf8").split("\n")) {
    // Split on the FIRST tab by index rather than destructuring, so neither half is ever `undefined` and
    // the guard below is about the row's content instead of about its arity.
    const tab = row.indexOf("\t");
    if (tab < 0) {
      continue;
    }
    const link = row.slice(0, tab);
    const citedBy = row.slice(tab + 1);
    if (!link.startsWith("console.twilio.com/")) {
      continue;
    }
    const path = link.slice("console.twilio.com".length);
    if (MARKETING_PATHS.has(path) || path.split("/").some((segment) => SID_SEGMENT.test(segment))) {
      continue;
    }
    const route = withRegionPlaceholder({ path });
    const held = byRoute.get(route) ?? new Set<string>();
    held.add(citedBy);
    byRoute.set(route, held);
  }
  return [...byRoute.entries()]
    .map(([route, cited]) => ({ citedBy: [...cited].toSorted(), route, section: sectionOf({ route }) }))
    .toSorted((left, right) => left.route.localeCompare(right.route));
}

/** One row, printed on a single line so a route's diff is one line long. */
function line({ row }: { row: Route }): string {
  const cited = row.citedBy.map((url) => JSON.stringify(url)).join(", ");
  return `  { citedBy: [${cited}], route: ${JSON.stringify(row.route)}, section: ${JSON.stringify(row.section)} },`;
}

const tsv = process.argv.slice(2).join("");
if (tsv === "") {
  throw new Error("usage: yarn tsx tools/generateTwilioConsoleRoutes.ts <console-links.tsv>");
}
const rows = routes({ tsv });
const sections = new Set(rows.map((row) => row.section));
const header = `/**
 * GENERATED by \`tools/generateTwilioConsoleRoutes.ts\` from console links harvested out of Twilio's own
 * documentation. Do not edit by hand — regenerate, and review the diff.
 *
 * ${String(rows.length)} declared routes across ${String(sections.size)} console sections, each carrying
 * the documentation page or pages that named it.
 *
 * **This denominator is a FLOOR, and saying so is the point.** It is every console route Twilio's own
 * documentation links to, which is checkable; it is not every route the console has, which nothing outside
 * a signed-in session can establish. \`walk.ts\` expands it from the navigation a landed page renders, so
 * the floor rises as pages are actually reached — and the gap between the two numbers is a thing this atlas
 * reports rather than a silence.
 */
import type { TwilioConsoleRoute } from "../browserPages.js";

/** Every console route Twilio's own documentation names, sorted by route. */
export const TWILIO_CONSOLE_ROUTES: readonly TwilioConsoleRoute[] = [
`;
writeFileSync(
  "src/atlas/twilio/generated/consoleRoutes.ts",
  `${header}${rows.map((row) => line({ row })).join("\n")}\n];\n`,
  "utf8",
);
process.stdout.write(`wrote ${String(rows.length)} routes across ${String(sections.size)} sections\n`);
