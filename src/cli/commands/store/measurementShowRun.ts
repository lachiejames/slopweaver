/**
 * `slopweaver store measurement-show` — one stored measurement body, read back OUT of the store: a text body
 * on stdout exactly as stored, any body to `--out` byte for byte. The seams it shares with the other two
 * measurement verbs live in `./measurementRun.ts`.
 */
import { dirname } from "node:path";

import { safeJsonStringify } from "#lib/safeJson.js";
import type { MeasurementRef } from "../../../store/fleet/measurementAnchor.js";
import { resolveMeasurementRef } from "../../../store/fleet/measurementAnchor.js";
import type { StoredMeasurementLocation } from "../../../store/fleet/measurementStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import {
  MEASUREMENT_SHOW_USAGE,
  measurementNothingStoredLine,
  parseMeasurementShowArgs,
  restoreAction,
} from "./measurementCore.js";
import {
  homeOf,
  type MeasurementReader,
  type MeasurementVerbDeps,
  productionMeasurementVerbDeps,
  refuseUsage,
  settleExisting,
  storeUnreadable,
  withReader,
} from "./measurementRun.js";

/**
 * Run `store measurement-show` against injected seams.
 *
 * @param rest the argv tail after `store measurement-show`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runStoreMeasurementShow({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: MeasurementVerbDeps;
}): Promise<number> {
  const args = parseMeasurementShowArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ deps, problems: args.error, usage: MEASUREMENT_SHOW_USAGE, verb: "measurement-show" });
  }
  const { ref, out, json } = args.value;
  if (ref === undefined) {
    return refuseUsage({
      deps,
      problems: ["--ref <anchor|path|sha256> is required"],
      usage: MEASUREMENT_SHOW_USAGE,
      verb: "measurement-show",
    });
  }
  const home = homeOf({ deps, named: args.value.home });
  const resolved = resolveMeasurementRef({ home, ref });
  if (resolved.isErr()) {
    deps.writeDiagnostic(`store measurement-show: ${resolved.error.message}`);
    return EXIT_ERROR;
  }
  return withReader({
    deps,
    home,
    use: (reader) => showFromReader({ deps, json, out, reader, ref, resolved: resolved.value }),
    verb: "measurement-show",
  });
}

/**
 * Find the newest body a resolved ref selects and hand it to stdout or `--out`.
 *
 * @param ref the ref as typed, named in a "nothing stored" line
 * @param resolved what the ref resolved to
 * @param out the `--out` file, when given
 * @returns the exit code
 */
async function showFromReader({
  reader,
  ref,
  resolved,
  out,
  json,
  deps,
}: {
  reader: MeasurementReader;
  ref: string;
  resolved: MeasurementRef;
  out: string | undefined;
  json: boolean;
  deps: MeasurementVerbDeps;
}): Promise<number> {
  const read = await reader.locations({ filter: { ref: resolved } });
  if (read.isErr()) {
    return storeUnreadable({ deps, error: read.error, verb: "measurement-show" });
  }
  const newest = read.value[0];
  if (newest === undefined) {
    deps.writeDiagnostic(`store measurement-show: ${measurementNothingStoredLine({ what: ref })}`);
    return EXIT_ERROR;
  }
  if (out === undefined && newest.placement !== "inline") {
    deps.writeDiagnostic(
      `store measurement-show: ${newest.relativePath} is a ${newest.mediaType} body held in Storage, not text — ` +
        "pass --out <file> to write its exact bytes",
    );
    return EXIT_ERROR;
  }
  const body = await reader.body({ bodySha256: newest.bodySha256 });
  if (body.isErr()) {
    deps.writeDiagnostic(`store measurement-show: the body could not be read (${body.error.code})`);
    deps.writeDiagnostic(`  ${body.error.message}`);
    return EXIT_ERROR;
  }
  warnDistinctBodies({ deps, locations: read.value, newest });
  if (out !== undefined) {
    return writeShown({ bytes: body.value, deps, json, location: newest, out });
  }
  const text = Buffer.from(body.value).toString("utf8");
  if (json) {
    deps.writeOut(
      safeJsonStringify({
        label: "store measurement-show",
        value: { body: text, location: newest, locations: read.value, ref: resolved },
      }),
    );
    return EXIT_OK;
  }
  deps.writeBody(text);
  return EXIT_OK;
}

/**
 * Say so when a path has held more than one body, since show prints only the newest.
 *
 * @param locations every stored location the ref selected
 * @param newest the one being shown
 */
function warnDistinctBodies({
  locations,
  newest,
  deps,
}: {
  locations: readonly StoredMeasurementLocation[];
  newest: StoredMeasurementLocation;
  deps: MeasurementVerbDeps;
}): void {
  const distinct = new Set(locations.map((location) => location.bodySha256)).size;
  if (distinct > 1) {
    deps.writeDiagnostic(
      `store measurement-show: ${String(distinct)} distinct bodies are stored at ${newest.relativePath}; this is ` +
        "the newest — `store measurement-list --prefix` lists every one, and a sha-256 --ref reads any of them",
    );
  }
}

/**
 * Write a shown body to `--out`, refusing to replace a file there that holds different bytes.
 *
 * @param bytes the body's exact bytes
 * @param location where the body was found, carried in `--json`
 * @param out the file `--out` named
 * @returns the exit code
 */
function writeShown({
  bytes,
  location,
  out,
  json,
  deps,
}: {
  bytes: Uint8Array;
  location: StoredMeasurementLocation;
  out: string;
  json: boolean;
  deps: MeasurementVerbDeps;
}): number {
  const action = restoreAction({ bodySha256: location.bodySha256, existingSha256: deps.existingSha256({ path: out }) });
  if (action === "differs") {
    deps.writeDiagnostic(`store measurement-show: ${out} already holds different bytes — nothing written`);
    return EXIT_ERROR;
  }
  if (action === "write") {
    const written = deps.createFile({ bytes, modifiedAt: location.fileModifiedAt, path: out, root: dirname(out) });
    if (written.isErr()) {
      written.error.forEach((line) => {
        deps.writeDiagnostic(`store measurement-show: ${out} could not be written: ${line}`);
      });
      return EXIT_ERROR;
    }
    const settled = settleExisting({ created: written.value, deps, location, target: out });
    if (settled === "differs") {
      deps.writeDiagnostic(`store measurement-show: ${out} appeared holding different bytes — nothing written`);
      return EXIT_ERROR;
    }
  }
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "store measurement-show", value: { location, out } }));
    return EXIT_OK;
  }
  deps.writeOut(
    `store measurement-show: ${location.relativePath} (sha256 ${location.bodySha256.slice(0, 12)}, ` +
      `${String(location.byteLength)} B) → ${out}`,
  );
  return EXIT_OK;
}

/** `slopweaver store measurement-show`. */
export const storeMeasurementShowCommand = defineCommand({
  run: (argv) =>
    runStoreMeasurementShow({
      deps: productionMeasurementVerbDeps(),
      rest: verbTail({ argv, verbs: ["measurement-show"] }),
    }),
});
