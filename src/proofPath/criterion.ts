/**
 * What counts as PROOF OUTPUT in a repository path — the one criterion every proof-path check reads.
 *
 * A pull request has no need for a proof folder, so leaving one behind (gifs, VHS tapes, a stray body file) must be
 * structurally impossible rather than a matter of care.
 *
 * A path is proof output when ANY of:
 *
 *  - it is a terminal-recording SOURCE (`.tape`, `.cast`), wherever it sits and whatever it is named, because a name-based
 *    rule would not catch a proof folder committed under another name. Every cassette a stray folder carried was a `vhs` tape a session ran by hand, so no capture
 *    verb's `--out` refusal saw it; the tape is the one file every such capture leaves, whatever its folder.
 *    Neither repository tracks one (`git ls-tree -r --name-only origin/main | grep -E '\.(tape|cast)$'`, and
 *    the same on acme-admin's `origin/staging`), so the door's clean-base invariant holds;
 *  - it sits below a directory named `proof`, `proofs`, `screenshots` or `.proof` (any case) — unless an
 *    earlier segment is exactly `src` AND the file is TypeScript source, which is how this repository's own
 *    `src/proof/` module (the `slopweaver proof` verb) stays legal while `packages/x/src/proof/out.gif` does
 *    not; or
 *  - its basename starts with `proof` or `screenshot` (any case) and it is a picture or a recording.
 *
 * What stays open: a rendered picture or recording under a neutral name with no tape beside it. Both bases
 * carry legitimate media, so that would need a base-aware diff rather than this path criterion.
 *
 * Read by the `no-proof-path` CI gate, the push and ready door verbs, and `localExclude.ts`, which writes the
 * ignore block into every spawned checkout's own `info/exclude` — our hygiene, never a team-facing file.
 */

/** Directory names whose contents are proof output. Compared lower-cased. */
const PROOF_DIRECTORY_SEGMENTS: ReadonlySet<string> = new Set(["proof", "proofs", "screenshots", ".proof"]);

/** Extensions of a picture or a recording — the media half of the criterion. */
const PROOF_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".webm",
  ".mov",
  ".tape",
  ".cast",
]);

/** Extensions of a terminal-recording source — proof output under any name, in any folder. */
const RECORDING_SOURCE_EXTENSIONS: readonly string[] = [".tape", ".cast"];

/** Source extensions a `proof`-named module directory under `src/` may legitimately hold. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx", ".mts", ".cts"]);

/** Basename prefixes that mark a picture or recording as proof output wherever it sits. */
const MEDIA_NAME_PREFIXES: readonly string[] = ["proof", "screenshot"];

/**
 * The exact ignore lines this repository's `.gitignore` and every spawned checkout's `info/exclude` carry,
 * contiguous and in this order, so a stray capture cannot be staged. Verified on a real git fixture: `packages/x/src/proof/nested/a.ts` stays addable
 * while `packages/x/src/proof/a.gif` and `proof/a.gif` are ignored. Each directory block ignores the
 * contents, re-includes descendant DIRECTORIES under `src/`, then only TypeScript files in them — a bare
 * `!**\/src/**\/proof/**` would re-include generated images too.
 */
export const PROOF_GITIGNORE_LINES: readonly string[] = [
  ...[...PROOF_DIRECTORY_SEGMENTS].flatMap((segment) => [
    `**/${segment}/**`,
    `!**/src/**/${segment}/**/`,
    `!**/src/**/${segment}/**/*.ts`,
    `!**/src/**/${segment}/**/*.tsx`,
    `!**/src/**/${segment}/**/*.[cm]ts`,
  ]),
  ...MEDIA_NAME_PREFIXES.flatMap((prefix) => [...PROOF_MEDIA_EXTENSIONS].map((ext) => `**/${prefix}*${ext}`)),
  ...RECORDING_SOURCE_EXTENSIONS.map((ext) => `**/*${ext}`),
];

/** The lower-cased extension of a basename, including the dot, or "" when it has none. */
function extensionOf({ name }: { name: string }): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** Whether a proof directory at `index` is a source module directory the file legitimately belongs to. */
function isSourceModuleFile({
  segments,
  index,
  extension,
}: {
  segments: readonly string[];
  index: number;
  extension: string;
}): boolean {
  return segments.slice(0, index).includes("src") && SOURCE_EXTENSIONS.has(extension);
}

/**
 * Whether a repository-relative path is proof output that must never be committed.
 *
 * @param path a repository-relative path, `/`-separated; a leading `./` is ignored
 * @returns true when the path is proof output
 */
export function isProofPath({ path }: { path: string }): boolean {
  const segments = path.replace(/^\.\//, "").split("/");
  const name = segments.at(-1)!;
  const extension = extensionOf({ name });
  const lowerName = name.toLowerCase();
  if (RECORDING_SOURCE_EXTENSIONS.includes(extension)) {
    return true;
  }
  if (PROOF_MEDIA_EXTENSIONS.has(extension) && MEDIA_NAME_PREFIXES.some((prefix) => lowerName.startsWith(prefix))) {
    return true;
  }
  const directoryIndex = segments
    .slice(0, -1)
    .findIndex((segment) => PROOF_DIRECTORY_SEGMENTS.has(segment.toLowerCase()));
  if (directoryIndex === -1) {
    return false;
  }
  return !isSourceModuleFile({ extension, index: directoryIndex, segments });
}

/**
 * Every proof path among `paths`, sorted and de-duplicated so each caller prints a deterministic list.
 *
 * @param paths repository-relative paths to judge
 * @returns the proof paths, empty when none
 */
export function proofPathHits({ paths }: { paths: readonly string[] }): readonly string[] {
  return [...new Set(paths.filter((path) => isProofPath({ path })))].toSorted();
}

/**
 * The {@link PROOF_GITIGNORE_LINES} a `.gitignore` does not carry as ONE contiguous, in-order block.
 *
 * Every line is reported missing when the block is broken up or reordered, because a reordered negation
 * changes what git ignores; a line absent from an otherwise intact block is reported alone.
 *
 * @param content the `.gitignore` text
 * @returns the lines to add (or the whole block to restore), empty when the block is intact
 */
export function missingProofGitignoreLines({ content }: { content: string }): readonly string[] {
  const lines = content.split("\n").map((line) => line.trim());
  const start = lines.indexOf(PROOF_GITIGNORE_LINES[0]!);
  const intact = start !== -1 && PROOF_GITIGNORE_LINES.every((line, offset) => lines[start + offset] === line);
  if (intact) {
    return [];
  }
  const present = new Set(lines);
  const absent = PROOF_GITIGNORE_LINES.filter((line) => !present.has(line));
  return absent.length === 0 ? PROOF_GITIGNORE_LINES : absent;
}
