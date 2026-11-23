/**
 * The ONE reader of a hygiene document under `$SLOPWEAVER_HOME/live/hygiene/` — the other half of
 * `./reportStore.ts`, for a consumer that reports on what the morning rows published rather than re-running
 * them (`skills/automation/reference/hygiene-documents.md`).
 *
 * It hands back the document's bytes validated through the caller's own view, beside the file's mtime,
 * because the contract makes the mtime of the last successful write the document's freshness clock and
 * nothing else. It never judges that freshness: whether a document is too old for its producing row's
 * cadence is the caller's question, asked against the row.
 *
 * Read-only. A failed read changes nothing on disk, and none of its failures is ever an empty document:
 * missing, unreadable and invalid are three typed arms (`./reportReadErrors.ts`) a caller names.
 */
import { readFileSync, statSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { type HygieneDocumentReadError, HygieneDocumentReadErrors } from "./reportReadErrors.js";

/** A document read back, with the instant its last successful write landed. */
export interface HygieneDocumentRead<T> {
  readonly document: T;
  /** The file's mtime — the freshness clock the reader contract names. */
  readonly writtenIso: string;
}

/**
 * The file's mtime, or why it could not be taken.
 *
 * @param path the document to stat
 * @returns the mtime as an ISO instant, or the missing/unreadable refusal
 */
function writtenAt({ path }: { path: string }): Result<string, HygieneDocumentReadError> {
  try {
    return ok(statSync(path).mtime.toISOString());
  } catch (error: unknown) {
    return err(refusalOf({ error, path }));
  }
}

/**
 * A filesystem throw as the arm it is: `ENOENT` is a document never published, anything else unreadable.
 *
 * @param error what the filesystem threw
 * @param path the document it was reading
 * @returns the typed refusal
 */
function refusalOf({ error, path }: { error: unknown; path: string }): HygieneDocumentReadError {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return HygieneDocumentReadErrors.missing({ path });
  }
  const cause = error instanceof Error ? error.message : String(error);
  return HygieneDocumentReadErrors.unreadable({ cause, path });
}

/**
 * Read one JSON hygiene document and validate it through the caller's view.
 *
 * @param path one of `stateHomePaths({ home }).live.hygiene`'s JSON documents
 * @param parse the caller's view over the parsed JSON, which reports every issue it finds
 * @returns the validated document and its mtime, or the typed refusal
 */
export function readHygieneJson<T>({
  path,
  parse,
}: {
  readonly path: string;
  readonly parse: (args: { readonly value: unknown }) => Result<T>;
}): Result<HygieneDocumentRead<T>, HygieneDocumentReadError> {
  return writtenAt({ path }).andThen((writtenIso) => {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error: unknown) {
      return err(refusalOf({ error, path }));
    }
    let value: unknown;
    try {
      value = safeJsonParse({ label: path, text });
    } catch (error: unknown) {
      const why = error instanceof Error ? error.message : String(error);
      return err(HygieneDocumentReadErrors.invalid({ issues: [`not JSON: ${why}`], path }));
    }
    return parse({ value })
      .map((document) => ({ document, writtenIso }))
      .mapErr((issues) => HygieneDocumentReadErrors.invalid({ issues, path }));
  });
}

/**
 * Read one JSON-lines hygiene document line by line and validate it through the caller's view.
 *
 * A zero-byte document is the producer's clean pass, so it reaches the view as no lines at all rather than
 * as a refusal. Blank lines — the terminal newline's empty tail — are dropped before the view sees them. A byte
 * that is not UTF-8 is never repaired into text: the line arrives as a lone U+FFFD, which no view parses, so
 * bytes the producer did not write cannot reproduce a digest of the lines it did.
 *
 * @param path one of `stateHomePaths({ home }).live.hygiene`'s JSON-lines documents
 * @param parse the caller's view over the non-blank lines, which rejects the whole document on one bad line
 * @returns the validated document and its mtime, or the typed refusal
 */
export function readHygieneJsonLines<T>({
  path,
  parse,
}: {
  readonly path: string;
  readonly parse: (args: { readonly lines: readonly string[] }) => Result<T>;
}): Result<HygieneDocumentRead<T>, HygieneDocumentReadError> {
  return writtenAt({ path }).andThen((writtenIso) => {
    const lines: string[] = [];
    try {
      readJsonlLines({
        onLine: ({ line }) => {
          if (line.trim().length > 0) {
            lines.push(line);
          }
        },
        path,
        strictUtf8: true,
      });
    } catch (error: unknown) {
      return err(refusalOf({ error, path }));
    }
    return parse({ lines })
      .map((document) => ({ document, writtenIso }))
      .mapErr((issues) => HygieneDocumentReadErrors.invalid({ issues, path }));
  });
}
