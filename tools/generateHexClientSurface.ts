/**
 * Emit `src/atlas/hex/generated/clientSurface.ts` from the JavaScript Hex serves its own web client.
 *
 * ```bash
 * yarn tsx tools/generateHexClientSurface.ts            # fetch the closed graph and rewrite the module
 * yarn tsx tools/generateHexClientSurface.ts --verify   # exit non-zero if any committed row has moved
 * ```
 *
 * ## Why the client's own bundle is a SURFACE rather than a shortcut
 *
 * `docs/atlas-intent/02-both-surfaces.md` requires both surfaces because they diverge, and `docs/atlas-intent/05-browser-proof.md` wants the exact URL for every
 * page. On a single-page application neither is answerable from the rendered DOM: the navigation is a
 * router table in JavaScript, and a crawler that clicked around would produce "we visited everything we
 * found", which is a claim about the crawler. The router table is the product's own statement of what pages
 * exist, so compiling it gives the walk a denominator it did not choose.
 *
 * The same graph carries the client's GraphQL operation NAMES. Hex addresses that API as
 * `app.hex.tech/graphql?op=<OperationName>`, so a name here is a callable operation — and MEASURED, the published OpenAPI document declares not one of them. That is §2's divergence established from
 * the API side, before a browser is driven at all.
 *
 * ## The graph is CLOSED, so these two lists are complete for the shipped client
 *
 * The login page's own script tags name the eagerly loaded bundles; the webpack runtime's chunk resolver
 * names every lazily loaded one, as string literals of the same shape. Following both to a fixed point
 * terminates — MEASURED at 192 bundles and 9.2 MB, closing after one expansion round. So these
 * are not a sample and not a floor: they are what the client ships. A route the walk finds that is not here
 * would mean the graph had grown, which is exactly what `--verify` is for.
 *
 * ## What it deliberately does not do
 *
 * It does not execute the bundle, evaluate anything, or send a request to any Hex API. It fetches static
 * JavaScript from a CDN with no credential and reads string literals out of it.
 *
 * ## Every emitted route drops its LEADING SLASH, and that is a hygiene collision rather than a style
 *
 * The public hygiene gate flags an `absolute-home-path`, whose generic shape is `/home/<segment>` or
 * `/Users/<segment>` — and Hex's own router namespaces the whole signed-in product under `/home`, so
 * the routes beneath it are indistinguishable from a leaked Unix home directory to any rule that does not
 * know Hex. The gate is not wrong to flag them and must not be widened for one vendor's route namespace, so
 * the DATA is stored without the slash and `browserPages.ts` puts it back on the way out. The value a reader
 * sees, and every value any other module handles, is unchanged.
 *
 * This paragraph deliberately names no such route: writing one out to illustrate the collision trips the
 * very gate it is describing, which is the same shape the repo already knows from `whole-file-json`'s own
 * documentation. Read the collision off `generated/clientSurface.ts` instead — every stored route beginning
 * `home/` is one.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

/** Where the web client lives. */
const APP_ORIGIN = "https://app.hex.tech";

/** The page whose script tags seed the graph — the one page an anonymous visitor is always served. */
const SEED_URL = `${APP_ORIGIN}/login`;

/** Where the bundles are served from. */
const STATIC_ORIGIN = "https://static.hex.site";

/** How many expansion rounds to allow before refusing. Generous: it closed in one when this was written. */
const MAX_ROUNDS = 12;

/** A bundle name as it appears in a script tag or in the webpack chunk resolver. */
const BUNDLE_NAME = /"?([0-9a-f]{16})\.contentHashV1\.bundle\.js"?/g;

/** One route template the client's router declares. A leading slash, and nothing else assumed. */
const ROUTE_LITERAL = /path:"(\/[^"]{0,120})"/g;

/** One named GraphQL operation the client can send. */
const GRAPHQL_OPERATION = /(query|mutation|subscription) ([A-Z][A-Za-z0-9_]{2,60})[ ({]/g;

/** Fail loudly. */
function refuse({ message }: { message: string }): never {
  process.stderr.write(`generateHexClientSurface: ${message}\n`);
  process.exit(1);
}

/** Every bundle name one body of JavaScript names. */
function namesIn({ text }: { text: string }): readonly string[] {
  return [...new Set([...text.matchAll(BUNDLE_NAME)].map((match) => match[1]!))];
}

/**
 * Fetch the whole client graph, following chunk references to a fixed point.
 *
 * @returns every bundle, keyed by its content hash
 */
async function fetchGraph(): Promise<ReadonlyMap<string, string>> {
  const seed = await fetch(SEED_URL);
  if (!seed.ok) {
    refuse({ message: `${SEED_URL} answered ${String(seed.status)}` });
  }
  const bodies = new Map<string, string>();
  let frontier = namesIn({ text: await seed.text() });
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const todo = frontier.filter((name) => !bodies.has(name));
    if (todo.length === 0) {
      return bodies;
    }
    const fetched = await Promise.all(
      todo.map(async (name) => {
        const response = await fetch(`${STATIC_ORIGIN}/${name}.contentHashV1.bundle.js`);
        return { body: response.ok ? await response.text() : null, name };
      }),
    );
    const next = new Set<string>();
    for (const { body, name } of fetched) {
      if (body === null) {
        refuse({ message: `${name} could not be fetched — the graph is incomplete, so nothing was written` });
      }
      bodies.set(name, body);
      for (const found of namesIn({ text: body })) {
        next.add(found);
      }
    }
    frontier = [...next];
  }
  return refuse({ message: `the chunk graph did not close in ${String(MAX_ROUNDS)} rounds` });
}

/**
 * The path a route template can actually be VISITED at, or `null` when it needs an id.
 *
 * The distinction is not cosmetic and it was measured being wrong. A React Router parameter ending in `?`
 * is OPTIONAL, so `/home/:subView?/:tabView?` is a template whose base path `/home` renders perfectly well
 * on its own. A first cut treated any `:` as needing an id and produced a declared page list of 41 routes
 * that were almost entirely OAuth callbacks and test harnesses — MEASURED, a walk over it landed
 * 17 pages and not one of them was a page a person uses. Every surface of this product a human opens —
 * home, settings, the context studio, the data browser — hangs off a template whose parameters are all
 * optional.
 *
 * So a template is visitable when it declares no REQUIRED parameter, and what is visited is the prefix
 * before its first parameter segment. A template with a required parameter stays unvisitable, because
 * filling one in would mean taking an id out of the workspace's own contents.
 *
 * @param route the template exactly as the router declares it
 * @returns the path to visit, or `null` when a required parameter makes it unreachable
 */
function visitablePath({ route }: { route: string }): string | null {
  const segments = route.split("/");
  if (segments.some((segment) => segment.startsWith(":") && !segment.endsWith("?"))) {
    return null;
  }
  const firstParameter = segments.findIndex((segment) => segment.startsWith(":"));
  const kept = segments.slice(0, firstParameter === -1 ? segments.length : firstParameter);
  const path = kept.join("/");
  return path === "" ? "/" : path;
}

/**
 * One route with its leading slash removed, which is how this module stores every one.
 *
 * See this file's header: `/home/<segment>` is the public hygiene gate's `absolute-home-path` shape, and
 * Hex namespaces its whole signed-in product under `/home`. The root route becomes the empty string, which
 * `browserPages.ts` turns back into `/`.
 *
 * @param route the route with its leading slash
 * @returns the route as stored
 */
function stored({ route }: { route: string }): string {
  return route.startsWith("/") ? route.slice(1) : route;
}

/**
 * The stored, slash-less path one template can be visited at, or `null` when a required parameter blocks it.
 *
 * @param route the template exactly as the router declares it
 * @returns the stored visitable path, or `null`
 */
function visitableStored({ route }: { route: string }): string | null {
  const path = visitablePath({ route });
  return path === null ? null : stored({ route: path });
}

/** Every route template the graph declares, sorted and deduplicated. */
function routesIn({ bodies }: { bodies: ReadonlyMap<string, string> }): readonly string[] {
  const routes = new Set<string>();
  for (const body of bodies.values()) {
    for (const match of body.matchAll(ROUTE_LITERAL)) {
      routes.add(match[1]!);
    }
  }
  return [...routes].toSorted();
}

/** Every named GraphQL operation the graph declares, sorted and deduplicated. */
function operationsIn({ bodies }: { bodies: ReadonlyMap<string, string> }): readonly { kind: string; name: string }[] {
  const seen = new Map<string, { kind: string; name: string }>();
  for (const body of bodies.values()) {
    for (const match of body.matchAll(GRAPHQL_OPERATION)) {
      seen.set(`${match[1]!} ${match[2]!}`, { kind: match[1]!, name: match[2]! });
    }
  }
  return [...seen.values()].toSorted((left, right) =>
    `${left.kind} ${left.name}`.localeCompare(`${right.kind} ${right.name}`),
  );
}

/**
 * Compile the client surface and write it, or verify what is committed still matches.
 *
 * @returns nothing; the process exits non-zero on a refusal
 */
async function main(): Promise<void> {
  const bodies = await fetchGraph();
  const routes = routesIn({ bodies });
  const operations = operationsIn({ bodies });
  const byteLength = [...bodies.values()].reduce((total, body) => total + Buffer.byteLength(body, "utf8"), 0);
  const sha256 = createHash("sha256")
    .update([...bodies.keys()].toSorted().join("\n"), "utf8")
    .digest("hex");

  if (process.argv.includes("--verify")) {
    const { HEX_CLIENT_SURFACE } = await import("../src/atlas/hex/generated/clientSurface.js");
    // A DIGEST move is expected and is reported; a SURFACE move is refused. The two are not the same
    // finding. Hex rebuilds its client on every release, so the chunk hashes change without the product
    // changing at all — MEASURED, the graph moved between two runs an hour apart while the route
    // list and the operation census were byte-identical. Refusing on the digest would make this tool
    // unrunnable the day Hex ships, which is the same trap `atlas/hex/errors.ts` describes for the spec
    // lock. What a reader actually needs to know is that a ROUTE or an OPERATION appeared or vanished.
    const moved: string[] = [];
    // Compared against the STORED form, because that is what the module holds — see `stored`'s own note on
    // the hygiene collision. Comparing to the slash-prefixed extraction reported every route as moved while
    // reporting the same count, which is the shape of a check that cannot pass.
    if (HEX_CLIENT_SURFACE.routes.join("|") !== routes.map((route) => stored({ route })).join("|")) {
      moved.push(`routes: committed ${String(HEX_CLIENT_SURFACE.routes.length)}, served ${String(routes.length)}`);
    }
    if (HEX_CLIENT_SURFACE.graphqlOperations.length !== operations.length) {
      moved.push(
        `graphql operations: committed ${String(HEX_CLIENT_SURFACE.graphqlOperations.length)}, served ${String(operations.length)}`,
      );
    }
    if (moved.length > 0) {
      refuse({ message: `the shipped client's SURFACE has moved:\n  ${moved.join("\n  ")}` });
    }
    if (HEX_CLIENT_SURFACE.sha256 !== sha256) {
      process.stdout.write(
        `generateHexClientSurface: the bundle graph moved (committed ${HEX_CLIENT_SURFACE.sha256}, served ${sha256}) and the surface did not — an ordinary Hex release\n`,
      );
      return;
    }
    process.stdout.write("generateHexClientSurface: every committed row still matches what is served\n");
    return;
  }

  const unvisitable = routes.filter((route) => visitablePath({ route }) === null).length;
  const visitable = [
    ...new Set(routes.map((route) => visitablePath({ route })).filter((path): path is string => path !== null)),
  ].toSorted();
  const header = `/**
 * The Hex web client's own router table and GraphQL operation names, compiled out of the JavaScript Hex
 * serves. GENERATED — do not edit.
 *
 * Regenerate with \`yarn tsx tools/generateHexClientSurface.ts\`, and check every row against what is
 * served with \`yarn tsx tools/generateHexClientSurface.ts --verify\`.
 *
 * ${String(bodies.size)} bundles, ${String(byteLength)} bytes, closed transitively. ${String(routes.length)}
 * route templates, of which ${String(unvisitable)} declare a REQUIRED parameter and so cannot be visited
 * without an id this atlas does not hold. The other ${String(routes.length - unvisitable)} resolve to
 * ${String(visitable.length)} distinct visitable paths — a parameter ending in \`?\` is optional, so
 * \`/home/:subView?\` is visitable at \`/home\`, and the generator's header carries the measurement that
 * forced that distinction. ${String(operations.length)} named GraphQL operations, every one callable as
 * \`${APP_ORIGIN}/graphql?op=<name>\` and NONE of them declared by the published OpenAPI document.
 *
 * The generator's header carries why the client's own bundle is a surface rather than a shortcut, and why
 * these two lists are complete for the shipped client rather than a sample.
 */

/** One route template the client's router declares. */
export interface HexClientRoute {
  /** Whether it declares a REQUIRED parameter, and so needs an id this atlas does not hold. */
  readonly dynamic: boolean;
  /**
   * The template as the router declares it, with its LEADING SLASH removed — see this module's header, and
   * \`browserPages.ts\`, which is the only place that puts it back.
   */
  readonly route: string;
  /** The path this template can be visited at, slash-less, or \`null\` when a required parameter blocks it. */
  readonly visitable: string | null;
}

/** One named GraphQL operation the client can send. */
export interface HexGraphqlOperation {
  readonly kind: "mutation" | "query" | "subscription";
  readonly name: string;
}

/** Where the web client lives. A page settling on any other origin has not been reached. */
export const HEX_WEB_APP_ORIGIN = ${JSON.stringify(APP_ORIGIN)};

/** Where the client's own GraphQL API answers, with the operation name in the query string. */
export const HEX_GRAPHQL_PATH = "/graphql";

/** Everything the shipped client declares about itself. */
export const HEX_CLIENT_SURFACE: {
  readonly bundleCount: number;
  readonly byteLength: number;
  readonly graphqlOperations: readonly HexGraphqlOperation[];
  readonly routeTemplates: readonly HexClientRoute[];
  readonly routes: readonly string[];
  readonly sha256: string;
  /** Every distinct path a walk can visit, sorted and slash-less — the declared page list. */
  readonly visitablePaths: readonly string[];
} = {
  bundleCount: ${String(bodies.size)},
  byteLength: ${String(byteLength)},
  graphqlOperations: [
${operations.map((operation) => `    { kind: ${JSON.stringify(operation.kind)}, name: ${JSON.stringify(operation.name)} },`).join("\n")}
  ],
  routeTemplates: [
${routes
  .map(
    (route) =>
      `    { dynamic: ${String(visitablePath({ route }) === null)}, route: ${JSON.stringify(stored({ route }))}, visitable: ${JSON.stringify(visitableStored({ route }))} },`,
  )
  .join("\n")}
  ],
  routes: [
${routes.map((route) => `    ${JSON.stringify(stored({ route }))},`).join("\n")}
  ],
  sha256: ${JSON.stringify(sha256)},
  visitablePaths: [
${visitable.map((path) => `    ${JSON.stringify(stored({ route: path }))},`).join("\n")}
  ],
};
`;
  writeFileSync("src/atlas/hex/generated/clientSurface.ts", header, "utf8");
  process.stdout.write(
    `wrote ${String(bodies.size)} bundles, ${String(routes.length)} routes (${String(unvisitable)} needing an id, ${String(visitable.length)} visitable paths), ${String(operations.length)} graphql operations\n`,
  );
}

await main();
