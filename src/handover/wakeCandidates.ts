/**
 * Which parks `handover wake` may judge and whether one still stands — the questions the verb asks of the board and
 * the run journal before and after it acts, kept apart from the verb that spawns. Whether a reseat or a finish really
 * cleared its park is `./wakeProofs.ts`.
 *
 * A journal carrying ANY line this build cannot read is never woken (that line may be a newer kind that already
 * cleared the park), and a board doc that will not read refuses the whole scan (its slug is unknowable, so any waking
 * row may share it).
 */

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { journalEvidence } from "./assemble.js";
import type { HandoverDoc } from "./doc.js";
import { statedBranches } from "./evaluate.js";
import { type RunEvent, runStateOf } from "./ledger.js";
import { activeParkedCheckpoint, parkAsItWaits } from "./parked.js";
import { type ParkedEvent, parkedBranchOf } from "./parkedEvent.js";
import type { ParkWake } from "./parkWake.js";
import { pausedRefusal } from "./paused.js";
import { type PermanentRefusal, permanentRefusalOf } from "./permanentRefusal.js";
import { readRunJournal } from "./runStore.js";
import { scanBoard } from "./store.js";

/** One parked row with a wake, as the scan found it. */
export interface WakeCandidate {
  readonly slug: string;
  readonly parked: ParkedEvent & { readonly wake: ParkWake };
  /** The park's position in the append-only journal — its identity, since two parks may share every field. */
  readonly parkIndex: number;
  /**
   * The doc's `repo:` — the checkout a finish standing in the state home probes — or `undefined` when it names none.
   * `cmux spawn` refuses a doc without one (`../cli/commands/cmux/spawnPreflight.ts`), so wake order ranks such a
   * park last rather than letting its age put a spawn that will fail ahead of every other park. A ranking, never a
   * skip: the spawn re-reads the doc.
   */
  readonly docRepo: string | undefined;
  /**
   * The branches the board states for this run — the doc's `branch:` and the branch its cycle recorded at `start`
   * (`./evaluate.ts`'s `statedBranches`) — which the reconcile of an ended pull request (`./parkedLanding.ts`) compares
   * that pull request's head against.
   */
  readonly statedBranches: readonly string[];
  /**
   * The branch the current cycle's `started` line recorded, when it recorded one. A park copies it, so the two agree
   * on any journal `handover park` wrote; the question pass still names it beside the park's own, because "every
   * branch the run names is the merged head" must hold of a journal where they differ. Kept
   * out of {@link WakeCandidate.statedBranches} so the ended-pull-request reconcile's match is unchanged.
   */
  readonly startedBranch: string | undefined;
  /** The row's doc, which a landed row's `handover close` records its `closed` event against. */
  readonly doc: HandoverDoc;
  /**
   * What the wake may do with the park before it reads any clock or check: judge it, leave a paused row alone,
   * or clear a park `cmux spawn` will refuse on every tick.
   */
  readonly disposition:
    | { readonly kind: "judge" }
    | { readonly kind: "paused"; readonly reason: string }
    | { readonly kind: "permanent"; readonly refusal: PermanentRefusal };
}

/**
 * A park's disposition off its doc and journal — the permanent refusals first, then a pause, in `cmux spawn`'s
 * own terms, so the wake never knocks on a door that row will not open. A row both paused AND permanently
 * refused is cleared: unpausing it lifts nothing, so only a pause that is the row's whole refusal keeps its park.
 *
 * @param events the row's journal events, in order
 * @param rerunAllowed whether the wake's environment opened the finished-run break-glass its spawn inherits
 * @param unreadableLines line numbers the journal reader could not decode
 * @returns what the wake may do with the park
 */
function wakeDispositionOf({
  doc,
  events,
  rerunAllowed,
  unreadableLines,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  rerunAllowed: boolean;
  unreadableLines: readonly number[];
}): WakeCandidate["disposition"] {
  const refusal = permanentRefusalOf({ doc, events, rerunAllowed, unreadableLines });
  if (refusal !== undefined) {
    return { kind: "permanent", refusal };
  }
  const paused = pausedRefusal({ doc });
  return paused === undefined ? { kind: "judge" } : { kind: "paused", reason: paused };
}

/** The board scan itself failed. */
interface WakeBoardScanFailedError {
  readonly code: "BOARD_SCAN_FAILED";
  readonly message: string;
}

/** A board doc would not read, so no slug on the board is known to be unique. */
interface WakeBoardDocUnreadableError {
  readonly code: "BOARD_DOC_UNREADABLE";
  readonly message: string;
  readonly unreadable: readonly string[];
}

/** Why `handover wake` judged no park at all. */
export type WakeScanError = WakeBoardScanFailedError | WakeBoardDocUnreadableError;

/** The factory every {@link WakeScanError} is built by. */
export const WakeScanErrors = {
  boardScanFailed: ({ message }: { message: string }): WakeBoardScanFailedError => ({
    code: "BOARD_SCAN_FAILED",
    message,
  }),
  docUnreadable: ({ unreadable }: { unreadable: readonly string[] }): WakeBoardDocUnreadableError => ({
    code: "BOARD_DOC_UNREADABLE",
    message:
      `${String(unreadable.length)} board doc(s) would not read (${unreadable.join(", ")}), and any of them may ` +
      "share a waking row's slug — fix them; no park wakes until they read",
    unreadable,
  }),
} as const;

/**
 * Every row parked NOW on a wake, in board order, plus what the scan could not judge.
 *
 * @param home the state home
 * @param rerunAllowed whether the wake's environment opened the finished-run break-glass its spawn inherits
 * @returns the candidates, the slugs two docs share, the journals that did not read — or why the board did not
 */
export function wakeCandidates({ home, rerunAllowed }: { home: string; rerunAllowed: boolean }): Result<
  {
    readonly candidates: readonly WakeCandidate[];
    readonly duplicateSlugs: readonly string[];
    readonly unreadable: readonly string[];
  },
  WakeScanError
> {
  const paths = stateHomePaths({ home });
  const scan = scanBoard({ handoverDir: paths.handovers });
  if (scan.isErr()) {
    return err(WakeScanErrors.boardScanFailed({ message: scan.error.message }));
  }
  const { docs } = scan.value;
  if (scan.value.unreadable.length > 0) {
    return err(WakeScanErrors.docUnreadable({ unreadable: scan.value.unreadable }));
  }
  const journals = journalEvidence({ docs, runsDir: paths.runs });
  const slugs = docs.map((doc) => doc.slug);
  const duplicateSlugs = [...new Set(slugs.filter((slug, index) => slugs.indexOf(slug) !== index))];
  const unreadable: string[] = [];
  const candidates: WakeCandidate[] = [];
  for (const slug of new Set(slugs)) {
    const journal = journals.get(slug)!;
    if (journal.unreadableLines.length > 0) {
      unreadable.push(`${slug} (journal)`);
      continue;
    }
    // As it waits: a wake suspended on the owner's open question is no candidate, so it is neither read nor reseated.
    const waiting = parkAsItWaits({ events: journal.events });
    const parked = waiting?.parked;
    if (waiting === undefined || parked?.wake === undefined || duplicateSlugs.includes(slug)) {
      continue;
    }
    const doc = docs.find((candidate) => candidate.slug === slug)!;
    candidates.push({
      disposition: wakeDispositionOf({
        doc,
        events: journal.events,
        rerunAllowed,
        unreadableLines: journal.unreadableLines,
      }),
      doc,
      docRepo: doc.repo,
      parkIndex: waiting.parkIndex,
      parked: { ...parked, wake: parked.wake },
      slug,
      startedBranch: runStateOf({ events: journal.events }).branch,
      statedBranches: statedBranches({ declaredBranch: doc.branch, recordedBranch: parkedBranchOf({ parked }) }),
    });
  }
  return ok({ candidates, duplicateSlugs, unreadable });
}

/**
 * Whether the park a scan found is still the one standing: the same checkpoint, not cleared, not replaced.
 *
 * @param parkIndex the park's position when the scan found it
 * @returns the reason it no longer stands, or `undefined` when it does
 */
export function parkMoved({
  parkIndex,
  runsDir,
  slug,
}: {
  parkIndex: number;
  runsDir: string;
  slug: string;
}): string | undefined {
  const read = readRunJournal({ runsDir, slug });
  if (read.isErr()) {
    return `the journal did not re-read: ${read.error.message}`;
  }
  return parkMovedIn({ events: read.value.events, parkIndex, unreadable: read.value.unreadable });
}

/** Whether a park still stands, read off its journal: `unknown` when the journal does not read whole. */
export type ParkStanding = "standing" | "gone" | "unknown";

/**
 * Whether the park a scan found still stands once a wake has acted, as its journal now says: the one fact the Fleet
 * page needs to drop a park from a board read before the wake, which no action name carries alone — a failed spawn
 * can have cleared its park or left it.
 *
 * @param parkIndex the park's position when the scan found it
 * @returns `standing`, `gone` (cleared or replaced), or `unknown` when the journal does not re-read whole
 */
export function parkStanding({
  parkIndex,
  runsDir,
  slug,
}: {
  parkIndex: number;
  runsDir: string;
  slug: string;
}): ParkStanding {
  const read = readRunJournal({ runsDir, slug });
  if (read.isErr() || read.value.unreadable.length > 0) {
    return "unknown";
  }
  // The park itself: a suspended WAKE leaves the park standing, on the owner (`./parkWakeSuspension.ts`).
  return parkGoneIn({ events: read.value.events, parkIndex, unreadable: [] }) === undefined ? "standing" : "gone";
}

/**
 * {@link parkMoved} over a journal already read: why the park at `parkIndex` no longer stands for a reseat, or
 * `undefined` — gone, or its wake suspended on the owner's question.
 */
function parkMovedIn({
  events,
  parkIndex,
  unreadable,
}: {
  events: readonly RunEvent[];
  parkIndex: number;
  unreadable: readonly number[];
}): string | undefined {
  const gone = parkGoneIn({ events, parkIndex, unreadable });
  if (gone !== undefined) {
    return gone;
  }
  // A second wake running at once may have suspended it on the owner's question after this one's scan.
  if (parkAsItWaits({ events })?.suspension !== undefined) {
    return "another wake suspended its wake on the owner's question";
  }
  return undefined;
}

/** Why the park at `parkIndex` no longer stands at all — cleared, replaced, or unreadable past — or `undefined`. */
function parkGoneIn({
  events,
  parkIndex,
  unreadable,
}: {
  events: readonly RunEvent[];
  parkIndex: number;
  unreadable: readonly number[];
}): string | undefined {
  if (unreadable.length > 0) {
    return `the journal now carries ${String(unreadable.length)} line(s) this build cannot read`;
  }
  const now = activeParkedCheckpoint({ events });
  if (now === undefined) {
    return "the park has cleared";
  }
  if (events.indexOf(now) !== parkIndex) {
    return `a later park (${now.atIso}) replaced it`;
  }
  return undefined;
}

/** Whether a park the scan found permanently refused still is, re-read just before the wake clears it. */
export type ClearRecheck =
  { readonly kind: "holds"; readonly refusal: PermanentRefusal } | { readonly kind: "lifted"; readonly reason: string };

/**
 * Re-scan the board and re-read the journal, and recompute the row's permanent refusal, so a clear acts on the
 * row as it stands rather than as the first scan found it — under that scan's own rules. A doc edited back to a
 * live status keeps its park, and so does a row a second doc now claims the slug of, or a board
 * holding a doc that will not read, since either may be the live row the park belongs to.
 *
 * A board scan per clear is affordable because a cleared park never returns: each one is paid for once.
 *
 * Residue: `applyRowEvent` re-checks the journal under its own read, never the board, so an edit landing between
 * this read and that append is not seen — the same window `cmux spawn` has between its refusal and its act.
 *
 * @param candidate the park as the scan found it
 * @param home the state home holding the board and the runs directory
 * @param rerunAllowed whether the wake's environment opened the finished-run break-glass its spawn inherits
 * @returns the refusal that still holds, or why the park must be kept
 */
export function clearRecheck({
  candidate,
  home,
  rerunAllowed,
}: {
  candidate: WakeCandidate;
  home: string;
  rerunAllowed: boolean;
}): ClearRecheck {
  const { parkIndex, slug } = candidate;
  const paths = stateHomePaths({ home });
  const read = readRunJournal({ runsDir: paths.runs, slug });
  if (read.isErr()) {
    return { kind: "lifted", reason: `the journal did not re-read: ${read.error.message}` };
  }
  const { events, unreadable } = read.value;
  const moved = parkMovedIn({ events, parkIndex, unreadable });
  if (moved !== undefined) {
    return { kind: "lifted", reason: moved };
  }
  const scan = scanBoard({ handoverDir: paths.handovers });
  if (scan.isErr()) {
    return { kind: "lifted", reason: `the board did not re-scan: ${scan.error.message}` };
  }
  if (scan.value.unreadable.length > 0) {
    return {
      kind: "lifted",
      reason: `the board now holds ${String(scan.value.unreadable.length)} doc(s) that will not read`,
    };
  }
  const claiming = scan.value.docs.filter((doc) => doc.slug === slug);
  const [doc] = claiming;
  if (claiming.length !== 1 || doc === undefined) {
    return { kind: "lifted", reason: `${String(claiming.length)} board docs now carry the slug ${slug}` };
  }
  const refusal = permanentRefusalOf({ doc, events, rerunAllowed, unreadableLines: unreadable });
  if (refusal === undefined) {
    return { kind: "lifted", reason: "the row is no longer refused by cmux spawn, so its park stands" };
  }
  return { kind: "holds", refusal };
}
