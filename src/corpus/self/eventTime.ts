/**
 * When did the owner actually think this? Resolving a `self` file's event time, and — just as importantly —
 * recording WHICH evidence the answer came from.
 *
 * ## mtime lies, and git does not
 *
 * A long editing session appends to a file, so mtime is when the owner last touched it rather than when the
 * thought was had. One root is a real git repository (552 commits), so `git log --diff-filter=A` gives the commit that
 * FIRST added a path, which is the closest thing on disk to the moment the thought was written down.
 *
 * ## The other root is not a git repository, and that is not fixable here
 *
 * The notes directory has no history at all, so nothing in it has a trustworthy event time. The rule this repo
 * keeps re-learning is that a guessed value which READS as measured is worse than an admitted gap, so the
 * fallback ladder is explicit and every record carries `attrs.timeSource` naming which rung it landed on:
 *
 *   `git` → `frontmatter` → `filename` → `mtime`
 *
 * Only `git` is evidence of when it was written. `frontmatter` and `filename` are what the owner declared.
 * `mtime` is a filesystem fact about the file, not about the thought, and saying so on the record is the whole
 * point — a retrieval answer citing a `mtime` record can be read for what it is.
 *
 * ## One git call, not one per file
 *
 * Per-file `git log` over 4,842 files is thousands of processes. This runs the whole history ONCE and builds a
 * path → first-added map; `--reverse` means the first sighting of a path in the stream is its earliest add.
 * `execFileSync`'s 1 MiB `maxBuffer` default truncates that stream, so it is raised deliberately.
 */
import { execFileSync } from "node:child_process";

/** Which evidence a record's `tsIso` came from. Carried on every `self` record as `attrs.timeSource`. */
export type SelfTimeSource = "git" | "frontmatter" | "filename" | "mtime";

/**
 * The git invocation that yields every path's FIRST-ADD date, as one stream.
 *
 * Exported as data rather than inlined so the pure parser below and the effectful runner cannot drift on the
 * format they agree about. `%x00` prefixes each commit so the parser can tell a date line from a path line;
 * `core.quotePath=false` stops git escaping non-ASCII paths (this corpus has plenty).
 */
export const GIT_FIRST_ADDED_ARGS: readonly string[] = [
  "-c",
  "core.quotePath=false",
  "log",
  "--reverse",
  "--diff-filter=A",
  "--format=%x00%aI",
  "--name-only",
];

/** How much git-log output to accept before failing loudly. 552 commits of this corpus produce well under 8 MiB. */
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** A `YYYY-MM-DD` anywhere in a string (the first one wins). */
const DATE_IN_TEXT = /(\d{4})-(\d{2})-(\d{2})/;

/** A `date:` / `created:` / `updated:` key in YAML frontmatter, capturing whatever follows it. */
// `[ \t]*` rather than `\s*`: `\s` matches a newline, which under the `m` flag can exchange characters with
// the trailing `.+` and gives a super-linear backtracking path.
const FRONTMATTER_DATE = /^(?:date|created|updated)[ \t]*:[ \t]*(\S.*)$/im;

/**
 * Parse the {@link GIT_FIRST_ADDED_ARGS} stream into a repo-relative-path → first-add ISO map. Pure.
 *
 * Because the log is `--reverse`d, the first time a path appears is its earliest add, so a later re-add (a
 * delete-then-restore, or a rename back to an old name) never overwrites the earlier date.
 *
 * @param stdout the raw git-log output
 * @returns path → the ISO instant of the commit that first added it
 */
export function parseGitFirstAdded({ stdout }: { stdout: string }): ReadonlyMap<string, string> {
  const firstAdded = new Map<string, string>();
  // The separator is written as an ESCAPE, never as a literal NUL byte: a raw 0x00 makes a `.ts` file
  // read as binary, which hides it from pull-request review and hard-refuses the Codex review pass.
  for (const commit of stdout.split("\u0000")) {
    const lines = commit.split("\n");
    const iso = lines[0]?.trim();
    if (iso === undefined || iso.length === 0) {
      continue;
    }
    for (const path of lines.slice(1)) {
      const trimmed = path.trim();
      if (trimmed.length > 0 && !firstAdded.has(trimmed)) {
        firstAdded.set(trimmed, iso);
      }
    }
  }
  return firstAdded;
}

/**
 * Run the whole-history git query for one root and parse it. Returns an EMPTY map when the root is not a git
 * repository (which the notes root is not) — an expected state, reported by the caller rather than thrown.
 *
 * @param root the absolute directory to query
 * @returns path → first-add ISO for every path git ever added under `root`, empty when there is no history
 */
export function gitFirstAddedDates({ root }: { root: string }): ReadonlyMap<string, string> {
  try {
    const stdout = execFileSync("git", ["-C", root, ...GIT_FIRST_ADDED_ARGS], {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseGitFirstAdded({ stdout });
  } catch {
    return new Map<string, string>();
  }
}

/**
 * The date the author DECLARED in the file's own YAML frontmatter, if any. Only the leading `---` block is
 * consulted, so a `date:` line in the body cannot be mistaken for the document's date. Pure.
 *
 * @param text the file's full text
 * @returns the ISO instant (midnight UTC of the declared day), or undefined
 */
export function dateFromFrontmatter({ text }: { text: string }): string | undefined {
  if (!text.startsWith("---\n")) {
    return undefined;
  }
  const end = text.indexOf("\n---", 4);
  const block = end === -1 ? text.slice(4) : text.slice(4, end);
  const declared = FRONTMATTER_DATE.exec(block)?.[1];
  return declared === undefined ? undefined : isoFromDateText({ text: declared });
}

/**
 * The date embedded in a path, as the owner's own filenames carry it (`YYYY-MM-DD-some-note.md`, or a
 * `daily/YYYY-MM-DD/` directory). Pure.
 *
 * @param relPath the file's path relative to its root
 * @returns the ISO instant (midnight UTC of that day), or undefined
 */
export function dateFromPath({ relPath }: { relPath: string }): string | undefined {
  return isoFromDateText({ text: relPath });
}

/**
 * The first `YYYY-MM-DD` in a string as an ISO instant at midnight UTC, rejecting impossible dates so a
 * version string like `1999-99-99` cannot become a timestamp. Pure.
 *
 * @param text the text to search
 * @returns the ISO instant, or undefined when there is no valid date
 */
function isoFromDateText({ text }: { text: string }): string | undefined {
  const match = DATE_IN_TEXT.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, year, month, day] = match;
  const iso = `${year!}-${month!}-${day!}T00:00:00.000Z`;
  const parsed = new Date(iso);
  // `getTime()` is NaN for an unparseable date, and the round-trip catches an overflowed one (the 31st of a
  // 28-day month parses, then reads back as the next month) — either way it is not a date a note could have been written on.
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== iso ? undefined : iso;
}

/** A resolved event time plus the evidence it rests on. */
export interface ResolvedEventTime {
  readonly tsIso: string;
  readonly timeSource: SelfTimeSource;
}

/**
 * Resolve a file's event time down the evidence ladder, naming the rung it landed on. Pure — every input,
 * including the filesystem mtime, is supplied by the caller.
 *
 * @param gitIso the first-add instant from git history, when the root has history and knows this path
 * @param text the file's full text (searched for a frontmatter date)
 * @param relPath the file's path relative to its root (searched for a date)
 * @param mtimeIso the filesystem mtime as ISO — the last resort, and marked as such
 * @returns the instant plus which evidence produced it
 */
export function resolveEventTime({
  gitIso,
  text,
  relPath,
  mtimeIso,
}: {
  gitIso: string | undefined;
  text: string;
  relPath: string;
  mtimeIso: string;
}): ResolvedEventTime {
  if (gitIso !== undefined && gitIso.length > 0) {
    return { timeSource: "git", tsIso: gitIso };
  }
  const frontmatter = dateFromFrontmatter({ text });
  if (frontmatter !== undefined) {
    return { timeSource: "frontmatter", tsIso: frontmatter };
  }
  const fromPath = dateFromPath({ relPath });
  if (fromPath !== undefined) {
    return { timeSource: "filename", tsIso: fromPath };
  }
  return { timeSource: "mtime", tsIso: mtimeIso };
}

/**
 * The per-run count of how each rung of the ladder was used, for the line `refresh` prints. A run that
 * resolved most of its corpus from mtime has NOT dated it, and the summary has to be able to say so.
 *
 * @param timeSources one entry per projected record (or per file), in any order
 * @returns the counts, ordered strongest evidence first
 */
export function countTimeSources({
  timeSources,
}: {
  timeSources: readonly SelfTimeSource[];
}): readonly { source: SelfTimeSource; count: number }[] {
  const order: readonly SelfTimeSource[] = ["git", "frontmatter", "filename", "mtime"];
  return order
    .map((source) => ({ count: timeSources.filter((entry) => entry === source).length, source }))
    .filter((entry) => entry.count > 0);
}
