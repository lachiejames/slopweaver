/**
 * Reading and appending run journals on disk. The effectful half of {@link ./ledger}.
 *
 * One `<slug>.jsonl` per doc under `$SLOPWEAVER_HOME/runs`, append-only. Append-only is what makes this
 * trustworthy across a compaction: a writer that rewrote the file could lose an earlier decision, and the whole
 * reason this exists is that decisions were being lost.
 *
 * A doc may be run more than once, and every cycle stays in the one file. {@link ./ledger}'s `runStateOf` reads
 * only from the last `started`, so history is preserved without a finished run looking permanently open.
 */

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { lstat as lstatAsync, readFile, stat as statAsync } from "node:fs/promises";
import { join } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import type { IngestError } from "#lib/ingestError.js";
import { isRecord } from "#lib/parsers.js";
import { err, errAsync, type Result, type ResultAsync } from "#lib/result.js";
import { safeFs, safeFsAsync } from "#lib/safeBoundary.js";
import { ledgerLine, type ParsedLedger, parseLedger, type RunEvent } from "./ledger.js";

/**
 * A slug safe to use as a filename.
 *
 * A slug comes from front-matter a human typed, and it is interpolated straight into a journal path — so
 * `../other-doc` normalised out of the runs directory and aliased ANOTHER doc's journal, appending a cycle that
 * derived state then attributed to the wrong doc. Found by an adversarial pass. Validated rather than sanitised:
 * quietly rewriting a slug would make the journal's name disagree with the doc that owns it.
 */
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** How many hex characters of the doc digest are kept. Enough to spot a change, short enough to print. */
const HASH_LENGTH = 16;

/**
 * The content hash of a doc, as recorded in its journal.
 *
 * This is what lets a later session detect that the brief changed underneath a live run — the amendment case.
 * Line endings are normalised first, so editing a doc on another machine is not mistaken for a rewrite.
 *
 * @param text the doc's full text
 * @returns a short hex digest
 */
export function docHash({ text }: { text: string }): string {
  return createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Whether a slug may be used as a journal filename.
 *
 * @param slug the doc's slug
 * @returns true when it is a plain name that cannot escape the runs directory
 */
export function isSafeSlug({ slug }: { slug: string }): boolean {
  return SAFE_SLUG.test(slug) && slug !== "." && slug !== "..";
}

/**
 * The journal path for one doc. The single place this name is derived.
 *
 * @param runsDir the runs directory
 * @param slug the doc's slug
 * @returns the absolute journal path
 */
export function runJournalPath({ runsDir, slug }: { runsDir: string; slug: string }): string {
  return join(runsDir, `${slug}.jsonl`);
}

/** The failure both journal calls return for a slug that is not a usable filename. */
function unsafeSlug({ slug, operation }: { slug: string; operation: string }): Result<never, IngestError> {
  return err(unsafeSlugError({ operation, slug }));
}

/** The error {@link unsafeSlug} carries, for a reader returning it asynchronously. */
function unsafeSlugError({ slug, operation }: { slug: string; operation: string }): IngestError {
  return {
    kind: "io",
    message: `"${slug}" is not usable as a journal filename — a slug must be a plain name (letters, digits, . _ -)`,
    operation,
    path: slug,
  };
}

/**
 * Read one doc's journal.
 *
 * A missing file is an EMPTY journal, not an error: the overwhelmingly common case is a doc nobody has started,
 * and failing there would make every gate treat "never run" as "broken".
 *
 * Requires a REGULAR file before opening it — the same guard `store.ts`'s `isReadableDoc` already applies to
 * handover docs, for the identical reason: a FIFO named `<slug>.jsonl` makes `readFileSync` block until a
 * writer appears, in practice forever, and this reader is now reached by an aggregate board-wide scan
 * (`handover list`) as well as by a single named lifecycle operation. Deliberately NO size cap, unlike the
 * 2 MiB one on docs: this repository defines a run journal as one append-only file retaining every cycle
 * with no writer-side bound, so a hard byte limit here would eventually make a genuinely long-lived run
 * permanently unreadable and unresumable by name — a worse defect than the hang this guards against.
 *
 * @param runsDir the runs directory
 * @param slug the doc's slug
 * @returns the parsed journal, empty when the doc has never been run
 */
export function readRunJournal({
  runsDir,
  slug,
}: {
  runsDir: string;
  slug: string;
}): Result<ParsedLedger, IngestError> {
  if (!isSafeSlug({ slug })) {
    return unsafeSlug({ operation: "handover.readRunJournal", slug });
  }
  const path = runJournalPath({ runsDir, slug });
  return safeFs({
    execute: (): ParsedLedger => {
      try {
        const stat = statSync(path);
        if (!stat.isFile()) {
          throw new Error(`${path} is not a regular file — refusing to read a run journal that could hang`);
        }
      } catch (error: unknown) {
        if (isRecord(error) && error["code"] === "ENOENT") {
          // ENOENT through a link that IS there is a dangling link, not an absent journal: reading it as "no run"
          // would let a row read open over a journal nobody can see.
          if (pathIsLink({ candidate: path })) {
            throw new Error(`${path} is a link to nothing — refusing to read it as an empty run journal`, {
              cause: error,
            });
          }
          return { events: [], unknownKind: [], unreadable: [] };
        }
        // Every other failure is REAL. Swallowing a permissions error would report "no run" for a run that
        // exists, which is the one answer that makes a gate silently inert.
        throw error;
      }
      return parseLedger({ text: readFileSync(path, "utf8") });
    },
    operation: "handover.readRunJournal",
    path,
  });
}

/** Whether a symlink itself sits at `candidate` — what tells a dangling link apart from nothing at all, once `stat` says ENOENT. */
function pathIsLink({ candidate }: { candidate: string }): boolean {
  try {
    return lstatSync(candidate).isSymbolicLink();
  } catch {
    return false;
  }
}

/** {@link pathIsLink}, without blocking the thread. */
async function pathIsLinkAsync({ candidate }: { candidate: string }): Promise<boolean> {
  try {
    return (await lstatAsync(candidate)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Read one doc's journal without blocking the thread — {@link readRunJournal}'s exact contract (an unsafe slug
 * refused, a missing file an empty journal, a non-regular file refused before it is opened, no size cap), for a
 * caller reading many journals at once.
 *
 * @param runsDir the runs directory
 * @param slug the doc's slug
 * @returns the parsed journal, empty when the doc has never been run
 */
export function readRunJournalAsync({
  runsDir,
  slug,
}: {
  runsDir: string;
  slug: string;
}): ResultAsync<ParsedLedger, IngestError> {
  if (!isSafeSlug({ slug })) {
    return errAsync(unsafeSlugError({ operation: "handover.readRunJournal", slug }));
  }
  const path = runJournalPath({ runsDir, slug });
  return safeFsAsync({
    execute: async (): Promise<ParsedLedger> => {
      try {
        const found = await statAsync(path);
        if (!found.isFile()) {
          throw new Error(`${path} is not a regular file — refusing to read a run journal that could hang`);
        }
      } catch (error: unknown) {
        if (isRecord(error) && error["code"] === "ENOENT") {
          if (await pathIsLinkAsync({ candidate: path })) {
            throw new Error(`${path} is a link to nothing — refusing to read it as an empty run journal`, {
              cause: error,
            });
          }
          return { events: [], unknownKind: [], unreadable: [] };
        }
        throw error;
      }
      return parseLedger({ text: await readFile(path, "utf8") });
    },
    operation: "handover.readRunJournal",
    path,
  });
}

/**
 * Append one event to a doc's journal, creating the directory on first use.
 *
 * @param runsDir the runs directory
 * @param slug the doc's slug
 * @param event the event to record
 * @returns the journal path written to
 */
export function appendRunEvent({
  runsDir,
  slug,
  event,
}: {
  runsDir: string;
  slug: string;
  event: RunEvent;
}): Result<string, IngestError> {
  if (!isSafeSlug({ slug })) {
    return unsafeSlug({ operation: "handover.appendRunEvent", slug });
  }
  const path = runJournalPath({ runsDir, slug });
  return safeFs({
    execute: (): string => {
      mkdirSync(runsDir, { mode: 0o700, recursive: true });
      // A journal whose last line has no trailing newline PARSES fine — a killed process is the normal way that
      // happens — but appending straight onto it would fuse two events into one unreadable line, destroying the
      // earlier one. Found by an adversarial pass. A separator is added only when the file needs one.
      appendLines({ mode: 0o600, path, text: ledgerLine({ event }) });
      return path;
    },
    operation: "handover.appendRunEvent",
    path,
  });
}
