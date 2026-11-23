/**
 * The I/O edge the three form-editing verbs share — `sweep-block`, `fold-caps` and `recut` — so each runner is
 * its decision and nothing else.
 *
 * A form is a scratch file one supervisor seat owns, so the write is ATOMIC (a reader never meets half a
 * form) but not concurrency-safe: two writers editing one form at once would lose one edit. That is the
 * single-writer assumption every one of these verbs makes, stated here rather than discovered.
 */
import { readFileSync } from "node:fs";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";

/** Everything a form-editing verb touches outside itself, injected so a test drives the whole verb. */
export interface BriefingFormEditDeps {
  /** Reads one file, or throws. */
  readonly readFile: (args: { path: string }) => string;
  /** Replaces one file atomically, or throws. */
  readonly writeFile: (args: { path: string; text: string }) => void;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read and parse a form file.
 *
 * @param path the form file
 * @param deps the injected reader
 * @returns the parsed JSON, or one line naming the path and what went wrong
 */
export function readFormJson({
  path,
  deps,
}: {
  path: string;
  deps: BriefingFormEditDeps;
}): Result<unknown, BriefingCommandError> {
  try {
    return ok(safeJsonParse({ label: path, text: deps.readFile({ path }) }));
  } catch (error: unknown) {
    return err(BriefingCommandErrors.formUnreadable({ cause: error, path }));
  }
}

/**
 * The text a form is written as: two-space JSON with a trailing newline, as `briefing archive` writes it.
 *
 * `safeJsonStringify` REFUSES a document past its own ceiling by throwing, and an edit can grow a form — a
 * recut substitution is longer than the word it replaces. So the refusal comes back as a `Result` rather than
 * as an exception thrown past the verb's error handling.
 *
 * @param form the form as raw JSON
 * @returns the file's text, or one line naming why it could not be serialised
 */
export function formJsonText({ form }: { form: unknown }): Result<string, BriefingCommandError> {
  try {
    return ok(`${safeJsonStringify({ label: "briefing form", space: 2, value: form })}\n`);
  } catch (error: unknown) {
    return err(BriefingCommandErrors.formNotSerialisable({ cause: error }));
  }
}

/**
 * Run one pure form edit, turning anything it throws into a refusal rather than a crash.
 *
 * The cores walk a form recursively, and a form is a document a caller supplied: nested past the engine's
 * stack it raises a `RangeError` no amount of care inside the walk prevents. A
 * verb that dies on it leaves the operator a stack trace instead of a sentence, so the throw is caught at the
 * one place that can say which file it came from.
 *
 * @param form the form as raw JSON
 * @param edit the pure core to run over it
 * @param path the form's path, for the refusal
 * @returns the core's result, or one line naming the file and what went wrong
 */
export function runFormEdit<T>({
  form,
  edit,
  path,
}: {
  form: unknown;
  edit: (args: { form: unknown }) => T;
  path: string;
}): Result<T, BriefingCommandError> {
  try {
    return ok(edit({ form }));
  } catch (error: unknown) {
    return err(BriefingCommandErrors.formEditFailed({ cause: error, path }));
  }
}

/**
 * Write a form, turning a thrown write into a refusal rather than a crash.
 *
 * @param path where to write
 * @param text the file's text
 * @param deps the injected writer
 * @returns nothing on success, or one line naming the path and what went wrong
 */
export function writeFormText({
  path,
  text,
  deps,
}: {
  path: string;
  text: string;
  deps: BriefingFormEditDeps;
}): Result<void, BriefingCommandError> {
  try {
    deps.writeFile({ path, text });
    return ok(undefined);
  } catch (error: unknown) {
    // The write is a staged file renamed into place, and the durability flush happens AFTER that rename, so a
    // failure here means the file holds either its old bytes or the WHOLE new form — never half of one, and
    // not necessarily the old one. Say so rather than implying nothing was written.
    return err(BriefingCommandErrors.formWriteFailed({ cause: error, path }));
  }
}

/**
 * The real seams: the filesystem, atomically, and the logger.
 *
 * @returns the production dependencies every form-editing verb shares
 */
export function productionFormEditDeps(): BriefingFormEditDeps {
  return {
    readFile: ({ path }) => readFileSync(path, "utf8"),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeFile: ({ path, text }) => {
      writeFileAtomic({ contents: text, path });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
