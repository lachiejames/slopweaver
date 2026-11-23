/**
 * Make a directory below the staging root with no link anywhere between the root and it.
 *
 * The overlap guard (`./destination.ts`) compares the staging root itself with the destination by identity.
 * That says nothing about what sits BELOW the root: a `recover` or `retrieved` entry, or tonight's per-run
 * `<instant>` directory, planted as a link into the destination would carry plaintext staging there while the
 * root check passes. So every staging directory is made here, one segment at a time, and each segment is
 * either created now or found to be a real directory — never a link, existing or dangling.
 *
 * `fresh` asks for the LAST segment to be created by this call: a backup's per-run directory is named for the
 * run's own instant, so finding it already there means something other than this run put it there.
 *
 * The residue is `./realPlace.ts`'s: an entry swapped for a link in the instant after its check still redirects
 * the write after it.
 */
import { lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { type BackupError, BackupErrors } from "./errors.js";
import { carriesDotSegment } from "./realPlace.js";
import { stagingRoot } from "./staging.js";

/**
 * Whether a thrown filesystem error says the entry already exists.
 *
 * @param cause what `mkdirSync` threw
 * @returns true for `EEXIST`
 */
function alreadyThere({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "EEXIST";
}

/**
 * Make one segment, accepting an existing entry only when it is a real directory and `fresh` was not asked for.
 *
 * @param path the segment's full path
 * @param fresh whether this call must be the one that creates it
 * @returns nothing, or why the segment cannot be staged into
 */
function makeSegment({ path, fresh }: { path: string; fresh: boolean }): Result<void, BackupError> {
  try {
    mkdirSync(path, { mode: 0o700 });
    return ok(undefined);
  } catch (cause: unknown) {
    if (!alreadyThere({ cause })) {
      return err(BackupErrors.stepFailed({ reasons: [`could not make ${path}: ${errorMessage({ error: cause })}`] }));
    }
  }
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    return err(
      BackupErrors.stepFailed({
        reasons: [`${path} is a link or not a directory; staging never writes through one — remove it and re-run`],
      }),
    );
  }
  if (fresh) {
    return err(
      BackupErrors.stepFailed({
        reasons: [`${path} already exists; this run's staging must be made by this run — remove it and re-run`],
      }),
    );
  }
  return ok(undefined);
}

/**
 * Make a staging directory under the home's staging root, refusing a link at any segment below the root.
 *
 * @param home the Slopweaver home whose staging root holds the directory
 * @param directory the directory to make; it must lie below the staging root
 * @param fresh whether the last segment must be created by this call rather than found
 * @returns nothing, or why the directory cannot be staged into
 */
export function makeStagingDirectory({
  home,
  directory,
  fresh = false,
}: {
  home: string;
  directory: string;
  fresh?: boolean;
}): Result<void, BackupError> {
  const root = stagingRoot({ home });
  // Refused before `relative` normalises it away: `<root>/link/../escape` would check `<root>/escape`.
  if (carriesDotSegment({ path: directory })) {
    return err(
      BackupErrors.stepFailed({ reasons: [`${directory} carries a . or .. segment; staging names a path plainly`] }),
    );
  }
  const below = relative(root, directory);
  if (below === "" || below === ".." || below.startsWith(`..${sep}`) || isAbsolute(below)) {
    return err(BackupErrors.stepFailed({ reasons: [`${directory} is not below the staging root ${root}`] }));
  }
  try {
    mkdirSync(root, { mode: 0o700, recursive: true });
  } catch (cause: unknown) {
    return err(BackupErrors.stepFailed({ reasons: [`could not make ${root}: ${errorMessage({ error: cause })}`] }));
  }
  const segments = below.split(sep);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const made = makeSegment({ fresh: fresh && index === segments.length - 1, path: current });
    if (made.isErr()) {
      return err(made.error);
    }
  }
  return ok(undefined);
}
