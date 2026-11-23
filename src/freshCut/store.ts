/**
 * Where a fresh cut's record and its verifications live: `$home/fresh-cuts/<record-id>/`, owner-only. The record is
 * written once, after every check on the new repository passed; each verification adds a report beside it and never
 * rewrites the record.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { type FreshCutRecord, type FreshCutVerification, freshCutRecordSchema } from "./core.js";
import { type FreshCutError, FreshCutErrors } from "./errors.js";

/** Directories this store makes: owner-only, since a report names the files a private term sits in. */
const DIRECTORY_MODE = 0o700;

/** Files this store writes: owner-only, for the same reason. */
const FILE_MODE = 0o600;

/**
 * The directory one cut's record and reports sit in.
 *
 * @param home the state home
 * @param recordId the cut's id
 * @returns the absolute directory
 */
function freshCutDirectory({ home, recordId }: { home: string; recordId: string }): string {
  return join(stateHomePaths({ home }).freshCuts, recordId);
}

/**
 * Write a cut's record, owner-only and atomically.
 *
 * @param home the state home
 * @param record what `produce` returned once every check on the new repository passed
 * @returns the path written, or why it could not be
 */
export function writeFreshCutRecord({
  home,
  record,
}: {
  home: string;
  record: FreshCutRecord;
}): Result<string, FreshCutError> {
  const path = join(freshCutDirectory({ home, recordId: record.recordId }), "record.json");
  return writeOwnerOnly({ path, text: `${JSON.stringify(record, null, 2)}\n` });
}

/**
 * Read and validate a cut's record. A missing, unparseable or malformed record refuses: a verification of a cut
 * nobody can say the origin of is not one.
 *
 * @param home the state home
 * @param recordId the cut's id, as `fresh-cut produce` printed it
 * @returns the record, or why it could not be read
 */
export function readFreshCutRecord({
  home,
  recordId,
}: {
  home: string;
  recordId: string;
}): Result<FreshCutRecord, FreshCutError> {
  const path = join(freshCutDirectory({ home, recordId }), "record.json");
  let json: unknown;
  try {
    // One small record this store wrote itself, so a whole-file parse is bounded by the schema below.
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return err(FreshCutErrors.recordUnreadable({ path, why: error instanceof Error ? error.message : String(error) }));
  }
  const parsed = freshCutRecordSchema.safeParse(json);
  if (!parsed.success || parsed.data.recordId !== recordId) {
    return err(FreshCutErrors.recordUnreadable({ path, why: "it is not a fresh-cut record for that id" }));
  }
  return ok(parsed.data);
}

/**
 * Write one verification's report beside its record, named for the instant it ran.
 *
 * @param home the state home
 * @param verification the finished verification
 * @returns the path written, or why it could not be
 */
export function writeFreshCutVerification({
  home,
  verification,
}: {
  home: string;
  verification: FreshCutVerification;
}): Result<string, FreshCutError> {
  const stamp = verification.verifiedAtIso.replaceAll(":", "-");
  const path = join(freshCutDirectory({ home, recordId: verification.recordId }), `verify-${stamp}.json`);
  return writeOwnerOnly({ path, text: `${JSON.stringify(verification, null, 2)}\n` });
}

/**
 * Write one owner-only file atomically.
 *
 * @param path the file
 * @param text its contents
 * @returns the path, or why it could not be written
 */
function writeOwnerOnly({ path, text }: { path: string; text: string }): Result<string, FreshCutError> {
  try {
    writeFileAtomic({ contents: text, dirMode: DIRECTORY_MODE, exactMode: true, fileMode: FILE_MODE, path });
    return ok(path);
  } catch (error) {
    return err(
      FreshCutErrors.recordWriteFailed({ cause: error instanceof Error ? error.message : String(error), path }),
    );
  }
}
