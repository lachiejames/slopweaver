/**
 * Which files of a ChatGPT data export carry the conversations, and how they are read out of the zip the owner
 * downloads.
 *
 * ## Identified by its members, never its name
 *
 * The download's file name is a hash and a timestamp OpenAI may change at will, and `chat.html` beside the data is
 * a viewer that not every export generation carries. What every export has is its conversations file:
 * `conversations.json`, or — for a large account — a numbered run of them (`conversations-000.json`, …;
 * OpenAI's help centre says a large export splits, and the separator is matched either way rather than guessed).
 * So an archive is an export when it holds that member set, and nothing else is consulted.
 *
 * ## Read with the system `unzip`, streamed to disk
 *
 * No zip library is a dependency here and macOS ships `/usr/bin/unzip`. A conversations file can be hundreds of
 * megabytes, so a member is never captured into a JavaScript string: `unzip -p` writes straight into a file
 * descriptor opened for it (`.claude/rules/typescript-patterns.md` § data-sized payloads), through a byte limit held
 * while it writes ({@link BOUNDED_UNZIP}): a zip found in Downloads is untrusted, and one whose
 * member inflates without end must stop at the export's byte budget (`exportSource.ts`). The two process edges
 * are a plain injected seam ({@link ChatgptArchiveDeps}) so a test drives the selection and the store with a fake
 * that writes files, and no test launches a process.
 */
import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readdirSync, readSync, type Stats, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";

/** A conversations file's own name: the single file, or one of a numbered run. */
export const CONVERSATIONS_FILE = /^conversations(?:[-_](\d+))?\.json$/;

/** A name the export may have given its conversations in a shape this reader does not know: refused, never skipped. */
const CONVERSATIONS_LOOKALIKE = /^conversations/i;

/** The page every ChatGPT export carries beside its conversations, so an archive holding it is an export. */
const EXPORT_PAGE = "chat.html";

/** The system unzip — absolute, so a `PATH` entry cannot stand in for it. */
const UNZIP = "/usr/bin/unzip";

/** One conversations file inside an export: where it sits, and the flat name it is stored under. */
export interface ConversationMember {
  /** Its path inside the archive or directory, as listed. */
  readonly member: string;
  /** Its own file name — what it is stored as, and what orders the run. */
  readonly name: string;
}

/** The two process edges an archive read needs. Production is {@link unzipArchiveDeps}. */
export interface ChatgptArchiveDeps {
  /** Every member name in the zip, as `unzip -Z1` lists them. */
  readonly listZip: (args: { zipPath: string }) => Result<readonly string[], ChatgptExportError>;
  /** Write one member's bytes to a file that does not exist yet, refusing once it would pass `maxBytes`. */
  readonly extractZipMember: (args: {
    zipPath: string;
    member: string;
    toPath: string;
    maxBytes: number;
  }) => Result<void, ChatgptExportError>;
}

/** The order a numbered run reads in: the bare file first, then by number. */
function runIndex({ name }: { name: string }): number {
  const digits = CONVERSATIONS_FILE.exec(name)?.[1];
  return digits === undefined ? -1 : Number(digits);
}

/**
 * The conversations files among an archive's or directory's member names, refused when the set is unsafe to
 * extract or is not one export.
 *
 * A member at the top level or one directory down (a re-zipped export folder) counts. Every other shape a
 * conversations file can take is refused rather than skipped, because a skipped file is history the refresh would
 * receipt without having read: a candidate deeper than one folder, or naming `..`, `.` or an absolute path, was not
 * laid out by the export. Two candidates with one file name or one run number, candidates under two different
 * folders, or a single file beside a numbered run, are two exports in one archive and are refused rather than
 * merged. A numbered run must count up from 0 with no number missing: a missing file is a whole file of history the
 * refresh would otherwise receipt without ever knowing it existed. The run starting at 0 is taken from the export's
 * own numbering as this repository's fixture carries it, not from a real split export; a real one that starts
 * elsewhere is refused by name, never read short. So is a file named like conversations in a shape this reader does
 * not know (`conversations-part-000.json`), and an archive carrying the export's own `chat.html` but no conversations
 * file it knows: either is an export whose history would otherwise be passed over as an unrelated zip.
 *
 * @param names every member name, as listed
 * @param path the archive or directory, named in a refusal
 * @returns the conversations files, bare file first then by number
 */
export function selectConversationMembers({
  names,
  path,
}: {
  names: readonly string[];
  path: string;
}): Result<readonly ConversationMember[], ChatgptExportError> {
  const found: ConversationMember[] = [];
  const folders = new Set<string>();
  for (const member of names) {
    const segments = member.split("/");
    // Named across either separator, so a backslashed candidate is seen — and refused below — not skipped.
    const name = member.split(/[/\\]/).at(-1)!;
    if (!CONVERSATIONS_FILE.test(name)) {
      if (CONVERSATIONS_LOOKALIKE.test(name)) {
        const why = "a conversations file named in a shape this reader does not know, so its history would go unread";
        return err(ChatgptExportErrors.unsafeMember({ member, why }));
      }
      continue;
    }
    const why = memberRefusal({ found, member, name, segments });
    if (why !== undefined) {
      return err(ChatgptExportErrors.unsafeMember({ member, why }));
    }
    folders.add(segments.length === 2 ? segments[0]! : "");
    found.push({ member, name });
  }
  if (found.length === 0) {
    return exportPageRefusal({ names, path });
  }
  const ordered = found.toSorted((a, b) => runIndex({ name: a.name }) - runIndex({ name: b.name }));
  const refused = setRefusal({ folders, ordered });
  if (refused !== undefined) {
    return err(ChatgptExportErrors.unsafeMember({ member: ordered[0]!.member, why: refused }));
  }
  return ok(ordered);
}

/**
 * An archive with no conversations file this reader knows: not an export, unless it carries the export's own page,
 * when it is one whose conversations went unrecognised and is refused by that page.
 */
function exportPageRefusal({
  names,
  path,
}: {
  names: readonly string[];
  path: string;
}): Result<never, ChatgptExportError> {
  const page = names.find((member) => member.split(/[/\\]/).at(-1)!.toLowerCase() === EXPORT_PAGE);
  if (page === undefined) {
    return err(ChatgptExportErrors.notAnExport({ path }));
  }
  const why =
    "a ChatGPT export's page with no conversations file this reader knows beside it, so its history would go unread";
  return err(ChatgptExportErrors.unsafeMember({ member: page, why }));
}

/** Why one conversations-file candidate is refused, given those already found — or `undefined` when it stands. */
function memberRefusal({
  found,
  member,
  name,
  segments,
}: {
  found: readonly ConversationMember[];
  member: string;
  name: string;
  segments: readonly string[];
}): string | undefined {
  if (member.startsWith("/") || member.includes("\\")) {
    return "an absolute or backslashed path";
  }
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return "a path that climbs out of the archive";
  }
  if (segments.length > 2) {
    return "a conversations file deeper than one folder down";
  }
  if (found.some((existing) => existing.name === name)) {
    return "a second member with the same file name";
  }
  if (found.some((existing) => runIndex({ name: existing.name }) === runIndex({ name }))) {
    return "a second conversations file with the same number";
  }
  return undefined;
}

/** Why the whole set of candidates is not one export — or `undefined` when it is. */
function setRefusal({
  folders,
  ordered,
}: {
  folders: ReadonlySet<string>;
  ordered: readonly ConversationMember[];
}): string | undefined {
  if (folders.size > 1) {
    return "conversations files under two folders";
  }
  if (ordered.length > 1 && runIndex({ name: ordered[0]!.name }) === -1) {
    return "a single conversations file beside a numbered run";
  }
  if (runIndex({ name: ordered[0]!.name }) === -1) {
    return undefined;
  }
  const gap = ordered.findIndex((member, position) => runIndex({ name: member.name }) !== position);
  if (gap !== -1) {
    return `a numbered run with no file numbered ${String(gap)}, so a whole file of the owner's history would go unread`;
  }
  return undefined;
}

/**
 * Whether a file is a zip, by its first four bytes rather than its extension.
 *
 * @param path the file
 * @returns true for a local-file or empty-archive zip signature
 */
export function isZipFile({ path }: { path: string }): boolean {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(4);
    const read = readSync(fd, head, 0, 4, 0);
    return read === 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
  } finally {
    closeSync(fd);
  }
}

/**
 * A member name as `unzip` reads a pattern: its wildcard characters escaped, so a folder named `a[1]` is the
 * folder and not a character class.
 */
function literalPattern({ member }: { member: string }): string {
  return member.replace(/[\\*?[\]]/g, (char) => `\\${char}`);
}

/**
 * `unzip -p` piped through `head -c`, which writes at most its count and then closes the pipe, so `unzip` dies on its
 * next write: a member that inflates without end is cut off at the limit WHILE it is written, never after it has
 * filled the disk. Byte-exact on every POSIX `sh`, where `ulimit -f` is not — its unit is 512 bytes under one shell
 * and 1024 under another (measured: macOS `/bin/sh` stopped a 1 MiB limit at 2 MiB). `head` takes one byte past the
 * limit so an over-long member is told from one exactly at it, and `unzip`'s own exit status, which a pipe would
 * hide, comes back on stderr as {@link UNZIP_EXIT}. Every value reaches the script as a positional argument, never
 * interpolated into it.
 */
const BOUNDED_UNZIP = '{ "$0" -p "$1" "$2"; echo "unzip-exit:$?" >&2; } | /usr/bin/head -c "$3"';

/** The stderr line {@link BOUNDED_UNZIP} reports `unzip`'s exit status on. */
const UNZIP_EXIT = /^unzip-exit:(\d+)$/m;

/** Run one bounded extraction into `fd`: whether `unzip` exited 0, and what it said on stderr. */
function boundedUnzip({
  fd,
  maxBytes,
  member,
  zipPath,
}: {
  fd: number;
  maxBytes: number;
  member: string;
  zipPath: string;
}): { readonly clean: boolean; readonly detail: string } {
  const run = spawnSync(
    "/bin/sh",
    ["-c", BOUNDED_UNZIP, UNZIP, zipPath, literalPattern({ member }), String(maxBytes + 1)],
    { maxBuffer: 1024 * 1024, stdio: ["ignore", fd, "pipe"] },
  );
  if (run.error !== undefined) {
    return { clean: false, detail: run.error.message };
  }
  const stderr = run.stderr.toString("utf8");
  const clean = run.status === 0 && UNZIP_EXIT.exec(stderr)?.[1] === "0";
  return { clean, detail: stderr.replace(UNZIP_EXIT, "").trim() };
}

/**
 * Whether one member is stored as a symbolic link: `unzip -p` writes a link's TARGET as its contents, so a link
 * whose target reads `[]` would arrive as a clean, empty conversations file. `unzip -Z` prints the member's Unix
 * mode, and a link's opens `l`; a zip made elsewhere carries no mode for a link to hide behind.
 */
function memberIsLink({ zipPath, member }: { zipPath: string; member: string }): Result<boolean, ChatgptExportError> {
  const run = spawnSync(UNZIP, ["-Z", zipPath, literalPattern({ member })], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (run.error !== undefined || run.status !== 0) {
    const detail = run.error !== undefined ? run.error.message : run.stderr.trim();
    return err(ChatgptExportErrors.archiveUnreadable({ detail, path: zipPath }));
  }
  return ok(run.stdout.startsWith("l"));
}

/** The production edges, over `/usr/bin/unzip`. */
export const unzipArchiveDeps: ChatgptArchiveDeps = {
  extractZipMember: ({ zipPath, member, toPath, maxBytes }) => {
    const link = memberIsLink({ member, zipPath });
    if (link.isErr()) {
      return err(link.error);
    }
    if (link.value) {
      return err(ChatgptExportErrors.unsafeMember({ member, why: "a symbolic link" }));
    }
    let fd: number;
    try {
      fd = openSync(toPath, "wx", 0o600);
    } catch (cause) {
      return err(ChatgptExportErrors.exportStoreFailed({ cause, path: toPath }));
    }
    try {
      const run = boundedUnzip({ fd, maxBytes, member, zipPath });
      // Past the limit first: `unzip` dies of the closed pipe there, so its status says nothing about the archive.
      if (fstatSync(fd).size > maxBytes) {
        return err(ChatgptExportErrors.exportTooLarge({ limitBytes: maxBytes, path: zipPath }));
      }
      if (!run.clean) {
        return err(ChatgptExportErrors.archiveUnreadable({ detail: run.detail, path: zipPath }));
      }
      return ok(undefined);
    } finally {
      closeSync(fd);
    }
  },
  listZip: ({ zipPath }) => {
    // The listing is names only — kilobytes for an export — so it is the one output captured in memory.
    const run = spawnSync(UNZIP, ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (run.error !== undefined || run.status !== 0) {
      const detail = run.error !== undefined ? run.error.message : run.stderr.trim();
      return err(ChatgptExportErrors.archiveUnreadable({ detail, path: zipPath }));
    }
    return ok(run.stdout.split("\n").filter((line) => line.length > 0));
  },
};

/**
 * Every `.zip` entry that is a file, with its modified time. One that will not even stat is as unknown as one that
 * will not list, so it is refused the same way; one gone between the listing and the stat is passed over, since
 * nothing is left there to sit unread.
 */
function statZips({
  dir,
  entries,
}: {
  dir: string;
  entries: readonly string[];
}): Result<readonly { mtimeMs: number; path: string }[], ChatgptExportError> {
  const statted: { mtimeMs: number; path: string }[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    let stat: Stats;
    try {
      stat = statSync(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      const detail = `could not read the archive ${path}: ${error instanceof Error ? error.message : String(error)}`;
      return err(ChatgptExportErrors.unlistableZip({ detail, path }));
    }
    if (stat.isFile()) {
      statted.push({ mtimeMs: stat.mtimeMs, path });
    }
  }
  return ok(statted);
}

/**
 * The newest ChatGPT export zip in a directory, identified by what it holds.
 *
 * Lists EVERY zip there, newest first, and answers every one whose members are an export, not only the newest: a held
 * export re-saved after a newer one must not stand in front of it, and only taking each in can tell which is already
 * held. No count caps the scan, because a capped one passes over whatever sits past the cap — twenty newer unrelated
 * zips would hide an unreadable export behind them and let the sync certify the older corpus. Listing reads only a
 * zip's central directory, one `unzip -Z1` each. A zip `unzip` cannot list, and a zip that LISTS conversations
 * files that are not one whole export — one too deep, two runs, a number missing — are each refused by name: passing
 * either over would let a sync certify the older corpus as current while the export the owner just downloaded sat unread.
 * The unlistable one may be an unrelated broken zip, and refusing costs the owner one move out of the folder; it is never
 * a download Chrome or Safari still has in flight, because they write under a temporary name (`.crdownload`,
 * `.download`) and rename to `.zip` only once the file is whole. A browser that writes the final name as it goes
 * (Firefox, beside a `.part`) fails the one sync that lands mid-download, and the next one passes.
 *
 * @param dir the directory to look in
 * @param archive the process edges
 * @returns the export zips' paths, newest first, empty when none of the zips there is an export; or the refusal
 *   naming a zip that will not list, or holds conversations files but not as one whole export
 */
export function findExportArchives({
  dir,
  archive,
}: {
  dir: string;
  archive: ChatgptArchiveDeps;
}): Result<readonly string[], ChatgptExportError> {
  let entries: readonly string[];
  try {
    entries = readdirSync(dir).filter((entry) => entry.toLowerCase().endsWith(".zip"));
  } catch {
    return err(ChatgptExportErrors.exportPathMissing({ path: dir }));
  }
  const statted = statZips({ dir, entries });
  if (statted.isErr()) {
    return err(statted.error);
  }
  const zips = statted.value.toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  const exportZips: string[] = [];
  for (const zip of zips) {
    const names = archive.listZip({ zipPath: zip.path });
    if (names.isErr()) {
      return err(ChatgptExportErrors.unlistableZip({ detail: names.error.message, path: zip.path }));
    }
    const selected = selectConversationMembers({ names: names.value, path: zip.path });
    if (selected.isOk()) {
      exportZips.push(zip.path);
    } else if (selected.error.code !== "NOT_AN_EXPORT") {
      return err(ChatgptExportErrors.malformedExport({ detail: selected.error.message, path: zip.path }));
    }
  }
  return ok(exportZips);
}
