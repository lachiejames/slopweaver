/**
 * The `### RULINGS` rows of the archived state-doc blocks under `$SLOPWEAVER_HOME/handovers/archive/` — the owner's rulings
 * written down as anchored rows. Two readers: `supervisor owner-turns` delivers the ones touched inside its window,
 * and `talk recall` searches all of them for the console voice.
 *
 * A row is a line under a `### RULINGS` heading that opens `- ` and carries a link (its anchor). The archive keeps
 * no per-row date, so a row is dated by its FILE's mtime — the only instant the representation holds.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isAbsentError } from "../lib/presentFile.js";
import { stateHomePaths } from "../stateHome.js";

/**
 * One anchored ruling row of an archived state-doc block.
 *
 * @internal
 */
export interface ArchivedRuling {
  /** The archive file's own name, never a path — what a pointer may carry. */
  readonly file: string;
  /** The absolute path, for a reader on this machine. */
  readonly path: string;
  /** The 1-based line the row sits on. */
  readonly line: number;
  readonly text: string;
  /** The archive file's mtime: the only date the archive holds for a row. */
  readonly instantIso: string;
}

/**
 * The directory the archived state-doc blocks live in.
 *
 * @returns `$home/handovers/archive`
 */
export function rulingArchiveDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).handovers, "archive");
}

/** The archive's rows, and every file or directory it could not read — so a count over the rows is never a guess. */
export interface ArchivedRulingsRead {
  readonly rows: readonly ArchivedRuling[];
  /** One line per thing not read; empty when the whole archive was. A missing archive is none and not a problem. */
  readonly problems: readonly string[];
}

/**
 * Every anchored ruling row in the archive whose file was touched at or after `sinceMs`. A fresh install has no
 * archive, which is no rows and no problem; a directory that will not list, a file that will not stat or read, and
 * anything named `*.md` that is not a regular file are each NAMED in `problems` rather than read as empty, so
 * `talk recall` never reports an exact zero over an archive it could not see.
 *
 * @param archiveDir the archive directory, {@link rulingArchiveDir}
 * @param sinceMs the floor, epoch milliseconds; `Number.NEGATIVE_INFINITY` for every row
 * @returns the rows, file by file, in line order, and what was not read
 */
export function archivedRulings({ archiveDir, sinceMs }: { archiveDir: string; sinceMs: number }): ArchivedRulingsRead {
  let files: readonly string[];
  try {
    files = readdirSync(archiveDir).filter((entry) => entry.endsWith(".md"));
  } catch (cause) {
    // An archive behind a dangling link could not be read, which is a problem, never an absent archive.
    if (isAbsentError({ error: cause, path: archiveDir })) {
      return { problems: [], rows: [] };
    }
    return { problems: [`${archiveDir}: ${String(cause)}`], rows: [] };
  }
  const rows: ArchivedRuling[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const read = archiveFileRows({ file, path: join(archiveDir, file), sinceMs });
    if (typeof read === "string") {
      problems.push(read);
    } else {
      for (const row of read) {
        rows.push(row);
      }
    }
  }
  return { problems, rows };
}

/** One archive file's rows inside the window, or the line naming why it was not read. */
function archiveFileRows({
  file,
  path,
  sinceMs,
}: {
  file: string;
  path: string;
  sinceMs: number;
}): readonly ArchivedRuling[] | string {
  try {
    const stat = lstatSync(path);
    // Only a regular file is opened, and never through a link: a symlink could point outside the home, and a
    // FIFO named `*.md` would block the read below with nothing timing it out, while the console voice reads
    // this inside a 20 s tool budget.
    if (!stat.isFile()) {
      return `${file} is not a regular file`;
    }
    if (stat.mtimeMs < sinceMs) {
      return [];
    }
    return rulingLinesOf({
      file,
      instantIso: new Date(stat.mtimeMs).toISOString(),
      path,
      text: readFileSync(path, "utf8"),
    });
  } catch (cause) {
    return `${file}: ${String(cause)}`;
  }
}

/** Every anchored ruling row inside one archived state-doc file's text. */
function rulingLinesOf({
  file,
  path,
  instantIso,
  text,
}: {
  file: string;
  path: string;
  instantIso: string;
  text: string;
}): readonly ArchivedRuling[] {
  const rows: ArchivedRuling[] = [];
  let underRulings = false;
  // Every terminator ends a line, CRLF, lone CR or LF: a ruling is identified by its words, so its copies under any
  // of the three must read as the same words.
  text.split(/\r\n|\r|\n/u).forEach((line, index) => {
    if (line.startsWith("### RULINGS")) {
      underRulings = true;
      return;
    }
    if (line.startsWith("#")) {
      underRulings = false;
      return;
    }
    if (underRulings && line.startsWith("- ") && line.includes("http")) {
      rows.push({ file, instantIso, line: index + 1, path, text: line });
    }
  });
  return rows;
}
