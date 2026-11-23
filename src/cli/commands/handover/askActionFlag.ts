/**
 * Reading `--action` — the one flag that carries a whole JSON document into a lifecycle verb.
 *
 * ## Why a document rather than more flags
 *
 * An action names a draft, who it tags, and two or three destinations each with its own label and
 * trade-off. Spelled as flags that is a dozen of them, several repeated, and `../../parseFlags.ts` keeps
 * values in a `Record<string, string | boolean>` so a flag cannot repeat at all — the same constraint
 * `../../../handover/askShape.ts` records for `--options`. One JSON value is the shape that fits, and it is
 * the shape the journal already stores, so what a caller types is what a card reads.
 *
 * ## Three spellings, and why they cannot be confused
 *
 * `-` reads stdin, a value beginning with `{` is the document itself, and anything else is a path to read.
 * A JSON object always begins with `{`, so no path is ever mistaken for a document and no document is ever
 * mistaken for a path — the ambiguity is closed by the grammar rather than by a flag saying which.
 *
 * ## The SENTENCE comes from the domain; this file only wraps it
 *
 * Every way a document fails is a variant of `../../../handover/askActionInput.ts`'s own union, and the
 * refusal here is one line built off `error.message`. Four sentences authored into this file is the shape
 * `error-shape-threshold` refuses, and it is also how the verb's wording drifts from what a test asserts.
 *
 * ## Every refusal names NOTHING WAS RECORDED
 *
 * Same reason `../../../handover/askShapeGate.ts` ends every line that way: `handover ask` refuses to run
 * twice on a run that is already waiting, so advice to fix the input and re-run is only followable while
 * the journal is still untouched. Every reader here runs BEFORE any append.
 */

import { readFileSync } from "node:fs";

import type { AskAction } from "../../../handover/askAction.js";
import { type AskActionInputError, AskActionInputErrors, actionFromText } from "../../../handover/askActionInput.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { stringFlag } from "./lifecycleRunCore.js";

/** The value that means "read the document from stdin" rather than from a path. */
const STDIN = "-";

/** What a JSON document begins with, and therefore what a path never does. */
const DOCUMENT_PREFIX = "{";

/** The sentence every refusal here ends on, because it is what makes "fix it and re-run" followable. */
const NOTHING_RECORDED =
  "NOTHING was recorded and the run is not paused, so fix the action and run the same command again.";

/**
 * The action this invocation declared, if it declared one.
 *
 * Three outcomes rather than two: `absent` is an ordinary unoffered ask and is not a failure, which a
 * boolean plus a value could not say without the caller re-deriving it.
 *
 * @param parsed this invocation's flags
 * @param command the verb as the caller typed it, which a file-read failure names
 * @param stdin how to read stdin — an injected SEAM so a test drives the `-` spelling without a pipe
 * @returns the action, its absence, or the domain's own typed failure — {@link askActionFlagErrorLines} prints it
 */
export function actionFlag({
  parsed,
  command,
  stdin,
}: {
  parsed: ParsedFlags;
  command: string;
  stdin: () => string;
}): Result<AskAction | undefined, AskActionInputError> {
  const raw = stringFlag({ name: "action", parsed });
  if (raw === undefined) {
    return ok(undefined);
  }
  return actionIn({ command, raw, stdin });
}

/**
 * The two lines a refused `--action` prints: the domain's own sentence under the verb, then that nothing was
 * recorded — the trailer that makes "fix it and re-run" followable.
 *
 * @param command the verb as the caller typed it, which opens the first line
 * @param error what the document reader refused
 * @returns the refusal line and the nothing-recorded line, in that order
 */
export function askActionFlagErrorLines({
  command,
  error,
}: {
  command: string;
  error: AskActionInputError;
}): readonly string[] {
  return [`${command} blocked because ${error.message}.`, NOTHING_RECORDED];
}

/** One `--action` value resolved to a source, read, and judged — the whole path, in the domain's own error. */
function actionIn({
  raw,
  command,
  stdin,
}: {
  raw: string;
  command: string;
  stdin: () => string;
}): Result<AskAction, AskActionInputError> {
  const source = actionSource({ raw, stdin });
  if (source.isErr()) {
    return err(source.error);
  }
  return actionFromText({ label: `${command} --action`, text: source.value });
}

/** The raw text one `--action` value names — stdin, the value itself, or the file it points at. */
function actionSource({ raw, stdin }: { raw: string; stdin: () => string }): Result<string, AskActionInputError> {
  const value = raw.trim();
  if (value === STDIN) {
    return ok(stdin());
  }
  if (value.startsWith(DOCUMENT_PREFIX)) {
    return ok(value);
  }
  const read = safeFs({
    execute: () => readFileSync(value, "utf8"),
    operation: "read --action document",
    path: value,
  });
  if (read.isErr()) {
    return err(AskActionInputErrors.fileUnreadable({ cause: read.error.message, path: value }));
  }
  return ok(read.value);
}

/**
 * Read the whole of stdin — the production seam behind `--action -`.
 *
 * @returns everything piped in, as text
 */
export function readStdinText(): string {
  return readFileSync(0, "utf8");
}
