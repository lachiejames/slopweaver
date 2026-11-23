/**
 * `slopweaver dev manifest` — snapshot the corpus's cross-source shape, or check a rebuild against a snapshot.
 *
 * Two modes, and the second is the one that matters:
 *
 *   slopweaver dev manifest --out before.json     # snapshot, BEFORE you discard anything
 *   …rebuild one source…
 *   slopweaver dev manifest --compare before.json # what did the rebuild lose?
 *
 * The comparison exists because "the source I rebuilt came back" is not a check. `derive` overwrites SHARED
 * artefacts — one directory, one identity resolution, one token graph, one curated graph, all computed across
 * every source at once — so a rebuild can be entirely green on its own source while having erased three others
 * from every derived artefact. Conservation of the sources you did NOT touch is the property; this verb is how
 * you find out whether it held.
 *
 * It also prints ORIGIN SURVIVAL on every run — per lane, how many of the local files its records were
 * scanned from still exist. That is the reading conservation structurally cannot make: a lane whose source
 * tree was pruned has lost nothing a before/after comparison can see, and is still the only copy of every
 * file that went. See {@link ../../../corpus/survival} for what each verdict means.
 *
 * Read-only with respect to the corpus. `--out` writes one JSON file wherever it is told to, which is the only
 * side effect and is why the verb declares `local-state`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { censusCorpus } from "../../../corpus/corpusCensus.js";
import { resolveCorpusDir } from "../../../corpus/corpusResolve.js";
import {
  type CorpusManifest,
  compareManifests,
  corpusManifestFold,
  manifestConserved,
  parseCorpusManifest,
  renderManifestComparison,
} from "../../../corpus/manifest.js";
import { type RowReader, withRowReader } from "../../../corpus/rowReader.js";
import { laneSurvival, renderSurvival } from "../../../corpus/survival.js";
import { parseJsonObject } from "../../../lib/jsonParse.js";
import { logger } from "../../../lib/logger.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";

const USAGE =
  "usage: slopweaver dev manifest [--out <path>] [--compare <path>] [--numbers-only] [--home <dir>] " +
  "[--corpus <dir>]";

/** The manifest of the corpus as it stands right now (the logical-latest view, not raw bronze lines). */
function currentManifest({ home, corpus }: { home: string; corpus?: string }): CorpusManifest | undefined {
  const dir = resolveCorpusDir({ home, ...(corpus !== undefined ? { corpus } : {}) });
  if (dir.isErr()) {
    logger.error({ msg: dir.error.message });
    return undefined;
  }
  return withRowReader({ run: (reader) => streamManifest({ dir: dir.value, home, reader }) });
}

/**
 * Stream a corpus tree into its manifest: census it, then read each logical record back by pointer and fold
 * it in — so the verb that proves a rebuild lost nothing never holds the corpus it is proving about. It used to
 * read every record into one array, which on the owner's corpus refused at the heap preflight.
 *
 * @param dir the resolved corpus root
 * @param home the Slopweaver home whose protect list applies
 * @param reader the open row reader ties and the fold's records are read back through
 * @returns the manifest, or undefined (with the reason logged) when the corpus could not all be read
 */
function streamManifest({
  dir,
  home,
  reader,
}: {
  dir: string;
  home: string;
  reader: RowReader;
}): CorpusManifest | undefined {
  // The `bronze` tie projection, because this verb always read bronze whole before collapsing it.
  const read = censusCorpus({ dir, home, reader, tieProjection: "bronze" });
  if (read.isErr()) {
    logger.error({ msg: read.error.message });
    return undefined;
  }
  // A file this could not open makes the whole verb lie in its own subject: it exists to prove a rebuild
  // lost nothing, and a manifest built from the readable subset would show a genuinely lossy rebuild as
  // clean. Refusing is the only answer that keeps the proof worth anything.
  if (read.value.unreadable.length > 0) {
    logger.error({
      msg: `refusing to build a manifest: ${String(read.value.unreadable.length)} corpus path(s) could not be read, and a manifest missing them would show a lossy rebuild as clean — ${read.value.unreadable.join(", ")}`,
    });
    return undefined;
  }
  // The LATEST view, deliberately: comparing physical bronze lines would report a rebuild as lossy purely
  // because it has not yet accumulated the duplicate versions an append-only store collects over time.
  const fold = corpusManifestFold({ exists: ({ path }) => existsSync(path) });
  for (const entry of read.value.winners.values()) {
    const record = reader.record({ pointer: entry.pointer, projection: "retrieval" });
    if (record.isErr()) {
      logger.error({ msg: record.error.message });
      return undefined;
    }
    fold.add({ record: record.value });
  }
  return fold.finish();
}

/** Read a stored manifest, or report why it could not be read. */
function readManifest({ path }: { path: string }): CorpusManifest | undefined {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readManifest", path });
  if (read.isErr()) {
    logger.error({ msg: `cannot read manifest: ${read.error.message}` });
    return undefined;
  }
  const parsed = parseJsonObject({ text: read.value });
  if (parsed.isErr()) {
    logger.error({ msg: `manifest is not a JSON object: ${parsed.error.message}` });
    return undefined;
  }
  const decoded = parseCorpusManifest({ value: parsed.value });
  if (decoded === undefined) {
    logger.error({ msg: `not a version-2 manifest: ${path}` });
    return undefined;
  }
  return decoded;
}

/**
 * How many distinct containers a source's records named. A stored manifest whose container tally does not
 * carry the source — one written before the tally existed decodes to an empty one — counted none.
 */
function containerCount({ manifest, source }: { manifest: CorpusManifest; source: string }): number {
  const counted = manifest.containersBySource[source];
  if (counted === undefined) {
    return 0;
  }
  return counted;
}

/**
 * The one-line shape summary a snapshot prints — counts only, safe to paste.
 *
 * The origin-survival block is printed on every run rather than behind a flag, because the reading it carries
 * is the one a rebuild verdict has to cite, and a number nobody sees unless they already suspected the problem
 * would not have caught the case it was built for.
 */
function shapeLines({ manifest }: { manifest: CorpusManifest }): readonly string[] {
  return [
    `records: ${String(manifest.records)} · curated edges: ${String(manifest.curatedEdges)}`,
    ...Object.entries(manifest.bySource)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(
        ([source, count]) =>
          `  ${source}: ${String(count)} record(s) across ${String(containerCount({ manifest, source }))} container(s)`,
      ),
    ...Object.entries(manifest.bySourceKind)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => `    ${key}: ${String(count)}`),
    ...renderSurvival({ lanes: laneSurvival({ manifest }) }),
  ];
}

/**
 * Run the manifest verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev manifest <tail>`)
 * @returns EXIT_OK when conserved (or on a plain snapshot), EXIT_ERROR on a conservation failure
 */
export function runDevManifest(argv: readonly string[]): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["numbers-only"], value: ["out", "compare", "home", "corpus"] },
  });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const manifest = currentManifest({
    home: resolveHome({ named: values["home"] }),
    ...(values["corpus"] !== undefined ? { corpus: values["corpus"] } : {}),
  });
  if (manifest === undefined) {
    return EXIT_ERROR;
  }
  for (const line of shapeLines({ manifest })) {
    logger.out({ line: line });
  }
  return finish({
    manifest,
    numbersOnly: flags.has("numbers-only"),
    ...(values["out"] !== undefined ? { out: values["out"] } : {}),
    ...(values["compare"] !== undefined ? { compare: values["compare"] } : {}),
  });
}

/** Persist the snapshot and/or run the comparison, returning the exit code. */
function finish({
  manifest,
  out,
  compare,
  numbersOnly,
}: {
  manifest: CorpusManifest;
  out?: string;
  compare?: string;
  numbersOnly: boolean;
}): number {
  if (out !== undefined) {
    const wrote = safeFs({
      execute: () => {
        writeFileSync(out, `${JSON.stringify(manifest)}\n`, "utf8");
      },
      operation: "writeManifest",
      path: out,
    });
    if (wrote.isErr()) {
      logger.error({ msg: `cannot write manifest: ${wrote.error.message}` });
      return EXIT_ERROR;
    }
    logger.out({ line: `wrote manifest → ${out}` });
  }
  if (compare === undefined) {
    return EXIT_OK;
  }
  const before = readManifest({ path: compare });
  if (before === undefined) {
    return EXIT_ERROR;
  }
  const findings = compareManifests({ after: manifest, before });
  for (const line of renderManifestComparison({ findings, numbersOnly })) {
    logger.out({ line: line });
  }
  return manifestConserved({ findings }) ? EXIT_OK : EXIT_ERROR;
}

export const devManifestCommand = defineCommand({ run: runDevManifest });
