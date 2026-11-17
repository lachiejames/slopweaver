/**
 * The `outlook` source's ingest job — discover the folders, read each one's delta round page by page, and
 * advance each folder's delta link once that folder's round is whole and on disk. Through the ONE per-source
 * seam ({@link ../ingestJob.SourceIngestJob}), so mail flows through the same redact → dedup → JSONL write as
 * every other source.
 *
 * ## Per folder, not all or nothing
 *
 * A delta link speaks for ONE folder, so one folder failing holds only its own link: the next pass resumes it
 * from where it was, and the folders that completed keep their progress. A message moved between a held folder
 * and an advanced one is safe either way round, because its immutable id is the record's `sourceId` and its
 * record does not depend on the folder (`./project.ts`): the destination's round delivers it under the same id,
 * whenever that round completes, and the source's tombstone is never written.
 *
 * ## A capped run initialises nothing
 *
 * `--sample`/`--fetch-cap` read a bounded slice of each folder in Graph's own order, which is not newest
 * first. So a capped run writes NO link, even for a folder that fit inside the cap: a proof run must never
 * leave sync state behind that a later pass resumes from. What it may claim is "up to N records from each
 * folder", and nothing about history or recency.
 *
 * ## Commit, then link
 *
 * Every page commits before the next is read (`./folderDelta.ts`), and a folder's link is written only after
 * its last page committed. A crash between the two loses the link, never the mail, and the recovery is one
 * round whose records all dedup away.
 */
import { clampIsoToClock } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { makeOutlookApi } from "../../live/outlook/api.js";
import type { OutlookApi } from "../../live/outlook/apiCore.js";
import { resolveOutlookGraph } from "../../live/outlook/session.js";
import { createBronzeCommitter } from "../corpusWriter.js";
import { type CoverageGap, coverageGap, type SourceIngestJob } from "../ingestJob.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { deltaStartFor, discoverOutlookMailFolders, type OutlookMailReadCap, outlookMailReadCap } from "./fetch.js";
import { type FolderRound, laterIso, readFolderRound } from "./folderDelta.js";
import { type OutlookMailSyncAnchors, readOutlookMailSyncAnchors, writeOutlookMailSyncAnchors } from "./syncAnchor.js";

/** The seam a pass reads through, and the account it is bound to — kept together so a test cannot mismatch them. */
export interface OutlookMailClient {
  readonly api: OutlookApi;
  readonly account: string;
}

/** What one pass reports back through the shared per-source seam. */
interface OutlookMailIngestReport {
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  notes: readonly string[];
  gaps: readonly CoverageGap[];
  committedPerContainer?: number;
  projectedPerContainer?: number;
  committedCursor?: string;
}

/**
 * Build the `outlook` ingest job.
 *
 * @param home the Slopweaver home holding the Microsoft grant, the bronze store and the delta links
 * @param window the planned export window, which names the bronze file; the read itself is not time-bounded
 * @param nowIso the clock, for each link's recorded time and the pooled cursor's clamp
 * @param client the seam and its account; omitted in production, where the stored Microsoft grant resolves one
 * @param sample the `--sample` cap, which bounds each folder and writes no link
 * @param fetchCap the `--fetch-cap` cap, same effect
 * @param cursorOverridden whether the caller named an explicit window, which reads every folder whole
 * @returns the job, ready for {@link ../ingestSource.ingestSources}
 */
export function outlookMailIngestJob({
  home,
  window,
  nowIso,
  client,
  sample,
  fetchCap,
  cursorOverridden,
}: {
  home: string;
  window: ExportWindow;
  nowIso: () => string;
  client: OutlookMailClient | undefined;
  sample: number | undefined;
  fetchCap: number | undefined;
  cursorOverridden: boolean;
}): SourceIngestJob {
  const cap = outlookMailReadCap({ fetchCap, sample });
  return {
    label: "outlook (mailbox)",
    run: () => runOutlookMailIngest({ cap, client, cursorOverridden, home, nowIso, window }),
    source: "outlook",
    window,
  };
}

/** Resolve the production seam from the ONE Microsoft grant, unless a caller injected one. */
async function resolveClient({
  client,
  home,
}: {
  client: OutlookMailClient | undefined;
  home: string;
}): Promise<Result<OutlookMailClient>> {
  if (client !== undefined) {
    return ok(client);
  }
  const bound = await resolveOutlookGraph({ capabilities: ["read"], home });
  if (bound.isErr()) {
    return err([bound.error.message]);
  }
  const { account, graph } = bound.value;
  return ok({ account, api: makeOutlookApi({ graph, rateScopeKey: account }) });
}

/** What the pass accumulates across folders. */
interface PassTally {
  committed: number;
  projected: number;
  tombstones: number;
  newestTsIso: string | undefined;
  advanced: number;
  anchors: OutlookMailSyncAnchors;
  readonly gaps: CoverageGap[];
  readonly notes: string[];
  readonly warnings: string[];
}

/** One pass: resolve, read the stored links, discover, then each folder's round in turn. */
async function runOutlookMailIngest({
  cap,
  client,
  cursorOverridden,
  home,
  nowIso,
  window,
}: {
  cap: OutlookMailReadCap | undefined;
  client: OutlookMailClient | undefined;
  cursorOverridden: boolean;
  home: string;
  nowIso: () => string;
  window: ExportWindow;
}): Promise<Result<OutlookMailIngestReport>> {
  const resolved = await resolveClient({ client, home });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const stored = readOutlookMailSyncAnchors({ home });
  if (stored.isErr()) {
    return err([stored.error.message]);
  }
  const discovered = await discoverOutlookMailFolders({ api: resolved.value.api });
  if (discovered.isErr()) {
    return err([discovered.error.message]);
  }
  const { folders, excluded, truncated } = discovered.value;
  const tally: PassTally = {
    advanced: 0,
    anchors: stored.value,
    committed: 0,
    gaps: [],
    newestTsIso: undefined,
    notes: [
      ...discovered.value.notes,
      `${String(folders.length)} folder(s) read, ${String(excluded)} left out as drafts, outbox, junk or deleted mail`,
    ],
    projected: 0,
    tombstones: 0,
    warnings: [],
  };
  if (truncated) {
    // No unseen folder has a link to move, so holding per container is honest: the next pass walks again.
    tally.gaps.push(
      coverageGap({
        heldPerContainer: true,
        message: "the folder walk hit its page ceiling, so some folders were never read",
      }),
    );
  }
  const committer = createBronzeCommitter({ home, window });
  for (const folder of folders) {
    const start = deltaStartFor({ anchors: tally.anchors, cursorOverridden, folderId: folder.id });
    const round = await readFolderRound({ ...resolved.value, cap, committer, folderId: folder.id, start });
    settleRound({ cap, folderId: folder.id, home, nowIso, round, tally });
  }
  return ok(passOutcome({ cap, nowIso, tally }));
}

/** Fold one folder's round into the pass, writing its link when it is entitled to one. Mutates the tally. */
function settleRound({
  cap,
  folderId,
  home,
  nowIso,
  round,
  tally,
}: {
  cap: OutlookMailReadCap | undefined;
  folderId: string;
  home: string;
  nowIso: () => string;
  round: FolderRound;
  tally: PassTally;
}): void {
  tally.committed += round.committed;
  tally.projected += round.projected;
  tally.tombstones += round.tombstones;
  tally.newestTsIso = laterIso({ a: tally.newestTsIso, b: round.newestTsIso });
  tally.notes.push(...round.notes);
  tally.warnings.push(...round.warnings);
  if (round.failure !== undefined) {
    tally.gaps.push(
      coverageGap({ heldPerContainer: true, message: `folder ${folderId} could not be read whole: ${round.failure}` }),
    );
    return;
  }
  if (cap !== undefined || round.deltaLink === undefined) {
    return;
  }
  const next = {
    ...tally.anchors,
    [folderId]: { deltaLink: round.deltaLink, recordedAtIso: nowIso(), version: 1 as const },
  };
  const written = writeOutlookMailSyncAnchors({ anchors: next, home });
  if (written.isErr()) {
    // The in-memory map keeps the OLD link, so a later folder's write cannot persist this failed advance.
    tally.warnings.push(written.error.message);
    return;
  }
  tally.anchors = next;
  tally.advanced += 1;
}

/** The pass's outcome from its tally. */
function passOutcome({
  cap,
  nowIso,
  tally,
}: {
  cap: OutlookMailReadCap | undefined;
  nowIso: () => string;
  tally: PassTally;
}): OutlookMailIngestReport {
  const committedCursor =
    tally.newestTsIso === undefined ? undefined : clampIsoToClock({ nowIso: nowIso(), tsIso: tally.newestTsIso });
  const capLine =
    cap === undefined
      ? `delta link advanced for ${String(tally.advanced)} folder(s)`
      : `capped at ${String(cap.maxMessages)} record(s) per folder in Graph's own order, so no delta link was written and nothing here is history or recency`;
  return {
    committedPerContainer: tally.committed,
    ...(committedCursor !== undefined ? { committedCursor } : {}),
    gaps: tally.gaps,
    notes: [
      ...tally.notes,
      `${String(tally.projected)} message record(s) projected`,
      `${String(tally.tombstones)} item(s) removed from or moved out of a folder, counted and never written — a message deleted after it was read keeps its record in the corpus`,
      capLine,
    ],
    projectedPerContainer: tally.projected,
    records: [],
    warnings: tally.warnings,
  };
}
