/**
 * The filesystem edge of `store authored-show --out`, `store authored-restore` and the two measurement verbs that
 * write (`measurement-show --out`, `measurement-restore`): every write they make, and the one hash each reads to
 * decide whether a path is already there. A sanctioned local-state seam
 * (`src/admit/sanctionedSeams.ts`) — nothing here reaches a provider.
 *
 * ## Restore can never overwrite, and never write outside the home
 *
 * `planAuthoredRestore` (`./authoredFile.ts`) writes only paths it found absent, but a path can appear between
 * that plan and the write, and a symbolic link under the home can point anywhere. So {@link createAuthoredFile}
 * is an exclusive create (`wx`, O_CREAT|O_EXCL, which fails on a dangling link as well), and both the nearest
 * directory that already exists and the one it lands in must resolve inside the home — the first checked BEFORE
 * `mkdir -p`, so a linked directory cannot have its missing children created outside it before a refusal.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, sep } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

/**
 * Create one restored file, exclusively, and give it its stored mtime.
 *
 * @param root the state home every write must resolve inside
 * @param path the absolute path to create
 * @param bytes the stored body
 * @param modifiedAt the stored mtime
 */
export function createAuthoredFile({
  root,
  path,
  bytes,
  modifiedAt,
}: {
  root: string;
  path: string;
  bytes: Buffer;
  modifiedAt: Date;
}): void {
  const realRoot = realpathSync(root);
  assertInside({ path: nearestExisting({ path: dirname(path) }), realRoot });
  mkdirSync(dirname(path), { recursive: true });
  assertInside({ path: dirname(path), realRoot });
  writeFileSync(path, bytes, { flag: "wx" });
  utimesSync(path, modifiedAt, modifiedAt);
}

/**
 * {@link createAuthoredFile} for a caller that settles an occupied path itself: the root is made first when
 * absent, and a path already there — a file that appeared since the caller looked, or a case-fold twin — is
 * `exists`, never replaced.
 *
 * @param root the directory the file must resolve inside, through every link
 * @param path the absolute path to create
 * @param bytes the stored body
 * @param modifiedAt the stored mtime
 * @returns `created`, `exists`, or why it could not be written
 */
export function createFileUnderRoot({
  root,
  path,
  bytes,
  modifiedAt,
}: {
  root: string;
  path: string;
  bytes: Uint8Array;
  modifiedAt: Date;
}): Result<"created" | "exists"> {
  try {
    mkdirSync(root, { recursive: true });
    createAuthoredFile({ bytes: Buffer.from(bytes), modifiedAt, path, root });
    return ok("created");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "EEXIST") {
      return ok("exists");
    }
    return err([errorMessage({ error: cause })]);
  }
}

/**
 * Write `show`'s body to the `--out` file the operator named, replacing it.
 *
 * @param path the operator's `--out`, anywhere they chose
 * @param bytes the stored body
 */
export function writeShownBody({ path, bytes }: { path: string; bytes: Buffer }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/**
 * The sha-256 of the file at a path.
 *
 * @param path an absolute path
 * @returns the hex digest, or `undefined` when nothing readable is there
 */
export function fileSha256({ path }: { path: string }): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * The closest path at or above one that exists — where `mkdir -p` would start creating.
 *
 * @param path an absolute path
 * @returns that path, or its nearest existing ancestor
 */
function nearestExisting({ path }: { path: string }): string {
  let at = path;
  while (!existsSync(at) && dirname(at) !== at) {
    at = dirname(at);
  }
  return at;
}

/**
 * Throw unless a path resolves, through every link, to the home or below it.
 *
 * @param path an existing path
 * @param realRoot the home, already resolved
 */
function assertInside({ path, realRoot }: { path: string; realRoot: string }): void {
  const real = realpathSync(path);
  if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`${path} resolves to ${real}, outside ${realRoot}`);
  }
}
