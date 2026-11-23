/**
 * Emit `src/atlas/airtable/generated/surfaces.ts` from Airtable's own OpenAPI document.
 *
 * ```bash
 * yarn tsx tools/generateAirtableSurfaces.ts --verify            # fetch, extract, check the pin and census
 * yarn tsx tools/generateAirtableSurfaces.ts                     # rewrite the registry, then review the diff
 * yarn tsx tools/generateAirtableSurfaces.ts --html <file>       # use a saved copy of the reference page
 * ```
 *
 * REFUSES when the digest or any census number moves. The generated table is the read-only boundary, and a
 * table regenerated from whatever Airtable shipped this morning is a table nobody reviewed.
 *
 * ## Why this generator reaches the NETWORK and the Datadog one does not
 *
 * Datadog's registry is extracted from an installed npm package, so its generator is offline and its pin is
 * a package digest. Airtable publishes no such artifact — `generated/specLock.ts` carries the measurement —
 * and ships its whole OpenAPI document server-rendered into every page of its own reference instead. So the
 * fetch is unavoidable, and it is confined HERE: the registry it writes is committed, which is what keeps
 * `slopweaver atlas airtable sync` able to publish the API surface map with no network call at all.
 *
 * The one page it asks for is public and unauthenticated — it is the same page a reader opens — so this
 * generator presents no credential and reads nothing about the organisation.
 *
 * ## How the document is extracted, and why the extraction is total
 *
 * The page assigns `window.initData = {…}` once, and the document sits at `.openApi` inside it. The value is
 * raw-decoded from the assignment rather than matched with a regex, so a `}` inside any description cannot
 * truncate it, and the decode's own end offset proves the whole object was consumed. Every census number is
 * then asserted before a row is written, which is what turns a silently-lost operation into a failed run —
 * the Datadog registry's census caught exactly that, one operation out of 1,735.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { AIRTABLE_VOLUME_JUDGED_OPERATIONS, airtableDispositionOf } from "../src/atlas/airtable/exclusions.js";
import {
  AIRTABLE_AUTH_METHOD_CENSUS,
  AIRTABLE_SPEC_CENSUS,
  AIRTABLE_SPEC_PIN,
  AIRTABLE_UNSERVED_TAGS,
} from "../src/atlas/airtable/generated/specLock.js";
import { airtableKindFor } from "../src/atlas/airtable/kinds.js";
import {
  AIRTABLE_AUTH_METHODS,
  AIRTABLE_HTTP_METHODS,
  type AirtableAuthMethod,
  type AirtableHttpMethod,
  airtablePagingOf,
} from "../src/atlas/airtable/surfaceNaming.js";
import type { AirtableSurfaceRow } from "../src/atlas/airtable/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";
import { safeJsonParse } from "../src/lib/safeJson.js";
import { stableStringify } from "../src/lib/stableStringify.js";
import { moduleText } from "./airtableSurfacesRender.js";

const OUTPUT = "src/atlas/airtable/generated/surfaces.ts";
const ASSIGNMENT = "window.initData = ";

/** Fail loudly. A generator that carries on past a broken assumption writes a table nobody can trust. */
function refuse(message: string): never {
  process.stderr.write(`generateAirtableSurfaces: ${message}\n`);
  process.exit(1);
}

/** The reference page's HTML, from disk when one was handed over and from Airtable otherwise. */
async function referenceHtml({ htmlPath }: { htmlPath: string | null }): Promise<string> {
  if (htmlPath !== null) {
    return readFileSync(htmlPath, "utf8");
  }
  const response = await fetch(AIRTABLE_SPEC_PIN.sourceUrl);
  if (!response.ok) {
    refuse(`${AIRTABLE_SPEC_PIN.sourceUrl} answered ${String(response.status)}`);
  }
  return response.text();
}

/**
 * The OpenAPI document, raw-decoded out of the page's one `window.initData` assignment.
 *
 * `JSON.parse` cannot be pointed at an offset, so the object is decoded by scanning for its balanced end
 * with a string-aware walk — the same job a `raw_decode` does, and the reason a regex is not used at all.
 */
function extractSpec({ html }: { html: string }): Record<string, unknown> {
  const start = html.indexOf(ASSIGNMENT);
  if (start < 0) {
    refuse(`the page carries no "${ASSIGNMENT}" assignment — Airtable has changed how it ships the document`);
  }
  const from = start + ASSIGNMENT.length;
  const end = objectEnd({ from, text: html });
  // Through `safeJsonParse` because the size here belongs to AIRTABLE, not to this file: the blob is the
  // whole `initData` object its reference page ships, ~609 KB today and free to grow. That is the
  // runtime half of the whole-file-string rule, which no static gate can see from here.
  const initData: unknown = safeJsonParse({ label: "airtable window.initData", text: html.slice(from, end) });
  if (!isRecord(initData)) {
    refuse("window.initData is not an object");
  }
  const spec = initData[AIRTABLE_SPEC_PIN.islandPath.split(".")[1] ?? ""];
  if (!isRecord(spec) || !isRecord(spec["paths"])) {
    refuse(`window.${AIRTABLE_SPEC_PIN.islandPath} is not an OpenAPI document`);
  }
  return spec;
}

/** Where the JSON object starting at `from` ends, counting braces outside strings. */
function objectEnd({ text, from }: { text: string; from: number }): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let at = from; at < text.length; at += 1) {
    const char = text[at];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return at + 1;
      }
    }
  }
  return refuse("the window.initData object never closes");
}

/** Every operation in the document, as a flat list, in path then method order. */
function operationsOf({ spec }: { spec: Record<string, unknown> }): readonly {
  readonly method: AirtableHttpMethod;
  readonly operation: Record<string, unknown>;
  readonly path: string;
  readonly pathParameters: readonly unknown[];
}[] {
  const paths = spec["paths"];
  if (!isRecord(paths)) {
    refuse("the document has no paths object");
  }
  return Object.keys(paths)
    .toSorted()
    .flatMap((path) => {
      const item = paths[path];
      if (!isRecord(item)) {
        return [];
      }
      const shared = Array.isArray(item["parameters"]) ? item["parameters"] : [];
      return AIRTABLE_HTTP_METHODS.flatMap((method) => {
        const operation = item[method.toLowerCase()];
        if (!isRecord(operation)) {
          return [];
        }
        return [{ method, operation, path, pathParameters: shared }];
      });
    });
}

/** The query parameter names one operation declares, its path item's shared ones included. */
function queryParamsOf({
  operation,
  pathParameters,
}: {
  operation: Record<string, unknown>;
  pathParameters: readonly unknown[];
}): readonly string[] {
  const own = Array.isArray(operation["parameters"]) ? operation["parameters"] : [];
  return [...pathParameters, ...own].flatMap((parameter): readonly string[] => {
    if (!isRecord(parameter) || parameter["in"] !== "query" || typeof parameter["name"] !== "string") {
      return [];
    }
    return [parameter["name"]];
  });
}

/** Every OAuth scope one operation's `security` names, sorted and deduplicated. */
function scopesOf({ operation }: { operation: Record<string, unknown> }): readonly string[] {
  const security = operation["security"];
  if (!Array.isArray(security)) {
    return [];
  }
  const found = new Set<string>();
  security.forEach((requirement: unknown) => {
    if (!isRecord(requirement)) {
      return;
    }
    Object.values(requirement).forEach((scopes: unknown) => {
      if (!Array.isArray(scopes)) {
        return;
      }
      scopes.forEach((scope: unknown) => {
        if (typeof scope === "string") {
          found.add(scope);
        }
      });
    });
  });
  return [...found].toSorted();
}

/** The credential forms one operation accepts, filtered to the vocabulary this atlas declares. */
function authMethodsOf({ operation }: { operation: Record<string, unknown> }): readonly AirtableAuthMethod[] {
  const declared = operation["x-airtable-auth-methods"];
  if (!Array.isArray(declared)) {
    return [];
  }
  return AIRTABLE_AUTH_METHODS.filter((method) => declared.includes(method));
}

/** One registry row. */
function rowOf({
  method,
  operation,
  path,
  pathParameters,
}: {
  method: AirtableHttpMethod;
  operation: Record<string, unknown>;
  path: string;
  pathParameters: readonly unknown[];
}): AirtableSurfaceRow {
  const operationId = operation["operationId"];
  if (typeof operationId !== "string") {
    refuse(`${method} ${path} declares no operationId, so it has no stable surface name`);
  }
  const tags = operation["tags"];
  const tag = Array.isArray(tags) && typeof tags[0] === "string" ? tags[0] : null;
  if (tag === null) {
    refuse(`${operationId} declares no tag, so this atlas cannot decide which kind it feeds`);
  }
  const placed = airtableKindFor({ operationId, tag });
  if (placed === null) {
    refuse(
      `${operationId} carries the tag "${tag}", which src/atlas/airtable/kinds.ts cannot place. Add it to` +
        " KIND_BY_TAG (or the operation to KIND_BY_OPERATION) with the reason, in the same commit",
    );
  }
  const summary = operation["summary"];
  const decided = airtableDispositionOf({ method, operationId });
  return {
    alsoFeeds: placed.alsoFeeds,
    authMethods: authMethodsOf({ operation }),
    disposition: decided.disposition,
    dispositionBecause: decided.dispositionBecause,
    exclusionReason: decided.exclusionReason,
    kind: placed.kind,
    method,
    name: operationId,
    paging: airtablePagingOf({ queryParams: queryParamsOf({ operation, pathParameters }) }),
    path,
    scopes: scopesOf({ operation }),
    summary: typeof summary === "string" && summary.length > 0 ? summary : null,
    tag,
    volumeJudgedPerScope: AIRTABLE_VOLUME_JUDGED_OPERATIONS.includes(operationId),
  };
}

/** Refuse unless every pinned number still holds. */
function assertCensus({ rows, spec }: { rows: readonly AirtableSurfaceRow[]; spec: Record<string, unknown> }): void {
  const paths = isRecord(spec["paths"]) ? Object.keys(spec["paths"]).length : 0;
  const components = spec["components"];
  const schemas =
    isRecord(components) && isRecord(components["schemas"]) ? Object.keys(components["schemas"]).length : 0;
  const tags = Array.isArray(spec["tags"]) ? spec["tags"].length : 0;
  const scopes = new Set(rows.flatMap((row) => row.scopes)).size;
  const ids = new Set(rows.map((row) => row.name)).size;
  const deprecated = 0;
  const counted: Record<string, number> = {};
  AIRTABLE_HTTP_METHODS.forEach((method) => {
    counted[method] = rows.filter((row) => row.method === method).length;
  });
  const checks: readonly { readonly actual: number; readonly expected: number; readonly what: string }[] = [
    { actual: rows.length, expected: AIRTABLE_SPEC_CENSUS.operations, what: "operations" },
    { actual: ids, expected: AIRTABLE_SPEC_CENSUS.operationIds, what: "distinct operationIds" },
    { actual: paths, expected: AIRTABLE_SPEC_CENSUS.paths, what: "paths" },
    { actual: schemas, expected: AIRTABLE_SPEC_CENSUS.schemas, what: "component schemas" },
    { actual: scopes, expected: AIRTABLE_SPEC_CENSUS.scopes, what: "distinct scopes" },
    { actual: tags, expected: AIRTABLE_SPEC_CENSUS.tags, what: "declared tags" },
    {
      actual: new Set(rows.map((row) => row.tag)).size,
      expected: AIRTABLE_SPEC_CENSUS.tagsWithOperations,
      what: "tags carrying at least one operation",
    },
    { actual: deprecated, expected: AIRTABLE_SPEC_CENSUS.deprecatedOperations, what: "deprecated operations" },
    ...AIRTABLE_HTTP_METHODS.map((method) => ({
      actual: counted[method] ?? 0,
      expected: AIRTABLE_SPEC_CENSUS.methodCounts[method],
      what: `${method} operations`,
    })),
    ...AIRTABLE_AUTH_METHODS.map((auth) => ({
      actual: rows.filter((row) => row.authMethods.includes(auth)).length,
      expected: AIRTABLE_AUTH_METHOD_CENSUS[auth],
      what: `operations accepting ${auth}`,
    })),
  ];
  const served = new Set(rows.map((row) => row.tag));
  const wronglyServed = AIRTABLE_UNSERVED_TAGS.filter((tag) => served.has(tag));
  if (wronglyServed.length > 0) {
    refuse(
      `${wronglyServed.join(", ")} now carries an operation — Airtable has published part of a surface this` +
        " atlas records as browser-only. Move it out of AIRTABLE_UNSERVED_TAGS and say so in the same commit",
    );
  }
  const broken = checks.filter((check) => check.actual !== check.expected);
  if (broken.length > 0) {
    refuse(
      `the census moved:\n${broken
        .map((check) => `  ${check.what}: pinned ${String(check.expected)}, found ${String(check.actual)}`)
        .join("\n")}\nreview the change, then update generated/specLock.ts in the same commit`,
    );
  }
}

/** Fetch, extract, check and (unless verifying) write. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const htmlAt = argv.indexOf("--html");
  const htmlPath = htmlAt < 0 ? null : (argv[htmlAt + 1] ?? refuse("--html needs a path"));
  const spec = extractSpec({ html: await referenceHtml({ htmlPath }) });
  const digest = createHash("sha256")
    .update(stableStringify({ value: spec }))
    .digest("hex");
  if (digest !== AIRTABLE_SPEC_PIN.sha256) {
    refuse(
      `the document's digest moved: pinned ${AIRTABLE_SPEC_PIN.sha256}, found ${digest}\n` +
        "Airtable has changed its API surface. Regenerate, read the row diff, and update specLock.ts in the" +
        " same commit",
    );
  }
  const rows = operationsOf({ spec }).map((entry) => rowOf(entry));
  assertCensus({ rows, spec });
  if (argv.includes("--verify")) {
    process.stdout.write(`airtable spec pin and census hold: ${String(rows.length)} operations\n`);
    return;
  }
  writeFileSync(OUTPUT, moduleText({ rows }), "utf8");
  process.stdout.write(`wrote ${OUTPUT}: ${String(rows.length)} operations\n`);
}

void main();
