/**
 * `slopweaver audit [--json]` — a read-only, LOCAL, ZERO-token quality + cost snapshot of the world model.
 * Like `doctor`, it is `diagnostic: true` / `effect: "none"`: it does NO network and NO model call, only
 * pure aggregation over the on-disk corpus (bronze + the distil digest cache + the derived silver index).
 * Human report → stderr; `--json` machine data → stdout (pristine), so `audit --json | jq` is clean.
 *
 * A thin effectful shell: it STREAMS bronze once through the corpus census, folding every physical row into
 * {@link auditFold} as it passes, then hands the tallies to the pure {@link composeAuditReport}; all the
 * counting/estimating lives in {@link ../../../audit/auditCore}, {@link ../../../audit/costEstimate}, and
 * {@link ../../../audit/auditReport}.
 *
 * The cost estimate's `usageByHash` is always an EMPTY map now. Under rule 2 (no spawned model, anywhere —
 * `AGENTS.md`) `distil` no longer calls a model in-process, so it can never again capture the real per-batch
 * usage that calibrated this estimate — `slopweaver distil status` is what reports the truth for a run today
 * (batch counts, prompt chars, truncation, zero model calls). What survives here is the COLD fallback,
 * honestly labelled "cold estimate" by `costProvenance` rather than presented as measured.
 *
 * It never holds the corpus. It used to read every record into one array before counting any of them, and on
 * the owner's 10.6 GB corpus that read refused at the heap preflight on every run from September on — the
 * honesty verb could not report at all (the rule: stream it rather than bump the band). What
 * it holds now is the census's one entry per logical record plus the fold's counters.
 */
import { auditableFrom, parseIdentityPeople } from "../../../audit/auditCore.js";
import { type AuditTallies, auditFold } from "../../../audit/auditFold.js";
import { type AuditReport, auditHumanLines, auditJson, composeAuditReport } from "../../../audit/auditReport.js";
import type { PersistedBatchUsage } from "../../../audit/costEstimate.js";
import { bronzeStorageBySource, type SourceStorage } from "../../../corpus/bronzeStorage.js";
import { censusCorpus } from "../../../corpus/corpusCensus.js";
import { bronzeDir, silverIdentitiesPath } from "../../../corpus/corpusPaths.js";
import { type RowReader, withRowReader } from "../../../corpus/rowReader.js";
import { type BatchDigest, DISTIL_PROMPT_FINGERPRINT } from "../../../gold/distil.js";
import { loadDistilCache } from "../../../gold/distilCache.js";
import { planDistilFromCensus } from "../../../gold/distilStreamPlan.js";
import { readJsonFile } from "../../../lib/jsonFile.js";
import { guardLoadSlot, type LoadSlotGuard } from "../../../lib/loadSlots.js";
import { logger } from "../../../lib/logger.js";
import { readSilverIndex } from "../../../silver/silverIndexRead.js";
import { admitLoadSlot } from "../../admitLoadSlot.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

const USAGE = "usage: slopweaver audit [--json] [--home <dir>]";

/**
 * Run the audit verb. Read-only: reads bronze + the distil caches + the silver index off disk, composes the
 * snapshot, and prints it. Never fails on an empty corpus — it just reports zeros.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runAudit(argv: readonly string[]): number {
  return runAuditWithDeps({ argv });
}

/**
 * Run the audit verb with an injected load-slot guard, so a test never touches the machine-wide slot
 * directory it shares with every other process on the host.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @param guard the machine's load-slot guard; omit for the real one
 * @returns the process exit code
 */
export function runAuditWithDeps({
  argv,
  guard = guardLoadSlot,
}: {
  argv: readonly string[];
  guard?: LoadSlotGuard;
}): number {
  const rest = verbTail({ argv, verbs: ["run"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const home = resolveHome({ named: values["home"] });
  // BEFORE bronze is read, deliberately: the census holds one entry per logical record, the largest thing this
  // verb commits, so it is one of the whole-corpus footprints the machine's slot rations (src/lib/loadSlots.ts).
  const admitted = admitLoadSlot({ guard, logger });
  if ("code" in admitted) {
    return admitted.code;
  }

  return withRowReader({ run: (reader) => auditWithReader({ home, json: flags.has("json"), reader }) });
}

/**
 * Stream bronze through the census and the audit fold, refuse on a partial read, and report.
 *
 * A missing or empty corpus is fine — audit reports zeros and never errors on one. A file nobody could READ
 * is not: every number this verb prints is a claim about the whole corpus, and an honesty verb that quietly
 * audits the readable subset is the one place a partial read is least acceptable.
 *
 * @param home the Slopweaver home whose bronze is audited
 * @param json whether `--json` was passed
 * @param reader the open row reader the census's ties and the batch hashes read rows back through
 * @returns the process exit code
 */
function auditWithReader({ home, json, reader }: { home: string; json: boolean; reader: RowReader }): number {
  const cache = loadDistilCache({ home });
  // Every citation any cached digest makes. The digests grounding reads are a subset of the cache, so the fold
  // keeps every citation target grounding could ask about, and none of the millions it never would.
  const citations = new Set([...cache.values()].flatMap((digest) => digest.points.flatMap((point) => point.citations)));
  const fold = auditFold({ citations });
  const verdict = auditableFrom({
    read: censusCorpus({
      dir: bronzeDir({ home }),
      home,
      onRow: ({ record, versions }) => {
        fold.add({ record, versions });
      },
      reader,
      tieProjection: "bronze",
    }),
  });
  if ("refusal" in verdict) {
    logger.error({ msg: verdict.refusal });
    return EXIT_ERROR;
  }
  // The SAME plan `distil` spends on — the collapsed corpus, under the same contract fingerprint — so a batch
  // audit calls cached is one distil would not re-spend on. This used to be cut from PHYSICAL rows, which
  // disagreed with distil's own plan in every container holding a superseded version: audit reported those
  // batches uncached, and priced a spend distil would never make.
  const batches = planDistilFromCensus({ census: verdict.auditable, promptVersion: DISTIL_PROMPT_FINGERPRINT, reader });
  if (batches.isErr()) {
    logger.error({ msg: batches.error.message });
    return EXIT_ERROR;
  }
  // The on-disk footprint is measured HERE (the shell), not in `src/audit/*` — those stay pure. It's a readdir +
  // stat per source, judged by the owner's protect list: a protected source is named on stderr on both lanes, never
  // read and never reported as one that occupies nothing, and an unreadable protect list refuses the audit.
  const storage = bronzeStorageBySource({ home });
  if (storage.isErr()) {
    logger.error({ msg: storage.error.message });
    return EXIT_ERROR;
  }
  for (const skipped of storage.value.protectedSources) {
    logger.warn({ msg: `${skipped.source}: NOT AUDITED, protected by the owner's list — ${skipped.line}` });
  }
  return emitReport({
    json,
    report: composeFor({
      batchHashes: batches.value.map((batch) => batch.hash),
      cache,
      home,
      storage: storage.value.storage,
      tallies: fold.tallies(),
    }),
  });
}

/**
 * Gather everything beside bronze the snapshot is composed from — the silver index, the on-disk footprint —
 * and compose it with the fold's tallies and the batch plan.
 *
 * @param home the Slopweaver home the artefacts are read from
 * @param tallies what the audit fold gathered over physical bronze
 * @param batchHashes every batch hash in the current distil plan, in plan order
 * @param cache the distil digest cache
 * @param storage the on-disk footprint per source, already measured
 * @returns the composed snapshot
 */
function composeFor({
  home,
  tallies,
  batchHashes,
  cache,
  storage,
}: {
  home: string;
  tallies: AuditTallies;
  batchHashes: readonly string[];
  cache: ReadonlyMap<string, BatchDigest>;
  storage: readonly SourceStorage[];
}): AuditReport {
  // Ground only the digests for batches in the CURRENT plan (deduped by hash) — a stale cached digest for
  // records since changed/pruned would cite gone records and wrongly drag grounding down.
  const planHashes = [...new Set(batchHashes)];
  const silver = readSilverIndex({ home });
  return composeAuditReport({
    batchHashes,
    cachedHashes: new Set(cache.keys()),
    digests: planHashes.map((hash) => cache.get(hash)).filter((digest): digest is BatchDigest => digest !== undefined),
    directoryPeople: silver.people.length,
    // Omitted when the on-disk directory predates PR4.8 — the report then says "not yet filtered" rather
    // than presenting an unfiltered count as a filtered one.
    ...(silver.excludedPeople !== undefined ? { directoryExcluded: silver.excludedPeople } : {}),
    opportunities: silver.opportunities,
    people: parseIdentityPeople({ value: readJsonFile({ path: silverIdentitiesPath({ home }) }) }),
    storage,
    // audit deliberately counts PHYSICAL bronze, not the latest-record view — the storage figures above
    // measure physical rows — and the fold's superseded tally is what keeps that honest: without it every
    // physical row reads as a live record, and the gap between this verb's count and a store read's reads as
    // a contradiction rather than as the collapse it is.
    tallies,
    // Always empty — see the file header: distil can never capture real usage again under rule 2.
    usageByHash: new Map<string, PersistedBatchUsage>(),
  });
}

/**
 * Render the finished report on whichever lane the caller asked for.
 *
 * @param report the composed audit report
 * @param json whether `--json` was passed
 * @returns the process exit code
 */
function emitReport({ report, json }: { report: AuditReport; json: boolean }): number {
  if (json) {
    logger.out({ line: JSON.stringify(auditJson({ report }), null, 2) });
    return EXIT_OK;
  }
  for (const line of auditHumanLines({ report })) {
    logger.info({ msg: line });
  }
  return EXIT_OK;
}

export const auditRunCommand = defineCommand({ run: runAudit });
