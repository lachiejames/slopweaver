/**
 * The raw metadata walk a salvage scan reads beside the blobs — split out of `./salvageScan` along the seam between
 * reading git's object listing and reading its per-path history. It answers two things the push publishes and no
 * blob holds: every changed path's NAME, scanned as text, and every path each new blob is WRITTEN at.
 *
 * The second exists because `rev-list --objects` names an object once, at the first path its walk meets, while the
 * repository-content identifier scanner forgives by path (`../hygiene/ownRepository.ts`: a `.github/CODEOWNERS`
 * account row, the README's one owner reference). Judged at its first path alone, a byte-identical copy of a
 * forgiven file at any other path inherited that forgiveness (reproduced in
 * `src/__tests__/unit/worktree/salvageScan/realGitPaths.test.ts`).
 */

/**
 * Every changed path in the range with the blob it writes, raw and NUL-separated: the `log` behind
 * `./salvageScan`'s metadata edge. Three flags carry the claim that every path a new blob is published at is in
 * it: `-r` walks into every directory, `--diff-merges=separate` diffs a merge against each parent, so a resolution
 * that differs from all of them is listed, and `--root` diffs a parentless commit against the empty tree whatever
 * `log.showRoot` says. A blob a range commit carries unchanged from every parent came from one that wrote it, or from
 * the destination, whose objects the listing never holds. `--no-show-signature` keeps `log.showSignature`'s prose
 * out of the stream; the commit object itself is scanned raw beside the blobs.
 */
export const METADATA_LOG = [
  "--no-replace-objects",
  "-c",
  "core.quotePath=false",
  "log",
  "--stdin",
  "--format=",
  "-z",
  "-r",
  "--raw",
  "--no-abbrev",
  "--root",
  "--no-show-signature",
  "--no-renames",
  "--diff-merges=separate",
  "--no-ext-diff",
] as const;

/**
 * One `--raw` record's meta field: both modes, both full object names and a status. With `--no-renames` and `-r`
 * a committed diff prints only these four statuses, and never a tree.
 */
const RAW_RECORD = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ADMT])$/;

/** The modes a new-side BLOB is written under: a file, an executable and a symlink. */
const BLOB_MODES: ReadonlySet<string> = new Set(["100644", "100755", "120000"]);

/** A submodule entry's mode, whose object is a commit in a database the scan never opens. */
const GITLINK_MODE = "160000";

/** The new-side mode and object name of a deleted path, and the old side of an added one. */
const NO_OBJECT = /^0+$/;

/** Every mode a `-r` raw record's side can carry: none, a blob mode, or a submodule entry — never a tree. */
const RECORD_MODES: ReadonlySet<string> = new Set(["000000", ...BLOB_MODES, GITLINK_MODE]);

/**
 * Whether a record's OLD side is one git could print: a known mode, empty exactly when the path was added.
 *
 * @param oldMode the old side's mode
 * @param oldObject the old side's object name
 * @param status the record's status letter
 * @returns true when the old side is consistent with the status
 */
function oldSideValid({ oldMode, oldObject, status }: { oldMode: string; oldObject: string; status: string }): boolean {
  const emptyOldSide = NO_OBJECT.test(oldMode) && NO_OBJECT.test(oldObject);
  return RECORD_MODES.has(oldMode) && emptyOldSide === (status === "A");
}

/** Why the scan declines a raw listing it could not read whole, quoting none of it. */
const MALFORMED_METADATA = "the paths it would push were in a git listing the scan could not read — nothing was pushed";

/** Why the scan declines a submodule entry, whose objects the push does not send and the scan never reads. */
const SUBMODULE_METADATA =
  "what it would push writes a submodule entry, and a submodule is not scanned — nothing was pushed";

/** What the push publishes as names, and every path each new blob is written at. */
export interface SalvageMetadata {
  /** Every changed path, NUL-terminated, in walk order: the names the push publishes, scanned as text. */
  readonly changedPaths: string;
  /** Each new-side blob's name, and every distinct path a commit in the range writes it at, first seen first. */
  readonly pathsByBlob: ReadonlyMap<string, readonly string[]>;
}

/**
 * Judge one record's meta field: the blob its path now holds, `null` for a deletion, or the decline reason.
 *
 * Pure. A new-side submodule entry declines on its own line; a field that is not a record, one mixing two hash widths,
 * an old side no git prints (an unknown mode, or empty when the path was not added), a deletion whose new side is not
 * all zeros (or a non-deletion whose is), and any other new-side mode decline as unreadable.
 *
 * @param meta the `:<old mode> <new mode> <old> <new> <status>` field
 * @returns the new-side blob, `null` when the path was deleted, or the decline reason
 */
function newSideBlob({ meta }: { meta: string }): { readonly blob: string | null } | string {
  const record = RAW_RECORD.exec(meta);
  if (record === null) {
    return MALFORMED_METADATA;
  }
  const [, oldMode, newMode, oldObject, newObject, status] = record;
  // One repository names every object in one hash: a record mixing SHA-1 and SHA-256 widths is not git's.
  const oneWidth = oldObject!.length === newObject!.length;
  if (!oneWidth || !oldSideValid({ oldMode: oldMode!, oldObject: oldObject!, status: status! })) {
    return MALFORMED_METADATA;
  }
  if (newMode === GITLINK_MODE) {
    return SUBMODULE_METADATA;
  }
  const deleted = status === "D";
  const emptyNewSide = NO_OBJECT.test(newMode!) && NO_OBJECT.test(newObject!);
  if (deleted !== emptyNewSide) {
    return MALFORMED_METADATA;
  }
  if (deleted) {
    return { blob: null };
  }
  return BLOB_MODES.has(newMode!) ? { blob: newObject! } : MALFORMED_METADATA;
}

/**
 * Parse {@link METADATA_LOG}'s output into the changed-path text and the blob-to-paths map.
 *
 * Pure, and fail-closed: the stream must alternate one meta field and one non-empty path, each NUL-terminated, and
 * every meta field must pass {@link newSideBlob}. A deletion adds its path to the text and nothing to the map. A
 * stream that does not parse declines, quoting none of it — a partial map would forgive a copy the scan never saw.
 *
 * @param output the command's stdout
 * @returns the metadata, or the decline reason
 */
export function parseSalvageMetadata({ output }: { output: string }): SalvageMetadata | string {
  const tokens = output.split("\0");
  // An empty walk splits to one empty token and parses to nothing; anything else must end on a NUL and pair up.
  if (tokens.pop() !== "" || tokens.length % 2 !== 0) {
    return MALFORMED_METADATA;
  }
  const paths: string[] = [];
  const pathsByBlob = new Map<string, string[]>();
  for (let index = 0; index < tokens.length; index += 2) {
    const path = tokens[index + 1]!;
    const side = newSideBlob({ meta: tokens[index]! });
    if (typeof side === "string") {
      return side;
    }
    if (path === "") {
      return MALFORMED_METADATA;
    }
    paths.push(path);
    if (side.blob !== null) {
      addPath({ blob: side.blob, path, pathsByBlob });
    }
  }
  return { changedPaths: paths.map((path) => `${path}\0`).join(""), pathsByBlob };
}

/**
 * Record one path under its blob, once, keeping first-seen order.
 *
 * @param blob the new-side blob
 * @param path the path it is written at
 * @param pathsByBlob the map, mutated
 */
function addPath({
  blob,
  path,
  pathsByBlob,
}: {
  blob: string;
  path: string;
  pathsByBlob: Map<string, string[]>;
}): void {
  const written = pathsByBlob.get(blob);
  if (written === undefined) {
    pathsByBlob.set(blob, [path]);
  } else if (!written.includes(path)) {
    written.push(path);
  }
}
