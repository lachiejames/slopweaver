/**
 * The three files a checkout before the store kept under `$SLOPWEAVER_HOME/org-health/`, READ for their one-time
 * import into the store (`./storePort.ts`) and never written. No writer and no projection lives here: once a store
 * row exists, nothing reads these files again.
 *
 * Each read refuses a file it cannot trust rather than importing part of it. A malformed snapshot or sightings file
 * imports nothing, so it can be repaired and the import retried; a ledger with a line that will not read imports
 * nothing either, since the newest press for an incident may be that very line.
 */
import { createHash } from "node:crypto";
import { lstatSync, type Stats } from "node:fs";

import { parseJson } from "#lib/jsonParse.js";
import { readStrictFileIfPresent } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";

import { type AcknowledgementRow, acknowledgementRowOf } from "./acknowledgement.js";
import { type AcknowledgementError, AcknowledgementErrors } from "./acknowledgementErrors.js";
import { type OrgHealthError, OrgHealthErrors } from "./errors.js";
import type { IncidentSightings } from "./sightings.js";
import { decodeIncidentSightings, decodeIncidentSnapshot } from "./snapshot.js";
import type { IncidentSnapshot } from "./types.js";

/** One press the legacy ledger held, with the id its import stores it under. */
export interface FileAcknowledgement {
  /** `legacy-v1:<sha256 of line number, NUL, raw line>` — the same line imported twice is the same row. */
  readonly id: string;
  readonly row: AcknowledgementRow;
}

/**
 * Read and decode one legacy JSON file with a codec.
 *
 * @param path the file
 * @param operation names the read in a refusal
 * @param decode the file's codec
 * @returns the decoded value, `undefined` with no file, or why the file there cannot be trusted
 */
function readImportJson<T>({
  path,
  operation,
  decode,
}: {
  path: string;
  operation: string;
  decode: (args: { value: unknown }) => Result<T>;
}): Result<T | undefined, OrgHealthError> {
  const read = readStrictFileIfPresent({ operation, path });
  if (read.isErr()) {
    return err(OrgHealthErrors.fileUnreadable({ detail: read.error.message, path }));
  }
  if (read.value === null) {
    return ok(undefined);
  }
  const parsed = parseJson({ text: read.value });
  if (parsed.isErr()) {
    return err(OrgHealthErrors.fileMalformed({ detail: parsed.error.message, path }));
  }
  const decoded = decode({ value: parsed.value });
  if (decoded.isErr()) {
    return err(OrgHealthErrors.fileMalformed({ detail: decoded.error.join("; "), path }));
  }
  return ok(decoded.value);
}

/**
 * The `incidents.json` a checkout before the store wrote, read for its one-time import.
 *
 * @param home the Slopweaver home
 * @returns the snapshot, `undefined` when no file is there, or why the file there cannot be trusted
 */
export function readSnapshotImportFile({
  home,
}: {
  home: string;
}): Result<IncidentSnapshot | undefined, OrgHealthError> {
  return readImportJson({
    decode: decodeIncidentSnapshot,
    operation: "org-health-snapshot",
    path: stateHomePaths({ home }).orgHealthIncidentsJson,
  });
}

/**
 * The `sightings.json` a checkout before the store wrote, read for its one-time import.
 *
 * @param home the Slopweaver home
 * @returns the sightings, `undefined` when no file is there — a memory to SEED, never an empty one — or why the file
 *   there cannot be trusted
 */
export function readSightingsImportFile({
  home,
}: {
  home: string;
}): Result<IncidentSightings | undefined, OrgHealthError> {
  return readImportJson({
    decode: decodeIncidentSightings,
    operation: "org-health-sightings",
    path: stateHomePaths({ home }).orgHealthSightingsJson,
  });
}

/**
 * What sits at the ledger's path, judged WITHOUT following a link. Only a path with nothing at all on it is a ledger
 * never written; a symlink (a dangling one included), a directory or any other entry is a ledger that cannot be
 * trusted, so its import refuses.
 *
 * @returns `absent`, `file`, or why the entry there is not a ledger
 */
function ledgerEntry({ path }: { path: string }): Result<"absent" | "file", AcknowledgementError> {
  let stats: Stats | undefined;
  try {
    stats = lstatSync(path, { throwIfNoEntry: false });
  } catch (cause) {
    return err(AcknowledgementErrors.ledgerIo({ cause, path }));
  }
  if (stats === undefined) {
    return ok("absent");
  }
  if (!stats.isFile()) {
    return err(AcknowledgementErrors.ledgerIo({ cause: new Error("it is not a regular file"), path }));
  }
  return ok("file");
}

/**
 * The id one legacy line is imported under: deterministic, so two importers name it alike, and distinct for the same
 * press written on two lines.
 *
 * @param line the 1-based line number
 * @param raw the line exactly as the file held it
 * @returns the id
 */
export function fileAcknowledgementId({ line, raw }: { line: number; raw: string }): string {
  return `legacy-v1:${createHash("sha256")
    .update(`${String(line)}\0${raw}`, "utf8")
    .digest("hex")}`;
}

/**
 * The `acknowledgements.jsonl` a checkout before the store appended, read WHOLE for its one-time import: every press
 * in file order, or a refusal when any non-blank line will not read. A home where the owner never acknowledged an incident
 * reads as an empty ledger, not a failure.
 *
 * @param home the Slopweaver home
 * @returns every press in file order, or why the ledger cannot be trusted whole
 */
export function readAcknowledgementsImportFile({
  home,
}: {
  home: string;
}): Result<readonly FileAcknowledgement[], AcknowledgementError> {
  const path = stateHomePaths({ home }).orgHealthAcknowledgementsJsonl;
  const entry = ledgerEntry({ path });
  if (entry.isErr()) {
    return err(entry.error);
  }
  if (entry.value === "absent") {
    return ok([]);
  }
  const rows: FileAcknowledgement[] = [];
  const unreadable: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim() === "") {
          return;
        }
        let row: AcknowledgementRow | undefined;
        try {
          row = acknowledgementRowOf({ value: safeJsonParse({ label: "incident acknowledgement", text: line }) });
        } catch {
          row = undefined;
        }
        if (row === undefined) {
          unreadable.push(index + 1);
        } else {
          rows.push({ id: fileAcknowledgementId({ line: index + 1, raw: line }), row });
        }
      },
      path,
    });
  } catch (cause) {
    return err(AcknowledgementErrors.ledgerIo({ cause, path }));
  }
  if (unreadable.length > 0) {
    const cause = new Error(`${String(unreadable.length)} line(s) did not read (${unreadable.join(", ")})`);
    return err(AcknowledgementErrors.ledgerIo({ cause, path }));
  }
  return ok(rows);
}
