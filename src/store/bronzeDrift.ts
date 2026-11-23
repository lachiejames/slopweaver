/**
 * The bronze-vs-store drift measure — the filesystem and database shell over `./bronzeDriftCore.ts`.
 *
 * ## Why this exists at all
 *
 * The store used to be able to sit permanently short of bronze with nothing saying so. MEASURED
 * on a real home: over ten thousand rows stood in bronze that the store did not hold, across six
 * sources, and the only way anyone found out was `store detail` answering "the store has never held one"
 * for a message that was on disk the whole time. `./bronzeWindows.ts` carries the mechanism that made such
 * a row permanent; `../cli/commands/refresh/storeLeg.ts` is the half that stops new ones being minted.
 * This is the half that makes an existing one VISIBLE, because a fix nobody can check is a claim.
 *
 * ## It reads through the SAME pipeline a load does
 *
 * Every candidate id comes from `./ingestRead.ts#readSlice` and `./ingest.ts#projectAll` — the exact
 * functions `ingestJsonl` uses — rather than from a second parse of the same lines. A drift report built
 * on its own reader would disagree with the loader the day either changed, and it would disagree
 * SILENTLY, in the direction of claiming rows missing that the loader never intended to store. Rule D's
 * deferral is honoured the same way too: candidates are released at each file's end, exactly as a
 * whole-file ingest releases them.
 *
 * ## What it does not read
 *
 * Anything the owner's protect list marks `no-access`: a source reaching one is `BRONZE_PROTECTED` before
 * its directory is listed (`./protectedBronze.ts`), and `store status` reports it withheld, with no repair line.
 * Bodies, side rows and the canonical `compact.jsonl` under the default scope. The presence probe selects
 * `source_id` alone off the `(source, source_id)` unique index (`./contentPresence.ts`), so the database
 * cost is an index probe per 2,000 ids rather than a scan.
 *
 * ## An unmeasurable scan never reads as a clean one
 *
 * Both filesystem failures are typed as `BRONZE_UNREADABLE` rather than counted as zero. That took two
 * changes, because the swallowing happened in two different places and only one of them was here: an
 * unreadable FILE was a raw `EACCES` escaping `readSlice`, and an unlistable DIRECTORY was
 * `../corpus/bronzeStorage.ts` deliberately conflating "never ingested" with "cannot be read". The scan lists
 * through `./protectedBronze.ts`, which reads strictly, so the compactor and the audit report keep the lenient
 * reading they have always had, and a directory that genuinely does not exist is still an empty scan.
 * Both cases carry an executed counterexample; `unit/store/bronzeDrift.test.ts` pins them.
 */
import type { CorpusSource } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";

import { openAdmission, releaseDeferred } from "./admission.js";
import type { BronzeDriftReport, ContentKey } from "./bronzeDriftCore.js";
import { contentKeyOf, missingContentIds } from "./bronzeDriftCore.js";
import { type BronzeScanScope, type BronzeWindowPlan, bronzeBytes, planBronzeWindows } from "./bronzeWindows.js";
import type { StoreClient } from "./client.js";
import { findPresentContentKeys } from "./contentPresence.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { loadExclusionLists, projectAll } from "./ingest.js";
import { readSlice } from "./ingestRead.js";
import { listProtectedBronzeFiles } from "./protectedBronze.js";
import type { ContentRow } from "./schema/content.js";

/**
 * The per-slice record ceiling the scan reads at — the heap bound, never a cap on the pass.
 *
 * The same number the `--store` leg uses, for the same reason: one window file is one refresh's worth of
 * records, and a slice well under it keeps the transient bounded on the 87,766-line file this home holds.
 */
const DRIFT_SLICE = 2_000;

/** What one file's scan contributed, before the store is asked anything. */
interface FileScan {
  readonly keys: readonly ContentKey[];
  readonly linesRead: number;
  readonly excluded: number;
  readonly refused: number;
}

/**
 * Read every candidate native id out of one bronze file, through the loader's own pipeline.
 *
 * The admission scope is per FILE, matching `ingestJsonl`: a rule-D candidate is released at the end of
 * the file it was read from, so a parent whose rescuing reply sits in a later window file is counted as
 * excluded here exactly as a load would exclude it. Measuring it any other way would report a gap the
 * loader would not close.
 *
 * The key taken from each projected record is `(content.source, content.sourceId)` — the PROJECTED source,
 * never the directory being scanned. `ingest.ts`'s `writeBatch` spreads `record.content` wholesale, so
 * that pair is literally what a load writes; keying on the directory instead would report a row missing
 * that the loader had already stored under another source (an executed counterexample pins it).
 *
 * @param path the bronze file to scan
 * @param home the Slopweaver home the denylists resolve under
 * @returns the keys this file offers, with the lines it examined and what it turned away
 */
function scanFile({ path, home }: { path: string; home: string }): Result<FileScan, StoreError> {
  const lists = loadExclusionLists({ home, lane: "ingest" });
  if (lists.isErr()) {
    return err(lists.error);
  }
  const admission = openAdmission({ exclusion: lists.value.denylist, identities: lists.value.identities });
  const keys: ContentKey[] = [];
  let linesRead = 0;
  let refused = 0;
  try {
    let from = 0;
    for (;;) {
      const slice = readSlice({ admission, from, limit: DRIFT_SLICE, path });
      linesRead += slice.linesRead;
      refused += slice.refusalCount;
      slice.projected.forEach((record) =>
        keys.push({ source: record.content.source, sourceId: record.content.sourceId }),
      );
      if (slice.linesRead === 0 || slice.resumeByteOffset <= from) {
        break;
      }
      from = slice.resumeByteOffset;
    }
    const released = projectAll({ records: releaseDeferred({ admission }) });
    released.projected.forEach((record) =>
      keys.push({ source: record.content.source, sourceId: record.content.sourceId }),
    );
    refused += released.refusals.length;
  } catch (error: unknown) {
    return err(StoreErrors.bronzeUnreadable({ cause: error, path }));
  }
  return ok({ excluded: admission.excluded, keys, linesRead, refused });
}

/**
 * List the source's bronze through the protect list and split it by scope, with the filesystem's throws typed.
 *
 * The listing is `./protectedBronze.ts`'s, never `listBronzeFiles`: that one reads a directory and stats every
 * file without asking whether the owner allowed it, and a bronze file at mode `000` once rejected
 * `measureBronzeDrift` with a bare Error rather than a sentence naming the file. This listing types both.
 *
 * @param home the Slopweaver home the bronze resolves under
 * @param source the source whose directory to list
 * @param scope which files the scan will read
 * @param protection the owner's protect-list entries
 * @returns the plan, `BRONZE_PROTECTED` before anything is listed, or `BRONZE_UNREADABLE` naming the path
 */
function planScan({
  home,
  source,
  scope,
  protection,
}: {
  home: string;
  source: ContentRow["source"];
  scope: BronzeScanScope;
  protection: readonly ProtectedPath[];
}): Result<BronzeWindowPlan, StoreError> {
  return listProtectedBronzeFiles({ entries: protection, home, source }).map((files) =>
    planBronzeWindows({ files, home, scope, source }),
  );
}

/**
 * What answers "which of these ids does the store hold" — the one thing in this scan that needs a database.
 *
 * Declared as a contract so the scan can be driven over a real bronze tree with a plain function standing
 * in for the store. The interesting behaviour here — bronze read order, per-file rule-D release, dedup
 * across window files, what the scope omits — is all filesystem-side, and none of it is checkable if the
 * only way to reach it is through Postgres.
 */
export type PresenceProbe = (args: {
  source: ContentRow["source"];
  sourceIds: readonly string[];
}) => Promise<Result<ReadonlySet<string>, StoreError>>;

/**
 * The presence probe that asks the real store, which is what every caller but a test passes.
 *
 * @param client the open store
 * @returns a probe bound to that client
 */
export function storePresenceProbe({ client }: { client: StoreClient }): PresenceProbe {
  return async ({ source, sourceIds }) => findPresentContentKeys({ client, source, sourceIds });
}

/**
 * Ask the store about each PROJECTED source separately, and answer in joined keys.
 *
 * One probe per distinct projected source rather than one for the directory: `content` is unique on
 * `(source, source_id)`, so asking about slack's ids under the calendar source — or the reverse — answers
 * a different question than the one the loader's write would settle. Normally there is exactly one group
 * and this costs nothing; a second group means the scanned directory holds a row that stores elsewhere,
 * which is worth being right about rather than fast about.
 *
 * @param candidates the distinct keys the scan offered
 * @param probe what answers which ids one source holds
 * @returns every key the store holds, joined by {@link contentKeyOf}, or the first probe failure
 */
async function probeEachSource({
  candidates,
  probe,
}: {
  candidates: readonly ContentKey[];
  probe: PresenceProbe;
}): Promise<Result<ReadonlySet<string>, StoreError>> {
  const bySource = new Map<ContentRow["source"], string[]>();
  for (const key of candidates) {
    const held = bySource.get(key.source);
    if (held === undefined) {
      bySource.set(key.source, [key.sourceId]);
    } else {
      held.push(key.sourceId);
    }
  }
  const present = new Set<string>();
  for (const [source, sourceIds] of bySource) {
    const answered = await probe({ source, sourceIds });
    if (answered.isErr()) {
      return err(answered.error);
    }
    answered.value.forEach((sourceId) => present.add(contentKeyOf({ key: { source, sourceId } })));
  }
  return ok(present);
}

/**
 * Measure how far one source's store rows sit behind its bronze.
 *
 * @param probe what answers which of the scanned ids the store already holds
 * @param home the Slopweaver home the bronze and the denylists resolve under
 * @param source the source to measure
 * @param scope how much of that source's bronze to scan — `windows` omits the canonical file
 * @param protection the owner's protect-list entries, REQUIRED so no caller scans without having read them;
 *   a source reaching a `no-access` path is `BRONZE_PROTECTED` before anything is listed or probed
 * @returns the report, or the first failure that stopped it being a measurement
 */
export async function measureBronzeDrift({
  probe,
  home,
  source,
  protection,
  scope = "windows",
}: {
  probe: PresenceProbe;
  home: string;
  source: ContentRow["source"];
  protection: readonly ProtectedPath[];
  scope?: BronzeScanScope;
}): Promise<Result<BronzeDriftReport, StoreError>> {
  const planned = planScan({ home, protection, scope, source });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const plan = planned.value;
  const seen = new Set<string>();
  const candidates: ContentKey[] = [];
  let linesRead = 0;
  let excluded = 0;
  let refused = 0;
  for (const file of plan.read) {
    const scanned = scanFile({ home, path: file.path });
    if (scanned.isErr()) {
      return err(scanned.error);
    }
    linesRead += scanned.value.linesRead;
    excluded += scanned.value.excluded;
    refused += scanned.value.refused;
    for (const key of scanned.value.keys) {
      const joined = contentKeyOf({ key });
      if (!seen.has(joined)) {
        seen.add(joined);
        candidates.push(key);
      }
    }
  }
  const present = await probeEachSource({ candidates, probe });
  if (present.isErr()) {
    return err(present.error);
  }
  const absent = missingContentIds({ candidates, present: present.value, scanned: source });
  return ok({
    bytesOmitted: bronzeBytes({ files: plan.omitted }),
    candidates: candidates.length,
    examples: absent.examples,
    excluded,
    filesOmitted: plan.omitted.length,
    filesScanned: plan.read.length,
    linesRead,
    missing: absent.missing,
    present: present.value.size,
    refused,
    scope,
    source: source satisfies CorpusSource,
  });
}
