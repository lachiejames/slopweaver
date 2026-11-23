/**
 * The directory-bronze persistence edge: `corpus/directory/google-admin.jsonl`, one row per Google
 * Workspace user, REPLACED whole on every pull rather than appended.
 *
 * ## Why a snapshot and not an append-only log
 *
 * Member bronze appends, and its own header names the cost: an unchanged member writes nothing, so an
 * absent member is indistinguishable from an unchanged one and nothing can ever say "this person left".
 * The directory is the roster — the one list where absence IS information — and Google returns it whole in
 * two pages. So a pull writes the whole list atomically, and a person Google no longer lists is simply not
 * in the file. Nothing downstream deletes on that (the rule: nobody is forgotten); it is what
 * lets `google_id` go null while the person, their email and their history stay.
 *
 * Every filesystem call goes through a `safe*` wrapper (typed {@link ../../lib/ingestError.IngestError}).
 */
import { join } from "node:path";

import { slopweaverHome } from "../../config.js";
import { parseJsonObject } from "../../lib/jsonParse.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { writeFileAtomicStream } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { readJsonlRows } from "../corpusStore.js";

import type { DirectoryUserRow } from "./types.js";

/**
 * The directory bronze file for Google Workspace Admin.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute JSONL path
 */
export function googleDirectoryFile({ home = slopweaverHome() }: { home?: string } = {}): string {
  return join(stateHomePaths({ home }).corpus.directory, "google-admin.jsonl");
}

/**
 * Whether an untyped value is a string, for the optional fields below.
 *
 * @param value the field
 * @returns whether it is a string
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Parse one JSONL line into a directory row, or say why the line was rejected.
 *
 * @param line the raw line
 * @returns the row, or the reason
 */
export function parseDirectoryRow({ line }: { line: string }): { row: DirectoryUserRow } | { error: string } {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return { error: parsed.error.message };
  }
  const entry = parsed.value;
  const googleId = entry["googleId"];
  const primaryEmail = entry["primaryEmail"];
  const emailNormalised = entry["emailNormalised"];
  const fullName = entry["fullName"];
  const fetchedAtIso = entry["fetchedAtIso"];
  const aliases = entry["aliases"];
  if (
    entry["version"] !== 1 ||
    !isString(googleId) ||
    !isString(primaryEmail) ||
    !isString(emailNormalised) ||
    !isString(fullName) ||
    !isString(fetchedAtIso) ||
    !Array.isArray(aliases) ||
    typeof entry["suspended"] !== "boolean" ||
    typeof entry["archived"] !== "boolean" ||
    typeof entry["isAdmin"] !== "boolean"
  ) {
    return { error: "not a version-1 directory row" };
  }
  const optional = ({ key }: { key: string }): Record<string, string> =>
    isString(entry[key]) ? { [key]: entry[key] } : {};
  return {
    row: {
      aliases: aliases.filter(isString),
      archived: entry["archived"],
      emailNormalised,
      fetchedAtIso,
      fullName,
      googleId,
      isAdmin: entry["isAdmin"],
      primaryEmail,
      raw: isRecord(entry["raw"]) ? entry["raw"] : {},
      suspended: entry["suspended"],
      version: 1,
      ...optional({ key: "givenName" }),
      ...optional({ key: "familyName" }),
      ...optional({ key: "orgUnitPath" }),
      ...optional({ key: "title" }),
      ...optional({ key: "creationIso" }),
      ...optional({ key: "lastLoginIso" }),
    },
  };
}

/**
 * Read the stored directory (absent file ⇒ empty, never a throw).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the rows and their line-numbered parse warnings
 */
export function readGoogleDirectory({ home = slopweaverHome() }: { home?: string } = {}): {
  rows: readonly DirectoryUserRow[];
  warnings: readonly string[];
} {
  const path = googleDirectoryFile({ home });
  const read = readJsonlRows<DirectoryUserRow>({ parseLine: parseDirectoryRow, path });
  if (read.isErr()) {
    return read.error.code === "ENOENT" ? { rows: [], warnings: [] } : { rows: [], warnings: [read.error.message] };
  }
  return read.value;
}

/**
 * Replace the stored directory with this pull's rows, atomically.
 *
 * @param rows every user the pull returned
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns how many rows were written, or a typed io error
 */
export function writeGoogleDirectory({
  rows,
  home = slopweaverHome(),
}: {
  rows: readonly DirectoryUserRow[];
  home?: string;
}): Result<{ written: number }> {
  const path = googleDirectoryFile({ home });
  const wrote = safeFs({
    execute: () => {
      writeFileAtomicStream({
        path,
        produce: ({ write }) => {
          for (const row of rows) {
            write({ text: `${JSON.stringify(row)}\n` });
          }
        },
      });
    },
    operation: "writeGoogleDirectory",
    path,
  });
  return wrote.isErr() ? err([wrote.error.message]) : ok({ written: rows.length });
}
