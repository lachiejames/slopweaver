/**
 * Read GitHub's own OpenAPI description off disk and compile it into `rest-operation` entities.
 *
 * The effects half of `atlas/github/restSurface.ts`: finding and reading the declaration files. The
 * extraction itself is pure and unit-tested over declaration text, so nothing here needs `node_modules`
 * present to be provable — only to RUN.
 *
 * ## Why the description is read from the installed package rather than fetched
 *
 * `@octokit/openapi-types` ships GitHub's own published OpenAPI description, pinned in this repository's
 * lockfile. Reading it is deterministic and offline: two runs on one checkout produce identical bytes, and
 * a run in CI produces what a run on a laptop does. Fetching the moving `latest` alias would make the
 * atlas's own API surface depend on what GitHub shipped this morning, which is the opposite of a ground
 * truth a reader can reproduce.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

import { type GithubRestRoute, parseGithubRestSurface } from "../../../atlas/github/restSurface.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubAtlasVerbError, GithubAtlasVerbErrors } from "./errors.js";

/**
 * What the compiled surface produced, plus the version it was read from.
 *
 * @internal
 */
export interface CompiledRestSurface {
  readonly routes: readonly GithubRestRoute[];
  /** Which route each installed Octokit method exposes, so a route can say whether the SDK declares it. */
  readonly sdkMethodByRoute: ReadonlyMap<string, string>;
  /** The `@octokit/openapi-types` version, so a stale generation announces itself. */
  readonly descriptionVersion: string;
}

/** Where the endpoint-table scan has got to: the current scope, and a method still awaiting its route. */
interface EndpointScanState {
  scope: string;
  pendingMethod: string | null;
}

/** A scope header: `  actions: {`. */
const SCOPE_LINE = /^ {2}([A-Za-z0-9_$]+): \{$/u;

/** A method whose route is on the same line: `    getOrg: ["GET /orgs/{org}"`. */
const INLINE_METHOD_LINE = /^ {4}([A-Za-z0-9_$]+): \["([A-Z]+ [^"]+)"/u;

/** A method whose route is on the next line: `    getOrg: [`. */
const WRAPPED_METHOD_LINE = /^ {4}([A-Za-z0-9_$]+): \[$/u;

/** A wrapped method's route: `      "GET /orgs/{org}"`. */
const ROUTE_LINE = /^ {6}"([A-Z]+ [^"]+)"$/u;

/**
 * Read one line of the installed endpoint table into the route map.
 *
 * @param line the source line
 * @param state where the scan has got to; mutated
 * @param byRoute the accumulator
 */
function scanEndpointLine({
  line,
  state,
  byRoute,
}: {
  line: string;
  state: EndpointScanState;
  byRoute: Map<string, string>;
}): void {
  const scopeMatch = SCOPE_LINE.exec(line);
  if (scopeMatch?.[1] !== undefined) {
    state.scope = scopeMatch[1];
    return;
  }
  if (state.scope.length === 0) {
    return;
  }
  const inline = INLINE_METHOD_LINE.exec(line);
  if (inline?.[1] !== undefined && inline[2] !== undefined) {
    byRoute.set(inline[2], `${state.scope}.${inline[1]}`);
    return;
  }
  const wrapped = WRAPPED_METHOD_LINE.exec(line);
  if (wrapped?.[1] !== undefined) {
    state.pendingMethod = `${state.scope}.${wrapped[1]}`;
    return;
  }
  const route = ROUTE_LINE.exec(line);
  if (route?.[1] !== undefined && state.pendingMethod !== null) {
    byRoute.set(route[1], state.pendingMethod);
    state.pendingMethod = null;
  }
}

/**
 * Where one installed package lives on disk.
 *
 * Two strategies, because neither alone reaches both packages this module reads. `require.resolve("<pkg>")`
 * fails outright for `@octokit/openapi-types`, which is TYPES ONLY and declares no runtime entry point at
 * all; and `require.resolve("<pkg>/package.json")` fails for `@octokit/plugin-rest-endpoint-methods`, whose
 * `exports` map does not publish that subpath. Both failures are silent in the obvious spelling — measured,
 * the endpoint scanner returned an empty table and the compile reported success over it — so the fallback
 * is a plain directory walk for `node_modules/<name>`, which is what a types-only package can be found by.
 *
 * @param fromDirectory where to start walking; the calling module's own directory
 * @param name the package name
 * @returns its directory, or `null` when it is not installed
 */
function packageDir({ fromDirectory, name }: { fromDirectory: string; name: string }): string | null {
  let directory = fromDirectory;
  const { root } = parse(directory);
  while (directory !== root) {
    const candidate = join(directory, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    directory = dirname(directory);
  }
  return null;
}

/**
 * Read the installed OpenAPI description and the installed Octokit's endpoint table.
 *
 * @returns the compiled surface, or why the installed packages could not be read
 */
export function compileGithubRestSurface(): Result<CompiledRestSurface, GithubAtlasVerbError> {
  const fromDirectory = dirname(fileURLToPath(import.meta.url));
  let declarations: string;
  let descriptionVersion: string;
  try {
    const directory = packageDir({ fromDirectory, name: "@octokit/openapi-types" });
    if (directory === null) {
      return err(GithubAtlasVerbErrors.descriptionMissing());
    }
    const manifest: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const declared = isRecord(manifest) ? manifest["version"] : undefined;
    descriptionVersion = typeof declared === "string" ? declared : "unknown";
    declarations = readFileSync(join(directory, "types.d.ts"), "utf8");
  } catch (error: unknown) {
    return err(GithubAtlasVerbErrors.descriptionUnreadable({ detail: errorMessage({ error }) }));
  }
  return compileGithubRestSurfaceDocuments({
    declarations,
    descriptionVersion,
    readEndpointSource: () => readSdkEndpointSource({ fromDirectory }),
  });
}

/**
 * Compile the description's declaration text and the plugin's endpoint table into one surface.
 *
 * The pure half of {@link compileGithubRestSurface}: every document arrives as text. The endpoint table is
 * asked for through `readEndpointSource` only once the declarations have parsed, so a description that does
 * not parse never reads it. A `null` table yields an empty SDK map rather than a failure — the routes are
 * GitHub's own declaration and remain complete without the `sdkMethod` field.
 *
 * @param declarations the text of `@octokit/openapi-types`'s `types.d.ts`
 * @param descriptionVersion the version that package's manifest declares, carried onto the result
 * @param readEndpointSource yields the plugin's generated `endpoints.js` text, or `null` when it is unavailable
 * @returns the compiled surface, or the parser's reasons wrapped as `SURFACE_UNPARSEABLE`
 *
 * @internal
 */
export function compileGithubRestSurfaceDocuments({
  declarations,
  descriptionVersion,
  readEndpointSource,
}: {
  declarations: string;
  descriptionVersion: string;
  readEndpointSource: () => string | null;
}): Result<CompiledRestSurface, GithubAtlasVerbError> {
  const parsed = parseGithubRestSurface({ declarations });
  if (parsed.isErr()) {
    return err(GithubAtlasVerbErrors.surfaceUnparseable({ reasons: parsed.error }));
  }
  return ok({
    descriptionVersion,
    routes: parsed.value,
    sdkMethodByRoute: sdkEndpointsFromSource({ source: readEndpointSource() }),
  });
}

/**
 * The installed plugin's generated endpoint table, as text.
 *
 * A failure here costs the atlas the `sdkMethod` field and nothing else, so an absent package or an
 * unreadable file answers `null` rather than failing the whole compile.
 *
 * @param fromDirectory where the package walk starts; the calling module's own directory
 * @returns the `endpoints.js` source, or `null` when the package or the file cannot be read
 */
function readSdkEndpointSource({ fromDirectory }: { fromDirectory: string }): string | null {
  const directory = packageDir({ fromDirectory, name: "@octokit/plugin-rest-endpoint-methods" });
  if (directory === null) {
    return null;
  }
  try {
    return readFileSync(join(directory, "dist-src", "generated", "endpoints.js"), "utf8");
  } catch {
    return null;
  }
}

/**
 * Which installed Octokit method exposes each route, scanned from the plugin's endpoint table.
 *
 * @param source the `endpoints.js` text, or `null` when it could not be read
 * @returns route (`GET /orgs/{org}`) to dotted method name (`orgs.get`); empty when `source` is `null`
 */
function sdkEndpointsFromSource({ source }: { source: string | null }): ReadonlyMap<string, string> {
  const byRoute = new Map<string, string>();
  if (source === null) {
    return byRoute;
  }
  // The table is `scope: { method: ["VERB /path"(, opts)?] }`. Scanned rather than imported: the package's
  // own `exports` map does not publish this path, and importing the plugin to read its table would load
  // every endpoint definition to answer a question about their names.
  // `scope` and `pendingMethod` are scoped to the scan rather than to the module: a table entry whose route
  // sits on the next line needs the second to survive one iteration and nothing more. As module-level
  // bindings they would survive between CALLS, so a second compile could attribute a route to a method
  // from the first.
  const state: EndpointScanState = { pendingMethod: null, scope: "" };
  for (const line of source.split("\n")) {
    scanEndpointLine({ byRoute, line, state });
  }
  return byRoute;
}
