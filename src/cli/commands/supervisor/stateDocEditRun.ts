/**
 * `slopweaver supervisor state-amend`, `state-fold` and `state-archive` — the edge that reads a state doc,
 * asks the pure core (`../../../supervisor/stateDocEdit.ts`, `stateDocFold.ts`, both over `stateDocBlock.ts`) for
 * the edit, and publishes it. How an edit is published, and what an operator sees at each failure, is `./stateDocEditPublication.ts`.
 */
import { basename } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { checkSummary, unsealedSummaryLines } from "../../../supervisor/outcomes/summaryMarker.js";
import { amendBootBlock, archiveBootBlock } from "../../../supervisor/stateDocEdit.js";
import { foldBootBlock } from "../../../supervisor/stateDocFold.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { SupervisorErrors, supervisorErrorLines } from "./errors.js";
import {
  extractRows,
  parseStateAmendArgs,
  parseStateArchiveArgs,
  parseStateFoldArgs,
  STATE_AMEND_USAGE,
  STATE_ARCHIVE_USAGE,
  STATE_FOLD_USAGE,
  type StateArchiveArgs,
} from "./stateDocEditCore.js";
import {
  attempt,
  expandHome,
  openDocAndArchive,
  productionStateDocEditDeps,
  publishThenReplace,
  replaceIfUnchanged,
  type StateDocEditDeps,
  tildify,
} from "./stateDocEditPublication.js";

/**
 * Print a refusal's lines under the verb's own prefix.
 *
 * @param verb the verb name
 * @param lines the refusal
 * @param deps the injected seams
 */
function refuse({ verb, lines, deps }: { verb: string; lines: readonly string[]; deps: StateDocEditDeps }): void {
  for (const line of lines) {
    deps.writeDiagnostic(`supervisor ${verb}: ${line}`);
  }
}

/**
 * Run `supervisor state-amend` against injected seams.
 *
 * @param rest the argv tail after `supervisor state-amend`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runStateAmend({ rest, deps }: { rest: readonly string[]; deps: StateDocEditDeps }): number {
  // Help is judged on the tail with the rows taken OUT: `--row --help` is a row whose text is `--help`, and a
  // raw `rest.includes("--help")` would answer it by printing usage and editing nothing.
  const outsideRows = extractRows({ rest });
  if (outsideRows.isOk() && outsideRows.value.remainder.some((token) => token === "--help" || token === "-h")) {
    deps.writeOut(STATE_AMEND_USAGE);
    return EXIT_OK;
  }
  const args = parseStateAmendArgs({ rest });
  if (args.isErr()) {
    refuse({ deps, lines: args.error, verb: "state-amend" });
    deps.writeDiagnostic(STATE_AMEND_USAGE);
    return EXIT_USAGE;
  }
  const doc = expandHome({ path: args.value.doc });
  const text = attempt({ label: `cannot read ${doc}`, step: () => deps.readFile({ path: doc }) });
  if (text.isErr()) {
    refuse({ deps, lines: supervisorErrorLines({ error: text.error }), verb: "state-amend" });
    return EXIT_ERROR;
  }
  const amended = amendBootBlock({ ...args.value, text: text.value });
  if (amended.isErr()) {
    refuse({ deps, lines: [amended.error.message], verb: "state-amend" });
    return EXIT_ERROR;
  }
  const written = replaceIfUnchanged({ deps, doc, expected: text.value, text: amended.value.text });
  if (written.isErr()) {
    refuse({ deps, lines: supervisorErrorLines({ error: written.error }), verb: "state-amend" });
    return EXIT_ERROR;
  }
  const { rows, docLines, blockLines } = amended.value;
  if (args.value.json) {
    deps.writeOut(JSON.stringify({ blockLines, doc, docLines, rows }));
    return EXIT_OK;
  }
  deps.writeOut(
    `supervisor state-amend: ${String(rows)} row(s) into handoff-${args.value.handoff}'s block — doc ${String(docLines)} lines, block ${String(blockLines)}`,
  );
  return EXIT_OK;
}

/**
 * Refuse the archive unless the successor summary beside it is one this repository derived and nobody edited.
 *
 * The check is the summary's own marker hash (`../../../supervisor/outcomes/summaryMarker.ts`), so a
 * hand-typed file claiming to be a summary, and a derived one with a sentence rewritten, both refuse. That is
 * the whole point: the briefing's narrative is derived rather than authored because
 * deriving removes a point of failure, and the handover's own statement of the owner's direction is
 * the surface where that failure cost the most.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns how many outcomes and ready rows the summary carries, or the refusal
 */
function verifySuccessorSummary({
  args,
  deps,
}: {
  args: StateArchiveArgs;
  deps: StateDocEditDeps;
}): Result<{ readonly outcomes: number; readonly ready: number }> {
  const path = expandHome({ path: args.successorSummary });
  const text = attempt({ label: `cannot read ${path}`, step: () => deps.readFile({ path }) });
  if (text.isErr()) {
    return err(supervisorErrorLines({ error: SupervisorErrors.summaryUnreadable({ inner: text.error }) }));
  }
  const checked = checkSummary({ text: text.value });
  if (checked.kind === "unsealed") {
    return err(unsealedSummaryLines({ path, why: checked.why }));
  }
  return ok({ outcomes: checked.outcomes, ready: checked.ready });
}

/**
 * Render the archive pass: read both inputs and ask the core for the two texts.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns the doc path, its original bytes, the archive path and the rendered edit, or the refusal
 */
function renderArchive({ args, deps }: { args: StateArchiveArgs; deps: StateDocEditDeps }): Result<{
  readonly doc: string;
  readonly original: string;
  readonly archivePath: string;
  readonly edit: {
    readonly archiveText: string;
    readonly docText: string;
    readonly movedFrom: { first: number; last: number };
    readonly docLines: number;
    readonly blockLines: number;
  };
}> {
  const opened = openDocAndArchive({ archive: args.archive, deps, typedDoc: args.doc });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const { archivePath, doc, original } = opened.value;
  const blockPath = expandHome({ path: args.blockFile });
  const block = attempt({ label: `cannot read ${blockPath}`, step: () => deps.readFile({ path: blockPath }) });
  if (block.isErr()) {
    return err(supervisorErrorLines({ error: block.error }));
  }
  const edit = archiveBootBlock({
    archiveDisplayPath: tildify({ path: archivePath }),
    description: args.description,
    docName: basename(doc),
    predecessor: args.predecessor,
    successor: args.successor,
    successorBlock: block.value,
    text: original,
    when: args.when,
  });
  if (edit.isErr()) {
    return err([edit.error.message]);
  }
  return ok({ archivePath, doc, edit: edit.value, original });
}

/**
 * Run `supervisor state-fold` against injected seams.
 *
 * @param rest the argv tail after `supervisor state-fold`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runStateFold({ rest, deps }: { rest: readonly string[]; deps: StateDocEditDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(STATE_FOLD_USAGE);
    return EXIT_OK;
  }
  const args = parseStateFoldArgs({ rest });
  if (args.isErr()) {
    refuse({ deps, lines: args.error, verb: "state-fold" });
    deps.writeDiagnostic(STATE_FOLD_USAGE);
    return EXIT_USAGE;
  }
  const opened = openDocAndArchive({ archive: args.value.archive, deps, typedDoc: args.value.doc });
  if (opened.isErr()) {
    refuse({ deps, lines: opened.error, verb: "state-fold" });
    return EXIT_ERROR;
  }
  const { archivePath, doc, original } = opened.value;
  const edit = foldBootBlock({
    archiveDisplayPath: tildify({ path: archivePath }),
    description: args.value.description,
    docName: basename(doc),
    handoff: args.value.handoff,
    keep: args.value.keep,
    text: original,
    when: args.value.when,
  });
  if (edit.isErr()) {
    refuse({ deps, lines: [edit.error.message], verb: "state-fold" });
    return EXIT_ERROR;
  }
  const reused = publishThenReplace({ archivePath, deps, doc, edit: edit.value, original });
  if (reused.isErr()) {
    refuse({ deps, lines: reused.error, verb: "state-fold" });
    return EXIT_ERROR;
  }
  const { folded, kept, docLines, blockLines } = edit.value;
  if (args.value.json) {
    deps.writeOut(
      JSON.stringify({ archive: archivePath, archiveReused: reused.value, blockLines, doc, docLines, folded, kept }),
    );
    return EXIT_OK;
  }
  deps.writeOut(
    `supervisor state-fold: ${String(folded)} row(s) of handoff-${args.value.handoff}'s block ` +
      `${reused.value ? "already in" : "folded to"} ${archivePath}, ${String(kept)} kept — doc ${String(docLines)} lines, block ${String(blockLines)}`,
  );
  return EXIT_OK;
}

/**
 * Run `supervisor state-archive` against injected seams.
 *
 * @param rest the argv tail after `supervisor state-archive`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runStateArchive({ rest, deps }: { rest: readonly string[]; deps: StateDocEditDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(STATE_ARCHIVE_USAGE);
    return EXIT_OK;
  }
  const args = parseStateArchiveArgs({ rest });
  if (args.isErr()) {
    refuse({ deps, lines: args.error, verb: "state-archive" });
    deps.writeDiagnostic(STATE_ARCHIVE_USAGE);
    return EXIT_USAGE;
  }
  const sealed = verifySuccessorSummary({ args: args.value, deps });
  if (sealed.isErr()) {
    refuse({ deps, lines: sealed.error, verb: "state-archive" });
    return EXIT_ERROR;
  }
  const rendered = renderArchive({ args: args.value, deps });
  if (rendered.isErr()) {
    refuse({ deps, lines: rendered.error, verb: "state-archive" });
    return EXIT_ERROR;
  }
  const { doc, original, archivePath, edit } = rendered.value;
  const reused = publishThenReplace({ archivePath, deps, doc, edit, original });
  if (reused.isErr()) {
    refuse({ deps, lines: reused.error, verb: "state-archive" });
    return EXIT_ERROR;
  }
  const { movedFrom, docLines, blockLines } = edit;
  if (args.value.json) {
    deps.writeOut(
      JSON.stringify({
        archive: archivePath,
        archiveReused: reused.value,
        blockLines,
        doc,
        docLines,
        movedFrom,
        successorSummary: { ...sealed.value, path: args.value.successorSummary },
      }),
    );
    return EXIT_OK;
  }
  deps.writeOut(
    `supervisor state-archive: handoff-${args.value.predecessor}'s block (lines ${String(movedFrom.first)}-${String(movedFrom.last)}) ` +
      `${reused.value ? "already in" : "archived to"} ${archivePath}; handoff-${args.value.successor}'s block in — doc ${String(docLines)} lines, block ${String(blockLines)}; ` +
      `successor summary sealed over ${String(sealed.value.outcomes)} outcome(s) and ${String(sealed.value.ready)} ready row(s)`,
  );
  return EXIT_OK;
}

/** `slopweaver supervisor state-amend`. */
export const supervisorStateAmendCommand = defineCommand({
  run: (argv) =>
    runStateAmend({ deps: productionStateDocEditDeps(), rest: verbTail({ argv, verbs: ["state-amend"] }) }),
});

/** `slopweaver supervisor state-fold`. */
export const supervisorStateFoldCommand = defineCommand({
  run: (argv) => runStateFold({ deps: productionStateDocEditDeps(), rest: verbTail({ argv, verbs: ["state-fold"] }) }),
});

/** `slopweaver supervisor state-archive`. */
export const supervisorStateArchiveCommand = defineCommand({
  run: (argv) =>
    runStateArchive({ deps: productionStateDocEditDeps(), rest: verbTail({ argv, verbs: ["state-archive"] }) }),
});
