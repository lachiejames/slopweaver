/**
 * Emit `src/atlas/nightfall/generated/surfaces.ts` from the documents pinned in `specLock.ts`.
 *
 * ```bash
 * yarn tsx tools/generateNightfallSurfaces.ts --spec-dir <dir>   # write the registry
 * yarn tsx tools/generateNightfallSurfaces.ts --verify           # check the committed table only
 * yarn tsx tools/generateNightfallSurfaces.ts --verify --spec-dir <dir>  # plus the digests and parity
 * ```
 *
 * `<dir>` holds the six `*.yaml` documents fetched from the URLs in `specLock.ts`. They are needed only to
 * WRITE and to check the pin; `--verify` on its own checks the committed table, which is what CI runs,
 * because CI has no network and the reviewed boundary is the table rather than the vendor's bytes.
 *
 * REFUSES when a digest, a byte length, a per-document operation count, the total census or the
 * per-disposition census moves. A generated table nobody reviewed is the thing every check here exists to
 * prevent, and a census that only counts the TOTAL cannot see a row changing side.
 *
 * ## How an operation is extracted, and why it is total
 *
 * OpenAPI 3.0.3 documents with no `$ref` at the path level, so the walk is: every key under `paths`, every
 * HTTP method under it, and the operation object is the value. Response fields come from the declared `200`
 * (or `2xx`) `application/json` schema with `$ref`s resolved one hop into `components.schemas`, which is as
 * deep as these documents nest their envelopes. Nothing is inferred: an operation whose kind, name or
 * disposition cannot be decided THROWS, and the count of operations extracted per document is asserted
 * against the pin before a byte is written.
 *
 * The document walk lives in `nightfallSurfacesSpec.ts`; the record shapes, registry checks and rendering
 * live in `nightfallSurfacesShapes.ts`.
 */
import { writeFileSync } from "node:fs";

import { nightfallDispositionFor } from "../src/atlas/nightfall/dispositions.js";
import {
  NIGHTFALL_SPEC_DOCUMENTS,
  nightfallKindFor,
  nightfallOperationName,
} from "../src/atlas/nightfall/surfaceNaming.js";
import { recordShapes, render, verifyRegistry } from "./nightfallSurfacesShapes.js";
import { loadSpecs, rowsOf, verifyPins } from "./nightfallSurfacesSpec.js";

const OUTPUT = "src/atlas/nightfall/generated/surfaces.ts";

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
  const module = await import("../src/atlas/nightfall/generated/surfaces.js");
  const rows = module.NIGHTFALL_SURFACES;
  verifyRegistry({ rows });
  for (const row of rows) {
    const document = NIGHTFALL_SPEC_DOCUMENTS.find((candidate) => candidate === row.specDocument);
    if (document === undefined) {
      throw new Error(`${row.name}: names document ${row.specDocument}, which specLock does not pin`);
    }
    if (nightfallKindFor({ api: row.api, path: row.path }) !== row.kind) {
      throw new Error(`${row.name}: stored kind ${row.kind} is not what surfaceNaming derives`);
    }
    if (nightfallOperationName({ api: row.api, method: row.method, path: row.path }) !== row.name) {
      throw new Error(`${row.name}: stored name is not what surfaceNaming derives`);
    }
    const verdict = nightfallDispositionFor({ kind: row.kind, method: row.method, name: row.name });
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
  const specs = loadSpecs({ specDirectory });
  verifyPins({ specs });
  const rows = specs.flatMap((spec) => rowsOf({ spec }));
  verifyRegistry({ rows });
  if (verifyOnly) {
    process.stdout.write(`verified ${rows.length} operations across ${specs.length} pinned documents\n`);
    return;
  }
  const shapes = recordShapes({ rows, specs });
  writeFileSync(OUTPUT, render({ rows, shapes }), "utf8");
  process.stdout.write(`wrote ${rows.length} operations and ${shapes.length} record shapes to ${OUTPUT}\n`);
}

await main();
