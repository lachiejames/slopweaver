/**
 * Named byte-offset cursors over the supervisor stream — what makes a reader RESUME rather than replay.
 *
 * One file per name, so the supervisor's sweep and (say) an ad-hoc drain never fight over one position. The
 * name is a FILENAME, so it is validated rather than sanitised: a caller that passes `../../etc/thing` gets a
 * refusal naming the rule, not a cursor written somewhere surprising. Silently rewriting a caller's key is
 * how two different names quietly become one cursor.
 */
import { join } from "node:path";

import { decodeCursorRecord } from "#lib/cursorRecord.js";
import { readFileIfPresent } from "../atlas/atlasFile.js";
import { slopweaverHome } from "../config.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

/** Owner-only, matching the rest of `live/`. */
const DIR_MODE = 0o700;

/** What a cursor name may be: lowercase, digits and hyphens, starting with an alphanumeric, at most 64. */
const CURSOR_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One recorded position: how far a reader got, and when it said so. */
export interface SupervisorEventCursor {
  readonly offset: number;
  /** When it was recorded, for a human; absent on a record that carries only its offset, which a reader still uses. */
  readonly recordedAtIso?: string;
}

/**
 * Where one named cursor lives.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param name the cursor name
 * @returns the absolute path, or the refusal naming why the name is not usable as a filename
 */
export function supervisorEventCursorPath({
  home = slopweaverHome(),
  name,
}: {
  home?: string;
  name: string;
}): Result<string> {
  if (!CURSOR_NAME.test(name)) {
    return err([
      `cursor name ${JSON.stringify(name)} is not usable: lowercase letters, digits and hyphens only, ` +
        "starting with a letter or digit, at most 64 characters",
    ]);
  }
  return ok(join(stateHomePaths({ home }).live.events.cursorsDir, `${name}.json`));
}

/** The cursor name is not usable as a filename. */
export interface SupervisorCursorNameUnusableError {
  readonly code: "CURSOR_NAME_UNUSABLE";
  readonly message: string;
}

/** The cursor file is there but cannot be believed. */
export interface SupervisorCursorUntrustedError {
  readonly code: "CURSOR_UNTRUSTED";
  readonly message: string;
  readonly path: string;
}

/** Why a named cursor could not be read. */
export type SupervisorCursorReadError = SupervisorCursorNameUnusableError | SupervisorCursorUntrustedError;

/** The one factory for every {@link SupervisorCursorReadError}. */
export const SupervisorCursorErrors = {
  nameUnusable: ({ reasons }: { reasons: readonly string[] }): SupervisorCursorNameUnusableError => ({
    code: "CURSOR_NAME_UNUSABLE",
    message: reasons.join("; "),
  }),
  untrusted: ({ path, detail }: { path: string; detail: string }): SupervisorCursorUntrustedError => ({
    code: "CURSOR_UNTRUSTED",
    message:
      `the supervisor stream cursor at ${path} is there but cannot be trusted (${detail}) — delete it to read ` +
      "the stream from the start, or pass --since <offset>",
    path,
  }),
} as const;

/** The one refusal for a cursor file that is there but cannot be believed. */
function untrusted({ path, detail }: { path: string; detail: string }): Result<never, SupervisorCursorReadError> {
  return err(SupervisorCursorErrors.untrusted({ detail, path }));
}

/**
 * Read a named cursor.
 *
 * A cursor never recorded is `undefined`. One that is there but unreadable or malformed is refused rather
 * than read the same way: a silent rewind to offset 0 re-delivers the whole stream as new, and a reader
 * cannot tell that replay from a real burst — the same choice `cmux/eventState/` makes.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param name the cursor name
 * @returns the cursor, `undefined` when none is recorded, or the refusal naming an unusable name or file
 */
export function readSupervisorEventCursor({
  home = slopweaverHome(),
  name,
}: {
  home?: string;
  name: string;
}): Result<SupervisorEventCursor | undefined, SupervisorCursorReadError> {
  return supervisorEventCursorPath({ home, name })
    .mapErr((reasons) => SupervisorCursorErrors.nameUnusable({ reasons }))
    .andThen((path): Result<SupervisorEventCursor | undefined, SupervisorCursorReadError> => {
      const text = readFileIfPresent({ path });
      if (text.isErr()) {
        return untrusted({ detail: text.error.join("; "), path });
      }
      if (text.value === null) {
        return ok(undefined);
      }
      const record = decodeCursorRecord({ positionKey: "offset", text: text.value });
      if (record.isErr()) {
        return untrusted({ detail: record.error.join("; "), path });
      }
      const { position: offset, recordedAtIso } = record.value;
      return ok(recordedAtIso === undefined ? { offset } : { offset, recordedAtIso });
    });
}

/**
 * Record how far a reader got, atomically (temp file plus rename).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param name the cursor name
 * @param nowIso the instant to stamp
 * @param offset the byte offset consumed up to
 * @returns ok, or the refusal naming the unusable name or the write failure
 */
export function writeSupervisorEventCursor({
  home = slopweaverHome(),
  name,
  nowIso,
  offset,
}: {
  home?: string;
  name: string;
  nowIso: string;
  offset: number;
}): Result<void> {
  return supervisorEventCursorPath({ home, name }).andThen((path) => {
    try {
      writeFileAtomic({
        contents: `${JSON.stringify({ offset, recordedAtIso: nowIso } satisfies SupervisorEventCursor)}\n`,
        dirMode: DIR_MODE,
        path,
      });
    } catch (error: unknown) {
      return err([`could not record the supervisor stream cursor at ${path}: ${String(error)}`]);
    }
    return ok(undefined);
  });
}
