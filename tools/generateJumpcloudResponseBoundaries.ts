/**
 * Emit `src/atlas/jumpcloud/generated/responseBoundaries*.ts` — one strict response boundary for every surface a
 * production read pages — from a structural census of the live tenant (`tools/jumpcloudResponseCensus.ts`) and,
 * for a surface no answer measured, the carrier its current specification declares (`<spec-dir>` holds
 * `v1.yaml`, `v2.yaml` and `insights.yaml`, fetched from the URLs in `specLock.ts`).
 *
 * ```bash
 * yarn tsx tools/generateJumpcloudResponseBoundaries.ts <spec-dir> <census.json>...
 * ```
 *
 * The censuses named are summed, so a boundary declares every shape any of those walks answered. One walk alone
 * narrows: a field that walk's records happened not to carry would be dropped, and a surface it never reached would
 * refuse every record, so name every census you hold. A census describes one tenant and stays uncommitted.
 *
 * Every rule about what a measurement declares is `src/atlas/jumpcloud/boundaryCodegen.ts`, under test; this file
 * only reads, routes and writes. It REFUSES, writing nothing, when a document serves a surface at a method or
 * path the registry does not, or when any surface's measurement declares no boundary — a partial registry is the
 * gap a boundary exists to close.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { jumpcloudBoundarySource, jumpcloudUnroutedCensus } from "../src/atlas/jumpcloud/boundaryCodegen.js";
import { type JumpcloudDeclaredCarrier, jumpcloudCarrierFromSpec } from "../src/atlas/jumpcloud/carrierCodegen.js";
import { type JumpcloudCodegenError, JumpcloudCodegenErrors } from "../src/atlas/jumpcloud/codegenErrors.js";
import { JUMPCLOUD_FILE_RESPONSES } from "../src/atlas/jumpcloud/fileResponses.js";
import { JUMPCLOUD_SURFACES } from "../src/atlas/jumpcloud/generated/surfaces.js";
import { jumpcloudPagedSurfaceNames } from "../src/atlas/jumpcloud/pagedSurfaces.js";
import {
  type JumpcloudResponseCensus,
  mergeJumpcloudResponseCensuses,
  parseJumpcloudResponseCensus,
} from "../src/atlas/jumpcloud/responseCensus.js";
import {
  JUMPCLOUD_RESPONSE_DOCUMENT_PATHS,
  jumpcloudResponseDocumentPathRefusals,
  jumpcloudResponseDocumentPathsFor,
} from "../src/atlas/jumpcloud/responseDocumentPaths.js";
import { type JumpcloudSpec, surfaceName } from "../src/atlas/jumpcloud/surfaceNaming.js";
import { err, type Result } from "../src/lib/result.js";

/** How many files the registry is split across, so no one generated file outgrows a reviewable diff. */
const BATCHES = 6;

const SPECS: readonly JumpcloudSpec[] = ["v1", "v2", "insights"];

/**
 * Surfaces no answer measured whose document declares no JSON carrier, each declared EMPTY so that any body at
 * all refuses as drift until a measured decoder joins `fileResponses.ts`. Named rather than matched, and refused
 * as stale the moment the census sees one answer 2xx.
 */
const UNMEASURED_WITHOUT_CARRIER: Readonly<Record<string, string>> = {
  "v2-billing-get-contract": "the document declares a binary PDF, and this tenant is not a provider",
  "v2-logos-get": "the document declares a binary image, and no custom email this tenant holds names a logo",
  "v2-users-service-list-active-pwm-tenants": "today's document no longer carries the operation; it answered 404",
};

/** Whether a parsed YAML node is a plain object, so the generator narrows rather than asserts. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One operation of one specification, with the document its `$ref`s resolve against. */
interface Operation {
  readonly doc: Record<string, unknown>;
  readonly op: Record<string, unknown>;
  readonly method: "GET" | "POST";
  readonly pathKey: string;
}

/**
 * Read every specification and index its operations by the registry name they generate, recording each
 * document's digest for the generated header.
 *
 * The digest is RECORDED, not compared to `specLock.ts`. That lock pins which operations the registry may call,
 * and JumpCloud republishes its documents: the bytes the lock was cut from are no longer served or archived. A response
 * carrier read from today's document is checked instead against the registry row it serves — same method, same
 * path — so a carrier can never come from an operation the registry does not name.
 */
function operationsByName({
  dir,
  digests,
}: {
  dir: string;
  digests: Map<string, string>;
}): ReadonlyMap<string, Operation> {
  const byName = new Map<string, Operation>();
  for (const spec of SPECS) {
    const text = readFileSync(join(dir, `${spec}.yaml`), "utf8");
    digests.set(spec, createHash("sha256").update(text).digest("hex"));
    const doc: unknown = parse(text);
    if (!isRecord(doc) || !isRecord(doc["paths"])) {
      throw new Error(`${spec}: no paths`);
    }
    for (const [pathKey, item] of Object.entries(doc["paths"])) {
      for (const method of ["get", "post"] as const) {
        const op = isRecord(item) ? item[method] : undefined;
        if (!isRecord(op)) {
          continue;
        }
        const operationId = typeof op["operationId"] === "string" ? op["operationId"] : `${method}${pathKey}`;
        byName.set(surfaceName({ operationId, spec }), {
          doc,
          method: method === "get" ? "GET" : "POST",
          op,
          pathKey,
        });
      }
    }
  }
  return byName;
}

/** Follow a local `$ref` (`#/components/...`) until the node is not one. */
function resolved({ doc, node }: { doc: Record<string, unknown>; node: unknown }): unknown {
  let current = node;
  for (let hops = 0; isRecord(current) && typeof current["$ref"] === "string"; hops += 1) {
    if (hops > 16) {
      throw new Error(`a $ref chain longer than 16 hops at ${current["$ref"]}`);
    }
    let target: unknown = doc;
    for (const segment of current["$ref"].replace(/^#\//, "").split("/")) {
      target = isRecord(target) ? target[segment.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
    }
    current = target;
  }
  return current;
}

/** A schema with its `allOf` members' properties folded in, so a composed envelope reads as one object. */
function flattened({ doc, node }: { doc: Record<string, unknown>; node: unknown }): Record<string, unknown> | null {
  const schema = resolved({ doc, node });
  if (!isRecord(schema)) {
    return null;
  }
  if (!Array.isArray(schema["allOf"])) {
    return schema;
  }
  const properties: Record<string, unknown> = isRecord(schema["properties"]) ? { ...schema["properties"] } : {};
  for (const member of schema["allOf"]) {
    const part = flattened({ doc, node: member });
    if (part !== null && isRecord(part["properties"])) {
      Object.assign(properties, part["properties"]);
    }
  }
  return { ...schema, properties, type: "object" };
}

/** The carrier a surface's success response declares in its specification. */
function specCarrierFor({
  surface,
  operation,
}: {
  surface: string;
  operation: Operation | undefined;
}): Result<JumpcloudDeclaredCarrier, JumpcloudCodegenError> {
  if (operation === undefined) {
    return err(JumpcloudCodegenErrors.unreadableSpec({ surface, why: "no operation generates this name" }));
  }
  const row = JUMPCLOUD_SURFACES.find((candidate) => candidate.name === surface);
  if (row === undefined || row.method !== operation.method || !row.path.endsWith(operation.pathKey)) {
    return err(
      JumpcloudCodegenErrors.unreadableSpec({
        surface,
        why: `today's document serves this name at ${operation.method} ${operation.pathKey}, not the registry's row`,
      }),
    );
  }
  const { doc, op } = operation;
  const responses = isRecord(op["responses"]) ? op["responses"] : {};
  const success = Object.keys(responses)
    .filter((status) => /^2\d\d$/.test(status))
    .toSorted()
    .at(0);
  if (success === undefined) {
    return err(JumpcloudCodegenErrors.unreadableSpec({ surface, why: "no 2xx response" }));
  }
  const response = resolved({ doc, node: responses[success] });
  const content = isRecord(response) && isRecord(response["content"]) ? response["content"] : {};
  const media = Object.values(content).at(0);
  if (!isRecord(media) || media["schema"] === undefined) {
    return jumpcloudCarrierFromSpec({ results: null, schema: null, surface });
  }
  const schema = flattened({ doc, node: media["schema"] });
  if (schema === null) {
    return err(JumpcloudCodegenErrors.unreadableSpec({ surface, why: "an unresolvable schema" }));
  }
  const results = isRecord(schema["properties"]) ? flattened({ doc, node: schema["properties"]["results"] }) : null;
  return jumpcloudCarrierFromSpec({ results, schema, surface });
}

/** The constructors one batch's sources call, so a batch imports only what it uses. */
function constructorsIn({ sources }: { sources: readonly string[] }): readonly string[] {
  const used = new Set(sources.map((source) => /(defineJumpcloud\w+Boundary)\(/.exec(source)![1]!));
  return [...used].toSorted();
}

/** One generated batch file. */
function batchFile({
  index,
  sources,
  digests,
}: {
  index: number;
  sources: readonly string[];
  digests: ReadonlyMap<string, string>;
}): string {
  const imports = [...constructorsIn({ sources }), "type JumpcloudPageBoundary"].join(", ");
  const usesZod = sources.some((source) => source.includes("z."));
  const read = SPECS.map((spec) => ` *   ${spec} sha256 ${digests.get(spec)!}`).join("\n");
  return `/**
 * GENERATED by \`tools/generateJumpcloudResponseBoundaries.ts\` from the structural censuses of a live tenant named
 * on its command line (never committed) — key paths, kinds and counts, never a value — and, for a surface
 * no answer measured, the carrier its specification declares. A field named in \`responseDocumentPaths.ts\` holds an
 * authored document and is declared unread. Do not edit by hand: re-take the census, regenerate, and review the diff.
 *
 * Batch ${String(index + 1)} of ${String(BATCHES)}; \`boundaryCodegen.ts\` says what each measurement declares. The
 * specifications the unmeasured carriers were read from:
${read}
 */
${usesZod ? 'import { z } from "zod";\n\n' : ""}import { ${imports} } from "../responseBoundary.js";

/** The response boundaries of batch ${String(index + 1)}, by surface name. */
export const JUMPCLOUD_RESPONSE_BOUNDARIES_${String(index + 1)}: readonly JumpcloudPageBoundary[] = [
${sources.map((source) => `  ${source},`).join("\n")}
];
`;
}

const [dir, ...censusPaths] = process.argv.slice(2);
if (dir === undefined || censusPaths.length === 0) {
  throw new Error("usage: yarn tsx tools/generateJumpcloudResponseBoundaries.ts <spec-dir> <census.json>...");
}
const digests = new Map<string, string>();
const operations = operationsByName({ digests, dir });
// Every census is this repository's own output: each one `tools/jumpcloudResponseCensus.ts` wrote.
const readCensus = ({ path }: { path: string }): JumpcloudResponseCensus => {
  const read = parseJumpcloudResponseCensus({ text: readFileSync(path, "utf8") });
  if (read.isErr()) {
    throw new Error(`${path} is not a JumpCloud response census:\n${read.error.join("\n")}`);
  }
  return read.value;
};
const merged = mergeJumpcloudResponseCensuses({
  censuses: censusPaths.map((path) => readCensus({ path })),
});
if (merged.isErr()) {
  throw new Error(`the censuses do not sum to a census:\n${merged.error.join("\n")}`);
}
const census = merged.value;
const paged = jumpcloudPagedSurfaceNames();
const surfaces = paged.filter((surface) => JUMPCLOUD_FILE_RESPONSES[surface] === undefined);
const sources: string[] = [];
const documents = JUMPCLOUD_RESPONSE_DOCUMENT_PATHS;
const refusals: string[] = [
  ...jumpcloudUnroutedCensus({ census, paged: new Set(paged) }),
  ...jumpcloudResponseDocumentPathRefusals({ census, generated: new Set(surfaces), paths: documents }),
].map((error) => error.message);
for (const surface of surfaces) {
  const without = UNMEASURED_WITHOUT_CARRIER[surface];
  if (without !== undefined) {
    const stat = census[surface];
    const answered = stat !== undefined && Object.keys(stat.statuses).some((status) => status.startsWith("2"));
    if (answered) {
      refusals.push(`${surface}: answered 2xx, so its UNMEASURED_WITHOUT_CARRIER entry is stale — remove it`);
    } else {
      sources.push(`// ${without}\n  defineJumpcloudEmptyBoundary({ surface: ${JSON.stringify(surface)} })`);
    }
    continue;
  }
  const source = jumpcloudBoundarySource({
    documentPaths: jumpcloudResponseDocumentPathsFor({ paths: documents, surface }),
    specCarrier: () => specCarrierFor({ operation: operations.get(surface), surface }),
    stat: census[surface],
    surface,
  });
  if (source.isErr()) {
    refusals.push(source.error.message);
  } else {
    sources.push(source.value);
  }
}
if (refusals.length > 0) {
  throw new Error(
    `${String(refusals.length)} surface(s) declare no boundary, nothing written:\n${refusals.join("\n")}`,
  );
}
const perBatch = Math.ceil(sources.length / BATCHES);
for (let index = 0; index < BATCHES; index += 1) {
  const batch = sources.slice(index * perBatch, (index + 1) * perBatch);
  writeFileSync(
    `src/atlas/jumpcloud/generated/responseBoundaries${String(index + 1)}.ts`,
    batchFile({ digests, index, sources: batch }),
  );
}
const measured = surfaces.filter((surface) => census[surface] !== undefined).length;
process.stdout.write(
  `${String(sources.length)} boundaries in ${String(BATCHES)} batches; ${String(measured)} surface(s) had a census entry\n`,
);
