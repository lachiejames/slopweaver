/**
 * `slopweaver browser annotate` — draw boxes and their notes onto an EXISTING PNG, and hand back the `image-record`
 * form that records the result once a session has looked at it.
 *
 * Every pixel decision is `../../../visualEvidence/annotateExisting.ts`'s `annotateImage` and every form decision is
 * `../../../visualEvidence/annotateForm.ts`; every path check is `./annotatePaths.ts`; this file reads, refuses
 * known-bad bytes, writes and reports. Why it stops
 * short of writing the record itself is in that form module's header: a record attests a look at the FINAL bytes.
 *
 * ## A picture already recorded unfit is never annotated
 *
 * A failed record is terminal for its bytes (`../../../visualEvidence/admission.ts`), and drawing on them would mint
 * new bytes with no record — laundering an obscured or unrendered capture into one that looks fresh. The rule
 * on the obscured case: a capture a pop-up covers is retaken, never worked around. So a source
 * whose digest holds ANY failed record is refused with no hatch, and so is an output whose digest does.
 *
 * Two files are written, the PNG and then its form, each atomically; if the second write fails the PNG stands and the
 * verb says so. Re-running is safe: both writes replace.
 */

import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { logger } from "#lib/logger.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { writeFileAtomic, writeFileAtomicBytes } from "#lib/writeAtomic.js";
import { type AnnotatedExistingImage, annotateImage } from "../../../visualEvidence/annotateExisting.js";
import {
  type AnnotateForm,
  imageRecordFormForAnnotatedImage,
  parseAnnotateForm,
} from "../../../visualEvidence/annotateForm.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { identifyImageBytes } from "../../../visualEvidence/imageIo.js";
import type { ImageRecordForm } from "../../../visualEvidence/recordForm.js";
import { readImageRecords } from "../../../visualEvidence/store.js";
import type { ArtifactIdentity } from "../../../visualEvidence/types.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type AnnotatePaths, annotatePaths, bindPaths, sameFileProblem } from "./annotatePaths.js";

/**
 * Read and validate the form file.
 *
 * @param form the path to the form file
 * @returns the parsed form, or the exit code to return
 */
async function loadForm({
  form,
}: {
  form: string;
}): Promise<{ readonly form: AnnotateForm } | { readonly code: number }> {
  let text: string;
  try {
    text = await readFile(form, "utf8");
  } catch (error) {
    logger.error({
      msg: `could not read the form at ${form}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_ERROR };
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `annotate form at ${form}`, text });
  } catch (error) {
    logger.error({
      msg: `could not parse the form at ${form}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_USAGE };
  }
  const parsed = parseAnnotateForm({ value: decoded });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    return { code: EXIT_USAGE };
  }
  return { form: parsed.value };
}

/**
 * Whether the out's directory still resolves to itself, read immediately before the write — the second half of
 * {@link bindPaths}, for a directory below the deepest existing ancestor that something else created as a link.
 *
 * The residue, stated: a process that swaps this real directory for a link between this read and the rename still
 * redirects the write. Node has no directory-descriptor write that closes it, and a process
 * that can make that swap already writes as this user beside the source, so the guard is against a mistaken path.
 *
 * @param out the bound out path
 * @returns the problem, or `null` when the write lands where it was bound
 */
function rebindProblem({ out }: { out: string }): string | null {
  const directory = dirname(out);
  mkdirSync(directory, { recursive: true });
  const real = realpathSync(directory);
  if (real === directory) {
    return null;
  }
  return `the directory ${directory} now resolves to ${real} — something moved it while annotating; nothing was written`;
}

/**
 * Why bytes may not be annotated or handed back, or `null` when nothing holds them: any failed record for their
 * digest, or a store that could not be read.
 *
 * @param digest the bytes' digest
 * @param which `source` or `output`, for the message
 * @param home the state home the image records live under
 * @returns the problem, or `null`
 */
function failedRecordProblem({
  digest,
  which,
  home,
}: {
  digest: string;
  which: "source" | "output";
  home: string;
}): string | null {
  const held = readImageRecords({ digest, home });
  if (held.isErr()) {
    return held.error.message;
  }
  const failed = held.value.find((record) => record.outcome === "failed");
  if (failed === undefined) {
    return null;
  }
  return (
    `the ${which} bytes ${digest} are already recorded unfit (${failed.reason}: ${failed.correction}) — a picture ` +
    "recorded unfit is retaken, never annotated around"
  );
}

/** What the verb produced, so the printer has no decisions of its own. */
interface AnnotateReport {
  readonly paths: AnnotatePaths;
  readonly source: ArtifactIdentity;
  readonly output: ArtifactIdentity;
  readonly recordForm: ImageRecordForm;
}

/**
 * Print what was drawn and the one command that records it.
 *
 * @param report what was written
 * @param json whether machine-readable output was asked for
 */
function reportAnnotated({ report, json }: { report: AnnotateReport; json: boolean }): void {
  const next = `slopweaver browser image-record --form ${report.paths.recordForm}`;
  if (json) {
    logger.out({
      line: JSON.stringify(
        {
          next,
          out: { ...report.output, path: report.paths.out },
          recordForm: { form: report.recordForm, path: report.paths.recordForm },
          recorded: false,
          source: { ...report.source, path: report.paths.source },
        },
        null,
        2,
      ),
    });
    return;
  }
  const { output } = report;
  logger.out({ line: `annotate: drew ${String(report.recordForm.annotations!.length)} box(es) — ${report.paths.out}` });
  logger.out({ line: `  ${String(output.widthPx)}x${String(output.heightPx)}, ${output.digest}` });
  logger.out({ line: `  pre-filled record form: ${report.paths.recordForm}` });
  logger.out({ line: "  no image record was written. open the picture, check every box and note, then:" });
  logger.out({ line: `  ${next}` });
}

/**
 * Read the source bytes and decode them.
 *
 * @param path the resolved source path
 * @returns the bytes and their identity, or the exit code to return
 */
async function loadSource({
  path,
}: {
  path: string;
}): Promise<{ readonly bytes: Uint8Array; readonly artifact: ArtifactIdentity } | { readonly code: number }> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    logger.error({
      msg: `could not read the source at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_ERROR };
  }
  const identity = await identifyImageBytes({ bytes });
  if (identity.isErr()) {
    for (const problem of visualEvidenceErrorLines({ error: identity.error })) {
      logger.error({ msg: problem });
    }
    return { code: EXIT_ERROR };
  }
  return { artifact: identity.value, bytes };
}

/**
 * Write the picture, then its record form.
 *
 * @param paths where each goes
 * @param bytes the annotated PNG
 * @param recordForm the pre-filled image-record form
 * @returns the exit code — non-zero, naming what stands, when either write failed
 */
function writeOutputs({
  paths,
  bytes,
  recordForm,
}: {
  paths: AnnotatePaths;
  bytes: Uint8Array;
  recordForm: ImageRecordForm;
}): number {
  try {
    const moved = rebindProblem({ out: paths.out });
    if (moved !== null) {
      logger.error({ msg: moved });
      return EXIT_ERROR;
    }
    // An older run's form goes first, so a failed second write never leaves one naming other bytes.
    rmSync(paths.recordForm, { force: true });
    writeFileAtomicBytes({ bytes: Buffer.from(bytes), path: paths.out });
  } catch (error) {
    logger.error({ msg: `could not write ${paths.out}: ${error instanceof Error ? error.message : String(error)}` });
    return EXIT_ERROR;
  }
  try {
    writeFileAtomic({ contents: `${JSON.stringify(recordForm, null, 2)}\n`, path: paths.recordForm });
  } catch (error) {
    logger.error({
      msg:
        `wrote ${paths.out} but not its record form ${paths.recordForm}: ` +
        `${error instanceof Error ? error.message : String(error)} — run annotate again; both writes replace`,
    });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Run `browser annotate`.
 *
 * @param form the path to the form file
 * @param home the state home whose image records are read for failed bytes — nothing is written there
 * @param json whether machine-readable output was asked for
 * @returns the process exit code
 */
export async function runBrowserAnnotate({
  form,
  home,
  json,
}: {
  form: string;
  home: string;
  json: boolean;
}): Promise<number> {
  const loaded = await loadForm({ form });
  if (!("form" in loaded)) {
    return loaded.code;
  }
  const resolved = annotatePaths({ form: loaded.form });
  if (resolved.isErr()) {
    for (const problem of resolved.error) {
      logger.error({ msg: problem });
    }
    return EXIT_USAGE;
  }
  const bound = bindPaths({ paths: resolved.value });
  if (!("paths" in bound)) {
    logger.error({ msg: bound.problem });
    return bound.code;
  }
  const { paths } = bound;
  const source = await loadSource({ path: paths.source });
  if (!("bytes" in source)) {
    return source.code;
  }
  const aliased = sameFileProblem({ paths });
  if (aliased !== null) {
    logger.error({ msg: aliased });
    return EXIT_USAGE;
  }
  const sourceHeld = failedRecordProblem({ digest: source.artifact.digest, home, which: "source" });
  if (sourceHeld !== null) {
    logger.error({ msg: sourceHeld });
    return EXIT_ERROR;
  }
  const made = await drawAndForm({ bytes: source.bytes, form: loaded.form, home, out: paths.out });
  if (!("drawn" in made)) {
    return made.code;
  }
  const written = writeOutputs({ bytes: made.drawn.bytes, paths, recordForm: made.recordForm });
  if (written !== EXIT_OK) {
    return written;
  }
  reportAnnotated({
    json,
    report: { output: made.drawn.artifact, paths, recordForm: made.recordForm, source: source.artifact },
  });
  return EXIT_OK;
}

/**
 * Draw the boxes, refuse output bytes already recorded unfit, and build the record form for exactly those bytes.
 *
 * @param bytes the source PNG
 * @param form the parsed annotate form
 * @param home the state home whose image records are read for failed bytes
 * @param out the resolved path the picture will be written to, named in the record form
 * @returns the drawn picture and its record form, or the exit code to return
 */
async function drawAndForm({
  bytes,
  form,
  home,
  out,
}: {
  bytes: Uint8Array;
  form: AnnotateForm;
  home: string;
  out: string;
}): Promise<
  { readonly drawn: AnnotatedExistingImage; readonly recordForm: ImageRecordForm } | { readonly code: number }
> {
  const drawn = await annotateImage({ annotations: form.annotations, bytes });
  if (drawn.isErr()) {
    for (const problem of visualEvidenceErrorLines({ error: drawn.error })) {
      logger.error({ msg: problem });
    }
    return { code: drawn.error.code === "UNDECODABLE" ? EXIT_ERROR : EXIT_USAGE };
  }
  const outputHeld = failedRecordProblem({ digest: drawn.value.artifact.digest, home, which: "output" });
  if (outputHeld !== null) {
    logger.error({ msg: outputHeld });
    return { code: EXIT_ERROR };
  }
  const recordForm = imageRecordFormForAnnotatedImage({
    annotations: drawn.value.annotations,
    form,
    outputDigest: drawn.value.artifact.digest,
    outputPath: out,
  });
  if (recordForm.isErr()) {
    for (const problem of recordForm.error) {
      logger.error({ msg: problem });
    }
    return { code: EXIT_USAGE };
  }
  return { drawn: drawn.value, recordForm: recordForm.value };
}
