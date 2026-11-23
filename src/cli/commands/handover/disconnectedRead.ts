/**
 * The secrets-store read behind the reconcile-time disconnected-integration hold —
 * `../../../handover/integrationNeeds.ts` is the pure judgement; this module only lists the store and says which
 * rows rank where the fill seats from.
 *
 * ## An unread store is stated, and the rows are offered unchecked
 *
 * A store that will not list holds nothing: holding every row that declares a need because one `readdir` failed
 * would starve the ready set on an outage. The line says so, so the zero is never silent — the same stance
 * `./trunkMovedRead.ts` takes on an unreadable trunk.
 *
 * ## A blank credential file is not a stored credential
 *
 * `tokenFromEnvOrHomeFile` (`src/config.ts`) trims a secret file and answers nothing for a blank one, so a file
 * that stands but is blank connects nothing and the hold keeps the row. Only a file one of
 * {@link INTEGRATIONS}' credential sets names is opened, tested for blankness and its value dropped on the spot —
 * never kept, never printed. The open is non-blocking and the type is read off the descriptor, so a non-regular
 * entry is never read from and a FIFO never stalls `reconcile`.
 */

import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type DisconnectedRow, disconnectedRowsOf, INTEGRATIONS } from "../../../handover/integrationNeeds.js";
import { SecretsErrors } from "../../../secrets/errors.js";
import { listSecretFileNames } from "../../../secrets/listing.js";
import { secretFilePath } from "../../../stateHome.js";
import { rankedSectionOf } from "./reconcileStanding.js";

/** The disconnected-integration hold: the rows it held by doc path, or why the secrets store would not list. */
export interface DisconnectedRead {
  readonly held: ReadonlyMap<string, DisconnectedRow>;
  /** Why the store could not be listed or read; every row is then offered unchecked, never held on a guess. */
  readonly unread: string | undefined;
}

/** Every credential file name an integration's credential sets name — the only files this read ever opens. */
const NEEDED_NAMES: ReadonlySet<string> = new Set(INTEGRATIONS.flatMap((spec) => spec.credentialSets.flat()));

/**
 * The names an integration needs whose file holds a non-blank value, each value discarded once tested.
 *
 * Each needed name is opened at ITS OWN path, exactly as the credential reader opens it, never matched against
 * the listing's spellings: on a case-insensitive volume a file listed as `FATHOM-API-KEY` is what the reader
 * opens as `fathom-api-key`, and an exact match over the listing would hold a row the reader calls connected.
 *
 * @param home the state home whose secrets store was listed
 * @returns the names that count as stored, or why one of them could not be read
 */
function storedCredentialNames({ home }: { home: string }): Result<ReadonlySet<string>, string> {
  const stored = new Set<string>();
  for (const name of NEEDED_NAMES) {
    const path = secretFilePath({ home, name });
    try {
      if (holdsNonBlankRegularFile({ path })) {
        stored.add(name);
      }
    } catch (cause) {
      if (!isMissing({ cause })) {
        return err(SecretsErrors.storeUnreadable({ cause, path }).message);
      }
    }
  }
  return ok(stored);
}

/**
 * Whether an open failed because nothing stands at the path — an integration simply not connected.
 *
 * @param cause what `openSync` threw
 * @returns true only for `ENOENT`
 */
function isMissing({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/**
 * Whether a path resolves to a regular file with a non-blank value — judged on the DESCRIPTOR, opened
 * non-blocking, so an entry swapped for a FIFO after the listing is neither read nor waited on.
 *
 * @param path the credential file's full path; a symlink is followed, as the credential reader follows it
 * @returns true only for a regular file whose trimmed content is non-blank
 */
function holdsNonBlankRegularFile({ path }: { path: string }): boolean {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      return false;
    }
    return readFileSync(fd, "utf8").trim().length > 0;
  } finally {
    closeSync(fd);
  }
}

/**
 * Which rows ranking in `RUN NOW` need an integration this install stores no credential for — a needed file
 * counting as stored only when it holds a non-blank value, which is never kept.
 *
 * A row is read by the section it RANKS in ({@link rankedSectionOf}), so a parked standing-session seat lifted to
 * `RUN NOW` is held exactly as a composed `RUN NOW` row is.
 *
 * @param models the composed board
 * @param home the state home whose secrets store is listed
 * @param nowIso the instant a standing-session ruling's bound is judged against
 * @returns the held rows, or an empty hold and why the store would not list or read
 */
export function readDisconnected({
  models,
  home,
  nowIso,
}: {
  models: readonly BoardModel[];
  home: string;
  nowIso: string;
}): DisconnectedRead {
  const listed = listSecretFileNames({ home });
  if (listed.isErr()) {
    return { held: new Map(), unread: listed.error.message };
  }
  const stored = storedCredentialNames({ home });
  if (stored.isErr()) {
    return { held: new Map(), unread: stored.error };
  }
  const ranksRunNow = (model: BoardModel): boolean =>
    rankedSectionOf({ model, nowIso, trunkMoved: false }).section === "RUN NOW";
  return { held: disconnectedRowsOf({ models, ranksRunNow, stored: stored.value }), unread: undefined };
}
