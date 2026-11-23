/**
 * `handover list`'s journal sweep — the effectful half of `../../../handover/detachedAsk.ts`, which says why it
 * exists and carries the measurement.
 *
 * Only `handover list` runs it. Every other reader of the board (`session-start`, `sweep board`, `handover
 * prune`, `handover row`) keeps composing from `handovers/*.md` alone, and `archivedDependencies` stays a
 * dependency resolver: an archived doc recovered here is a root of THIS verb's board only, and never reaches
 * the collision or stale-repository checks, which describe the live board.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { IngestError } from "#lib/ingestError.js";
import { safeFs } from "#lib/safeBoundary.js";

import { archivedDependencies, type JournalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import {
  type DetachedAsk,
  detachedDocOf,
  type UnreadJournal,
  unclaimedJournalSlugs,
  waitingAskOf,
} from "../../../handover/detachedAsk.js";
import type { DocProbeState, HandoverDoc } from "../../../handover/doc.js";
import { ownerWaitOf } from "../../../handover/ownerWait.js";
import { readRunJournal, runJournalPath } from "../../../handover/runStore.js";
import { readExactDoc, scanBoard } from "../../../handover/store.js";

/** What the sweep found beyond the board's own docs. */
export interface ListRecovery {
  /** Docs a waiting run's slug found off the board — in the archive, or written since the scan. */
  readonly archivedRoots: readonly HandoverDoc[];
  /** Those roots' journals, already read, so the board does not read them twice. */
  readonly journals: ReadonlyMap<string, JournalEvidence>;
  readonly detachedAsks: readonly DetachedAsk[];
  readonly unreadJournals: readonly UnreadJournal[];
}

/** Nothing recovered — what a board with no runs directory yet carries. */
const NO_RECOVERY: ListRecovery = {
  archivedRoots: [],
  detachedAsks: [],
  journals: new Map(),
  unreadJournals: [],
};

/**
 * Whether a recovery found anything a reader must see, so an empty `handovers/` is not reported as an empty board.
 *
 * @param recovery the sweep's result
 * @returns whether any root, ask or unread journal came back
 */
export function recoveredAnything({ recovery }: { recovery: ListRecovery }): boolean {
  return recovery.archivedRoots.length > 0 || recovery.detachedAsks.length > 0 || recovery.unreadJournals.length > 0;
}

/**
 * Whether `ownerWait` calls a row's question settled — a recovered row the board leaves out.
 *
 * @param model one composed row
 * @returns true when the row's ask is settled, whatever its run still holds
 */
export function isSettledWait({ model }: { model: BoardModel }): boolean {
  return ownerWaitOf({ derived: model.derived, run: model.run }).kind === "settled";
}

/**
 * The recovered roots' rows, settled ones included, composed in a pass of their OWN so the board's rows are exactly
 * what they would have been without them — a recovered root in the board's pass changes `doneSlugs`, and with it a
 * live row's `blockedBy` placement, on a `done` doc or a `settlement:` ask. The board keeps only
 * {@link recoveredModels}; `handover list` also reads the settled rest, since an archived settled ask whose run was
 * asked again is on no surface (`../../../handover/settledAsk.ts`).
 *
 * @param docs the board's own docs, which a recovered row's `blockedBy` resolves against like any row's
 * @param probeStates the board's probe sweep; a recovered root is never probed, so it finds none
 * @returns every recovered row, in recovery order
 */
export function recoveredRows({
  docs,
  handoverDir,
  journals,
  probeStates,
  recovery,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  journals: ReadonlyMap<string, JournalEvidence>;
  probeStates: ReadonlyMap<string, DocProbeState>;
  recovery: ListRecovery;
}): readonly BoardModel[] {
  if (recovery.archivedRoots.length === 0) {
    return [];
  }
  const recovered = new Set(recovery.archivedRoots.map((doc) => doc.slug));
  const roots = [...docs, ...recovery.archivedRoots];
  return composeBoardModels({
    journals,
    probeStates,
    resolutionDocs: [...roots, ...archivedDependencies({ docs: roots, handoverDir })],
    roots,
  }).filter((model) => recovered.has(model.doc.slug));
}

/**
 * The recovered rows the board shows: only a row still waiting on the owner is kept, since a settled one has nothing to
 * show and was never on the board.
 *
 * @param docs the board's own docs, which a recovered row's `blockedBy` resolves against like any row's
 * @param probeStates the board's probe sweep; a recovered root is never probed, so it finds none
 * @returns the recovered rows `ownerWait` does not call settled, in recovery order
 */
export function recoveredModels({
  docs,
  handoverDir,
  journals,
  probeStates,
  recovery,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  journals: ReadonlyMap<string, JournalEvidence>;
  probeStates: ReadonlyMap<string, DocProbeState>;
  recovery: ListRecovery;
}): readonly BoardModel[] {
  return recoveredRows({ docs, handoverDir, journals, probeStates, recovery }).filter(
    (model) => !isSettledWait({ model }),
  );
}

/** Whether a failed listing is the runs directory simply not existing yet — a fresh home. */
function isMissing({ error }: { error: IngestError }): boolean {
  return error.code === "ENOENT";
}

/**
 * Sweep the journals no board doc claims for questions still waiting on the owner.
 *
 * Every failure is REPORTED, never skipped: an unlistable runs directory and an unreadable journal each come
 * back as an {@link UnreadJournal}, because "could not look" printed as "nothing waiting" is the defect this
 * sweep closes, one layer down. A board doc and its run never both reach the output: a claimed slug is
 * subtracted before any journal is opened.
 *
 * @param claimed every slug a readable board doc carries
 * @param handoverDir the board directory, whose `archive/` holds the docs this may recover
 * @param liveUnreadable the board files the scan could not read
 * @param runsDir where the run journals live
 * @returns the recovered roots, the asks with no doc, and the journals that would not read
 */
export function recoverListJournals({
  claimed,
  handoverDir,
  liveUnreadable,
  runsDir,
}: {
  claimed: ReadonlySet<string>;
  handoverDir: string;
  liveUnreadable: readonly string[];
  runsDir: string;
}): ListRecovery {
  const listed = safeFs({ execute: () => readdirSync(runsDir), operation: "handover.list.journals", path: runsDir });
  if (listed.isErr()) {
    return isMissing({ error: listed.error })
      ? NO_RECOVERY
      : { ...NO_RECOVERY, unreadJournals: [{ journal: runsDir, why: listed.error.message }] };
  }
  const { slugs, unusable } = unclaimedJournalSlugs({ claimed, names: listed.value });
  const archivedRoots: HandoverDoc[] = [];
  const journals = new Map<string, JournalEvidence>();
  const detachedAsks: DetachedAsk[] = [];
  const unreadJournals: UnreadJournal[] = unusable.map((name) => ({
    journal: join(runsDir, name),
    why: "its name is not a usable slug, so no doc can claim it",
  }));
  // Read whole at most once, and only when a waiting run's exact paths did not yield its doc — the rare case, so a board
  // with nothing detached never pays for the archive.
  let index: ArchiveIndex | undefined;
  // An early return rather than `??=` (refused by `no-silent-fallback`) or an if-assign (oxlint's
  // `prefer-nullish-coalescing`), the shape `run.ts`'s `resolveHome` call notes.
  const archive = (): ArchiveIndex => {
    if (index !== undefined) {
      return index;
    }
    const read = archiveIndexOf({ handoverDir });
    index = read;
    return read;
  };
  for (const slug of slugs) {
    const found = sweepOne({ archive, handoverDir, liveUnreadable, runsDir, slug });
    if (found.kind === "root") {
      archivedRoots.push(found.doc);
      journals.set(slug, found.evidence);
    } else if (found.kind === "detached") {
      detachedAsks.push(found.ask);
    } else if (found.kind === "unread") {
      unreadJournals.push(found.unread);
    }
  }
  return { archivedRoots, detachedAsks, journals, unreadJournals };
}

/** The archive read whole: its docs by their OWN slug, which a renamed file keeps, and what would not read. */
type ArchiveIndex =
  | { readonly kind: "read"; readonly bySlug: ReadonlyMap<string, HandoverDoc>; readonly unreadable: readonly string[] }
  | { readonly kind: "unlisted"; readonly why: string };

/**
 * Every archived doc, keyed by the slug its front matter carries — so a doc archived under another file name is
 * still found by the run that names it. A missing archive is an empty one.
 *
 * @returns the index, or why the archive could not be listed
 */
function archiveIndexOf({ handoverDir }: { handoverDir: string }): ArchiveIndex {
  const scanned = scanBoard({ handoverDir: join(handoverDir, "archive") });
  if (scanned.isErr()) {
    return { kind: "unlisted", why: `the archive could not be listed: ${scanned.error.message}` };
  }
  const bySlug = new Map<string, HandoverDoc>();
  for (const doc of scanned.value.docs) {
    if (!bySlug.has(doc.slug)) {
      bySlug.set(doc.slug, doc);
    }
  }
  return { bySlug, kind: "read", unreadable: scanned.value.unreadable.map((name) => join("archive", name)) };
}

/**
 * The doc a waiting run's slug names off the board — at its exact live or archived path, else under any archived
 * file name — or what is known about its absence.
 *
 * @param archive the archive index, read on first call
 * @returns the doc, or its {@link DetachedAsk} state
 */
function offBoardDocOf({
  archive,
  handoverDir,
  liveUnreadable,
  slug,
}: {
  archive: () => ArchiveIndex;
  handoverDir: string;
  liveUnreadable: readonly string[];
  slug: string;
}):
  | { readonly kind: "found"; readonly doc: HandoverDoc }
  | { readonly kind: "absent"; readonly doc: DetachedAsk["doc"] } {
  const exact = readExactDoc({ handoverDir, slug });
  if (exact.isOk() && exact.value !== undefined) {
    return { doc: exact.value.doc, kind: "found" };
  }
  // Consulted even when the exact path would not read: a misfiled doc at `archive/<slug>.md` carrying another slug
  // must not hide the renamed one that carries this slug.
  const index = archive();
  const renamed = index.kind === "read" ? index.bySlug.get(slug) : undefined;
  if (renamed !== undefined) {
    return { doc: renamed, kind: "found" };
  }
  if (exact.isErr()) {
    return { doc: detachedDocOf({ lookupError: exact.error.message, unreadableDocs: [] }), kind: "absent" };
  }
  if (index.kind === "unlisted") {
    return { doc: detachedDocOf({ lookupError: index.why, unreadableDocs: [] }), kind: "absent" };
  }
  const unreadableDocs = [...liveUnreadable, ...index.unreadable];
  return { doc: detachedDocOf({ lookupError: undefined, unreadableDocs }), kind: "absent" };
}

/**
 * One unclaimed journal's verdict: a doc to compose, an ask with no doc, a journal that would not read, or nothing
 * waiting.
 *
 * @param archive the archive index, read on first call
 * @returns the verdict, carrying what the caller files it under
 */
function sweepOne({
  archive,
  handoverDir,
  liveUnreadable,
  runsDir,
  slug,
}: {
  archive: () => ArchiveIndex;
  handoverDir: string;
  liveUnreadable: readonly string[];
  runsDir: string;
  slug: string;
}):
  | { readonly kind: "root"; readonly doc: HandoverDoc; readonly evidence: JournalEvidence }
  | { readonly kind: "detached"; readonly ask: DetachedAsk }
  | { readonly kind: "unread"; readonly unread: UnreadJournal }
  | { readonly kind: "not-waiting" } {
  const journal = runJournalPath({ runsDir, slug });
  const read = readRunJournal({ runsDir, slug });
  if (read.isErr()) {
    return { kind: "unread", unread: { journal, why: read.error.message } };
  }
  const evidence: JournalEvidence = { events: read.value.events, unreadableLines: read.value.unreadable };
  const waiting = waitingAskOf({ evidence });
  if (waiting.kind === "unreadable") {
    return { kind: "unread", unread: { journal, why: waiting.why } };
  }
  if (waiting.kind === "not-waiting") {
    return waiting;
  }
  const found = offBoardDocOf({ archive, handoverDir, liveUnreadable, slug });
  if (found.kind === "found") {
    return { doc: found.doc, evidence, kind: "root" };
  }
  const ask = { askedIso: waiting.askedIso, doc: found.doc, journal, question: waiting.question, slug };
  return { ask, kind: "detached" };
}
