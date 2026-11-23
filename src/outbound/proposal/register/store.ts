/**
 * Reading and appending register journals on disk. The effectful half of `./events.ts` and `./parse.ts`.
 *
 * One `<slug>.jsonl` per proposal under `stateHomePaths().proposalsRegister`, append-only — mirrors
 * `../../../handover/runStore.ts` deliberately, down to the safe-slug guard, the missing-file-is-empty
 * reading, and the regular-file guard against a FIFO hang. The trailing-newline check before an append is
 * no longer a third hand-copy of the same function: `../../../lib/appendSeparator.ts` is the one copy.
 */
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "../../../lib/appendSeparator.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { stateHomePaths } from "../../../stateHome.js";
import { foldRegisterEntry, type RegisterEntry, type RegisterEvent } from "./events.js";
import { parseRegisterJournal, registerJournalLine } from "./parse.js";

/**
 * A slug safe to use as a journal filename.
 *
 * A slug is interpolated straight into a journal path — `intakeStore.ts`'s identical rule (`^[a-z0-9][a-z0-9-]{0,79}$`)
 * exists for the same reason, so this reuses that exact shape rather than the looser one `runStore.ts` uses for
 * hand-typed handover slugs: a register slug is always machine-derived (from an intake id or from
 * `deriveRegisterSlug`), never hand-typed, so there is no reason to accept anything an intake id could not be.
 */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Whether a string is safe to use as a register slug.
 *
 * @param slug the candidate slug
 * @returns true iff it is lowercase alphanumeric with dashes, bounded, and cannot traverse a path
 */
export function isSafeRegisterSlug({ slug }: { slug: string }): boolean {
  return SAFE_SLUG.test(slug);
}

/**
 * The journal path for one proposal.
 *
 * @param home the state home
 * @param slug the proposal's slug
 * @returns the absolute journal path
 */
export function registerJournalPath({ home, slug }: { home: string; slug: string }): string {
  return join(stateHomePaths({ home }).proposalsRegister, `${slug}.jsonl`);
}

/** The failure both journal calls return for a slug that is not a usable filename. */
function unsafeSlug({ slug, operation }: { slug: string; operation: string }): Result<never, IngestError> {
  return err({
    kind: "io",
    message: `"${slug}" is not usable as a register journal filename — a slug must match ^[a-z0-9][a-z0-9-]{0,79}$`,
    operation,
    path: slug,
  });
}

/**
 * Read one proposal's journal.
 *
 * A missing file is an EMPTY journal, not an error — the overwhelmingly common case for a fresh slug is that
 * nothing has been recorded yet.
 *
 * @param home the state home
 * @param slug the proposal's slug
 * @returns the parsed journal, empty when the proposal has never been registered
 */
export function readRegisterJournal({
  home,
  slug,
}: {
  home: string;
  slug: string;
}): Result<{ readonly events: readonly RegisterEvent[]; readonly unreadable: readonly number[] }, IngestError> {
  if (!isSafeRegisterSlug({ slug })) {
    return unsafeSlug({ operation: "proposal.readRegisterJournal", slug });
  }
  const path = registerJournalPath({ home, slug });
  return safeFs({
    execute: () => {
      try {
        const stat = statSync(path);
        if (!stat.isFile()) {
          throw new Error(`${path} is not a regular file — refusing to read a register journal that could hang`);
        }
      } catch (error: unknown) {
        if (isRecord(error) && error["code"] === "ENOENT") {
          return { events: [], unreadable: [] };
        }
        throw error;
      }
      return parseRegisterJournal({ text: readFileSync(path, "utf8") });
    },
    operation: "proposal.readRegisterJournal",
    path,
  });
}

/**
 * Read and fold one proposal's current entry.
 *
 * @param home the state home
 * @param slug the proposal's slug
 * @returns the current entry, `undefined` when the slug has never been created, or the read failure
 */
export function loadRegisterEntry({
  home,
  slug,
}: {
  home: string;
  slug: string;
}): Result<RegisterEntry | undefined, IngestError> {
  const journal = readRegisterJournal({ home, slug });
  return journal.map((parsed) => foldRegisterEntry({ events: parsed.events, slug }));
}

/**
 * Append one event to a proposal's journal, creating the register directory on first use.
 *
 * @param home the state home
 * @param slug the proposal's slug
 * @param event the event to record
 * @returns the journal path written to
 */
export function appendRegisterEvent({
  home,
  slug,
  event,
}: {
  home: string;
  slug: string;
  event: RegisterEvent;
}): Result<string, IngestError> {
  if (!isSafeRegisterSlug({ slug })) {
    return unsafeSlug({ operation: "proposal.appendRegisterEvent", slug });
  }
  const dir = stateHomePaths({ home }).proposalsRegister;
  const path = registerJournalPath({ home, slug });
  return safeFs({
    execute: () => {
      mkdirSync(dir, { mode: 0o700, recursive: true });
      appendLines({ mode: 0o600, path, text: registerJournalLine({ event }) });
      return path;
    },
    operation: "proposal.appendRegisterEvent",
    path,
  });
}

/**
 * Every slug with a register journal on disk.
 *
 * @param home the state home
 * @returns every `.jsonl` stem under the register directory, unsorted
 */
export function listRegisterSlugs({ home }: { home: string }): readonly string[] {
  const dir = stateHomePaths({ home }).proposalsRegister;
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length));
  } catch {
    return [];
  }
}
