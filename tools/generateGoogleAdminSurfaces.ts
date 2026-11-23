/**
 * Emit `src/atlas/googleAdmin/generated/surfaces.ts` from the discovery documents pinned in
 * `discoveryLock.ts`.
 *
 * ```bash
 * yarn tsx tools/generateGoogleAdminSurfaces.ts --fetch <dir>    # fetch the documents, then write
 * yarn tsx tools/generateGoogleAdminSurfaces.ts --spec-dir <dir> # write from documents already fetched
 * yarn tsx tools/generateGoogleAdminSurfaces.ts --verify         # check the committed table only
 * yarn tsx tools/generateGoogleAdminSurfaces.ts --verify --spec-dir <dir>  # plus the digests and parity
 * ```
 *
 * `<dir>` holds the eleven `<name>.<version>.json` documents fetched from the URLs in `discoveryLock.ts`.
 * They are needed only to WRITE and to check the pin; `--verify` on its own checks the committed table,
 * which is what CI runs, because CI has no network and the reviewed boundary is the table rather than
 * Google's bytes.
 *
 * REFUSES when a digest, a byte length, a per-document method count, the total census, the distinct-id
 * census, the scopeless census or either disposition census moves. A generated table nobody reviewed is
 * the thing every check here exists to prevent, and a census that only counts the TOTAL cannot see a row
 * changing side.
 *
 * ## How a method is extracted, and why it is total
 *
 * A discovery document nests `resources` arbitrarily deep, each level optionally carrying `methods`. The
 * walk is every resource, depth first, plus the document's own top-level `methods`. Response fields come
 * from the declared `response.$ref` resolved one hop into `schemas`, which is as deep as Google's
 * envelopes nest. Nothing is inferred: a method whose kind, name or disposition cannot be decided THROWS.
 * The walk and the row building live in `googleAdminSurfacesExtract.ts`, the censuses in
 * `googleAdminSurfacesCensus.ts`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { googleAdminDispositionFor } from "../src/atlas/googleAdmin/dispositions.js";
import { GOOGLE_ADMIN_DISCOVERY_PINS } from "../src/atlas/googleAdmin/generated/discoveryLock.js";
import {
  GOOGLE_ADMIN_DOCUMENTS,
  type GoogleAdminDocument,
  googleAdminOperationName,
} from "../src/atlas/googleAdmin/surfaceNaming.js";
import type { GoogleAdminSurfaceRow } from "../src/atlas/googleAdmin/surfaceRow.js";

import { verifyRegistry } from "./googleAdminSurfacesCensus.js";
import {
  type GoogleAdminRecordShape,
  isRecord,
  type LoadedDocument,
  recordShapes,
  rowsOf,
} from "./googleAdminSurfacesExtract.js";

const OUTPUT = "src/atlas/googleAdmin/generated/surfaces.ts";

/**
 * Fetch every pinned document into a directory, so the pin can be reproduced in one command.
 *
 * @param specDirectory where to write them
 */
async function fetchDocuments({ specDirectory }: { specDirectory: string }): Promise<void> {
  mkdirSync(specDirectory, { recursive: true });
  for (const pin of GOOGLE_ADMIN_DISCOVERY_PINS) {
    const response = await fetch(pin.url);
    if (!response.ok) {
      throw new Error(`${pin.url} answered ${response.status}`);
    }
    writeFileSync(join(specDirectory, `${pin.document}.json`), Buffer.from(await response.arrayBuffer()));
  }
  process.stdout.write(`fetched ${GOOGLE_ADMIN_DISCOVERY_PINS.length} documents to ${specDirectory}\n`);
}

/**
 * Read and parse the eleven documents from a directory, refusing anything the pin does not describe.
 *
 * @param specDirectory where the fetched documents live
 * @returns every document, in pin order
 */
function loadDocuments({ specDirectory }: { specDirectory: string }): readonly LoadedDocument[] {
  return GOOGLE_ADMIN_DISCOVERY_PINS.map((pin) => {
    const path = join(specDirectory, `${pin.document}.json`);
    if (!existsSync(path)) {
      throw new Error(`${path} is absent — fetch every document with --fetch, or from the URLs in discoveryLock.ts`);
    }
    const bytes = readFileSync(path);
    const json: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(json)) {
      throw new Error(`${path} did not parse to an object`);
    }
    // `as`: every pin's `document` is one of GOOGLE_ADMIN_DOCUMENTS, asserted by `verifyPins` below.
    // oxlint-disable-next-line no-unsafe-type-assertion
    return { bytes, document: pin.document as GoogleAdminDocument, json };
  });
}

/**
 * Check every document's bytes and declared metadata against the pin.
 *
 * @param documents the loaded documents
 */
function verifyPins({ documents }: { documents: readonly LoadedDocument[] }): void {
  for (const loaded of documents) {
    const pin = GOOGLE_ADMIN_DISCOVERY_PINS.find((candidate) => candidate.document === loaded.document);
    if (pin === undefined) {
      throw new Error(`${loaded.document} is not pinned`);
    }
    if (!GOOGLE_ADMIN_DOCUMENTS.some((known) => known === pin.document)) {
      throw new Error(`${pin.document} is pinned but surfaceNaming.ts does not declare it`);
    }
    if (loaded.bytes.byteLength !== pin.byteLength) {
      throw new Error(`${loaded.document}: ${loaded.bytes.byteLength} bytes, pin says ${pin.byteLength}`);
    }
    const sha256 = createHash("sha256").update(loaded.bytes).digest("hex");
    if (sha256 !== pin.sha256) {
      throw new Error(`${loaded.document}: digest ${sha256}, pin says ${pin.sha256} — Google re-published`);
    }
    if (loaded.json["title"] !== pin.title) {
      throw new Error(`${loaded.document}: title ${String(loaded.json["title"])}, pin says ${pin.title}`);
    }
    if (loaded.json["revision"] !== pin.revision) {
      throw new Error(`${loaded.document}: revision ${String(loaded.json["revision"])}, pin says ${pin.revision}`);
    }
    if (loaded.json["baseUrl"] !== pin.baseUrl) {
      throw new Error(`${loaded.document}: baseUrl ${String(loaded.json["baseUrl"])}, pin says ${pin.baseUrl}`);
    }
  }
}

/** Render the registry and the record shapes as the committed module. */
function render({
  rows,
  shapes,
}: {
  rows: readonly GoogleAdminSurfaceRow[];
  shapes: readonly GoogleAdminRecordShape[];
}): string {
  const sorted = [...rows].toSorted((left, right) => left.name.localeCompare(right.name));
  const header = [
    "/**",
    " * The closed registry of every method Google's eleven selected discovery documents declare.",
    " *",
    " * GENERATED by `tools/generateGoogleAdminSurfaces.ts` from the documents pinned in `discoveryLock.ts`.",
    " * Do not edit: a hand-edited row is a row no census caught, and the generator asserts every count on",
    " * every run.",
    " *",
    " * The row TYPE and its field meanings are `../surfaceRow.ts`; the disposition rules are",
    " * `../dispositions.ts`; which documents are here at all is `../apiSelection.ts`.",
    " */",
    'import type { GoogleAdminSurfaceRow } from "../surfaceRow.js";',
    "",
    "/** Every method Google publishes for the Admin console's APIs, sorted by name. */",
    "export const GOOGLE_ADMIN_SURFACES: readonly GoogleAdminSurfaceRow[] = [",
  ].join("\n");
  const body = sorted.map((row) => `  ${JSON.stringify(row)},`).join("\n");
  const shapeHeader = [
    "",
    "/**",
    " * What one record of each kind DECLARES, from Google's own schemas — the half of a shape index that",
    " * needs no credential. A list method's envelope is unwrapped to the record inside it.",
    " */",
    "export const GOOGLE_ADMIN_RECORD_SHAPES: readonly {",
    "  readonly fields: readonly string[];",
    "  readonly kind: string;",
    "  readonly schemaName: string;",
    "  readonly sourceOperation: string;",
    "}[] = [",
  ].join("\n");
  const shapeBody = shapes.map((shape) => `  ${JSON.stringify(shape)},`).join("\n");
  return `${header}\n${body}\n];\n${shapeHeader}\n${shapeBody}\n];\n`;
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
  const module = await import("../src/atlas/googleAdmin/generated/surfaces.js");
  const rows = module.GOOGLE_ADMIN_SURFACES;
  verifyRegistry({ rows });
  for (const row of rows) {
    if (!GOOGLE_ADMIN_DOCUMENTS.some((candidate) => candidate === row.document)) {
      throw new Error(`${row.name}: names document ${row.document}, which discoveryLock does not pin`);
    }
    if (googleAdminOperationName({ document: row.document, id: row.id }) !== row.name) {
      throw new Error(`${row.name}: stored name is not what surfaceNaming derives`);
    }
    const verdict = googleAdminDispositionFor({
      id: row.id,
      kind: row.kind,
      method: row.method,
      supportsMediaUpload: row.supportsMediaUpload,
    });
    if (verdict.disposition !== row.disposition) {
      throw new Error(`${row.name}: stored disposition ${row.disposition}, the rule says ${verdict.disposition}`);
    }
  }
  return rows.length;
}

/** Run the tool. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const verifyOnly = argv.includes("--verify");
  const fetchIndex = argv.indexOf("--fetch");
  const specIndex = argv.indexOf("--spec-dir");
  const fetchInto = fetchIndex === -1 ? null : (argv[fetchIndex + 1] ?? null);
  const specDirectory = fetchInto ?? (specIndex === -1 ? null : (argv[specIndex + 1] ?? null));
  if (specDirectory === null) {
    if (!verifyOnly) {
      throw new Error("writing the registry needs --fetch <dir> or --spec-dir <dir>; --verify alone checks the table");
    }
    const checked = await verifyCommittedTable();
    process.stdout.write(`verified ${checked} committed methods against every census and naming rule\n`);
    return;
  }
  if (fetchInto !== null) {
    await fetchDocuments({ specDirectory: fetchInto });
  }
  const documents = loadDocuments({ specDirectory });
  verifyPins({ documents });
  const rows = documents.flatMap((loaded) => rowsOf({ loaded }));
  verifyRegistry({ rows });
  if (verifyOnly) {
    process.stdout.write(`verified ${rows.length} methods across ${documents.length} pinned documents\n`);
    return;
  }
  const shapes = recordShapes({ documents, rows });
  writeFileSync(OUTPUT, render({ rows, shapes }), "utf8");
  process.stdout.write(`wrote ${rows.length} methods and ${shapes.length} record shapes to ${OUTPUT}\n`);
}

await main();
