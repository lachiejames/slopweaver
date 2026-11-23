/**
 * The locked read-then-append behind `handover tag` and `register --tag`: the effectful shell around
 * `./tagWrite.ts`'s judgements.
 *
 * ## One board-wide lock, and what it freezes
 *
 * Every tag write and EVERY registration takes {@link ROW_TAGS_LOCK_KEY}. One key,
 * so there is no lock order to get wrong. Under it:
 *
 * - **Row identity.** A tag lands only when exactly one live doc claims the slug AND it is `handovers/<slug>.md`.
 *   `register` always writes that canonical name, checks it under the same lock, and so cannot mint a second
 *   claimant while a tag is judging the first.
 * - **Board-wide newness.** Whether a guarded value already exists somewhere is judged over every live row's
 *   journal while no other tag write can drop its last holder.
 *
 * ## What it does NOT freeze, stated rather than discovered
 *
 * Other row events do not take this lock; none of them changes tag holdings. A malformed line written by an
 * outside or older writer between the read and the append is DETECTED at read-back (`./rowEvent.ts`'s
 * `unreadableGrowth`) and reported as a committed-but-ambiguous failure, never prevented: a pre-append check is not
 * compare-and-append. `sweep apply` archiving the row mid-write moves the same doc, so the tag is still that row's
 * history, like any row event racing an archive. A `tagged` event appended by a
 * writer that skips the lock — only a hand edit can, since no build writes one any other way — can make a retry
 * re-append a set that already landed; the read-back reports that case as failed rather than hiding it.
 */

import { lstatSync, type Stats } from "node:fs";
import { join } from "node:path";

import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import { sleepSync } from "#lib/sleepSync.js";

import { acquireOperationLock, type OperationLockHandle } from "../admit/operationLock.js";
import type { HandoverDoc } from "./doc.js";
import type { ParsedLedger, RunEvent } from "./ledger.js";
import { applyRowEvent } from "./rowEvent.js";
import { declaredTagsOf } from "./rowTagFold.js";
import { type RowTag, TAG_KEYS } from "./rowTags.js";
import { readRunJournal, runJournalPath } from "./runStore.js";
import {
  boardValues,
  effectiveTagChange,
  guardedKeys,
  newValueProblems,
  type TagChange,
  type TagRequest,
} from "./tagWrite.js";
import { type TagWriteError, TagWriteErrors } from "./tagWriteErrors.js";

/** The one lock every tag write and every registration takes. */
export const ROW_TAGS_LOCK_KEY = "row-tags";

/** The first pause before retrying a held lock; doubled each time up to {@link MAX_LOCK_RETRY_MS}. */
const FIRST_LOCK_RETRY_MS = 50;

/** The longest single pause between attempts. */
const MAX_LOCK_RETRY_MS = 1000;

/**
 * How many attempts before a held lock is refused: 50 ms doubling to 1 s, about 35 s in all — longer than the
 * board-wide read a guarded value makes a holder do (measured 2.1 s for the scan alone on 3,492 docs:
 * `yarn tsx -e 'import {scanBoard} from "./src/handover/store.ts"; …'`), so a registration queued behind a tag
 * waits it out rather than failing.
 */
const MAX_LOCK_ATTEMPTS = 40;

/** What one tag write did: whether it appended, what it left alone, and the row's tags after. */
export interface TagOutcome {
  readonly written: boolean;
  /** Each assignment or drop the row already satisfied, as written. */
  readonly satisfied: readonly string[];
  /** Each `--new-value` naming a value some row already carried by the time it was judged. */
  readonly redundant: readonly string[];
  /** The row's declared and unrecognised tags after the write. */
  readonly tags: readonly RowTag[];
}

/**
 * Take the board-wide tag lock, waiting out a busy one a bounded number of times.
 *
 * @param home the state home the lock lives under
 * @param nowIso the instant the attempt is judged at
 * @returns the held lock, or the last refusal after every attempt
 */
export function acquireRowTagsLock({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): Result<OperationLockHandle, TagWriteError> {
  let waitMs = FIRST_LOCK_RETRY_MS;
  // Never taken over from a LIVE holder by age: the section it guards reads journals with no size cap, so no
  // finite lease is an upper bound on it, and a takeover would let two writers judge newness at once. A dead holder's lock is still recovered — the primitive checks the pid.
  let last = acquireOperationLock({ home, key: ROW_TAGS_LOCK_KEY, nowIso, staleAfterMs: Number.POSITIVE_INFINITY });
  for (let attempt = 1; attempt < MAX_LOCK_ATTEMPTS && last.isErr(); attempt += 1) {
    sleepSync({ ms: waitMs });
    waitMs = Math.min(waitMs * 2, MAX_LOCK_RETRY_MS);
    last = acquireOperationLock({ home, key: ROW_TAGS_LOCK_KEY, nowIso, staleAfterMs: Number.POSITIVE_INFINITY });
  }
  return last.mapErr((why) => TagWriteErrors.lockBusy({ why }));
}

/** Whether a filesystem failure says the path is simply not there. */
function isMissing({ error }: { error: IngestError }): boolean {
  return error.code === "ENOENT";
}

/**
 * The directory entry standing at a path, NOT followed — a symlink is reported as one, dangling or not — or
 * `undefined` when nothing is there.
 *
 * @param path the path to look at
 * @returns the entry's own stats, or why that could not be told
 */
export function entryAt({ path }: { path: string }): Result<Stats | undefined, IngestError> {
  const link = safeFs({ execute: () => lstatSync(path), operation: "handover.tag.entry", path });
  if (link.isErr()) {
    return isMissing({ error: link.error }) ? ok(undefined) : err(link.error);
  }
  return ok(link.value);
}

/**
 * One row's journal, telling a journal that is not there from one that is there and broken, and refusing any entry
 * that is not itself a regular file.
 *
 * `readRunJournal` maps every `ENOENT` to an empty journal, which is right for a row nobody has run and wrong for a
 * dangling symlink at `<slug>.jsonl`, which raises the same code (the same counterexample
 * `./rulingAuditStore.ts` answers). A LIVE symlink is refused too: `readRunJournal` and the appender both follow
 * it, so a tag would be appended into whatever file it points at. `lstat` sees both. A swap
 * to a symlink between this check and the append is a narrower filesystem race this does not close.
 *
 * @param runsDir the runs directory
 * @param slug the row's slug
 * @returns the decoded journal, or why it could not be read
 */
function readPresentJournal({ runsDir, slug }: { runsDir: string; slug: string }): Result<ParsedLedger, string> {
  const path = runJournalPath({ runsDir, slug });
  const entry = entryAt({ path });
  if (entry.isErr()) {
    return err(entry.error.message);
  }
  if (entry.value !== undefined && !entry.value.isFile()) {
    return err(
      `${path} is not a regular file — a symlink or directory there is refused, so a write cannot land elsewhere`,
    );
  }
  // A hard link is a regular file that is also some other path, so an append here would land in two histories.
  // None of the 2,568 live journals has one (`find ~/.slopweaver/runs -links +1`).
  if (entry.value !== undefined && entry.value.nlink !== 1) {
    return err(`${path} has ${String(entry.value.nlink)} hard links, so an append would reach another path too`);
  }
  return readRunJournal({ runsDir, slug }).mapErr((cause) => cause.message);
}

/**
 * Why the runs directory cannot be trusted to answer "no journal here", `undefined` when it can: a dangling
 * symlink AT `runs/` makes every journal inside it read as absent, so one directory of history would silently
 * become none.
 */
function runsDirProblem({ runsDir }: { runsDir: string }): string | undefined {
  const entry = entryAt({ path: runsDir });
  if (entry.isErr()) {
    return entry.error.message;
  }
  // Judged on the entry ITSELF: a live symlink to a directory elsewhere would carry every append out of the home
  // so only a real directory, or nothing yet, is accepted.
  if (entry.value === undefined || entry.value.isDirectory()) {
    return undefined;
  }
  return `${runsDir} is not a real directory — a symlink there is refused, so a write cannot land outside the home`;
}

/** The one live doc a tag may land on, or why the slug names no such doc. */
function soleCanonicalClaimant({
  docs,
  handoverDir,
  slug,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  slug: string;
}): Result<HandoverDoc, TagWriteError> {
  const claimants = docs.filter((doc) => doc.slug === slug);
  const [only] = claimants;
  if (only === undefined) {
    return err(TagWriteErrors.rowIdentity({ slug, why: "no live row on the board claims this slug" }));
  }
  if (claimants.length > 1) {
    const paths = claimants.map((doc) => doc.path).join(", ");
    return err(
      TagWriteErrors.rowIdentity({
        slug,
        why: `${String(claimants.length)} rows claim it (${paths}), and they would share one journal`,
      }),
    );
  }
  const canonical = join(handoverDir, `${slug}.md`);
  if (only.path !== canonical) {
    return err(
      TagWriteErrors.rowIdentity({
        slug,
        why: `its doc is ${only.path}, not ${canonical} — rename it so registration can see the claim`,
      }),
    );
  }
  return ok(only);
}

/**
 * Every live row's declared tags, and how many rows' journals could not be read whole. A journal with ANY
 * undecodable line contributes nothing: its decoded lines may be followed by one that dropped the value, so counting
 * them could make a spelling look established that no row now carries.
 */
function boardHoldings({ docs, runsDir }: { docs: readonly HandoverDoc[]; runsDir: string }): {
  readonly rows: readonly (readonly RowTag[])[];
  readonly unreadable: number;
} {
  const rows: (readonly RowTag[])[] = [];
  let unreadable = 0;
  for (const slug of new Set(docs.map((doc) => doc.slug))) {
    const journal = readPresentJournal({ runsDir, slug });
    if (journal.isErr() || journal.value.unreadable.length > 0) {
      unreadable += 1;
      continue;
    }
    rows.push(declaredTagsOf({ events: journal.value.events }));
  }
  return { rows, unreadable };
}

/** A tag write judged whole and not yet appended: what would change, and what the row held when it was judged. */
export interface JudgedTagWrite {
  readonly change: TagChange;
  readonly redundant: readonly string[];
  /** The target journal's events as judged, so the receipt folds the new event onto exactly what was read. */
  readonly events: readonly RunEvent[];
}

/**
 * Judge one tag write, the lock ALREADY held by the caller and the board already scanned under it. Writes nothing:
 * a registration judges its tags this way BEFORE its doc exists, so a refused tag leaves no row behind.
 *
 * @param docs every live doc, as scanned under the lock — with a registration's prospective doc among them
 * @param handoverDir the live board directory, to judge the claimant's filename
 * @param runsDir the runs directory
 * @param slug the row to tag
 * @param request the validated request
 * @returns the judged write, or why it may not happen
 */
export function judgeTagWrite({
  docs,
  handoverDir,
  runsDir,
  slug,
  request,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  runsDir: string;
  slug: string;
  request: TagRequest;
}): Result<JudgedTagWrite, TagWriteError> {
  const claimant = soleCanonicalClaimant({ docs, handoverDir, slug });
  if (claimant.isErr()) {
    return err(claimant.error);
  }
  const runsBroken = runsDirProblem({ runsDir });
  if (runsBroken !== undefined) {
    return err(TagWriteErrors.journalUnreadable({ slug, why: runsBroken }));
  }
  const journal = readPresentJournal({ runsDir, slug });
  if (journal.isErr()) {
    return err(TagWriteErrors.journalUnreadable({ slug, why: journal.error }));
  }
  if (journal.value.unreadable.length > 0) {
    const lines = journal.value.unreadable.join(", ");
    return err(
      TagWriteErrors.journalUnreadable({
        slug,
        why: `line(s) ${lines} do not decode — if a newer build wrote them, pull and rebuild`,
      }),
    );
  }
  const held = declaredTagsOf({ events: journal.value.events });
  const oneValued = new Set(TAG_KEYS.filter((spec) => spec.cardinality === "one").map((spec) => spec.key));
  const change = effectiveTagChange({ held, oneValued, request });
  const guarded = guardedKeys({ specs: TAG_KEYS });
  const needsBoard = request.newValues.length > 0 || change.set.some((assignment) => guarded.has(assignment.key));
  const board = needsBoard ? boardHoldings({ docs, runsDir }) : { rows: [], unreadable: 0 };
  const judged = newValueProblems({
    change,
    existing: boardValues({ guarded, rows: board.rows }),
    guarded,
    request,
    unreadableJournals: board.unreadable,
  });
  if (judged.problems.length > 0) {
    return err(TagWriteErrors.requestRefused({ problems: judged.problems }));
  }
  return ok({ change, events: journal.value.events, redundant: judged.redundant });
}

/**
 * Append a judged tag write — or nothing, when the row already held it all. Still under the caller's lock.
 *
 * @param judged the write as {@link judgeTagWrite} judged it
 * @param runsDir the runs directory
 * @param slug the row to tag
 * @param why the reason the event records
 * @param now the clock the event's instant is read from, IMMEDIATELY before the append — never at command entry,
 *   where a lock wait and a board read would let a concurrent `started` land after it with a later time
 * @returns what the write did, or why the append failed
 */
export function appendTagWrite({
  judged,
  runsDir,
  slug,
  why,
  now,
}: {
  judged: JudgedTagWrite;
  runsDir: string;
  slug: string;
  why: string;
  now: () => string;
}): Result<TagOutcome, TagWriteError> {
  const { change, events, redundant } = judged;
  if (change.set.length === 0 && change.drop.length === 0) {
    return ok({ redundant, satisfied: change.satisfied, tags: declaredTagsOf({ events }), written: false });
  }
  const event: RunEvent = { atIso: now(), drop: change.drop, kind: "tagged", set: change.set, why };
  const written = applyRowEvent({ event, runsDir, slug });
  if (written.isErr()) {
    return err(TagWriteErrors.appendFailed({ cause: written.error }));
  }
  return ok({
    redundant,
    satisfied: change.satisfied,
    tags: declaredTagsOf({ events: [...events, event] }),
    written: true,
  });
}

/**
 * Judge and append one tag write, the lock ALREADY held by the caller and the board already scanned under it.
 *
 * @param docs every live doc, as scanned under the lock
 * @param handoverDir the live board directory, to judge the claimant's filename
 * @param runsDir the runs directory
 * @param slug the row to tag
 * @param request the validated request
 * @param why the reason the event records
 * @param now the clock the event's instant is read from, just before the append
 * @returns what the write did, or why it did not
 */
export function tagRowUnderLock({
  docs,
  handoverDir,
  runsDir,
  slug,
  request,
  why,
  now,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  runsDir: string;
  slug: string;
  request: TagRequest;
  why: string;
  now: () => string;
}): Result<TagOutcome, TagWriteError> {
  return judgeTagWrite({ docs, handoverDir, request, runsDir, slug }).andThen((judged) =>
    appendTagWrite({ judged, now, runsDir, slug, why }),
  );
}
