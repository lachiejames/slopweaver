/**
 * The local files a card's or a row's words name — what the voice reads, so a deliverable a seat wrote down as a
 * file is read rather than reported missing.
 *
 The voice must never tell the owner a briefing does not exist when it does and was simply not found. A briefing
 * the owner meant was the run's plan file. Its card said `Folder: ~/dev/acme-desktop-tauri … Plan: PLAN.md in the
 * folder.`, no page was published, and the voice told the owner "the implementation plan's there, but not the full
 * briefing yet". A path in a card's prose was no link, so nothing handed it over as something to read.
 *
 * Three shapes are taken:
 *
 * - a `~/` path;
 * - an absolute path under a root this machine keeps files in ({@link MACHINE_ROOTS}), so an API route such as
 *   `GET /v1/people/{id}` in the same card is never taken for a file;
 * - a bare DOCUMENT name (`PLAN.md`), joined to the one folder the same text names. With no folder, or two, it is
 *   left alone: a guessed path that will not read would be the very "it does not exist" this module exists to end.
 *
 * Never inside an address: `file:///Users/…` is a published page (`site/lib/openCard.ts` reads those), and an
 * `https://` path is a web page. A file's existence is never checked here; `file_read` answers that.
 *
 * `site/lib/cardFiles.ts` restates this for the Queue's cards, which `site/` cannot import;
 * `site/__tests__/unit/cardFilesMirror.test.ts` binds the two.
 */

/** The roots an absolute path must open on to count as a file on this machine. */
const MACHINE_ROOTS: readonly string[] = ["Users", "private", "tmp", "var", "opt", "home", "Volumes"];

/** The extensions a bare name must carry to be read as a deliverable beside its folder: a document, never code. */
const DOCUMENT_EXTENSIONS: readonly string[] = ["md", "txt", "html", "pdf"];

/**
 * A `~/` or machine-rooted path, never preceded by a character that would put it inside an address or a word, and
 * never ending on sentence punctuation.
 */
const PATH = new RegExp(
  String.raw`(?<![\w:/.~-])(?:~|/(?:${MACHINE_ROOTS.join("|")}))/[^\s<>"'\x60)\]}|,;]*[^\s<>"'\x60)\]}|,;.:!?]`,
  "gu",
);

/** A bare document name: no slash before it, none after, and a sentence's full stop after it is not part of it. */
const BARE_DOCUMENT = new RegExp(
  String.raw`(?<![\w/~.-])[A-Za-z0-9][\w-]*(?:\.[\w-]+)*\.(?:${DOCUMENT_EXTENSIONS.join("|")})(?![\w/-]|\.\w)`,
  "gu",
);

/**
 * Whether a path names a folder rather than a file: its last segment carries no extension.
 *
 * @param path a path {@link PATH} matched
 * @returns whether it reads as a folder
 */
function isFolder({ path }: { path: string }): boolean {
  const last = path.replace(/\/+$/u, "").split("/").at(-1)!;
  return !last.includes(".");
}

/**
 * Every local file one text names: its paths in order, then each bare document name joined to the text's one folder.
 *
 * @param text one card's or row's words
 * @returns the files, as written (`~` kept: `file_read` takes it)
 */
function filesIn({ text }: { text: string }): readonly string[] {
  const paths = [...text.matchAll(PATH)].map((match) => match[0].replace(/\/+$/u, ""));
  const files = paths.filter((path) => !isFolder({ path }));
  const folders = [...new Set(paths.filter((path) => isFolder({ path })))];
  if (folders.length !== 1) {
    return files;
  }
  const folder = folders[0]!;
  const beside = [...text.matchAll(BARE_DOCUMENT)].map((match) => `${folder}/${match[0]}`);
  return [...files, ...beside];
}

/**
 * The local files a set of texts names, deduplicated, first seen first. Each text resolves its own bare names, so a
 * folder one sentence names is never joined to a file another sentence names.
 *
 * @param texts the card's or row's words, one entry per field
 * @returns the files
 */
export function localFilesNamed({ texts }: { texts: readonly string[] }): readonly string[] {
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
