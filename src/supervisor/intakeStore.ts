/**
 * Appending and reading the intake ledger — the effectful half of {@link ./intake}.
 *
 * An ABSENT ledger reads as no marks, because one that has never been written is the ordinary state of a
 * fresh install. A PRESENT ledger that cannot be read is an error the caller reports, never "no marks": a
 * sweep reading it as empty would re-raise every turn and relay a mark had already cleared, and say it read
 * them. The WRITE side throws, because a mark nobody recorded is not a mark. Owner-only permissions, matching the session ledger beside it — a
 * mark's witness is free text a supervisor wrote about something the owner said.
 */
import { lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { lookupDocBySlug, scanBoard } from "../handover/store.js";
import { appendLines } from "../lib/appendSeparator.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";
import type { IntakeMark } from "./intake.js";
import { parseIntakeMarkJournal } from "./intakeMarkLine.js";
import { preferredMark, type SlugLookup, witnessShares } from "./intakeWitness.js";

/** Owner-only permissions, matching `../sessions/sessionStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The intake ledger's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `sessions/intake-marks.jsonl`
 */
function intakeMarksPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).intakeMarksJsonl;
}

/**
 * Every mark the ledger holds.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the decodable marks, in file order — empty when the ledger is absent, an error when it is present
 *   and cannot be read
 */
export function readIntakeMarks({ home }: { home?: string } = {}): Result<readonly IntakeMark[], SupervisorCoreError> {
  const path = intakeMarksPath(home === undefined ? {} : { home });
  try {
    // A FIFO here would block `readFileSync` until a writer appears; `talk offer` reads this while a call connects.
    if (!statSync(path).isFile()) {
      throw new Error("not a regular file — refusing a read that could hang");
    }
    return ok(parseIntakeMarkJournal({ text: readFileSync(path, "utf8") }));
  } catch (cause) {
    // Only ENOENT is absent — `existsSync` also answers false for a symlink loop, which is present and unreadable.
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      // A dangling symlink stats as ENOENT too, yet a write would follow it and create its target.
      if (!isSymlink({ link: path })) {
        return ok([]);
      }
      return err(
        SupervisorCoreErrors.intakeMarksUnreadable({
          cause: new Error("a dangling symlink, not an absent file"),
          path,
        }),
      );
    }
    return err(SupervisorCoreErrors.intakeMarksUnreadable({ cause, path }));
  }
}

/**
 * Whether `link` itself is a symlink, without following it. Not named `path`: `whole-file-json` tracks this
 * file's `path` local to the ledger, and a second binding of that name would hide its whole-file read.
 */
function isSymlink({ link }: { link: string }): boolean {
  try {
    return lstatSync(link).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Which slugs name a row, answered first by one exact-file read per slug rather than a board scan — a scan costs
 * seconds, and a witness is judged on the `intake-mark` and steers paths. A row since archived still counts: a
 * reader can still follow it. On a miss it reads every doc's own `slug:` ONCE per lookup, because a file name
 * is not always its slug: 3 of 389 archived docs carried another (`../cli/commands/handover/registerWrite.ts`
 * carries the measurement), and a witness naming one is a reference all the same. A doc
 * declaring no `slug:` is its file name's row, because that is the slug the board and every handover verb read.
 *
 * A miss is only as good as that scan, so the lookup also says which directories would not list
 * (`unlistable`): ranking a witness may shrug that off, but routing a turn to a row may not.
 *
 * @param handoverDir the top-level handovers directory
 * @returns the lookup {@link ./intakeWitness} judges a witness against, and the scan's own failures
 */
export function boardSlugLookup({ handoverDir }: { handoverDir: string }): BoardSlugLookup {
  let filed: FiledSlugs | undefined;
  // The one scan this lookup ever runs, taken on its first miss and kept for every later one.
  const scanned = (): FiledSlugs => {
    if (filed !== undefined) {
      return filed;
    }
    const fresh = filedSlugs({ handoverDir });
    filed = fresh;
    return fresh;
  };
  return {
    has: (slug) => {
      if (lookupDocBySlug({ handoverDir, slug }) !== undefined) {
        return true;
      }
      return scanned().slugs.has(slug);
    },
    unlistable: () => {
      if (filed === undefined) {
        // No scan ran: every answer so far came off an exact file read, so none rests on a failed listing.
        return [];
      }
      return filed.unlistable;
    },
  };
}

/** A {@link SlugLookup} that can say whether its misses rest on a board scan that failed. */
export interface BoardSlugLookup extends SlugLookup {
  /** Each board directory the scan could not list, with why; empty when no scan ran or every one listed. */
  readonly unlistable: () => readonly string[];
}

/** Every slug the board and its archive declare, and each directory that would not list. */
interface FiledSlugs {
  readonly slugs: ReadonlySet<string>;
  readonly unlistable: readonly string[];
}

/**
 * Every slug a doc on the board or in its archive declares, whatever its file is called — read by the board's
 * own `scanBoard`, so a doc counts here exactly when the board would read it. A directory that will not list
 * contributes no slug and is named in `unlistable`, so a caller for whom a miss would lose a turn can refuse.
 */
function filedSlugs({ handoverDir }: { handoverDir: string }): FiledSlugs {
  const slugs = new Set<string>();
  const unlistable: string[] = [];
  for (const dir of [handoverDir, join(handoverDir, "archive")]) {
    const scan = scanBoard({ handoverDir: dir });
    if (scan.isErr()) {
      unlistable.push(`${dir}: ${scan.error.message}`);
      continue;
    }
    scan.value.docs.forEach((doc) => slugs.add(doc.slug));
  }
  return { slugs, unlistable };
}

/**
 * The mark that stands on one turn ({@link ./intakeWitness}'s `preferredMark`), with slugs judged off the board.
 *
 * @param marks the intake ledger, in file order
 * @param pointer the normalised turn pointer
 * @param handoverDir the top-level handovers directory
 * @returns the standing mark, or `undefined` when the turn carries none
 */
export function standingMarkFor({
  marks,
  pointer,
  handoverDir,
}: {
  marks: readonly IntakeMark[];
  pointer: string;
  handoverDir: string;
}): IntakeMark | undefined {
  const candidates = marks.filter((mark) => mark.pointer === pointer);
  if (candidates.length <= 1) {
    return candidates[0];
  }
  return preferredMark({ candidates, shares: witnessShares({ marks }), slugs: boardSlugLookup({ handoverDir }) });
}

/**
 * Append one mark to the ledger.
 *
 * @param mark the mark to record
 * @param home the state home (defaults to the resolved home)
 */
export function appendIntakeMark({ mark, home }: { mark: IntakeMark; home?: string }): void {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  mkdirSync(paths.sessions, { mode: DIR_MODE, recursive: true });
  appendLines({ mode: FILE_MODE, path: paths.intakeMarksJsonl, text: `${JSON.stringify(mark)}\n` });
}
