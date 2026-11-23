/**
 * Reading and writing a Datadog census. The effectful edge; everything that decides is pure.
 *
 * ## Why the rows are a `.jsonl` and the manifest is not
 *
 * The manifest's size comes from the ORGANISATION and is bounded by it — the map holds tens of entities,
 * hundreds of monitors, a hundred dashboards — so one JSON document is the right shape and `safeJsonParse`
 * is a real guard on it rather than ceremony.
 *
 * The rows' size comes from the DATA: a census over every product produces as many rows as an
 * organisation's telemetry happens to have shapes, which nothing in this code bounds — MEASURED,
 * the log product alone can run to tens of thousands. So they are a record stream, written with
 * {@link ../../lib/writeAtomic.writeFileAtomicStream} and read with
 * {@link ../../corpus/corpusStore.readJsonlLines} — the two mechanisms the `whole-file-json` gate names, for
 * exactly this reason.
 *
 * ## Reading never partially succeeds
 *
 * A rows file with one malformed line fails the whole read rather than returning the rows it could parse. A
 * census is consulted to decide whether Datadog can answer a question at all, so a silently shortened one
 * produces the worst outcome available here: a detective that is confidently told there is nothing to look
 * at.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic, writeFileAtomicStream } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { CensusRow } from "../census/row.js";
import { censusRowSchema } from "../census/schema.js";
import type { Catalogue, CatalogueManifest } from "./catalogue.js";
import { type DatadogDetectiveError, DatadogDetectiveErrors } from "./errors.js";
import { catalogueManifestSchema } from "./schema.js";

/**
 * Whether a census has been built under this home at all.
 *
 * A plain existence check rather than a read, because the caller that most needs it — the gate in
 * `store detect` — asks on every question and must not pay a parse to learn the answer is no.
 *
 * @param home the Slopweaver home
 * @returns true when both files are present
 */
export function catalogueExists({ home }: { home: string }): boolean {
  const paths = stateHomePaths({ home }).datadogCatalogue;
  return existsSync(paths.manifest) && existsSync(paths.rows);
}

/**
 * Read one built census's MANIFEST alone — the services, the map, the window and the build instant.
 *
 * Its own reader because the manifest is about a hundred kilobytes and the rows beside it are tens of
 * megabytes: MEASURED, a whole read costs about six and a half seconds more than the CLI's own
 * start on a COLD page cache, and about two warm — the cold figure is the one to plan against, since a given
 * question is asked once (`time slopweaver datadog catalogue show --limit 1` against `time slopweaver datadog
 * catalogue --help`). A
 * reader that runs on every question — `route plan`, `turn brief` — can only afford this half.
 *
 * @param home the Slopweaver home
 * @returns the manifest, or the typed reason it could not be read
 */
export function readCatalogueManifest({ home }: { home: string }): Result<CatalogueManifest, DatadogDetectiveError> {
  const paths = stateHomePaths({ home }).datadogCatalogue;
  if (!existsSync(paths.manifest)) {
    return err(DatadogDetectiveErrors.catalogueAbsent({ path: paths.manifest }));
  }
  const raw = safeFs({
    execute: () => readFileSync(paths.manifest, "utf8"),
    operation: "readCatalogue.manifest",
    path: paths.manifest,
  });
  if (raw.isErr()) {
    return err(DatadogDetectiveErrors.catalogueUnreadable({ cause: raw.error, path: paths.manifest }));
  }
  // `safeJsonParse` THROWS rather than returning — on malformed JSON and on a payload past its 100 MiB
  // refusal alike — so the `try` keeps this function's `Result` promise.
  try {
    const manifest = catalogueManifestSchema.safeParse(
      safeJsonParse({ label: "datadog census manifest", text: raw.value }),
    );
    if (!manifest.success) {
      return err(DatadogDetectiveErrors.catalogueUnreadable({ cause: manifest.error, path: paths.manifest }));
    }
    return ok(manifest.data);
  } catch (error: unknown) {
    return err(DatadogDetectiveErrors.catalogueUnreadable({ cause: error, path: paths.manifest }));
  }
}

/**
 * Read one built census whole.
 *
 * @param home the Slopweaver home
 * @returns the manifest and its rows, or the typed reason it could not be read
 */
export function readCatalogue({ home }: { home: string }): Result<Catalogue, DatadogDetectiveError> {
  const paths = stateHomePaths({ home }).datadogCatalogue;
  const manifest = readCatalogueManifest({ home });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  // One `try` around the row parses, because `safeJsonParse` THROWS rather than returning — on malformed JSON
  // and on a payload past its 100 MiB refusal alike. Without it an exception escapes a function whose
  // signature promises a `Result`, which is the shape this repo's error handling exists to make impossible.
  try {
    const rows: CensusRow[] = [];
    let broke: unknown = null;
    if (existsSync(paths.rows)) {
      readJsonlLines({
        onLine: ({ line }) => {
          if (broke !== null || line.trim().length === 0) {
            return;
          }
          const row = censusRowSchema.safeParse(safeJsonParse({ label: "datadog census row", text: line }));
          if (!row.success) {
            broke = row.error;
            return;
          }
          rows.push(row.data);
        },
        path: paths.rows,
      });
    }
    if (broke !== null) {
      return err(DatadogDetectiveErrors.catalogueUnreadable({ cause: broke, path: paths.rows }));
    }
    return ok({ manifest: manifest.value, rows });
  } catch (error: unknown) {
    return err(DatadogDetectiveErrors.catalogueUnreadable({ cause: error, path: paths.root }));
  }
}

/**
 * Write one built census, manifest last.
 *
 * Last because the manifest is the publication authority — the same rule every atlas here follows. A pass
 * killed between the two files leaves the previous manifest pointing at a rows file that has moved, which is
 * wrong in one direction only: the row count will not match, which {@link readCatalogue}'s caller can see.
 * The reverse order would leave a manifest promising rows that were never written.
 *
 * @param home the Slopweaver home
 * @param catalogue what the pass produced
 */
export function writeCatalogue({ home, catalogue }: { home: string; catalogue: Catalogue }): void {
  const paths = stateHomePaths({ home }).datadogCatalogue;
  mkdirSync(paths.root, { recursive: true });
  writeFileAtomicStream({
    path: paths.rows,
    produce: ({ write }) => {
      for (const row of catalogue.rows) {
        write({ text: `${safeJsonStringify({ label: "datadog census row", value: row })}\n` });
      }
    },
  });
  writeFileAtomic({
    contents: safeJsonStringify({ label: "datadog census manifest", value: catalogue.manifest }),
    path: paths.manifest,
  });
}
