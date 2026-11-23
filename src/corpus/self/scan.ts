/**
 * Walk the owner's own writing off the local filesystem — the read half of the `self` connector.
 *
 * A thin effectful shell around pure predicates. There is no network, no pagination and no rate limit here,
 * which is precisely why `self` is a full deterministic re-scan with no cursor: re-reading everything is free,
 * and it sidesteps `resolveSince`, which truncates a cursor to a calendar date and would either re-read the
 * whole corpus anyway or silently skip files.
 *
 * Three things it deliberately refuses to do:
 *
 *  - **Follow symlinks.** A link out of a root would silently widen the scan past what the operator named,
 *    and a link back into one would loop.
 *  - **Read a binary as if it were prose.** Density decides, not presence: see {@link ../sanitise.looksBinary}.
 *    A blob is refused whole, while a prose file carrying a few stray control bytes has them stripped and is
 *    kept — the previous rule condemned a file for a single NUL and lost 239 lines of real writing that way.
 *  - **Read anything inside `$SLOPWEAVER_HOME`.** The home holds bronze, gold and run journals — all of it
 *    derived from the corpus. Scanning it would ingest the engine's own output as though it were the owner's thinking,
 *    and grow on every run.
 *
 * What it no longer does is refuse in SILENCE. Every entry the walk sees and does not take is recorded with a
 * typed reason ({@link ./skips}), because the previous version discarded those decisions and three files could
 * disappear from a root with nothing printed at all.
 */
import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { appendAll } from "../../lib/arrays.js";
import { looksBinary, stripControlBytes } from "../sanitise.js";
import { ALLOW_LARGE_FILES, type SelfSkip, type SelfSkipReason } from "./skips.js";

/**
 * The extensions the corpus is read from. Anything else is declined with a NAMED reason (see {@link ./skips}).
 *
 * `.markdown`, `.mdc`, `.rst`, `.org` and `.csv` are read because of what the previous
 * two-extension list was throwing away: in one scratch root a plain `.markdown` file vanished with no mention
 * at all, and across the real roots 83 `.mdc` files — Markdown by another name — were never once reported.
 * All five are plain text, so reading them costs nothing beyond the walk that already found them.
 *
 * Formats that are NOT text remain declined, and deliberately so: turning a PNG or a PDF into corpus text
 * needs extraction, which is a model decision rather than an extension-list edit.
 */
const SELF_FILE_EXTENSIONS: readonly string[] = [".md", ".markdown", ".mdc", ".txt", ".rst", ".org", ".csv"];

/** Directory names never walked. `.git` is history, not writing; `node_modules` is nobody's thinking. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", ".cache", ".venv"]);

/**
 * The per-file size ceiling. Generous — the largest real file measured is 961KB and it is ingested whole —
 * but bounded, so a stray database dump with a `.txt` name cannot be read into memory.
 *
 * This is OUR bound, not the filesystem's, which is why it is the one skip class with a documented way
 * through: exceeding it is reported as a `too-large` skip whose message names {@link ALLOW_LARGE_FILES}.
 * Blocking by default while always offering a break-glass is the house pattern for a guardrail — a hard
 * block with no escape gets worked around, and a soft warning gets ignored.
 */
export const SELF_FILE_MAX_BYTES = 16 * 1024 * 1024;

/** One scanned file: everything the projector needs, and nothing that needs a second filesystem read. */
export interface SelfFile {
  /** Absolute path — becomes the record's `url`, because the consumer is a local human clicking it. */
  readonly absPath: string;
  /** Path relative to its root, POSIX-separated, so a `sourceId` is stable regardless of where the root sits. */
  readonly relPath: string;
  /** The root's directory name (not its absolute path — the record must not carry an absolute path prefix). */
  readonly rootName: string;
  /** The absolute root this file was found under, so the git query can be keyed per root. */
  readonly root: string;
  /** The file's full text, control bytes already stripped. */
  readonly text: string;
  /** Filesystem mtime as an ISO instant — the last rung of the event-time ladder. */
  readonly mtimeIso: string;
  /**
   * How many control bytes were removed on the way in. Carried rather than discarded so a completeness
   * check can report that the bytes on disk and the bytes in the record legitimately differ — an
   * unexplained difference is loss, and this is what makes this particular difference explained.
   */
  readonly controlBytesStripped: number;
}

/** The scan's outcome: the files, every entry declined and why, and the human warnings. */
export interface SelfScanResult {
  readonly files: readonly SelfFile[];
  /**
   * Every entry the walk SAW and did not ingest, each carrying a typed reason.
   *
   * This is the field the discovery conservation identity is computed from: `seen = read + declined`. It
   * exists because the previous walk discarded its own skip decisions, so three files could vanish from a
   * root while every count the run printed stayed perfectly balanced — `ingested` only ever counted rows
   * that were READ, so a file never read appeared on neither side of the law.
   */
  readonly skips: readonly SelfSkip[];
  readonly warnings: readonly string[];
}

/**
 * Whether a filename is part of the corpus. Pure.
 *
 * @param name the file's base name
 * @returns true when its extension is one the corpus is made of
 */
export function isSelfCorpusFile({ name }: { name: string }): boolean {
  const lower = name.toLowerCase();
  return SELF_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Whether an entry sits under a path the operator excluded. Pure.
 *
 * A relative-path PREFIX rather than a glob, deliberately: there is no glob engine in this repo to reuse,
 * and a prefix answers the actual question without inventing one — "do not ingest this subtree". Comparison
 * is on the POSIX-separated relative path, so an exclusion is stable wherever the root is mounted.
 *
 * This exists because the corpus was measured to be 17.6% vendored prior-art from another organisation,
 * every record of it attributed to the profile owner, with no way to say no.
 *
 * @param relPath the entry's path relative to its root
 * @param exclude the operator's excluded prefixes
 * @returns true when the entry is under one of them
 */
function isExcludedPath({ relPath, exclude }: { relPath: string; exclude: readonly string[] }): boolean {
  return exclude.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));
}

/**
 * Whether a directory should be walked. Pure.
 *
 * @param name the directory's base name
 * @returns true when the walk must not descend into it
 */
export function isSkippedDirectory({ name }: { name: string }): boolean {
  return SKIPPED_DIRECTORIES.has(name);
}

/**
 * Whether a path sits inside the Slopweaver home, which must never be scanned. Compares path SEGMENTS, so a
 * sibling directory whose name merely starts with the home's name is not caught by accident. Pure.
 *
 * @param path the candidate absolute path
 * @param home the absolute Slopweaver home
 * @returns true when `path` is the home or lies beneath it
 */
export function isInsideHome({ path, home }: { path: string; home: string }): boolean {
  const rel = relative(home, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== path);
}

/**
 * Read one file into a {@link SelfFile}, or say — with a typed reason — why it was not read.
 *
 * Two behaviours here are deliberate reversals of what this function used to do:
 *
 *  - **The size ceiling names its escape hatch.** It is our bound, not the disk's, so refusing without
 *    saying how to proceed just moves the problem into the operator's head.
 *  - **A few control bytes no longer cost the whole file.** The old test was "contains a NUL ⇒ binary",
 *    which threw away a real file for one stray byte. {@link ../sanitise.looksBinary} tests DENSITY, so a
 *    genuine blob is still refused while a prose file carrying an escape sequence is cleaned and kept —
 *    and the cleaning is reported rather than done quietly.
 */
function readSelfFile({
  absPath,
  root,
  maxBytes,
}: {
  absPath: string;
  root: string;
  maxBytes: number;
}): { file: SelfFile } | { reason: SelfSkipReason; detail: string } {
  const stat = statSync(absPath);
  if (stat.size > maxBytes) {
    return {
      detail: `${String(stat.size)} bytes exceeds the ${String(maxBytes)}-byte ceiling — set ${ALLOW_LARGE_FILES}=1 to read it anyway`,
      reason: "too-large",
    };
  }
  const raw = readFileSync(absPath, "utf8");
  if (looksBinary({ text: raw })) {
    return { detail: "control bytes are dense enough that this is a blob, not prose", reason: "binary-content" };
  }
  const cleaned = stripControlBytes({ text: raw });
  return {
    file: {
      absPath,
      controlBytesStripped: cleaned.removed,
      mtimeIso: stat.mtime.toISOString(),
      relPath: relative(root, absPath).split(sep).join("/"),
      root,
      rootName: selfRootName({ root }),
      text: cleaned.text,
    },
  };
}

/**
 * A root's short NAME, guaranteed non-empty.
 *
 * `basename` is empty for a filesystem root (`"/"`), and a review pass showed what that costs: the record's
 * `container` became `""`, the bronze reader rejected the row (container must be non-empty), the dedup index
 * therefore never saw it, and every re-scan appended the same record again — a duplicate on every run, forever,
 * with each run reporting a successful write. The name is used in `container` and in every `sourceId`, so it
 * being non-empty is load-bearing rather than cosmetic. Pure.
 *
 * @param root the absolute root path
 * @returns the root's directory name, or `"root"` when it has none
 */
export function selfRootName({ root }: { root: string }): string {
  const name = basename(root);
  return name.length > 0 ? name : "root";
}

/** Stat one root, returning whether it is a directory or why it could not be read (never throwing). */
function statRoot({ root }: { root: string }): { isDirectory: boolean } | { error: string } {
  try {
    return { isDirectory: statSync(root).isDirectory() };
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * What the walk should do with one directory entry, decided from the entry alone.
 *
 * The previous version of this returned a bare `"skip"` for four unrelated situations and the walker then
 * DISCARDED it, which is precisely how three files could disappear from a root with nothing printed. It now
 * returns the REASON, so every declined entry can be counted and named. Pure.
 *
 * @param entry the directory entry
 * @param absPath the entry's absolute path
 * @param home the Slopweaver home, which is never scanned
 * @param relPath the entry's path relative to its root
 * @param exclude relative-path prefixes the operator excluded
 * @returns `descend` or `read` for an entry the walk takes, else the typed reason it is declined
 */
function entryAction({
  entry,
  absPath,
  home,
  relPath,
  exclude,
}: {
  entry: Dirent;
  absPath: string;
  home: string;
  relPath: string;
  exclude: readonly string[];
}): { take: "descend" | "read" } | { decline: SelfSkipReason } {
  if (isExcludedPath({ exclude, relPath })) {
    return { decline: "excluded-path" };
  }
  if (entry.isSymbolicLink()) {
    return { decline: "symlink" };
  }
  if (isInsideHome({ home, path: absPath })) {
    return { decline: "inside-home" };
  }
  if (entry.isDirectory()) {
    return isSkippedDirectory({ name: entry.name }) ? { decline: "excluded-directory" } : { take: "descend" };
  }
  if (!entry.isFile()) {
    // A socket, a FIFO or a device node. Not writing, and not a directory either.
    return { decline: "unsupported-extension" };
  }
  return isSelfCorpusFile({ name: entry.name }) ? { take: "read" } : { decline: "unsupported-extension" };
}

/** Read one entry's file into the accumulator, or record the typed reason it was not read. */
function collectFile({
  absPath,
  root,
  maxBytes,
  into,
  skips,
}: {
  absPath: string;
  root: string;
  maxBytes: number;
  into: SelfFile[];
  skips: SelfSkip[];
}): void {
  const read = readSelfFile({ absPath, maxBytes, root });
  if ("file" in read) {
    into.push(read.file);
    return;
  }
  skips.push({ detail: read.detail, reason: read.reason, relPath: selfRelPath({ absPath, root }) });
}

/** An entry's path relative to its root, POSIX-separated — never absolute, so no home directory is carried. */
function selfRelPath({ absPath, root }: { absPath: string; root: string }): string {
  return relative(root, absPath).split(sep).join("/");
}

/** One directory's entries in a deterministic order, or the reason it could not be listed. */
function sortedEntries({ dir }: { dir: string }): { entries: readonly Dirent[] } | { error: string } {
  try {
    return { entries: readdirSync(dir, { withFileTypes: true }).toSorted((a, b) => (a.name < b.name ? -1 : 1)) };
  } catch (error) {
    return { error: String(error) };
  }
}

/** Recursively collect one root's corpus files, recording a typed skip for every entry not taken. */
function walkRoot({
  dir,
  root,
  home,
  maxBytes,
  exclude,
  into,
  skips,
}: {
  dir: string;
  root: string;
  home: string;
  maxBytes: number;
  exclude: readonly string[];
  into: SelfFile[];
  skips: SelfSkip[];
}): void {
  const listed = sortedEntries({ dir });
  if ("error" in listed) {
    skips.push({ detail: listed.error, reason: "unreadable", relPath: selfRelPath({ absPath: dir, root }) });
    return;
  }
  for (const entry of listed.entries) {
    const absPath = join(dir, entry.name);
    const relPath = selfRelPath({ absPath, root });
    const action = entryAction({ absPath, entry, exclude, home, relPath });
    if ("decline" in action) {
      skips.push({ detail: "", reason: action.decline, relPath: selfRelPath({ absPath, root }) });
    } else if (action.take === "descend") {
      walkRoot({ dir: absPath, exclude, home, into, maxBytes, root, skips });
    } else {
      collectFile({ absPath, into, maxBytes, root, skips });
    }
  }
}

/**
 * Scan every root for the owner's own writing.
 *
 * A root that does not exist is a WARNING and the scan continues over the rest: an operator with one of two
 * directories present should still get that one ingested, and a typo should say so rather than look like an
 * empty corpus.
 *
 * @param roots the absolute directories to walk, in order
 * @param home the absolute Slopweaver home, never scanned (see the module note)
 * @param exclude relative-path prefixes to decline, each reported as a named `excluded-path` skip
 * @param maxBytes the per-file size ceiling (defaults to {@link SELF_FILE_MAX_BYTES}; the caller lifts it
 *   when {@link ALLOW_LARGE_FILES} is set, so this function stays free of an environment read)
 * @returns the files found, every entry declined with its typed reason, and the human warnings
 */
export function scanSelfCorpus({
  roots,
  home,
  maxBytes = SELF_FILE_MAX_BYTES,
  exclude = [],
}: {
  roots: readonly string[];
  home: string;
  maxBytes?: number;
  exclude?: readonly string[];
}): SelfScanResult {
  const files: SelfFile[] = [];
  const skips: SelfSkip[] = [];
  const warnings: string[] = [];
  for (const root of roots) {
    const statted = statRoot({ root });
    // A ROOT that cannot be walked is a configuration problem, not an entry the walk declined, so it stays a
    // warning and never enters `skips` — otherwise it would be reported twice, once as a warning and again
    // through `selfFaultWarnings`, and the discovery arithmetic would count a root as though it were a file.
    if ("error" in statted) {
      warnings.push(`root not readable, skipped: ${basename(root)} (${statted.error})`);
      continue;
    }
    if (!statted.isDirectory) {
      warnings.push(`root is not a directory, skipped: ${basename(root)}`);
      continue;
    }
    const found: SelfFile[] = [];
    walkRoot({ dir: root, exclude, home, into: found, maxBytes, root, skips });
    // `appendAll`, never `push(...)`: the spread-argument limit is around 124k and stack-dependent, and this
    // corpus is measured at 4,842 files today with no ceiling on what a root may grow to.
    appendAll({ from: found, into: files });
  }
  return { files, skips, warnings };
}
