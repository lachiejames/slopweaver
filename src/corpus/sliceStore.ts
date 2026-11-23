/**
 * Reading and writing slice manifests — the deliberately FAIL-LOUD store.
 *
 * Every function here refuses rather than degrades, and that is the whole reason it exists instead of
 * reusing the tolerant helpers next door. Two measured precedents:
 *
 *  - `dev manifest`'s loader turns a failed corpus read into an EMPTY record list, so a permissions error
 *    or a truncated file reads as "the corpus is empty" and every conservation check over it passes.
 *  - {@link ./manifest.parseCorpusManifest} accepts `{"version":2}` and fills most missing collections
 *    with empties, so a truncated manifest compares clean against anything.
 *
 * Both are reasonable for their jobs and fatal for this one. A completeness harness that cannot read its own
 * baseline must say so, because "I could not read the pin" and "the pin matched" are the two states this
 * whole capability exists to keep apart.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { parseSliceManifest, type SliceManifest } from "./slice.js";
import { type SliceStoreError, SliceStoreErrors } from "./sliceStore.errors.js";

/**
 * The directory slice manifests live in, beneath the state home.
 *
 * Never the repository: a manifest names real local directories, which is exactly the content the public
 * hygiene gate exists to keep out of a public repo.
 *
 * @param home the state home
 * @returns the absolute slices directory
 */
function sliceDir({ home }: { home: string }): string {
  // Through `stateHomePaths` rather than joining the sub-path here: the state home has ONE typed contract,
  // and a second module deriving its own path is how two spellings of the same directory come to exist.
  // (Stated without the offending call shape — the guard that enforces this scans TEXT, so a comment
  // quoting the thing it forbids fails it just as a real call would.)
  return stateHomePaths({ home }).slices;
}

/**
 * The path of one named slice's manifest.
 *
 * @param home the state home
 * @param name the slice's name
 * @returns the absolute path of that slice's manifest
 */
function slicePath({ home, name }: { home: string; name: string }): string {
  return join(sliceDir({ home }), `${name}.json`);
}

/**
 * A slice name that cannot escape its directory.
 *
 * The name becomes a FILENAME, and a name is exactly the kind of value that arrives from a flag. Restricting
 * it to a conservative alphabet is cheaper than sanitising a path, and it keeps `slice verify --name ../..`
 * from being interesting. Pure.
 *
 * @param name the candidate slice name
 * @returns true when the name is safe to use as a filename
 */
export function isValidSliceName({ name }: { name: string }): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}

/**
 * Read one slice manifest, distinguishing "absent" from "unreadable" from "malformed".
 *
 * Three outcomes rather than two, because collapsing them is the defect: a caller that cannot tell a missing
 * pin from a corrupt one will happily capture a fresh pin over the top of a file it simply failed to parse,
 * and the baseline it was supposed to compare against is gone.
 *
 * @param home the state home
 * @param name the slice's name
 * @returns the manifest, or a typed error naming which of the three failures occurred
 */
export function readSliceManifest({
  home,
  name,
}: {
  home: string;
  name: string;
}): Result<SliceManifest, SliceStoreError> {
  const path = slicePath({ home, name });
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error["code"] : undefined;
    return err(
      code === "ENOENT" ? SliceStoreErrors.notFound({ name }) : SliceStoreErrors.unreadable({ cause: error, name }),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return err(SliceStoreErrors.invalidJson({ name }));
  }
  const manifest = parseSliceManifest({ value });
  return manifest === undefined ? err(SliceStoreErrors.missingFields({ name })) : ok(manifest);
}

/**
 * Write a slice manifest atomically, and refuse to clobber an existing pin unless told to.
 *
 * Atomic because a half-written manifest is exactly the corrupt-pin case above. Refusing by default because
 * overwriting a pin silently discards the baseline every later run compares against — the moving baseline
 * this module exists to prevent.
 *
 * @param home the state home
 * @param manifest the manifest to write
 * @param overwrite whether an existing pin for this name may be replaced
 * @returns the path written, or the reason it was refused
 */
export function writeSliceManifest({
  home,
  manifest,
  overwrite,
}: {
  home: string;
  manifest: SliceManifest;
  overwrite: boolean;
}): Result<string, SliceStoreError> {
  if (!isValidSliceName({ name: manifest.name })) {
    return err(SliceStoreErrors.invalidName({ name: manifest.name }));
  }
  // EXISTENCE, not readability. Guarding on `readSliceManifest(...).ok` was the bug: a corrupt or
  // unreadable pin returns `ok: false`, read as absence, and was then replaced with no `--overwrite` — the
  // baseline destroyed precisely when it was least trustworthy and most worth preserving for inspection.
  if (!overwrite && existsSync(slicePath({ home, name: manifest.name }))) {
    return err(SliceStoreErrors.alreadyExists({ name: manifest.name }));
  }
  const path = slicePath({ home, name: manifest.name });
  try {
    writeFileAtomic({
      contents: `${JSON.stringify(manifest, null, 2)}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
  } catch (error) {
    return err(SliceStoreErrors.writeFailed({ cause: error, name: manifest.name }));
  }
  return ok(path);
}
