/**
 * Reading the orchestration-doc board off disk. The effectful half of {@link ./doc}.
 *
 * A scan over `$SLOPWEAVER_HOME/handovers/*.md`, never an index. Each doc carries its own metadata, so two
 * sessions writing docs at the same time cannot collide and nothing has to be reconciled.
 *
 * The directory is deliberately configurable. It defaults inside `$SLOPWEAVER_HOME` so a doc is reachable
 * from any repository on the machine — the point is that these are cross-repo — but `$SLOPWEAVER_HOME` is
 * not backed up, and unlike the corpus these are hand-written and cannot be regenerated. Pointing
 * `handoverDir` at a git-backed path is the durable choice, and slopweaver cannot ship that path because it
 * is a public repository.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, stat as statAsync } from "node:fs/promises";
import { join } from "node:path";
import type { IngestError } from "#lib/ingestError.js";
import { isRecord } from "#lib/parsers.js";
import { createConcurrencyLimiter } from "#lib/resilience.js";
import { err, ok, type Result, type ResultAsync } from "#lib/result.js";
import { safeFs, safeFsAsync } from "#lib/safeBoundary.js";
import { type HandoverDoc, parseHandoverDoc } from "./doc.js";

/** What a scan found, including what it could not read. */
export interface BoardScan {
  readonly docs: readonly HandoverDoc[];
  /**
   * Files that look like docs but could not be read.
   *
   * Counted, never dropped. A doc silently missing from the board is indistinguishable from work that was
   * never planned — which is precisely the friction the board exists to remove.
   */
  readonly unreadable: readonly string[];
}

/**
 * Read every orchestration doc under a directory.
 *
 * A missing directory is NOT an error: the common case on a fresh machine is that nobody has written a doc
 * yet, and failing there would make the board look broken rather than empty.
 *
 * @param handoverDir the directory holding the docs
 * @returns the parsed docs plus the names of any that could not be read
 */
export function scanBoard({ handoverDir }: { handoverDir: string }): Result<BoardScan, IngestError> {
  return scanBoardFiles({ handoverDir, prefix: "" });
}

/**
 * Read only the docs whose FILE name opens with `prefix` — the rows one family of slugs lands in, for a check that
 * must re-read that family at an append without paying for the whole board. A row is written as `<slug>.md`, so the
 * file name stands for the slug; a doc whose `slug:` differs from its file name is outside this read.
 *
 * @param handoverDir the directory holding the docs
 * @param prefix the file-name prefix to keep, `talk-` for the rows the owner's console words land on
 * @returns the parsed docs plus the names of any matching file that could not be read
 */
export function scanBoardPrefixed({
  handoverDir,
  prefix,
}: {
  handoverDir: string;
  prefix: string;
}): Result<BoardScan, IngestError> {
  return scanBoardFiles({ handoverDir, prefix });
}

/** The one scan loop both readers above share, an empty prefix keeping every doc. */
function scanBoardFiles({
  handoverDir,
  prefix,
}: {
  handoverDir: string;
  prefix: string;
}): Result<BoardScan, IngestError> {
  return safeFs({
    execute: (): BoardScan => {
      const docs: HandoverDoc[] = [];
      const unreadable: string[] = [];
      for (const name of listMarkdown({ handoverDir }).filter((file) => file.startsWith(prefix))) {
        const path = join(handoverDir, name);
        if (!isReadableDoc({ path })) {
          // A FIFO named `something.md` makes `readFileSync` block until a writer appears — forever, in
          // practice. That is fatal in the Stop hook, whose deadline is enforced above the wrapper script, so a
          // blocked read cannot fail open. Found by an adversarial pass. Only regular files of a sane size are
          // read; anything else is reported as unreadable, which is loud and cannot hang.
          unreadable.push(name);
          continue;
        }
        try {
          docs.push(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }));
        } catch {
          unreadable.push(name);
        }
      }
      return { docs, unreadable };
    },
    operation: "handover.scanBoard",
    path: handoverDir,
  });
}

/** A board scan that kept what its caller needed out of every doc's text, keyed by the doc's path. */
export interface BoardKeptScan<T> extends BoardScan {
  /** What `keep` took from each read doc's text, so a reader of its body never opens the file a second time. */
  readonly kept: ReadonlyMap<string, T>;
}

/** One doc as the wide read left it: not read, read and parsed with what was kept, or read and not a doc. */
type WideRead<T> =
  | { readonly name: string; readonly path: string; readonly outcome: "failed" }
  | { readonly name: string; readonly path: string; readonly outcome: "unparsed" }
  | { readonly name: string; readonly path: string; readonly outcome: "parsed"; readonly parsed: ParsedRead<T> };

/** A parsed doc and what was kept from its text, absent when `keep` threw. */
interface ParsedRead<T> {
  readonly doc: HandoverDoc;
  readonly kept: { readonly value: T } | undefined;
}

/**
 * How many docs {@link scanBoardConcurrently} has open at once. On this machine the cost of a board read is
 * per OPEN, not per byte, and a serial read pays every open in turn. MEASURED over 10,256 docs, 80 MB,
 * at load average ~25: `statSync` all 234 ms, `readFileSync` all 3,941 ms, `fs/promises` `readFile` 32 wide
 * 751 ms. Repro, end to end: `time slopweaver talk find-card apple developer account signing access it-support`, on
 * this scan and on `scanBoard` (`docs/console/voice-finds-a-card-by-topic.md` carries both readings).
 */
export const CONCURRENT_SCAN_WIDTH = 32;

/**
 * Read every orchestration doc under a directory with up to {@link CONCURRENT_SCAN_WIDTH} files open at once, and
 * keep what `keep` takes from each doc's text. The same docs, in the same order, with the same unreadable names as
 * {@link scanBoard}: the regular-file and size guard runs before every read, a file that will not read or parse is
 * counted, never dropped, and a missing directory is an empty board.
 *
 * The scan holds nothing of a doc past its read but what `keep` returned, so a `keep` that takes a little holds a
 * little: holding every text was a whole board's bytes at once where `scanBoard` holds one doc. A `keep` that returns the text, or a doc that is all one section `keep` takes, holds it all.
 *
 * For a reader whose deadline the serial scan outgrew — the console voice's `talk find-card`, killed at its sixteen
 * seconds on a board of ten thousand docs. Every other caller keeps {@link scanBoard}.
 *
 * @param handoverDir the directory holding the docs
 * @param keep what to take from one parsed doc's text; a doc whose `keep` throws is on the board with nothing kept
 * @returns the parsed docs, what was kept from each, and the names of any that could not be read
 */
export function scanBoardConcurrently<T>({
  handoverDir,
  keep,
}: {
  handoverDir: string;
  keep: (read: { doc: HandoverDoc; text: string }) => T;
}): ResultAsync<BoardKeptScan<T>, IngestError> {
  return safeFsAsync({
    execute: async (): Promise<BoardKeptScan<T>> => {
      const limit = createConcurrencyLimiter({ concurrency: CONCURRENT_SCAN_WIDTH });
      const reads = await Promise.all(
        listMarkdown({ handoverDir }).map((name) =>
          limit(async (): Promise<WideRead<T>> => {
            const path = join(handoverDir, name);
            const text = await docTextAt({ path });
            if (text === undefined) {
              return { name, outcome: "failed", path };
            }
            const parsed = parsedRead({ keep, path, text });
            if (parsed === undefined) {
              return { name, outcome: "unparsed", path };
            }
            return { name, outcome: "parsed", parsed, path };
          }),
        ),
      );
      const docs: HandoverDoc[] = [];
      const kept = new Map<string, T>();
      const unreadable: string[] = [];
      for (const read of reads) {
        // A read that failed 32 wide is read again alone once every wide read has settled, exactly as `scanBoard`
        // reads it: under a low descriptor limit the wide read fails EMFILE on a doc the serial read opens fine (Codex
        // r3 on this change).
        const parsed = read.outcome === "failed" ? serialParsedRead({ keep, path: read.path }) : wideParsed({ read });
        if (parsed === undefined) {
          unreadable.push(read.name);
          continue;
        }
        docs.push(parsed.doc);
        if (parsed.kept !== undefined) {
          kept.set(read.path, parsed.kept.value);
        }
      }
      return { docs, kept, unreadable };
    },
    operation: "handover.scanBoardConcurrently",
    path: handoverDir,
  });
}

/** What a settled wide read parsed, or `undefined` for one that read and did not parse. */
function wideParsed<T>({ read }: { read: WideRead<T> }): ParsedRead<T> | undefined {
  if (read.outcome === "parsed") {
    return read.parsed;
  }
  return undefined;
}

/** Parse one doc's text and take what `keep` wants from it, else `undefined` when it is not a doc. */
function parsedRead<T>({
  keep,
  path,
  text,
}: {
  keep: (read: { doc: HandoverDoc; text: string }) => T;
  path: string;
  text: string;
}): ParsedRead<T> | undefined {
  let doc: HandoverDoc;
  try {
    doc = parseHandoverDoc({ path, text });
  } catch {
    return undefined;
  }
  try {
    return { doc, kept: { value: keep({ doc, text }) } };
  } catch {
    return { doc, kept: undefined };
  }
}

/** One doc read alone, the way {@link scanBoard} reads it, parsed and kept, else `undefined`. */
function serialParsedRead<T>({
  keep,
  path,
}: {
  keep: (read: { doc: HandoverDoc; text: string }) => T;
  path: string;
}): ParsedRead<T> | undefined {
  const text = serialDocText({ path });
  if (text === undefined) {
    return undefined;
  }
  return parsedRead({ keep, path, text });
}

/**
 * One doc's text when the path is a regular file small enough to read, else `undefined` — {@link isReadableDoc}'s
 * guard ahead of the read, for the FIFO reason {@link scanBoard} gives.
 */
async function docTextAt({ path }: { path: string }): Promise<string | undefined> {
  try {
    const found = await statAsync(path);
    if (!found.isFile() || found.size > MAX_DOC_BYTES) {
      return undefined;
    }
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** One doc's text read the way {@link scanBoard} reads it, one file open at a time, else `undefined`. */
function serialDocText({ path }: { path: string }): string | undefined {
  if (!isReadableDoc({ path })) {
    return undefined;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The largest doc this will read. An orchestration doc is prose; anything vastly bigger is not one. */
const MAX_DOC_BYTES = 2 * 1024 * 1024;

/**
 * Whether a path is a REGULAR file small enough to read.
 *
 * `statSync` follows symlinks, which is intended — a symlink to a real doc is fine, a symlink to a FIFO is not,
 * and this asks about the destination either way.
 */
function isReadableDoc({ path }: { path: string }): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size <= MAX_DOC_BYTES;
  } catch {
    return false;
  }
}

/**
 * Look up one archived doc by exact slug, WITHOUT enumerating the archive directory.
 *
 * `scanBoard` deliberately never reads `handovers/archive/` — that is what keeps closed work off the default
 * board and out of collision/stale-repository scans. But a live doc's `blockedBy` can still name a slug that
 * was later archived, and silently degrading that to "missing dependency" loses the exact terminal reason and
 * `via` chain a dependent should see. This is a targeted, single-file lookup for that one case — never a scan
 * boundary change, and never a path a board render or hygiene sweep should call.
 *
 * The same regular-file/size guard as {@link isReadableDoc} applies, and the archived file's own authored
 * `slug:` must equal the requested one — a same-named file containing the wrong document is a distinct
 * integrity failure from "no such archived doc", not a silent substitution.
 *
 * @param handoverDir the top-level handovers directory (its `archive/` sibling is where this looks)
 * @param slug the exact slug to resolve
 * @returns the archived doc, or `undefined` when no safely-readable, correctly-slugged match exists
 */
export function lookupArchivedDoc({
  handoverDir,
  slug,
}: {
  handoverDir: string;
  slug: string;
}): HandoverDoc | undefined {
  return docAt({ path: join(handoverDir, "archive", `${slug}.md`), slug });
}

/**
 * Look up one doc by exact slug in the live board directory, then in its archive — two single-file reads,
 * never a scan. For a row whose file name its registering verb fixed as `<slug>.md` (a voice relay's row is
 * one); a doc filed under another name is not found here, and a caller says so rather than guessing.
 *
 * @param handoverDir the top-level handovers directory
 * @param slug the exact slug to resolve
 * @returns the doc, or `undefined` when neither place holds a safely-readable, correctly-slugged match
 */
export function lookupDocBySlug({ handoverDir, slug }: { handoverDir: string; slug: string }): HandoverDoc | undefined {
  const live = docAt({ path: join(handoverDir, `${slug}.md`), slug });
  if (live !== undefined) {
    return live;
  }
  return lookupArchivedDoc({ handoverDir, slug });
}

/** A doc one exact-slug read found, and whether it came from the archive. */
export interface ExactDoc {
  readonly doc: HandoverDoc;
  readonly archived: boolean;
}

/** A file sits at the exact slug's path and would not read whole, so nothing it says can be acted on. */
interface UnreadableExactDocError {
  readonly code: "DOC_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly why: string;
}

/** Constructors for {@link UnreadableExactDocError}. */
const ExactDocErrors = {
  unreadable: ({ path, why }: { path: string; why: string }): UnreadableExactDocError => ({
    code: "DOC_UNREADABLE",
    message: `${path}: ${why}`,
    path,
    why,
  }),
} as const;

/**
 * One doc by exact slug, live first then archived, telling ABSENT apart from present-but-unreadable.
 *
 * {@link lookupDocBySlug} folds both into `undefined`, which is right for a board that only wants the doc and
 * wrong for a reader that must never act on a missing answer: `../hand/evidence.ts` settles a card when its
 * row reads terminal, and "the file is there and would not parse" is not "nobody ever filed that row". The
 * same regular-file and size guard as every other read here.
 *
 * @param handoverDir the top-level handovers directory
 * @param slug the exact slug, already checked safe by the caller
 * @returns the doc and whether it came from the archive, `undefined` when neither path holds anything, or why
 *   the file there would not read
 */
export function readExactDoc({
  handoverDir,
  slug,
}: {
  handoverDir: string;
  slug: string;
}): Result<ExactDoc | undefined, UnreadableExactDocError> {
  const live = exactDocAt({ path: join(handoverDir, `${slug}.md`), slug });
  if (live.isErr() || live.value !== undefined) {
    return live.map((doc) => (doc === undefined ? undefined : { archived: false, doc }));
  }
  return exactDocAt({ path: join(handoverDir, "archive", `${slug}.md`), slug }).map((doc) =>
    doc === undefined ? undefined : { archived: true, doc },
  );
}

/**
 * The doc at one path, `undefined` when nothing is there, or why what is there would not read whole.
 *
 * @param path the file the slug names
 * @param slug the slug its front-matter must carry
 * @returns the doc, nothing, or the refusal
 */
function exactDocAt({
  path,
  slug,
}: {
  path: string;
  slug: string;
}): Result<HandoverDoc | undefined, UnreadableExactDocError> {
  if (!pathExists({ path })) {
    return ok(undefined);
  }
  if (!isReadableDoc({ path })) {
    return err(ExactDocErrors.unreadable({ path, why: "it is not a regular file of at most 2 MiB" }));
  }
  let doc: HandoverDoc;
  try {
    doc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    return err(ExactDocErrors.unreadable({ path, why: error instanceof Error ? error.message : "it would not parse" }));
  }
  if (doc.slug !== slug) {
    return err(ExactDocErrors.unreadable({ path, why: `its front-matter names slug ${doc.slug}` }));
  }
  // Each problem is named, not counted: a count left a refusal that sent the reader to find which six lines were wrong
  // (the close's approved-draft gate), and `handover lint --doc` already names them the same way.
  if (doc.problems.length > 0) {
    const named = doc.problems.join("; ");
    return err(
      ExactDocErrors.unreadable({
        path,
        why: `its front-matter has ${String(doc.problems.length)} problem(s): ${named}`,
      }),
    );
  }
  return ok(doc);
}

/** Whether anything at all sits at a path — a file, a directory, a FIFO — as opposed to nothing. */
function pathExists({ path }: { path: string }): boolean {
  try {
    statSync(path);
    return true;
  } catch (error: unknown) {
    return !(isRecord(error) && error["code"] === "ENOENT");
  }
}

/** The doc at one path when it is readable and carries exactly this slug; `undefined` otherwise. */
function docAt({ path, slug }: { path: string; slug: string }): HandoverDoc | undefined {
  if (!isReadableDoc({ path })) {
    return undefined;
  }
  let doc: HandoverDoc;
  try {
    doc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
  } catch {
    return undefined;
  }
  return doc.slug === slug ? doc : undefined;
}

/**
 * Markdown filenames in the directory, or none when the directory does not exist YET.
 *
 * Only `ENOENT` is treated as empty. The first version swallowed every failure, so a permissions error or a
 * bad mount reported "No orchestration docs" and hid every piece of planned work — a board that says nothing
 * is there is far worse than one that says it could not look. Found by a review pass, and it is the fifth
 * defect of this exact shape in this change: the tool resolving an ambiguity it should have reported.
 */
function listMarkdown({ handoverDir }: { handoverDir: string }): readonly string[] {
  try {
    return readdirSync(handoverDir)
      .filter((name) => name.endsWith(".md"))
      .toSorted();
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return [];
    }
    throw error;
  }
}
