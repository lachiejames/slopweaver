/**
 * `slopweaver audit references --indirect` — the second layer of the zero-references proof: the same zip of the
 * same commit, scanned for what could tie the tree back to the organisation WITHOUT its name. The direct mode
 * proves a count; this one produces a candidate list for a person to judge.
 *
 * Inputs: the off-repo candidate map (`$SLOPWEAVER_HOME/hygiene/indirect-reference-map.tsv`) and the operating
 * system's dictionary, which the harvest reads to find a name nobody listed. Both must be there: a scan without
 * either would read clean for a reason that is not the tree. Outputs: the full report under the home, `0600`;
 * the candidate page under the home; and on stderr only the counts by class, never a matched term.
 *
 * Exit 0 when no `remove` candidate remains, so "every obvious candidate is gone" is one command; 1 when one does
 * or a step failed. A `review` or `aggregate` candidate never fails the run: those are the owner's to judge.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { type IndirectMapRow, parseIndirectMap } from "../../../hygiene/indirectMap.js";
import { INDIRECT_SCAN_PAGE_SLUG, renderIndirectPage } from "../../../hygiene/indirectPage.js";
import {
  type HarvestDictionary,
  type IndirectClass,
  readHarvestDictionary,
  summariseIndirect,
} from "../../../hygiene/indirectScan.js";
import { type IndirectTreeScan, scanIndirectTree } from "../../../hygiene/indirectTree.js";
import { type ExportedTreeProof, exportAndScanTree } from "../../../hygiene/referenceExport.js";
import { type ReferenceExportError, ReferenceExportErrors } from "../../../hygiene/referenceExportErrors.js";
import { runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomicStream } from "../../../lib/writeAtomic.js";
import type { PagePublisher } from "../../../pages/publish.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/** The system dictionary the harvest reads: its common words, and its proper names. */
const DICTIONARY_WORDS = "/usr/share/dict/words";
const DICTIONARY_PROPERNAMES = "/usr/share/dict/propernames";

/**
 * The most files a harvest word may span and still be listed: a name that is somebody's sits in a handful of
 * files, while this tree's own vocabulary recurs. MEASURED on main (17,295 files): at 3 the
 * harvest listed 1,022 terms in 2,470 places for a person to read, already the largest class on the page. Repro:
 * `slopweaver audit references --indirect --no-page` and read the two `harvest:` count lines.
 */
const HARVEST_MAX_FILES = 3;

/** What the indirect run reads before it exports anything. */
interface IndirectInputs {
  readonly map: readonly IndirectMapRow[];
  readonly mapSha256: string;
  readonly dictionary: HarvestDictionary;
}

/**
 * Pure: the refusal for an input that is not there.
 *
 * @param path the input's path
 * @returns the line to print
 */
function absentInput({ path }: { path: string }): string {
  return `${path} is absent, so an indirect scan would read clean for a reason that is not the tree`;
}

/**
 * Read the candidate map, then the system dictionary, refusing when either is absent or the map is malformed.
 *
 * @param home the Slopweaver home
 * @returns the inputs, or every reason they cannot be trusted
 */
export function readIndirectInputs({ home }: { home: string }): Result<IndirectInputs> {
  const mapPath = stateHomePaths({ home }).indirectReferenceMap;
  if (!existsSync(mapPath)) {
    return err([absentInput({ path: mapPath })]);
  }
  const text = readFileSync(mapPath, "utf8");
  const map = parseIndirectMap({ text });
  if (map.isErr()) {
    return err([map.error.message]);
  }
  for (const path of [DICTIONARY_WORDS, DICTIONARY_PROPERNAMES]) {
    if (!existsSync(path)) {
      return err([absentInput({ path })]);
    }
  }
  const dictionary = readHarvestDictionary({
    propernames: readFileSync(DICTIONARY_PROPERNAMES, "utf8").split("\n"),
    words: readFileSync(DICTIONARY_WORDS, "utf8").split("\n"),
  });
  return ok({ dictionary, map: map.value, mapSha256: createHash("sha256").update(text).digest("hex") });
}

/**
 * Pure: the counts the run prints — one line per class, never a matched term.
 *
 * @param proof the export's provenance and the walk's counts
 * @param classes the summarised classes
 * @returns the lines to print
 */
export function indirectReportLines({
  proof,
  classes,
}: {
  proof: ExportedTreeProof<IndirectTreeScan>;
  classes: readonly IndirectClass[];
}): readonly string[] {
  const remove = classes.filter((entry) => entry.disposition === "remove");
  const removeHits = remove.reduce((sum, entry) => sum + entry.hits, 0);
  return [
    // The sha, never the ref: a ref is a name the operator chose, and it could spell a term the scan matched.
    `audit references --indirect: ${proof.sha.slice(0, 12)} exported as a zip with no .git — ` +
      `${String(proof.result.filesScanned)} files scanned for indirect candidates`,
    removeHits === 0
      ? "  0 obvious (remove) candidates remain"
      : `  ${String(removeHits)} obvious (remove) candidate place(s) remain`,
    ...classes.map(
      (entry) =>
        `    ${entry.className.padEnd(28)} ${entry.disposition.padEnd(9)} ${String(entry.hits).padStart(6)} places ` +
        `${String(entry.files).padStart(5)} files ${String(entry.terms.length).padStart(4)} terms`,
    ),
  ];
}

/** One report line: one term of one class, its identity first so a line reads as a row before its places. */
export interface IndirectReportRow {
  readonly className: string;
  readonly disposition: IndirectClass["disposition"];
  readonly term: string;
  readonly hits: number;
  readonly files: number;
  readonly replacement: string;
  readonly places: readonly { readonly path: string; readonly line: number; readonly excerpt: string }[];
}

/**
 * Pure: the report's rows — one per term, in the classes' order, each place cut to where it is and what it reads.
 *
 * @param classes the summarised classes
 * @returns one row per term
 */
export function indirectReportRows({ classes }: { classes: readonly IndirectClass[] }): readonly IndirectReportRow[] {
  return classes.flatMap((entry) =>
    entry.terms.map((term) => ({
      className: entry.className,
      disposition: entry.disposition,
      term: term.term,
      hits: term.hits,
      files: term.files,
      replacement: term.places[0]!.replacement,
      places: term.places.map((place) => ({ excerpt: place.excerpt, line: place.line, path: place.path })),
    })),
  );
}

/**
 * Write the full report under the home, `0600`: one header line, then one line per term.
 *
 * @param path where it is written
 * @param proof the export's provenance
 * @param classes the summarised classes
 * @returns nothing, or why it could not be written — naming the path, never a term
 */
function writeReport({
  path,
  proof,
  classes,
}: {
  path: string;
  proof: ExportedTreeProof<IndirectTreeScan>;
  classes: readonly IndirectClass[];
}): Result<void, ReferenceExportError> {
  const { result, ...provenance } = proof;
  const header = { ...provenance, binaryFiles: result.binaryFiles, filesScanned: result.filesScanned };
  try {
    writeFileAtomicStream({
      fileMode: 0o600,
      path,
      produce: ({ write }) => {
        write({ text: `${safeJsonStringify({ label: "indirect report header", value: header })}\n` });
        for (const row of indirectReportRows({ classes })) {
          write({ text: `${safeJsonStringify({ label: "indirect report term", value: row })}\n` });
        }
      },
    });
  } catch {
    return err(ReferenceExportErrors.reportUnwritable({ path }));
  }
  return ok(undefined);
}

/**
 * Render and publish the candidate page under the home.
 *
 * @param home the resolved Slopweaver home
 * @param classes the summarised classes
 * @param proof the export's provenance and the walk's counts
 * @param map the candidate map the scan read
 * @param mapSha256 the map's digest, so the page names exactly which map it came from
 * @param publish writes the page to its folder, its freeze and the store
 * @returns the page's address, or every reason it was not published
 */
async function publishIndirectPage({
  home,
  classes,
  proof,
  map,
  mapSha256,
  publish,
}: {
  home: string;
  classes: readonly IndirectClass[];
  proof: ExportedTreeProof<IndirectTreeScan>;
  map: readonly IndirectMapRow[];
  mapSha256: string;
  publish: PagePublisher;
}): Promise<Result<string>> {
  const human = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const now = new Date();
  const fragment = renderIndirectPage({
    classes,
    facts: {
      binaryFiles: proof.result.binaryFiles,
      committedLabel: human.format(new Date(proof.committedIso)),
      filesScanned: proof.result.filesScanned,
      harvestMaxFiles: HARVEST_MAX_FILES,
      harvestSkipped: proof.result.harvestSkipped,
      mapRows: map.length,
      mapSha256,
      ref: proof.ref,
      scannedLabel: human.format(now),
      sha: proof.sha,
    },
  });
  const published = await publish({ fragment, home, nowIso: now.toISOString(), slug: INDIRECT_SCAN_PAGE_SLUG });
  return published.map((page) => page.url);
}

/**
 * Print each reason a step failed, prefixed with the verb, and refuse.
 *
 * @param problems what went wrong, each already safe to print
 * @param writeDiagnostic the stderr sink
 * @returns the error exit code
 */
function refuse({
  problems,
  writeDiagnostic,
}: {
  problems: readonly string[];
  writeDiagnostic: (line: string) => void;
}): number {
  for (const problem of problems) {
    writeDiagnostic(`audit references --indirect: ${problem}`);
  }
  return EXIT_ERROR;
}

/**
 * Run the indirect mode.
 *
 * @param ref the commit-ish to export
 * @param home the resolved Slopweaver home
 * @param page whether to publish the candidate page
 * @param writeOut the stdout sink, for the page address
 * @param writeDiagnostic the stderr sink, for the counts
 * @param publish writes the candidate page to its folder, its freeze and the store
 * @returns the process exit code
 */
export async function runAuditIndirectReferences({
  ref,
  home,
  page,
  writeOut,
  writeDiagnostic,
  publish,
}: {
  ref: string;
  home: string;
  page: boolean;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
  publish: PagePublisher;
}): Promise<number> {
  const inputs = readIndirectInputs({ home });
  if (inputs.isErr()) {
    return refuse({ problems: inputs.error, writeDiagnostic });
  }
  const { map, dictionary, mapSha256 } = inputs.value;
  const proof = exportAndScanTree({
    home,
    ref,
    root: runningCheckoutRoot(),
    scan: ({ treeRoot, expected }) => scanIndirectTree({ dictionary, expected, map, treeRoot }),
  });
  if (proof.isErr()) {
    return refuse({ problems: [proof.error.code], writeDiagnostic });
  }
  const classes = summariseIndirect({ harvestMaxFiles: HARVEST_MAX_FILES, places: proof.value.result.places });
  const reportPath = stateHomePaths({ home }).indirectReferenceReport;
  const written = writeReport({ classes, path: reportPath, proof: proof.value });
  if (written.isErr()) {
    return refuse({ problems: [written.error.message], writeDiagnostic });
  }
  for (const line of indirectReportLines({ classes, proof: proof.value })) {
    writeDiagnostic(line);
  }
  writeDiagnostic(`  report: ${reportPath}`);
  if (page) {
    const published = await publishIndirectPage({ classes, home, map, mapSha256, proof: proof.value, publish });
    if (published.isErr()) {
      return refuse({ problems: published.error, writeDiagnostic });
    }
    writeOut(published.value);
  }
  const removeHits = classes.filter((entry) => entry.disposition === "remove").reduce((sum, e) => sum + e.hits, 0);
  return removeHits === 0 ? EXIT_OK : EXIT_ERROR;
}
