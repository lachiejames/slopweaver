/**
 * The Codex pass reservation document on disk, `$SLOPWEAVER_HOME/live/codex-pass-reservations.json`: one read and
 * one atomic publish, every fault typed. The lock and the decision around them are `./passReservationStore.ts`'s.
 *
 * Only a file that is genuinely not there reads as the empty version-1 document — absence is the defined initial
 * state. Anything else that will not read is `PASS_RESERVATION_STORE_UNREADABLE`, and a file that reads but does not
 * parse is `PASS_RESERVATION_STORE_MALFORMED`: either holds every limited account out rather than reading as "nothing
 * reserved". Publication is `writeFileAtomic` with an exact `0600`, in a `0700` directory.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type CodexPassReservationDocument, EMPTY_CODEX_PASS_RESERVATIONS } from "./passReservation.js";
import { type CodexPassReservationError, CodexPassReservationErrors } from "./passReservationErrors.js";

/** The document file's mode — owner-only, whatever the umask. */
const CODEX_PASS_RESERVATIONS_FILE_MODE = 0o600;

/** The mode a directory this publish creates takes. */
const DIRECTORY_MODE = 0o700;

const reservationSchema = z
  .object({
    accountIdentities: z.array(z.string().min(1)).min(1),
    accountKey: z.string().min(1),
    acquiredAtIso: z.iso.datetime(),
    destinationAlias: z.string().min(1),
    expiresAtIso: z.iso.datetime(),
    id: z.string().min(1),
    pid: z.number().int().positive(),
    weeklyPoints: z.literal(1),
  })
  .strict();

// A release removes every row carrying its id, so two rows sharing one would let one pass's release erase another
// running pass's hold. A document like that reads as MALFORMED, which holds every limited account out (fail closed).
const documentSchema = z
  .object({ reservations: z.array(reservationSchema), schemaVersion: z.literal(1) })
  .strict()
  .refine((document) => new Set(document.reservations.map((row) => row.id)).size === document.reservations.length, {
    message: "two reservations share one id",
  });

/**
 * Read the document.
 *
 * @param path the document's path, from `stateHomePaths({ home }).live.codexPassReservationsJson`
 * @returns the document — the empty one when no file is there — or the typed fault
 */
export function readCodexPassReservations({
  path,
}: {
  path: string;
}): Result<CodexPassReservationDocument, CodexPassReservationError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (isAbsentError({ error: cause, path })) {
      return ok(EMPTY_CODEX_PASS_RESERVATIONS);
    }
    return err(CodexPassReservationErrors.storeUnreadable({ cause, path }));
  }
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: path, text });
  } catch (cause) {
    return err(CodexPassReservationErrors.storeMalformed({ path, problems: [String(cause)] }));
  }
  return validDocument({ path, raw });
}

/** The document `raw` amounts to under the schema, or MALFORMED naming every problem. */
function validDocument({
  path,
  raw,
}: {
  path: string;
  raw: unknown;
}): Result<CodexPassReservationDocument, CodexPassReservationError> {
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return err(CodexPassReservationErrors.storeMalformed({ path, problems }));
  }
  return ok(parsed.data);
}

/**
 * Publish the document whole, atomically and durably, owner-only. It is held to the same schema a read is — unique
 * ids included — so the store never publishes a document it would itself read as MALFORMED.
 *
 * @param path the document's path
 * @param document what to publish
 * @returns nothing, MALFORMED when the document breaks the schema (nothing written), or the typed write fault — the
 *   previous document then still stands
 */
export function writeCodexPassReservations({
  document,
  path,
}: {
  document: CodexPassReservationDocument;
  path: string;
}): Result<void, CodexPassReservationError> {
  const valid = validDocument({ path, raw: document });
  if (valid.isErr()) {
    return err(valid.error);
  }
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: path, space: 2, value: document })}\n`,
      dirMode: DIRECTORY_MODE,
      exactMode: true,
      fileMode: CODEX_PASS_RESERVATIONS_FILE_MODE,
      path,
    });
  } catch (cause) {
    return err(CodexPassReservationErrors.storeWriteFailed({ cause, path }));
  }
  return ok(undefined);
}
