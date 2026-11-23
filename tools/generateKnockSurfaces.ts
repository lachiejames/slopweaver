/**
 * Emit `src/atlas/knock/generated/surfaces.ts` and `…/routes.ts` from Knock's own published artifacts.
 *
 * ```bash
 * yarn tsx tools/generateKnockSurfaces.ts --verify   # fetch, compile, check every pin and census
 * yarn tsx tools/generateKnockSurfaces.ts            # rewrite both registries, then review the diff
 * yarn tsx tools/generateKnockSurfaces.ts --from <dir>   # compile saved copies instead of fetching
 * ```
 *
 * REFUSES when a digest or any census number moves. The generated tables are the read-only boundary, and a
 * table regenerated from whatever Knock shipped this morning is a table nobody reviewed. The one exception
 * is the dashboard build id, which moves on every deploy and is reported rather than enforced —
 * `generated/specLock.ts` carries why.
 *
 * ## What this generator reaches, and what it does not
 *
 * Three unauthenticated documents on Knock's own hosts: two OpenAPI documents Knock's documentation points
 * its integrators at, and the route table the dashboard's own client publishes. None takes a credential and
 * none returns anything about this organisation, so what is compiled here describes the PRODUCT rather than
 * the account — which is why `slopweaver atlas knock sync` can publish the whole surface map offline.
 *
 * ## The cross-document identifier pass is why both documents are compiled together
 *
 * `identifierFrom` cannot be decided from one document. `GET /v1/audiences/{key}/members` is a data-API
 * operation and only the Management API lists audiences; `GET /v1/objects/{collection}` needs a collection
 * name NEITHER document produces. So the two path sets are collected first and every operation is judged
 * against both — see `surfaceRow.ts` on why that field is the most useful one on the row.
 *
 * The operation walk lives in `knockSurfacesRows.ts` and the census checks in `knockSurfacesCensus.ts`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  isKnockWalkableRoute,
  type KnockRouteRow,
  knockRouteParameters,
  knockRouteScope,
} from "../src/atlas/knock/dashboardRoutes.js";
import { KNOCK_DASHBOARD_MANIFEST_PIN, KNOCK_SPEC_PINS } from "../src/atlas/knock/generated/specLock.js";
import { type KnockAtlasKind, knockKindForRoute } from "../src/atlas/knock/kinds.js";
import { KNOCK_APIS, type KnockApi } from "../src/atlas/knock/surfaceNaming.js";
import type { KnockSurfaceRow } from "../src/atlas/knock/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";
import { safeJsonParse } from "../src/lib/safeJson.js";
import {
  checkRouteCensus,
  checkSpecCensus,
  checkSurfaceCensus,
  checkVoluminousPrefixes,
} from "./knockSurfacesCensus.js";
import { collectionPaths, type RawOperation, readOperations, refuse, surfaceRow } from "./knockSurfacesRows.js";

const SURFACES_OUTPUT = "src/atlas/knock/generated/surfaces.ts";
const ROUTES_OUTPUT = "src/atlas/knock/generated/routes.ts";

/** One document's bytes, from disk when a directory was handed over and from Knock otherwise. */
async function documentText({ url, from, file }: { url: string; from: string | null; file: string }): Promise<string> {
  if (from !== null) {
    return readFileSync(join(from, file), "utf8");
  }
  const response = await fetch(url);
  if (!response.ok) {
    refuse(`${url} answered ${String(response.status)}`);
  }
  return response.text();
}

/** The OpenAPI document one pinned URL serves, with its digest checked against the lock. */
async function pinnedDocument({ api, from }: { api: KnockApi; from: string | null }): Promise<Record<string, unknown>> {
  const pin = KNOCK_SPEC_PINS[api];
  const text = await documentText({ file: `knock-${api}.json`, from, url: pin.url });
  const sha256 = createHash("sha256").update(text).digest("hex");
  if (sha256 !== pin.sha256) {
    refuse(
      `${pin.url} has moved: pinned ${pin.sha256} at ${String(pin.byteLength)} bytes, served ${sha256} at ` +
        `${String(text.length)}. Review what changed, then update KNOCK_SPEC_PINS.${api} and rerun`,
    );
  }
  // Through `safeJsonParse` because the size here belongs to KNOCK rather than to this file: the document
  // is ~450 KB today and free to grow. That is the runtime half of the whole-file-string rule, which no
  // static gate can see from here.
  const document = safeJsonParse({ label: `knock ${api} openapi`, text });
  if (!isRecord(document) || !isRecord(document["paths"])) {
    refuse(`${pin.url} is not an OpenAPI document`);
  }
  return document;
}

/** Every route pattern the dashboard's own build manifest declares. */
async function dashboardRoutes({ from }: { from: string | null }): Promise<readonly string[]> {
  const text = await manifestText({ from });
  // `match[1]` is the pattern's one capturing group, and a match that succeeded always has it.
  const declared = [...text.matchAll(/"(\/[^"]*)":\s*\[/g)].map((match) => match[1]!);
  const routes = [...new Set(declared.filter((route) => !route.startsWith("/_next")))].toSorted();
  if (routes.length === 0) {
    refuse("the dashboard build manifest declared no routes — Knock has changed how it ships its route table");
  }
  return routes;
}

/** The build manifest's bytes, reporting a moved build id rather than refusing on one. */
async function manifestText({ from }: { from: string | null }): Promise<string> {
  if (from !== null) {
    return readFileSync(join(from, "buildManifest.js"), "utf8");
  }
  const landing = await fetch(KNOCK_DASHBOARD_MANIFEST_PIN.landingUrl);
  if (!landing.ok) {
    refuse(`${KNOCK_DASHBOARD_MANIFEST_PIN.landingUrl} answered ${String(landing.status)}`);
  }
  const matched = /"buildId":"([^"]+)"/.exec(await landing.text());
  const buildId = matched === null ? null : matched[1];
  if (buildId === null) {
    refuse("the dashboard landing page carries no buildId — Knock is no longer serving a Next.js client");
  }
  const url = `https://dashboard.knock.app/_next/static/${buildId}/_buildManifest.js`;
  const response = await fetch(url);
  if (!response.ok) {
    refuse(`${url} answered ${String(response.status)}`);
  }
  const text = await response.text();
  if (buildId !== KNOCK_DASHBOARD_MANIFEST_PIN.buildId) {
    process.stderr.write(
      `generateKnockSurfaces: the dashboard build id has moved from ${KNOCK_DASHBOARD_MANIFEST_PIN.buildId} to ` +
        `${buildId} — expected on any deploy, reported rather than refused. Digest ` +
        `${createHash("sha256").update(text).digest("hex")} at ${String(text.length)} bytes\n`,
    );
  }
  return text;
}

/** One compiled route row. */
function routeRow({ route, readable }: { route: string; readable: ReadonlySet<KnockAtlasKind> }): KnockRouteRow {
  const kind = knockKindForRoute({ route });
  return {
    apiBacked: kind !== null && readable.has(kind),
    kind,
    parameters: knockRouteParameters({ route }),
    route,
    scope: knockRouteScope({ route }),
    walkable: isKnockWalkableRoute({ route }),
  };
}

/**
 * One row per line, fields in alphabetical order, spelled as TypeScript rather than as JSON.
 *
 * Unquoted keys and a space after each colon, matching the Prisma and Airtable registries: a generated file
 * is still read in review, and `{"api":"data","deprecated":false}` is materially harder to scan than
 * `{ api: "data", deprecated: false }` across two hundred rows. `generated/` is prettier-ignored, so the
 * formatting a reviewer sees is whatever this function writes.
 *
 * @param row the row to serialise
 * @returns one indented, comma-terminated line
 */
function serialiseRow({ row }: { row: object }): string {
  const fields = Object.entries(row)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`);
  return `  { ${fields.join(", ")} },`;
}

/** Write both generated registries. */
function emit({ surfaces, routes }: { surfaces: readonly KnockSurfaceRow[]; routes: readonly KnockRouteRow[] }): void {
  const tally = (list: readonly KnockSurfaceRow[], value: string): number =>
    list.filter((row) => row.disposition === value).length;
  writeFileSync(
    SURFACES_OUTPUT,
    [
      "/**",
      " * GENERATED — do not hand-edit. Regenerate with `yarn tsx tools/generateKnockSurfaces.ts` and review the",
      " * diff. Built from the two OpenAPI documents pinned in `specLock.ts`.",
      " *",
      ` * ${String(surfaces.length)} rows across both of Knock's published APIs: ${String(tally(surfaces, "entity"))} entity,`,
      ` * ${String(tally(surfaces, "shape-index"))} shape-index, ${String(tally(surfaces, "probe-only"))} probe-only, ${String(tally(surfaces, "excluded"))} excluded.`,
      " */",
      'import type { KnockSurfaceRow } from "../surfaceRow.js";',
      "",
      "/** Every Knock operation, whatever this atlas does with each, sorted by API then method then path. */",
      "export const KNOCK_SURFACES: readonly KnockSurfaceRow[] = [",
      ...surfaces.map((row) => serialiseRow({ row })),
      "];",
      "",
    ].join("\n"),
  );
  writeFileSync(
    ROUTES_OUTPUT,
    [
      "/**",
      " * GENERATED — do not hand-edit. Regenerate with `yarn tsx tools/generateKnockSurfaces.ts` and review the",
      " * diff. Built from the dashboard's own `_buildManifest.js`, which needs no credential.",
      " *",
      ` * ${String(routes.length)} routes: ${String(routes.filter((row) => row.walkable).length)} addressable from a signed-in session alone,`,
      ` * and ${String(routes.filter((row) => !row.apiBacked).length)} whose subject NO declared operation reads.`,
      " */",
      'import type { KnockRouteRow } from "../dashboardRoutes.js";',
      "",
      "/** Every dashboard route pattern, sorted. */",
      "export const KNOCK_ROUTES: readonly KnockRouteRow[] = [",
      ...routes.map((row) => serialiseRow({ row })),
      "];",
      "",
    ].join("\n"),
  );
}

/** Compile both documents and the route table, check every assertion, and write unless verifying. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const from = argv.includes("--from") ? (argv[argv.indexOf("--from") + 1] ?? null) : null;
  const documents = new Map<KnockApi, Record<string, unknown>>();
  const raw: RawOperation[] = [];
  for (const api of KNOCK_APIS) {
    const document = await pinnedDocument({ api, from });
    documents.set(api, document);
    raw.push(...readOperations({ api, document }));
  }
  const collections = collectionPaths({ operations: raw });
  const surfaces = raw
    .map((row) => surfaceRow({ collections, document: documents.get(row.api) ?? {}, row }))
    .toSorted((left, right) =>
      `${left.api} ${left.method} ${left.path}`.localeCompare(`${right.api} ${right.method} ${right.path}`),
    );
  for (const api of KNOCK_APIS) {
    checkSpecCensus({
      api,
      document: documents.get(api) ?? {},
      raw: raw.filter((row) => row.api === api),
      rows: surfaces.filter((row) => row.api === api),
    });
  }
  checkVoluminousPrefixes({ rows: surfaces });
  checkSurfaceCensus({ rows: surfaces });
  const readable = new Set<KnockAtlasKind>(
    surfaces.filter((row) => row.disposition === "entity" || row.disposition === "shape-index").map((row) => row.kind),
  );
  const routes = (await dashboardRoutes({ from })).map((route) => routeRow({ readable, route }));
  checkRouteCensus({ rows: routes });
  if (argv.includes("--verify")) {
    process.stdout.write(
      `generateKnockSurfaces: ${String(surfaces.length)} operations and ${String(routes.length)} routes agree with the lock\n`,
    );
    return;
  }
  emit({ routes, surfaces });
  process.stdout.write(`generateKnockSurfaces: wrote ${SURFACES_OUTPUT} and ${ROUTES_OUTPUT}\n`);
}

void main();
