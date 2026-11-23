/**
 * The disk edge of `slopweaver store recover`: moving the files leg out of the recovery's own staging into the
 * home, and the marker a re-run resumes from. The decrypted credentials take the same decisions in
 * `./recoverSecrets.ts`, which reads the home's copy and keeps out of the destination through the two helpers here.
 *
 * **Nothing the home already holds is overwritten.** Each path is decided by `installDecision`
 * (`./recoverPlan.ts`): absent is written, byte-identical is skipped, and a difference is LEFT in staging and
 * reported, because a recovery onto a home that is not empty — a migration onto a Mac already in use, say — must
 * never destroy what it found.
 *
 * Staging lives under the backup staging root (`backups/store/recover/<instant>/`), which is this install's own
 * scratch: `pruneStaging` only removes a directory carrying an upload receipt and the sweep only reads one
 * carrying `files.json` at its top, so neither reaches it.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { homeRelativePath } from "../../stateHome.js";
import { backupErrorLines } from "./errors.js";
import { heldByIdentity, realPlace, statIdentity } from "./realPlace.js";
import { type RecoverError, RecoverErrors } from "./recoverErrors.js";
import { type InstallDecision, installDecision, type RecoverMarker } from "./recoverPlan.js";
import { digestFile } from "./stack.js";
import { stagingRoot } from "./staging.js";
import { makeStagingDirectory } from "./stagingDirectory.js";

/** The one write a recovery makes over what the home holds: `store-url` repointed at the recovered database. */
export interface InstallReplacement {
  readonly path: "secrets/store-url";
  /** The database the home's URL named before — the old URL is the new one with this database. */
  readonly oldDatabase: string;
  readonly newDatabase: string;
}

/** What one install into the home did. Paths and database names only — a credential's value never rides a report. */
export interface InstallReport {
  readonly written: number;
  readonly identical: number;
  /** Home-relative paths left in staging because the home holds different bytes there. */
  readonly conflicts: readonly string[];
  /** What was written over the home's own copy; only `store-url`, and only when its database alone differed. */
  readonly replaced: readonly InstallReplacement[];
}

/**
 * The recovery's own staging directory for one backup.
 *
 * @param home the Slopweaver home being recovered
 * @param prefix the backup's `<project>/<instant>/` prefix
 * @returns `<staging root>/recover/<project>_<instant>`
 */
export function recoverStagingDirectory({ home, prefix }: { home: string; prefix: string }): string {
  return join(stagingRoot({ home }), "recover", prefix.replace(/\/+$/, "").replace(/\//g, "_"));
}

/**
 * Make the recovery's staging directory for one backup, through no link below the staging root — a planted
 * `recover` link would otherwise carry the decrypted credentials, and the clear before them, elsewhere.
 *
 * @param home the Slopweaver home being recovered
 * @param prefix the backup's `<project>/<instant>/` prefix
 * @returns the directory, made, or why it cannot be staged into
 */
export function makeRecoverStaging({ home, prefix }: { home: string; prefix: string }): Result<string, RecoverError> {
  const directory = recoverStagingDirectory({ home, prefix });
  const made = makeStagingDirectory({ directory, home });
  if (made.isErr()) {
    return err(RecoverErrors.stepFailed({ reasons: backupErrorLines({ error: made.error }), step: "making staging" }));
  }
  return ok(directory);
}

/**
 * The SHA-256 of whatever stands at a path, or `null` when nothing does. A symlink counts as present and never
 * matches, so a link in the home is never written through.
 *
 * @param path the path in the home
 * @returns the digest, `null` when absent, or why it could not be read
 */
export function presentDigest({ path }: { path: string }): Result<string | null, RecoverError> {
  let isLink: boolean;
  try {
    isLink = lstatSync(path).isSymbolicLink();
  } catch {
    return ok(null);
  }
  if (isLink) {
    return ok("symlink");
  }
  return digestFile({ path })
    .map((artefact) => artefact.sha256)
    .mapErr((error) => RecoverErrors.stepFailed({ reasons: [error.message], step: `reading ${path}` }));
}

/**
 * Refuse a home path that really lands inside the backup destination — a link standing in the home (`bronze/`
 * pointed at the destination, say) would otherwise carry a restored file or credential into it. Resolved with
 * `realPlace` and compared by identity, the same test the transport's own writes are gated on.
 *
 * @param path the path in the home about to be written
 * @param destination the destination root the recovery reads, or `undefined` when there is none to keep out of
 * @returns nothing when the path lands outside it, else why nothing was written
 */
export function refuseInsideDestination({
  path,
  destination,
}: {
  path: string;
  destination: string | undefined;
}): Result<void, RecoverError> {
  if (destination === undefined) {
    return ok(undefined);
  }
  const real = realPlace({ path });
  if (real.isErr()) {
    return err(RecoverErrors.stepFailed({ reasons: [real.error.message], step: `resolving ${path}` }));
  }
  if (heldByIdentity({ identityOf: statIdentity, place: real.value, root: destination })) {
    return err(
      RecoverErrors.stepFailed({
        reasons: [
          `${path} resolves to ${real.value}, inside the backup destination ${destination}; nothing was written`,
        ],
        step: `installing ${path}`,
      }),
    );
  }
  return ok(undefined);
}

/**
 * Every regular file under a directory, as paths relative to it.
 *
 * @param root the directory to walk
 * @returns the relative paths, sorted
 */
function filesUnder({ root }: { root: string }): readonly string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .toSorted();
}

/**
 * Decide one staged file against the home. The staged copy is only digested when the home holds something at
 * its path, so moving a fresh home's gigabytes of bronze reads none of them.
 *
 * @param from the staged file
 * @param to the same relative path in the home
 * @returns the decision, or why either side could not be read
 */
function decideFile({ from, to }: { from: string; to: string }): Result<InstallDecision, RecoverError> {
  const present = presentDigest({ path: to });
  if (present.isErr()) {
    return err(present.error);
  }
  if (present.value === null) {
    return ok("write");
  }
  const incoming = digestFile({ path: from });
  if (incoming.isErr()) {
    return err(RecoverErrors.stepFailed({ reasons: [incoming.error.message], step: `reading ${from}` }));
  }
  return ok(installDecision({ incoming: incoming.value.sha256, present: present.value }));
}

/**
 * Decide one staged file and act on it: move it in, drop an identical copy, or leave a conflict staged.
 *
 * @param from the staged file
 * @param to the same relative path in the home
 * @param relativePath the path both share, named in a failure
 * @param destination the backup destination root, which a move may never land inside
 * @returns the decision acted on, or the first path that could not be read or moved
 */
function installOneFile({
  from,
  to,
  relativePath,
  destination,
}: {
  from: string;
  to: string;
  relativePath: string;
  destination: string | undefined;
}): Result<InstallDecision, RecoverError> {
  const decided = decideFile({ from, to });
  if (decided.isErr()) {
    return err(decided.error);
  }
  const decision = decided.value;
  if (decision === "write") {
    const outside = refuseInsideDestination({ destination, path: to });
    if (outside.isErr()) {
      return err(outside.error);
    }
  }
  try {
    if (decision === "write") {
      mkdirSync(dirname(to), { mode: 0o700, recursive: true });
      renameSync(from, to);
    } else if (decision === "identical") {
      rmSync(from, { force: true });
    }
  } catch (cause: unknown) {
    return err(RecoverErrors.stepFailed({ reasons: [errorMessage({ error: cause })], step: `moving ${relativePath}` }));
  }
  return ok(decision);
}

/**
 * Move every file the files leg rebuilt into the home, never over a file that differs.
 *
 * @param staged the directory `runRestoreFiles` rebuilt the roots under
 * @param home the Slopweaver home
 * @param destination the backup destination root, which no install may land inside through a link in the home
 * @returns what was moved, skipped and left behind, or the first path that could not be read or moved
 */
export function installStagedFiles({
  staged,
  home,
  destination,
}: {
  staged: string;
  home: string;
  destination?: string;
}): Result<InstallReport, RecoverError> {
  let written = 0;
  let identical = 0;
  const conflicts: string[] = [];
  for (const relativePath of filesUnder({ root: staged })) {
    const installed = installOneFile({
      destination,
      from: join(staged, relativePath),
      relativePath,
      to: homeRelativePath({ home, relativePath }),
    });
    if (installed.isErr()) {
      return err(installed.error);
    }
    if (installed.value === "write") {
      written += 1;
    } else if (installed.value === "identical") {
      identical += 1;
    } else {
      conflicts.push(relativePath);
    }
  }
  if (conflicts.length === 0) {
    rmSync(staged, { force: true, recursive: true });
  }
  return ok({ conflicts, identical, replaced: [], written });
}

/**
 * Read a recovery's marker, when one was written.
 *
 * @param path the marker file
 * @returns its parsed JSON, or `null` when there is none or it is not JSON — a fresh start either way
 */
export function readRecoverMarker({ path }: { path: string }): unknown {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return safeJsonParse({ label: "the recovery marker", text: readFileSync(path, "utf8") });
  } catch {
    return null;
  }
}

/**
 * Write a recovery's marker, atomically.
 *
 * @param path the marker file
 * @param marker how far the recovery got
 * @returns nothing, or why it could not be written
 */
export function writeRecoverMarker({
  path,
  marker,
}: {
  path: string;
  marker: RecoverMarker;
}): Result<void, RecoverError> {
  try {
    const contents = `${safeJsonStringify({ label: "the recovery marker", space: 2, value: marker })}\n`;
    writeFileAtomic({ contents, dirMode: 0o700, fileMode: 0o600, path });
    return ok(undefined);
  } catch (cause: unknown) {
    return err(
      RecoverErrors.stepFailed({ reasons: [errorMessage({ error: cause })], step: "writing the recovery marker" }),
    );
  }
}

/**
 * Remove a directory of this recovery's own staging, so a retried step starts from an empty one.
 *
 * @param path the staging directory
 */
export function clearStaging({ path }: { path: string }): void {
  rmSync(path, { force: true, recursive: true });
}
