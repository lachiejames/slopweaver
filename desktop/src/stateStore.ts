/**
 * Read and write the shell's saved state (`persistedState.ts`) as one JSON file in Electron's `userData`.
 * A missing file is a first launch, not a failure; anything else that goes wrong is a typed error the menu bar
 * shows. Writes are atomic and synchronous: a sibling temporary file, then a rename, so a crash mid-write leaves the
 * old state and no two writes ever interleave.
 */
import { renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { err, ok, type Result, ResultAsync } from "neverthrow";

import { type StateError, StateErrors } from "./errors";
import { decodePersistedState, FRESH_STATE, type PersistedState } from "./persistedState";

/**
 * The saved state, or {@link FRESH_STATE} on a first launch.
 *
 * @param path the state file
 * @returns the state, or why the file there could not be used
 */
export function readPersistedState({ path }: { path: string }): ResultAsync<PersistedState, StateError> {
  return ResultAsync.fromPromise(
    readFile(path, "utf8").then(
      (text): string | undefined => text,
      (cause: unknown) => {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return undefined;
        }
        throw cause;
      },
    ),
    (cause) => StateErrors.unreadable({ detail: cause instanceof Error ? cause.message : String(cause) }),
  ).andThen((text) => {
    if (text === undefined) {
      return ok(FRESH_STATE);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return err(StateErrors.malformed({ field: "the file (not JSON)" }));
    }
    return decodePersistedState({ value });
  });
}

/**
 * Save the state atomically, and before returning. Synchronous on purpose: an asynchronous write still pending when
 * the app quits is never finished, and two in flight can land out of order, an older state over a newer one — a
 * Not now lost either way. The file is a few hundred bytes, so blocking the main process for it costs nothing felt.
 * It is handed to the OS, not fsynced: a quit is covered, a power cut straight after is not, and costs at most the
 * guide asking once more.
 *
 * @param path the state file
 * @param state what to save
 * @returns nothing once it is renamed into place, or why it could not be written
 */
export function writePersistedState({
  path,
  state,
}: {
  path: string;
  state: PersistedState;
}): Result<void, StateError> {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
    return ok(undefined);
  } catch (cause) {
    return err(StateErrors.unwritable({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
}
