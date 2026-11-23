/**
 * Which file NAMES stand in `$SLOPWEAVER_HOME/secrets` — the read a caller needs when the only question is
 * which credentials this install holds, never what any of them says.
 *
 * `secrets status` has its own reader (`src/cli/commands/secrets/statusRun.ts` § readStore), and it is the wrong
 * one for a monitor for two reasons. It answers an EMPTY store on every `readdir` failure, so a directory that
 * could not be read — EACCES, or a `secrets` path that is a file — reads exactly like an install that connected
 * nothing, which is the `clear`-versus-`unmeasurable` conflation `src/monitor/types.ts` exists to forbid. And it
 * opens grant JSON, which a caller asking only for names has no business doing. So this lister opens no file at
 * all, and separates the one absence that is an ordinary state from every other failure:
 *
 *  - **no `secrets/` directory** is an empty store — an install that has connected nothing yet;
 *  - **any other failure** is a typed {@link SecretsError}, never an empty list.
 *
 * The effectful edge only: `readdir` and `stat`, exercised by a temp-dir round trip rather than a mock.
 */
import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { type SecretsError, SecretsErrors } from "./errors.js";

/**
 * Whether a thrown filesystem error says the path is simply not there.
 *
 * @param cause what `readdirSync` or `statSync` threw
 * @returns true only for `ENOENT`
 */
function isMissing({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/**
 * Whether NOTHING stands at a path itself — `lstat` never follows a link, so a dangling one is still there.
 *
 * `stat` and `readdir` answer `ENOENT` both when a path is not there and when it is a link whose target is gone
 * (an unmounted volume). Only the first is an absence; read the second as one and every open card settles as
 * cleared over a store nobody listed. Any other `lstat` failure
 * is not proof of absence either, so it answers false and the caller reports the store unreadable.
 *
 * @param path the path to test
 * @returns true only when `lstat` itself says there is no entry
 */
function isGone({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (cause) {
    return isMissing({ cause });
  }
}

/**
 * Whether the home the store would sit in is a directory this read can see — so a missing `secrets/` beneath it
 * is an install that connected nothing, rather than a home that is itself a dangling link or sits under one.
 *
 * @param home the Slopweaver home
 * @returns true when `stat` resolves it to a directory
 */
function homeStands({ home }: { home: string }): boolean {
  try {
    return statSync(home).isDirectory();
  } catch {
    return false;
  }
}

/**
 * What one listed entry is: a regular file, something else, or gone since the listing.
 *
 * A `stat` that fails any other way — a link inside the store whose target is gone included — is a store this
 * read could not see whole, so it is an error rather than a shorter list.
 *
 * @param path the entry's full path
 * @returns its kind, or why it could not be seen
 */
function entryKind({ path }: { path: string }): Result<"file" | "other" | "gone", SecretsError> {
  try {
    return ok(statSync(path).isFile() ? "file" : "other");
  } catch (cause) {
    // Vanished since the listing: not there. A link whose target is gone IS there, and cannot be seen.
    if (isMissing({ cause }) && isGone({ path })) {
      return ok("gone");
    }
    return err(SecretsErrors.storeUnreadable({ cause, path }));
  }
}

/**
 * List the regular files standing in the secrets store, by name, in name order — never opening one.
 *
 * A directory entry that vanished between the listing and its `stat` is left out, and so is anything that is
 * not a regular file, which is not a credential; an entry that could not be seen is an error ({@link entryKind}).
 *
 * @param home the Slopweaver home whose `secrets/` directory to list
 * @returns every regular file's name, an empty list when there is no `secrets/` directory, or why the store
 *   could not be listed
 */
export function listSecretFileNames({ home }: { home: string }): Result<readonly string[], SecretsError> {
  const dir = stateHomePaths({ home }).secrets;
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    const noStore = isMissing({ cause }) && isGone({ path: dir }) && homeStands({ home });
    if (noStore) {
      return ok([]);
    }
    return err(SecretsErrors.storeUnreadable({ cause, path: dir }));
  }
  const names: string[] = [];
  for (const name of entries) {
    const kind = entryKind({ path: join(dir, name) });
    if (kind.isErr()) {
      return err(kind.error);
    }
    if (kind.value === "file") {
      names.push(name);
    }
  }
  return ok(names.toSorted());
}
