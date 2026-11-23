/**
 * Emit `src/atlas/canva/generated/surfaces.ts` from the document pinned in `specLock.ts`.
 *
 * ```bash
 * yarn tsx tools/generateCanvaSurfaces.ts --spec-dir <dir>            # write the registry
 * yarn tsx tools/generateCanvaSurfaces.ts --verify                    # check the committed table only
 * yarn tsx tools/generateCanvaSurfaces.ts --verify --spec-dir <dir>   # plus the digest and parity
 * ```
 *
 * `<dir>` holds `api.yml`, fetched from the URL in `specLock.ts`. It is needed only to WRITE and to check
 * the pin; `--verify` on its own checks the committed table, which is what CI runs, because CI has no
 * network and the reviewed boundary is the table rather than the vendor's bytes.
 *
 * REFUSES when the digest, the byte length, the operation census, the effect census, the stability census,
 * the entitlement census or the scope census moves. A generated table nobody reviewed is the thing every
 * check here exists to prevent, and a census that only counts the TOTAL cannot see a row changing side.
 *
 * ## Two properties this generator asserts that Nightfall's could not
 *
 * Every operation carries an `operationId` and exactly one tag, so the registry's name and kind are the
 * vendor's own rather than derived. Both are ASSERTED on every run instead of assumed: a description that
 * grew an untagged operation must fail the run rather than land under a guessed kind, and the whole reason
 * `surfaceNaming.ts` is a transliteration instead of an inference is that these two hold today.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { canvaEffectFor } from "../src/atlas/canva/effects.js";
import { CANVA_SPEC_PIN } from "../src/atlas/canva/generated/specLock.js";
import { canvaPagingFor } from "../src/atlas/canva/surfaceNaming.js";
import type { CanvaSurfaceRow } from "../src/atlas/canva/surfaceRow.js";
import { isRecord, type LoadedSpec, METHODS, rowOf } from "./canvaSurfacesRows.js";
import { type CanvaScopeRow, scopeRows, verifyRegistry } from "./canvaSurfacesVerify.js";

const OUTPUT = "src/atlas/canva/generated/surfaces.ts";

/**
 * Read and parse the document from a directory.
 *
 * @param specDirectory where the fetched document lives
 * @returns the parsed document and its exact bytes
 */
function loadSpec({ specDirectory }: { specDirectory: string }): LoadedSpec {
  const path = join(specDirectory, "api.yml");
  if (!existsSync(path)) {
    throw new Error(`${path} is absent — fetch it from ${CANVA_SPEC_PIN.url}`);
  }
  const bytes = readFileSync(path);
  const json: unknown = parse(bytes.toString("utf8"));
  if (!isRecord(json)) {
    throw new Error(`${path} did not parse to an object`);
  }
  return { bytes, json };
}

/**
 * The one server URL the document declares.
 *
 * @param spec the loaded document
 * @returns its `servers[0].url`
 */
function serverOf({ spec }: { spec: LoadedSpec }): string {
  const servers = spec.json["servers"];
  if (!Array.isArray(servers) || servers.length !== 1) {
    throw new Error("expected exactly one server — the provider key leaves the server out because of that");
  }
  const first: unknown = servers[0];
  const url = isRecord(first) ? first["url"] : null;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("the server declares no url");
  }
  return url;
}

/**
 * Check the document's bytes and declared metadata against the pin.
 *
 * @param spec the loaded document
 */
function verifyPin({ spec }: { spec: LoadedSpec }): void {
  if (spec.bytes.byteLength !== CANVA_SPEC_PIN.byteLength) {
    throw new Error(`${spec.bytes.byteLength} bytes, pin says ${CANVA_SPEC_PIN.byteLength}`);
  }
  const sha256 = createHash("sha256").update(spec.bytes).digest("hex");
  if (sha256 !== CANVA_SPEC_PIN.sha256) {
    throw new Error(`digest ${sha256}, pin says ${CANVA_SPEC_PIN.sha256} — the vendor re-published`);
  }
  const info = spec.json["info"];
  const title = isRecord(info) ? info["title"] : null;
  if (title !== CANVA_SPEC_PIN.title) {
    throw new Error(`title ${String(title)}, pin says ${CANVA_SPEC_PIN.title}`);
  }
  const version = isRecord(info) ? info["version"] : null;
  if (version !== CANVA_SPEC_PIN.version) {
    throw new Error(`version ${String(version)}, pin says ${CANVA_SPEC_PIN.version}`);
  }
  if (serverOf({ spec }) !== CANVA_SPEC_PIN.server) {
    throw new Error(`server ${serverOf({ spec })}, pin says ${CANVA_SPEC_PIN.server}`);
  }
}

/**
 * Extract every operation the document declares.
 *
 * @param spec the loaded document
 * @returns its rows, unsorted
 */
function rowsOf({ spec }: { spec: LoadedSpec }): readonly CanvaSurfaceRow[] {
  const server = serverOf({ spec });
  const paths = spec.json["paths"];
  if (!isRecord(paths)) {
    throw new Error("no paths object");
  }
  const rows: CanvaSurfaceRow[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      throw new Error(`${path} is not an object`);
    }
    for (const method of METHODS) {
      const operation = item[method.toLowerCase()];
      if (operation === undefined) {
        continue;
      }
      if (!isRecord(operation)) {
        throw new Error(`${method} ${path} is not an object`);
      }
      rows.push(rowOf({ method, operation, path, server, spec }));
    }
  }
  return rows;
}

/** Render the registry and the scope table as the committed module. */
function render({ rows, scopes }: { rows: readonly CanvaSurfaceRow[]; scopes: readonly CanvaScopeRow[] }): string {
  const sorted = [...rows].toSorted((left, right) => left.name.localeCompare(right.name));
  const header = [
    "/**",
    " * The closed registry of every operation Canva's published Connect API description declares.",
    " *",
    " * GENERATED by `tools/generateCanvaSurfaces.ts` from the document pinned in `specLock.ts`. Do not edit:",
    " * a hand-edited row is a row no census caught, and the generator asserts every count on every run.",
    " *",
    " * The row TYPE and its field meanings are `../surfaceRow.ts`; the effect rule is `../effects.ts` and the",
    " * stability and entitlement rules are `../eligibility.ts`.",
    " */",
    'import type { CanvaSurfaceRow } from "../surfaceRow.js";',
    "",
    "/** Every operation the vendor publishes, sorted by its own operation id. */",
    "export const CANVA_SURFACES: readonly CanvaSurfaceRow[] = [",
  ].join("\n");
  const body = sorted.map((row) => `  ${JSON.stringify(row)},`).join("\n");
  const scopeHeader = [
    "",
    "/**",
    " * Every OAuth scope the document declares, filed under the kind it governs and carrying every operation",
    " * that names it. A scope with an empty `namedBy` is one the grant surface offers and the call surface",
    " * never uses — see `CanvaScopeRow` in `tools/generateCanvaSurfaces.ts`.",
    " */",
    "export const CANVA_SCOPES: readonly {",
    "  readonly kind: string;",
    "  readonly namedBy: readonly string[];",
    "  readonly scope: string;",
    "}[] = [",
  ].join("\n");
  const scopeBody = scopes.map((scope) => `  ${JSON.stringify(scope)},`).join("\n");
  return `${header}\n${body}\n];\n${scopeHeader}\n${scopeBody}\n];\n`;
}

/**
 * Check the COMMITTED table, with no vendor bytes and no network — what CI and the run's own probe use.
 *
 * Imported dynamically rather than at the top of this file, because the module it reads is the one this
 * tool writes: a static import would make the generator unable to run on a tree where the table does not
 * exist yet, which is every tree the first time.
 *
 * @returns how many rows were checked
 */
async function verifyCommittedTable(): Promise<number> {
  const module = await import("../src/atlas/canva/generated/surfaces.js");
  const rows = module.CANVA_SURFACES;
  verifyRegistry({ rows, scopes: module.CANVA_SCOPES });
  for (const row of rows) {
    const effect = canvaEffectFor({ method: row.method, name: row.name });
    if (effect.effect !== row.effect) {
      throw new Error(`${row.name}: stored effect ${row.effect}, the rule says ${effect.effect}`);
    }
    if (canvaPagingFor({ queryParams: row.queryParams, responseFields: row.responseFields }) !== row.paging) {
      throw new Error(`${row.name}: stored paging ${row.paging} is not what surfaceNaming derives`);
    }
  }
  return rows.length;
}

/** Run the tool. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const verifyOnly = argv.includes("--verify");
  const specIndex = argv.indexOf("--spec-dir");
  const specDirectory = specIndex === -1 ? null : (argv[specIndex + 1] ?? null);
  if (specDirectory === null) {
    if (!verifyOnly) {
      throw new Error("writing the registry needs --spec-dir <dir>; --verify alone checks the committed table");
    }
    const checked = await verifyCommittedTable();
    process.stdout.write(`verified ${checked} committed operations against every census and naming rule\n`);
    return;
  }
  const spec = loadSpec({ specDirectory });
  verifyPin({ spec });
  const rows = rowsOf({ spec });
  const scopes = scopeRows({ rows, spec });
  verifyRegistry({ rows, scopes });
  if (verifyOnly) {
    process.stdout.write(`verified ${rows.length} operations and ${scopes.length} scopes against the pin\n`);
    return;
  }
  writeFileSync(OUTPUT, render({ rows, scopes }), "utf8");
  process.stdout.write(`wrote ${rows.length} operations and ${scopes.length} scopes to ${OUTPUT}\n`);
}

await main();
