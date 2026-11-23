/**
 * The owner-only JSON file a user-consent grant lives in — read, written and removed the same way whichever
 * provider issued it.
 *
 * A grant is not the one-line shape every static connector token is (`src/secrets/store.ts`): it is a
 * credential plus the scopes actually approved, the account it bound to, and a cache rewritten on every
 * refresh. So it gets its own `0600` JSON file under the `0700` `secrets/` directory. What the file holds is
 * the PROVIDER's business — Google's refresh token (`googleGrant.ts`), Microsoft's serialized MSAL cache
 * (`outlookGrant.ts`) — and each passes its own structural guard. What is the same for both, and lives here
 * once, is the file's lifecycle: a missing file is "not connected", an unparseable one is corruption, and
 * both modes are re-tightened on every write.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicStream } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import { type SecretsError, SecretsErrors } from "./errors.js";

/**
 * Whether the path itself names a directory entry, without following a symlink to its target. An entry that
 * cannot be inspected (macOS answers EACCES for a link carrying a deny-readattr ACL) counts as present, so the
 * caller reports the failed read rather than throwing or reading a grant still on disk as never connected.
 */
function entryExists({ path }: { path: string }): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/**
 * Read one door's stored grant off disk.
 *
 * @param path the grant file to read
 * @param productName how the door names itself in a failure
 * @param connectVerb the command a corrupt-grant message tells the operator to re-run
 * @param isGrant the provider's structural guard for its own grant shape
 * @returns the stored grant, `undefined` when the door has never been connected, or why a stored one is unusable
 */
export function readGrantFile<G>({
  path,
  productName,
  connectVerb,
  isGrant,
}: {
  path: string;
  productName: string;
  connectVerb: string;
  isGrant: (value: unknown) => value is G;
}): Result<G | undefined, SecretsError> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    // A missing file is `undefined` rather than an error, because "not connected yet" is an ordinary
    // state every verb reports in its own voice. Only ENOENT is absence: a grant that exists and cannot be
    // read (a permission or I/O failure) is an error, or `--disconnect` would report a grant still on disk
    // as already gone. A file that exists and will not parse is an error too, because that is corruption.
    // ENOENT also answers a symlink whose target is gone, so absence is confirmed on the path's own entry.
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (missing && !entryExists({ path })) {
      return ok(undefined);
    }
    return err(SecretsErrors.grantFileFailed({ action: "read", cause: error, path, productName }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    return err(SecretsErrors.grantJsonInvalid({ cause: error, productName }));
  }
  if (!isGrant(parsed)) {
    return err(SecretsErrors.grantShapeInvalid({ connectVerb, productName }));
  }
  return ok(parsed);
}

/**
 * Persist a grant owner-only, re-tightening both modes on every write.
 *
 * @param home the state home whose `secrets/` directory receives the file
 * @param path where the grant is written
 * @param productName how the door names itself in a failure
 * @param grant the provider's grant, serialised as it stands
 * @returns the path written, or why the write did not happen
 */
export function writeGrantFile({
  home,
  path,
  productName,
  grant,
}: {
  home: string;
  path: string;
  productName: string;
  grant: object;
}): Result<string, SecretsError> {
  const dir = stateHomePaths({ home }).secrets;
  try {
    // A mode is umask-masked on create and never tightens an existing file, so both are re-tightened
    // explicitly on every overwrite rather than trusted from the first write.
    mkdirSync(dir, { mode: 0o700, recursive: true });
    chmodSync(dir, 0o700);
    // Staged beside the target and renamed over it, so a reader racing a refresh sees the old grant or the new
    // one, never a truncated file it would report as corruption. The staged file is set to exactly 0600 BEFORE
    // the rename, so no umask and no crash between the two leaves the grant at another mode.
    const contents = `${JSON.stringify(grant, undefined, 2)}\n`;
    writeFileAtomicStream({
      exactMode: true,
      fileMode: 0o600,
      path,
      produce: ({ write }) => {
        write({ text: contents });
      },
    });
  } catch (error: unknown) {
    // Writing one and deleting one fail for the same reasons — a permission, a full disk, a directory that
    // is not there — so both answer through one variant naming the act, the door and the path.
    return err(SecretsErrors.grantFileFailed({ action: "write", cause: error, path, productName }));
  }
  return ok(path);
}

/**
 * Delete one door's grant file.
 *
 * @param path the grant file to delete
 * @param productName how the door names itself in a failure
 * @returns the path that went, or why it did not
 */
export function removeGrantFile({
  path,
  productName,
}: {
  path: string;
  productName: string;
}): Result<string, SecretsError> {
  try {
    unlinkSync(path);
  } catch (error: unknown) {
    return err(SecretsErrors.grantFileFailed({ action: "delete", cause: error, path, productName }));
  }
  return ok(path);
}
