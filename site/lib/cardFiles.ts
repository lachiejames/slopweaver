/**
 * The local files a Queue card's words name, so `read_card` and `open_card` hand the voice a plan file a card names in
 * prose (`Folder: ~/dev/x … Plan: PLAN.md in the folder.`) as something to `file_read`, never something to report
 * missing.
 *
 * A restatement of `src/talk/namedFiles.ts`, which carries the incident, the three
 * shapes and why each edge is drawn where it is: a file under `site/` may not import one under `src/`.
 * `../__tests__/unit/cardFilesMirror.test.ts` drives one table through both, so a change to either that the other
 * misses fails there.
 */

/** The roots an absolute path must open on to count as a file on this machine. */
const MACHINE_ROOTS: readonly string[] = ["Users", "private", "tmp", "var", "opt", "home", "Volumes"];

/** The extensions a bare name must carry to be read as a deliverable beside its folder: a document, never code. */
const DOCUMENT_EXTENSIONS: readonly string[] = ["md", "txt", "html", "pdf"];

/** A `~/` or machine-rooted path, never inside an address or a word, never ending on sentence punctuation. */
const PATH = new RegExp(
  String.raw`(?<![\w:/.~-])(?:~|/(?:${MACHINE_ROOTS.join("|")}))/[^\s<>"'\x60)\]}|,;]*[^\s<>"'\x60)\]}|,;.:!?]`,
  "gu",
);

/** A bare document name: no slash before it, none after, and a sentence's full stop after it is not part of it. */
const BARE_DOCUMENT = new RegExp(
  String.raw`(?<![\w/~.-])[A-Za-z0-9][\w-]*(?:\.[\w-]+)*\.(?:${DOCUMENT_EXTENSIONS.join("|")})(?![\w/-]|\.\w)`,
  "gu",
);

/** Whether a path names a folder rather than a file: its last segment carries no extension. */
function isFolder({ path }: { path: string }): boolean {
  const last = path.replace(/\/+$/u, "").split("/").at(-1)!;
  return !last.includes(".");
}

/** Every local file one text names: its paths in order, then each bare document name joined to its one folder. */
function filesIn({ text }: { text: string }): readonly string[] {
  const paths = [...text.matchAll(PATH)].map((match) => match[0].replace(/\/+$/u, ""));
  const files = paths.filter((path) => !isFolder({ path }));
  const folders = [...new Set(paths.filter((path) => isFolder({ path })))];
  if (folders.length !== 1) {
    return files;
  }
  const folder = folders[0];
  const beside = [...text.matchAll(BARE_DOCUMENT)].map((match) => `${folder}/${match[0]}`);
  return [...files, ...beside];
}

/**
 * The local files a set of texts names, deduplicated, first seen first, each text resolving its own bare names.
 *
 * @param texts the card's words, one entry per field
 * @returns the files, as written (`~` kept: `file_read` takes it)
 */
export function cardFilesNamed({ texts }: { texts: readonly string[] }): readonly string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const file of filesIn({ text })) {
      if (!out.includes(file)) {
        out.push(file);
      }
    }
  }
  return out;
}
