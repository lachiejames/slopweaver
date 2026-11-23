/**
 * Emit `src/atlas/jam/generated/{specLock,surfaces}.ts` from what Jam publishes and what its own servers
 * answer.
 *
 * ```bash
 * yarn tsx tools/generateJamSurfaces.ts            # fetch, probe, and write both generated files
 * yarn tsx tools/generateJamSurfaces.ts --verify   # check the committed table only — no network
 * ```
 *
 * `--verify` is what CI runs, because CI has no network and the reviewed boundary is the TABLE rather than
 * the vendor's bytes. It refuses when the operation census, the scope census, the route census or the
 * probe's own control invariant has moved, because a generated table nobody reviewed is the thing every
 * check here exists to prevent.
 *
 * ## What it probes, and the one family it deliberately does not
 *
 * The route probe sends `GET` to every candidate and `POST` only to `/mcp`, which is the MCP transport
 * rather than a mutation. It never POSTs to `/oauth/register`, `/oauth/token`, `/oauth/revoke` or
 * `/oauth/introspect`: registering a client is a WRITE, and an atlas whose descriptor says
 * `refuse-every-write` must not have a generator that quietly does one. Those four are recorded from the
 * published description, which declares them, rather than from a request.
 *
 * MEASURED by hand, once, outside this generator and recorded as a gap rather than re-measured:
 * `POST https://api.jam.dev/oauth/authorize`, `/oauth/token` and `/oauth/register` answer an empty body with
 * HTTP 500 `FST_ERR_FAILED_ERROR_SERIALIZATION` — the server's own validation error does not match its
 * declared error schema — while `/oauth/introspect` and `/oauth/revoke` answer a clean 400. Reproduce one:
 *
 * ```bash
 * curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://api.jam.dev/oauth/token
 * ```
 */
import { createHash } from "node:crypto";

import { JAM_CENSUS, JAM_SPEC_PINS } from "../src/atlas/jam/generated/specLock.js";
import { JAM_INTEGRATIONS, JAM_OPERATIONS, JAM_ROUTES, JAM_SCOPES } from "../src/atlas/jam/generated/surfaces.js";
import { JAM_CONTROL_PATH, jamRouteVerdictFor } from "../src/atlas/jam/routeProbe.js";
import type { JamRouteRow, JamSpecPin } from "../src/atlas/jam/surfaceRow.js";

import { integrationsOf, isRecord, operationsOf, scopesOf } from "./jamSurfacesExtract.js";
import { SPEC_LOCK_OUTPUT, SURFACES_OUTPUT, writeSpecLock, writeSurfaces } from "./jamSurfacesRender.js";

/** The addresses this generator reads. Every one is public and needs no credential. */
const OPENAPI_URL = "https://api.jam.dev/openapi.json";
const AUTHORIZATION_SERVER_URL = "https://api.jam.dev/.well-known/oauth-authorization-server";
const API_PROTECTED_RESOURCE_URL = "https://api.jam.dev/.well-known/oauth-protected-resource";
const MCP_PROTECTED_RESOURCE_URL = "https://mcp.jam.dev/.well-known/oauth-protected-resource";
const SITEMAP_URL = "https://jam.dev/sitemap.xml";

/** The candidate routes the probe asks about, as `<host> <METHOD> <path>` triples. */
const CANDIDATES: readonly { readonly host: string; readonly method: string; readonly path: string }[] = [
  { host: "https://api.jam.dev", method: "GET", path: "/" },
  { host: "https://api.jam.dev", method: "GET", path: "/openapi.json" },
  { host: "https://api.jam.dev", method: "GET", path: "/whoami" },
  { host: "https://api.jam.dev", method: "GET", path: "/.well-known/oauth-authorization-server" },
  { host: "https://api.jam.dev", method: "GET", path: "/.well-known/oauth-protected-resource" },
  { host: "https://api.jam.dev", method: "GET", path: "/oauth/authorize" },
  { host: "https://api.jam.dev", method: "GET", path: "/mcp" },
  { host: "https://api.jam.dev", method: "POST", path: "/mcp" },
  { host: "https://api.jam.dev", method: "GET", path: "/jams" },
  { host: "https://api.jam.dev", method: "GET", path: "/teams" },
  { host: "https://api.jam.dev", method: "GET", path: "/workspaces" },
  { host: "https://api.jam.dev", method: "GET", path: "/members" },
  { host: "https://api.jam.dev", method: "GET", path: "/integrations" },
  { host: "https://api.jam.dev", method: "GET", path: "/cli" },
  { host: "https://api.jam.dev", method: "GET", path: "/health" },
  { host: "https://api.jam.dev", method: "GET", path: JAM_CONTROL_PATH },
  { host: "https://mcp.jam.dev", method: "GET", path: "/" },
  { host: "https://mcp.jam.dev", method: "GET", path: "/mcp" },
  { host: "https://mcp.jam.dev", method: "POST", path: "/mcp" },
  { host: "https://mcp.jam.dev", method: "GET", path: "/.well-known/oauth-protected-resource" },
  { host: "https://mcp.jam.dev", method: "GET", path: "/.well-known/oauth-authorization-server" },
  { host: "https://mcp.jam.dev", method: "GET", path: "/openapi.json" },
  { host: "https://mcp.jam.dev", method: "GET", path: JAM_CONTROL_PATH },
];

/** Fetch one public document as text, or throw with the address that failed. */
async function fetchText({ url }: { url: string }): Promise<string> {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${String(response.status)}`);
  }
  return response.text();
}

/** The sha256 of some bytes, as hex. */
function digestOf({ text }: { text: string }): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Probe one candidate and grade what came back. */
async function probeOne({ host, method, path }: { host: string; method: string; path: string }): Promise<JamRouteRow> {
  const response = await fetch(`${host}${path}`, { method, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return {
    contentType,
    control: path === JAM_CONTROL_PATH,
    host,
    method,
    path,
    statusCode: response.status,
    verdict: jamRouteVerdictFor({ contentType, statusCode: response.status }),
  };
}

/** Check the committed table against the reviewed census, with no network at all. */
function verify(): void {
  const failures: string[] = [];
  const actual: Record<string, number> = {
    integrations: JAM_INTEGRATIONS.length,
    operations: JAM_OPERATIONS.length,
    routesAnswered: JAM_ROUTES.filter((route) => route.verdict === "answered").length,
    routesNotRouted: JAM_ROUTES.filter((route) => route.verdict === "not-routed").length,
    routesProbed: JAM_ROUTES.length,
    routesRoutedNoLeaf: JAM_ROUTES.filter((route) => route.verdict === "routed-no-leaf").length,
    scopes: JAM_SCOPES.length,
    scopesNamedByNoOperation: JAM_SCOPES.filter((scope) => scope.namedBy.length === 0).length,
  };
  for (const [key, expected] of Object.entries(JAM_CENSUS)) {
    const found = actual[key];
    if (found !== expected) {
      failures.push(`${key}: reviewed ${String(expected)}, table has ${String(found)}`);
    }
  }
  const controls = JAM_ROUTES.filter((route) => route.control);
  if (controls.length === 0) {
    failures.push("the table carries no control route, so its negative cannot be shown to fire");
  }
  for (const control of controls) {
    if (control.verdict !== "not-routed") {
      failures.push(`the control ${control.host}${control.path} graded ${control.verdict}, not not-routed`);
    }
  }
  if (JAM_SPEC_PINS.length === 0) {
    failures.push("the lock pins no document");
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `jam surfaces verified: ${String(JAM_OPERATIONS.length)} operation(s), ${String(JAM_SCOPES.length)} scope(s), ` +
      `${String(JAM_ROUTES.length)} probed route(s), ${String(JAM_INTEGRATIONS.length)} integration page(s)\n`,
  );
}

/** Fetch, probe and write both generated modules. */
async function generate(): Promise<void> {
  const openapiText = await fetchText({ url: OPENAPI_URL });
  const openapi: unknown = JSON.parse(openapiText);
  if (!isRecord(openapi)) {
    throw new Error(`${OPENAPI_URL} did not parse to an object`);
  }
  const servers = openapi["servers"];
  const firstServer = Array.isArray(servers) ? servers[0] : null;
  const serverUrl = isRecord(firstServer) && typeof firstServer["url"] === "string" ? firstServer["url"] : "";
  const info = isRecord(openapi["info"]) ? openapi["info"] : {};
  const securitySchemes =
    isRecord(openapi["components"]) && isRecord(openapi["components"]["securitySchemes"])
      ? Object.keys(openapi["components"]["securitySchemes"]).toSorted((left, right) => left.localeCompare(right))
      : [];
  const operations = operationsOf({ document: openapi, serverUrl });

  const authorizationServerText = await fetchText({ url: AUTHORIZATION_SERVER_URL });
  const authorizationServer: unknown = JSON.parse(authorizationServerText);
  const apiResourceText = await fetchText({ url: API_PROTECTED_RESOURCE_URL });
  const apiResource: unknown = JSON.parse(apiResourceText);
  const mcpResourceText = await fetchText({ url: MCP_PROTECTED_RESOURCE_URL });
  const mcpResource: unknown = JSON.parse(mcpResourceText);
  if (!isRecord(authorizationServer) || !isRecord(apiResource) || !isRecord(mcpResource)) {
    throw new Error("one of the OAuth discovery documents did not parse to an object");
  }
  const scopes = scopesOf({
    authorizationServer,
    operations,
    resources: [
      { document: apiResource, id: "api-protected-resource" },
      { document: mcpResource, id: "mcp-protected-resource" },
    ],
  });

  const routes: JamRouteRow[] = [];
  for (const candidate of CANDIDATES) {
    routes.push(await probeOne(candidate));
  }

  const sitemap = await fetchText({ url: SITEMAP_URL });
  const integrations = integrationsOf({ sitemap });

  const pins: readonly JamSpecPin[] = [
    {
      byteLength: Buffer.byteLength(openapiText),
      documentTitle: typeof info["title"] === "string" ? info["title"] : "untitled",
      id: "openapi",
      operationCount: operations.length,
      pathCount: isRecord(openapi["paths"]) ? Object.keys(openapi["paths"]).length : 0,
      securitySchemes,
      serverUrl,
      sha256: digestOf({ text: openapiText }),
      url: OPENAPI_URL,
      version: typeof info["version"] === "string" ? info["version"] : "unversioned",
    },
    {
      byteLength: Buffer.byteLength(authorizationServerText),
      documentTitle: "OAuth 2.0 Authorization Server Metadata",
      id: "authorization-server",
      operationCount: 0,
      pathCount: 0,
      securitySchemes: [],
      serverUrl: "",
      sha256: digestOf({ text: authorizationServerText }),
      url: AUTHORIZATION_SERVER_URL,
      version: "unversioned",
    },
    {
      byteLength: Buffer.byteLength(apiResourceText),
      documentTitle: "OAuth 2.0 Protected Resource Metadata (api.jam.dev)",
      id: "api-protected-resource",
      operationCount: 0,
      pathCount: 0,
      securitySchemes: [],
      serverUrl: "",
      sha256: digestOf({ text: apiResourceText }),
      url: API_PROTECTED_RESOURCE_URL,
      version: "unversioned",
    },
    {
      byteLength: Buffer.byteLength(mcpResourceText),
      documentTitle: "OAuth 2.0 Protected Resource Metadata (mcp.jam.dev)",
      id: "mcp-protected-resource",
      operationCount: 0,
      pathCount: 0,
      securitySchemes: [],
      serverUrl: "",
      sha256: digestOf({ text: mcpResourceText }),
      url: MCP_PROTECTED_RESOURCE_URL,
      version: "unversioned",
    },
  ];

  writeSpecLock({
    census: {
      integrations: integrations.length,
      operations: operations.length,
      routesAnswered: routes.filter((route) => route.verdict === "answered").length,
      routesNotRouted: routes.filter((route) => route.verdict === "not-routed").length,
      routesProbed: routes.length,
      routesRoutedNoLeaf: routes.filter((route) => route.verdict === "routed-no-leaf").length,
      scopes: scopes.length,
      scopesNamedByNoOperation: scopes.filter((scope) => scope.namedBy.length === 0).length,
    },
    pins,
  });
  writeSurfaces({ integrations, operations, routes, scopes });
  process.stdout.write(`wrote ${SPEC_LOCK_OUTPUT} and ${SURFACES_OUTPUT}\n`);
}

if (process.argv.includes("--verify")) {
  verify();
} else {
  await generate();
}
