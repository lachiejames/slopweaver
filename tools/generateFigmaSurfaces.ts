/**
 * Emit `src/atlas/figma/generated/surfaces.ts` from Figma's own OpenAPI document.
 *
 * ```bash
 * yarn tsx tools/generateFigmaSurfaces.ts --verify           # fetch, extract, check both pins and the census
 * yarn tsx tools/generateFigmaSurfaces.ts                    # rewrite the registry, then review the diff
 * yarn tsx tools/generateFigmaSurfaces.ts --spec <file>      # use a local copy of openapi.yaml
 * ```
 *
 * REFUSES when either digest or any census number moves. The generated table is the read-only boundary, and
 * a table regenerated from whatever Figma shipped this morning is a table nobody reviewed.
 *
 * ## Why the tarball rather than an installed dependency
 *
 * `@figma/rest-api-spec` would work as a devDependency, and it is deliberately not one: nothing in the
 * shipped product imports it, so it would be a package installed on every machine and in every CI lane to
 * serve one generator that runs when Figma publishes. Fetching the immutable, digest-addressed tarball puts
 * the cost where the work is. The registry it writes is committed, which is what keeps
 * `slopweaver atlas figma sync` able to publish the API surface map with no network call at all.
 *
 * The one request it makes is to the public npm registry for a public package. It presents no credential,
 * reaches nothing of Figma's, and reads nothing about the organisation.
 *
 * ## Both digests are checked, and they answer different questions
 *
 * The tarball digest says the published release is byte-for-byte the reviewed one. The `openapi.yaml`
 * digest says the one member this atlas reads is. A republish that changed a README moves the first and not
 * the second, and this tool says which happened rather than reporting one undifferentiated mismatch.
 *
 * ## The tar reader is deliberately about twenty lines
 *
 * A gzipped tar is a stream of 512-byte headers each followed by its member's bytes, padded to 512. Name at
 * offset 0, size as octal at 124. That is the whole format this needs, so it is implemented here rather
 * than pulling a dependency into the tree for one member of one archive.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { parse as parseYaml } from "yaml";

import { figmaDispositionOf } from "../src/atlas/figma/exclusions.js";
import {
  FIGMA_DEPRECATED_OPERATIONS,
  FIGMA_FULLY_DEPRECATED_TAGS,
  FIGMA_SPEC_PIN,
  FIGMA_UNSERVED_TAGS,
} from "../src/atlas/figma/generated/specLock.js";
import { figmaKindFor } from "../src/atlas/figma/kinds.js";
import { FIGMA_HTTP_METHODS, type FigmaHttpMethod, figmaPagingOf } from "../src/atlas/figma/surfaceNaming.js";
import type { FigmaSurfaceRow } from "../src/atlas/figma/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";

import { authMethodsOf, queryParamsOf, scopesOf } from "./figmaSurfacesExtract.js";
import { censusChecks, moduleText } from "./figmaSurfacesRender.js";

const OUTPUT = "src/atlas/figma/generated/surfaces.ts";

/** One tar header block, and the payload that follows it. */
const TAR_BLOCK = 512;

/** Fail loudly. A generator that carries on past a broken assumption writes a table nobody can trust. */
function refuse(message: string): never {
  process.stderr.write(`generateFigmaSurfaces: ${message}\n`);
  process.exit(1);
}

/**
 * One NUL-padded tar header field, as text.
 *
 * Cut at the first NUL by INDEX rather than by a regular expression: `no-control-regex` refuses matching
 * U+0000 in a pattern, and it is right to — the field is fixed-width padding, not something to parse.
 */
function headerField({ header, from, length }: { header: Buffer; from: number; length: number }): string {
  const raw = header.subarray(from, from + length).toString("utf8");
  const end = raw.indexOf("\u0000");
  return (end < 0 ? raw : raw.slice(0, end)).trim();
}

/** One named member's bytes, out of a gzipped tar. */
function tarMember({ archive, name }: { archive: Buffer; name: string }): Buffer {
  const tar = gunzipSync(archive);
  let at = 0;
  while (at + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(at, at + TAR_BLOCK);
    const entry = headerField({ from: 0, header, length: 100 });
    if (entry.length === 0) {
      break;
    }
    const size = Number.parseInt(headerField({ from: 124, header, length: 12 }), 8);
    const from = at + TAR_BLOCK;
    if (entry === name) {
      return tar.subarray(from, from + size);
    }
    at = from + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return refuse(`the tarball has no member "${name}" — Figma has changed the package layout`);
}

/** The document's bytes, from a local file when one was handed over and from the pinned tarball otherwise. */
async function specBytes({ specPath }: { specPath: string | null }): Promise<Buffer> {
  if (specPath !== null) {
    return readFileSync(specPath);
  }
  const response = await fetch(FIGMA_SPEC_PIN.tarballUrl);
  if (!response.ok) {
    refuse(`${FIGMA_SPEC_PIN.tarballUrl} answered ${String(response.status)}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const tarballDigest = createHash("sha256").update(archive).digest("hex");
  if (tarballDigest !== FIGMA_SPEC_PIN.tarballSha256) {
    refuse(
      `the TARBALL's digest moved: pinned ${FIGMA_SPEC_PIN.tarballSha256}, found ${tarballDigest}.\n` +
        `npm republished ${FIGMA_SPEC_PIN.packageName}@${FIGMA_SPEC_PIN.packageVersion} under the same` +
        " version. If the openapi.yaml digest below still holds, only packaging changed and the pin is the" +
        " thing to update; if it moved too, the API surface did",
    );
  }
  return tarMember({ archive, name: FIGMA_SPEC_PIN.specPath });
}

/** The parsed OpenAPI document, with both pins on the exact bytes checked first. */
function documentOf({ bytes }: { bytes: Buffer }): Record<string, unknown> {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== FIGMA_SPEC_PIN.specSha256) {
    refuse(
      `the DOCUMENT's digest moved: pinned ${FIGMA_SPEC_PIN.specSha256}, found ${digest}` +
        ` (${String(bytes.length)} bytes against a pinned ${String(FIGMA_SPEC_PIN.specByteLength)}).\n` +
        "Figma has changed its API surface. Regenerate, read the row diff, and update generated/specLock.ts" +
        " in the same commit",
    );
  }
  const parsed: unknown = parseYaml(bytes.toString("utf8"));
  if (!isRecord(parsed) || !isRecord(parsed["paths"])) {
    refuse("the pinned bytes did not parse into an OpenAPI document with a paths object");
  }
  return parsed;
}

/** Every operation in the document, as a flat list, in path then method order. */
function operationsOf({ spec }: { spec: Record<string, unknown> }): readonly {
  readonly method: FigmaHttpMethod;
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
      return FIGMA_HTTP_METHODS.flatMap((method) => {
        const operation = item[method.toLowerCase()];
        if (!isRecord(operation)) {
          return [];
        }
        return [{ method, operation, path, pathParameters: shared }];
      });
    });
}

/** One registry row. */
function rowOf({
  method,
  operation,
  path,
  pathParameters,
}: {
  method: FigmaHttpMethod;
  operation: Record<string, unknown>;
  path: string;
  pathParameters: readonly unknown[];
}): FigmaSurfaceRow {
  const operationId = operation["operationId"];
  if (typeof operationId !== "string") {
    refuse(`${method} ${path} declares no operationId, so it has no stable surface name`);
  }
  const tags = operation["tags"];
  const tag = Array.isArray(tags) && typeof tags[0] === "string" ? tags[0] : null;
  if (tag === null) {
    refuse(`${operationId} declares no tag, so this atlas cannot decide which kind it feeds`);
  }
  const placed = figmaKindFor({ operationId, tag });
  if (placed === null) {
    refuse(
      `${operationId} carries the tag "${tag}", which src/atlas/figma/kinds.ts cannot place. Add it to` +
        " KIND_BY_TAG (or the operation to KIND_BY_OPERATION) with the reason, in the same commit",
    );
  }
  const summary = operation["summary"];
  const decided = figmaDispositionOf({ method, operationId });
  return {
    alsoFeeds: placed.alsoFeeds,
    authMethods: authMethodsOf({ operation }),
    deprecated: operation["deprecated"] === true,
    disposition: decided.disposition,
    dispositionBecause: decided.dispositionBecause,
    exclusionReason: decided.exclusionReason,
    kind: placed.kind,
    method,
    name: operationId,
    paging: figmaPagingOf({ queryParams: queryParamsOf({ operation, pathParameters }) }),
    path,
    scopes: scopesOf({ operation }),
    summary: typeof summary === "string" && summary.length > 0 ? summary : null,
    tag,
  };
}

/** Refuse unless every pinned number and every pinned name still holds. */
function assertCensus({ rows, spec }: { rows: readonly FigmaSurfaceRow[]; spec: Record<string, unknown> }): void {
  const served = new Set(rows.map((row) => row.tag));
  const wronglyServed = FIGMA_UNSERVED_TAGS.filter((tag) => served.has(tag));
  if (wronglyServed.length > 0) {
    refuse(
      `${wronglyServed.join(", ")} now carries an operation — Figma has published part of a surface this` +
        " atlas records as browser-only. Move it out of FIGMA_UNSERVED_TAGS and say so in the same commit",
    );
  }
  const deprecated = rows.filter((row) => row.deprecated).map((row) => row.name);
  const movedDeprecations = [
    ...deprecated
      .filter((name) => !FIGMA_DEPRECATED_OPERATIONS.includes(name))
      .map((name) => `  ${name} is now deprecated`),
    ...FIGMA_DEPRECATED_OPERATIONS.filter((name) => !deprecated.includes(name)).map(
      (name) => `  ${name} is no longer deprecated`,
    ),
  ];
  if (movedDeprecations.length > 0) {
    refuse(
      `the deprecation set moved:\n${movedDeprecations.join("\n")}\nupdate FIGMA_DEPRECATED_OPERATIONS and` +
        " FIGMA_FULLY_DEPRECATED_TAGS in the same commit",
    );
  }
  const fullyDeprecated = [...served].filter((tag) =>
    rows.filter((row) => row.tag === tag).every((row) => row.deprecated),
  );
  const tagDrift = [
    ...fullyDeprecated.filter((tag) => !FIGMA_FULLY_DEPRECATED_TAGS.includes(tag)),
    ...FIGMA_FULLY_DEPRECATED_TAGS.filter((tag) => !fullyDeprecated.includes(tag)),
  ];
  if (tagDrift.length > 0) {
    refuse(
      `which tags are wholly deprecated moved: ${tagDrift.join(", ")} — update FIGMA_FULLY_DEPRECATED_TAGS` +
        " in the same commit, and say in the pull request which surface Figma has retired or revived",
    );
  }
  const broken = censusChecks({ rows, spec }).filter((check) => check.actual !== check.expected);
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
  const specAt = argv.indexOf("--spec");
  const specPath = specAt < 0 ? null : (argv[specAt + 1] ?? refuse("--spec needs a path"));
  const spec = documentOf({ bytes: await specBytes({ specPath }) });
  const rows = operationsOf({ spec }).map((entry) => rowOf(entry));
  assertCensus({ rows, spec });
  if (argv.includes("--verify")) {
    process.stdout.write(`figma spec pins and census hold: ${String(rows.length)} operations\n`);
    return;
  }
  writeFileSync(OUTPUT, moduleText({ rows }), "utf8");
  process.stdout.write(`wrote ${OUTPUT}: ${String(rows.length)} operations\n`);
}

void main();
