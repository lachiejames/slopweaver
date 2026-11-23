/**
 * The `judgement/owner-directives.json` home-file decoder: the one file the owner-judgement store imports once
 * and never reads again (`../store/registerImport.ts`, register `owner-judgement`).
 *
 * Read only when no import marker exists. Strict, and every refusal writes nothing: a file that will not read or
 * decode is `OWNER_DIRECTIVE_HOME_FILE_UNREADABLE`, and a well-formed one at a version this build does not read is
 * `OWNER_DIRECTIVE_HOME_FILE_OUTDATED` — kept apart because the recovery differs (an outdated file is moved aside
 * and re-recorded from its memories; corrupt bytes are never overwritten). A present file parses through the same
 * {@link parseOwnerDirectiveOverlay} an export's directives part decodes with, so what is imported is exactly what
 * the file's reader answered and the export fingerprint does not move.
 */
import { readStrictFileIfPresent } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { parseJson } from "../lib/jsonParse.js";
import { isRecord } from "../lib/parsers.js";
import { stateHomePaths } from "../stateHome.js";
import type { ImportSource } from "../store/registerImport.js";

import { type OwnerDirectiveError, OwnerDirectiveErrors } from "./ownerDirective.errors.js";
import { OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION, parseOwnerDirectiveOverlay } from "./ownerDirective.js";
import { importRecordsOf, type OwnerJudgementRecord } from "./ownerJudgementRecords.js";

/**
 * Decode the home file's text into the import's records. Pure.
 *
 * @param path the file, named in every refusal
 * @param text what the file held
 * @returns every directive and correction it holds, or why it imports nothing
 */
export function decodeHomeFileOwnerJudgement({
  path,
  text,
}: {
  path: string;
  text: string;
}): Result<ImportSource<OwnerJudgementRecord>, OwnerDirectiveError> {
  const decoded = parseJson({ text });
  if (decoded.isErr()) {
    return err(OwnerDirectiveErrors.homeFileUnreadable({ path, reason: "it is not valid JSON" }));
  }
  const parsed = parseOwnerDirectiveOverlay({ value: decoded.value });
  if (parsed.isOk()) {
    return ok({ records: importRecordsOf({ overlay: parsed.value }), state: "present" });
  }
  // Decoded cleanly and carries a version number this build does not read: recoverable, not corrupt.
  const version = isRecord(decoded.value) ? decoded.value["schemaVersion"] : undefined;
  if (typeof version === "number" && version !== OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION) {
    return err(OwnerDirectiveErrors.homeFileOutdated({ path, reads: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION, version }));
  }
  return err(OwnerDirectiveErrors.homeFileUnreadable({ path, reason: parsed.error.message }));
}

/**
 * Read the home file for its one-time import.
 *
 * @param home the Slopweaver home it lived under
 * @returns its records, `absent` when the home holds no file, or why it imports nothing
 */
export function readHomeFileOwnerJudgement({
  home,
}: {
  home: string;
}): Result<ImportSource<OwnerJudgementRecord>, OwnerDirectiveError> {
  const path = stateHomePaths({ home }).judgement.ownerDirectivesJson;
  const read = readStrictFileIfPresent({ operation: "read the home file's owner directives for their import", path });
  if (read.isErr()) {
    return err(OwnerDirectiveErrors.homeFileUnreadable({ path, reason: read.error.message }));
  }
  if (read.value === null) {
    return ok({ state: "absent" });
  }
  return decodeHomeFileOwnerJudgement({ path, text: read.value });
}
