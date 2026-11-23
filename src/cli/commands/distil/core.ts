/**
 * The pure core shared by the three `distil` verbs — `status` (read), `brief` (read + write a brief), and
 * `answer` (validate + write the cache/gold). Nothing here touches the network, the model, or the clock; the
 * shells (`./plan.ts`, `./status.ts`, `./brief.ts`, `./answer.ts`) inject the filesystem reads and writes
 * these functions describe.
 *
 * ## Why there are three verbs instead of one
 *
 * Under rule 2 (no spawned model, anywhere — see `AGENTS.md`) `distil` cannot call `claude` itself. The
 * thinking that used to happen inside a forced-tool model call now happens in the visible Claude Code
 * session that is already running: `status` says what is left, `brief` hands the session one batch's exact
 * prompt, and `answer` grounds what the session wrote and updates the cache. **One batch per handoff, not a
 * pack of several** — `groupForDistil` targets ~40 records and its content-defined bounds can reach 60;
 * bundling more would make the unit of work (and of error recovery) uncontrolled.
 *
 * ## What is preserved exactly
 *
 * The batching (`distilGroup.ts`), its content hash, the digest cache (`distilCache.ts`, keyed by that
 * hash), `DISTIL_PROMPT_FINGERPRINT`, `buildDigestPrompt`, `digestPromptTruncation`, `validateBatchDigest`,
 * `reduceToSourceDigest`, and gold rendering are UNCHANGED — only how a digest gets produced moved out of
 * this process. `promptChangeRefusal`, `shouldWriteGold`, `buildDistilWritePlan` and `toSourceDigests` below
 * are carried over verbatim from the pre-rewrite `core.ts`.
 */
import { join } from "node:path";
import { goldDir, silverDigestsDir } from "../../../corpus/corpusPaths.js";
import type { CorpusSource } from "../../../corpus/types.js";
import type { BatchDigest, SourceDigest } from "../../../gold/distil.js";
import { reduceToSourceDigest } from "../../../gold/distil.js";
import type { DistilBatch } from "../../../gold/distilGroup.js";
import { buildGoldDocs } from "../../../gold/goldIndex.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { SilverIndex } from "../../../silver/silverIndexRead.js";
import { parseFlagTail, parsePositiveInteger } from "../../optionParsers.js";

/**
 * Flags the old, model-calling `distil` accepted that no longer mean anything: there is no in-process model
 * call to budget, throttle or cap, and no run to preview — `distil status` reports the plan directly. Each
 * maps to the ONE line explaining what replaced it, so a script written against the old verb fails loudly
 * with a fix rather than silently being ignored.
 */
export const REMOVED_DISTIL_FLAGS: Readonly<Record<string, string>> = {
  "--budget":
    "removed — distil no longer spends model tokens in this process, so there is nothing left to budget. " +
    "The model call is the visible supervisor session composing the digest, and that session is already " +
    "metered by its host.",
  "--concurrency":
    "removed — there is no in-process model call left to run concurrently. One batch is answered per " +
    "`distil brief` / `distil answer` handoff.",
  "--dry-run": "removed — run `slopweaver distil status` instead; it reports the batch plan without writing anything.",
  "--full":
    "removed — every `distil brief` now hands over exactly one batch. Repeat `distil brief` / `distil answer` " +
    "until `distil status` reports zero remaining; there is no uncapped run to opt into.",
  "--max-batches":
    "removed — there is no batch loop in this process to cap. `distil brief` always hands over exactly one batch.",
  "--max-cost": "removed — same reason as `--budget`: there is no in-process model call left to cap the cost of.",
};

/**
 * Refuse every removed flag by name, with its migration message — before the generic parser gets a chance to
 * report a bare "unknown flag". Pure.
 *
 * @param rest the raw argv tail, unparsed
 * @returns one line per removed flag present, empty when none were used
 */
export function removedDistilFlagRefusal({ rest }: { rest: readonly string[] }): readonly string[] {
  return rest
    .filter((token) => token in REMOVED_DISTIL_FLAGS)
    .map((token) => `${token} ${REMOVED_DISTIL_FLAGS[token]}`);
}

/** The batch-plan flags `status` and `brief` share — both must plan the SAME way `brief` would hand out. */
export interface DistilPlanOptions {
  readonly home?: string;
  readonly corpus?: string;
  readonly maxPerBatch?: number;
  readonly topContainers?: number;
  readonly recentOnly: boolean;
}

/** The batch-plan flag spec, exported so the repo-wide `--help`-truth ratchet can read it. */
export const DISTIL_PLAN_FLAG_SPEC = {
  boolean: ["recent-only"],
  string: ["home", "corpus", "max-per-batch", "top-containers"],
} as const;

/**
 * Build {@link DistilPlanOptions} from ALREADY-TOKENISED flags. Pure, and split out from
 * {@link parseDistilPlanOptions} so `distil brief` — which accepts these flags PLUS its own
 * (`--accept-prompt-change`, `--out`) — can tokenise the whole tail with one merged spec and still reuse
 * this to build the shared subset, rather than tokenising twice against two specs that would each reject
 * the other's flags as unknown.
 *
 * @param values every parsed `--flag value` (string flags only land here)
 * @param flags every parsed boolean switch that was present
 * @returns the validated plan options, or the accumulated value errors
 */
export function buildDistilPlanOptions({
  values,
  flags,
}: {
  values: Readonly<Record<string, string>>;
  flags: ReadonlySet<string>;
}): Result<DistilPlanOptions> {
  const errors: string[] = [];
  const int = ({ label, key }: { label: string; key: string }): number | undefined =>
    values[key] !== undefined ? parsePositiveInteger({ errors, label, value: values[key] }) : undefined;
  const maxPerBatch = int({ key: "max-per-batch", label: "--max-per-batch" });
  const topContainers = int({ key: "top-containers", label: "--top-containers" });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    recentOnly: flags.has("recent-only"),
    ...(values["home"] !== undefined ? { home: values["home"] } : {}),
    ...(values["corpus"] !== undefined ? { corpus: values["corpus"] } : {}),
    ...(maxPerBatch !== undefined ? { maxPerBatch } : {}),
    ...(topContainers !== undefined ? { topContainers } : {}),
  });
}

/**
 * Tokenise + build {@link DistilPlanOptions} in one call — what `distil status` uses, since it accepts no
 * flags beyond the shared plan set.
 *
 * @param rest the verb tail (already checked against {@link removedDistilFlagRefusal})
 * @returns the validated plan options, or the accumulated flag errors
 */
export function parseDistilPlanOptions({ rest }: { rest: readonly string[] }): Result<DistilPlanOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: DISTIL_PLAN_FLAG_SPEC.boolean, value: DISTIL_PLAN_FLAG_SPEC.string },
  });
  return parsed.isErr() ? err(parsed.error) : buildDistilPlanOptions(parsed.value);
}

/** The unique-batch plan: how many distinct batches this container of work has, cached vs remaining. */
export interface DistilPlan {
  readonly totalUniqueBatches: number;
  readonly cachedUniqueBatches: number;
  readonly remainingUniqueBatches: number;
}

/**
 * Plan by UNIQUE hash, not by raw batch count — two batches sharing a hash (identical records, which only
 * happens by coincidence) are one unit of work, not two. Pure.
 *
 * @param batches the full ordered batch plan from `groupForDistil`
 * @param cache the content-hash → digest cache
 * @returns the deduped totals
 */
export function planDistil({
  batches,
  cache,
}: {
  batches: readonly { readonly hash: string }[];
  cache: ReadonlyMap<string, BatchDigest>;
}): DistilPlan {
  const uniqueHashes = new Set(batches.map((batch) => batch.hash));
  const cachedUniqueBatches = [...uniqueHashes].filter((hash) => cache.has(hash)).length;
  return {
    cachedUniqueBatches,
    remainingUniqueBatches: uniqueHashes.size - cachedUniqueBatches,
    totalUniqueBatches: uniqueHashes.size,
  };
}

/**
 * The next batch `distil brief` would hand out: the first, in `groupForDistil`'s own deterministic order,
 * whose hash is not yet cached. Pure.
 *
 * Selecting by FIRST APPEARANCE (rather than, say, the largest or the newest container) is what makes two
 * consecutive `distil brief` calls with no `distil answer` in between hand out the identical batch — the
 * selection is a pure function of the plan and the cache, not of how many times it has been asked.
 *
 * @param batches the full ordered batch plan from `groupForDistil`
 * @param cache the content-hash → digest cache
 * @returns the next uncached batch, or `undefined` when every unique hash is already cached
 */
export function nextDistilBatch<T extends { readonly hash: string }>({
  batches,
  cache,
}: {
  batches: readonly T[];
  cache: ReadonlyMap<string, BatchDigest>;
}): T | undefined {
  const seen = new Set<string>();
  for (const batch of batches) {
    if (seen.has(batch.hash)) {
      continue;
    }
    seen.add(batch.hash);
    if (!cache.has(batch.hash)) {
      return batch;
    }
  }
  return undefined;
}

/**
 * Every digest the CURRENT batch plan resolves to, in `groupForDistil`'s own order — WITH duplicates, not
 * deduped. This is the exact sequence that feeds `reduceToSourceDigest`/`toSourceDigests`: the pre-rewrite
 * `distilBatches` built its digest list the same way (`batches.map((b) => cache.get(b.hash))`), and
 * `reduceToSourceDigest` sorts by `points.length` — a hash that legitimately appears twice must contribute
 * its digest twice, or a container's digest count (and therefore its rank in the rendered gold) would move
 * for a reason that has nothing to do with its content. Deduping here would be a silent behaviour change.
 *
 * @param batches the full ordered batch plan from `groupForDistil`
 * @param cache the content-hash → digest cache
 * @returns one digest per batch that has one, in batch order, skipping only batches with no digest at all
 */
export function digestsInBatchOrder({
  batches,
  cache,
}: {
  batches: readonly { readonly hash: string }[];
  cache: ReadonlyMap<string, BatchDigest>;
}): readonly BatchDigest[] {
  return batches.map((batch) => cache.get(batch.hash)).filter((digest): digest is BatchDigest => digest !== undefined);
}

/**
 * The report line for `distil answer` when at least one unique batch is still uncached after this one. Pure.
 *
 * @param batch the batch just answered
 * @param plan the plan RECOMPUTED after the cache write (so the counts include this batch)
 * @returns the progress line
 */
export function distilAnsweredProgressLine({ batch, plan }: { batch: DistilBatch; plan: DistilPlan }): string {
  return (
    `digested ${batch.source}/${batch.container} (batch ${batch.hash}) — ` +
    `${String(plan.cachedUniqueBatches)}/${String(plan.totalUniqueBatches)} unique batch(es) cached, ` +
    `${String(plan.remainingUniqueBatches)} remaining. Run \`slopweaver distil brief\` for the next one.`
  );
}

/**
 * The report line for `distil answer` when this was the LAST uncached batch and gold was rebuilt. Pure.
 *
 * @param batch the batch just answered
 * @param goldPath where gold was rewritten
 * @returns the completion line
 */
export function distilCompleteLine({ batch, goldPath }: { batch: DistilBatch; goldPath: string }): string {
  return (
    `digested ${batch.source}/${batch.container} (batch ${batch.hash}) — every unique batch is now cached → ` +
    `gold rebuilt at ${goldPath}`
  );
}

/**
 * Whether the digest set is COMPLETE — every batch in the plan resolved to a digest. Gold is written only
 * when this holds: writing from a partial set would publish a build that silently dropped whatever had not
 * been answered yet.
 *
 * @param digestCount how many digests {@link digestsInBatchOrder} resolved
 * @param batchCount how many batches the plan holds (`batches.length`, not deduped)
 * @returns true only when every batch is accounted for
 */
export function shouldWriteGold({ digestCount, batchCount }: { digestCount: number; batchCount: number }): boolean {
  return digestCount === batchCount && batchCount > 0;
}

/**
 * The refusal for a run whose distil CONTRACT (prompt + schema + batching scheme) no longer matches the one
 * the cache was built under. Every cached digest is keyed by that contract, so a change makes all of them
 * miss at once — left unguarded, `distil status`/`distil brief` would silently start treating a fully-built
 * gold corpus as freshly empty. Refuse, name both fingerprints, and name the way forward
 * (`--accept-prompt-change`). Unchanged from the pre-rewrite verb.
 *
 * @param storedFingerprint the contract the cache was built under (undefined ⇒ a pre-marker home)
 * @param currentFingerprint the contract this build would run under
 * @param cachedCount how many digests are currently cached
 * @param accepted whether `--accept-prompt-change` authorised the change
 * @returns the refusal lines, or empty to proceed
 */
export function promptChangeRefusal({
  storedFingerprint,
  currentFingerprint,
  cachedCount,
  accepted,
}: {
  storedFingerprint: string | null;
  currentFingerprint: string;
  cachedCount: number;
  accepted: boolean;
}): readonly string[] {
  if (accepted || cachedCount === 0 || storedFingerprint === currentFingerprint) {
    return [];
  }
  // A cache with no marker predates the contract fingerprint, and is named as that rather than as a value.
  let from = "unversioned (pre-PR5.4 cache)";
  if (storedFingerprint !== null) {
    from = storedFingerprint;
  }
  return [
    `distil: the distil contract changed — prompt, schema, or batch boundaries (${from} → ${currentFingerprint}).`,
    `distil: all ${String(cachedCount)} cached digest(s) were produced under the old contract and no longer apply.`,
    "distil: re-run `distil brief --accept-prompt-change` to authorise starting over under the new contract.",
  ];
}

/**
 * Reduce fresh+cached batch digests into per-source silver digests. Pure. Unchanged from the pre-rewrite
 * verb — see {@link digestsInBatchOrder} for what feeds `digests` here.
 *
 * @param digests every batch digest to reduce, in the order {@link digestsInBatchOrder} produced
 * @param recordCountBySource how many collapsed records each source holds — what each digest reports it covers
 * @returns one digest per source
 */
export function toSourceDigests({
  digests,
  recordCountBySource,
}: {
  digests: readonly BatchDigest[];
  recordCountBySource: ReadonlyMap<CorpusSource, number>;
}): readonly SourceDigest[] {
  const bySource = new Map<CorpusSource, BatchDigest[]>();
  for (const digest of digests) {
    const bucket = bySource.get(digest.source);
    if (bucket === undefined) {
      bySource.set(digest.source, [digest]);
    } else {
      bucket.push(digest);
    }
  }
  return [...bySource.entries()].map(([source, sourceDigests]) =>
    reduceToSourceDigest({
      digests: sourceDigests,
      recordCount: countFor({ counts: recordCountBySource, source }),
      source,
    }),
  );
}

/**
 * How many records each source holds — the per-source figure {@link toSourceDigests} reports, counted from
 * records a caller already holds. The streaming plan counts the same thing off its census instead. Pure.
 *
 * @param records the collapsed corpus records
 * @returns the count per source, in first-seen order
 */
export function recordCountsBySource({
  records,
}: {
  records: readonly { readonly source: CorpusSource }[];
}): ReadonlyMap<CorpusSource, number> {
  const counts = new Map<CorpusSource, number>();
  for (const record of records) {
    counts.set(record.source, countFor({ counts, source: record.source }) + 1);
  }
  return counts;
}

/** A source's count, or zero when the map has never seen it. */
function countFor({ counts, source }: { counts: ReadonlyMap<CorpusSource, number>; source: CorpusSource }): number {
  const count = counts.get(source);
  if (count === undefined) {
    return 0;
  }
  return count;
}

/** One file to write, resolved to an absolute path + its serialisable content. */
interface WriteFile<T> {
  readonly path: string;
  readonly content: T;
}

/** The full set of files a completed distil writes: per-source silver digests + the gold markdown docs. */
export interface DistilWritePlan {
  readonly silverDigests: readonly WriteFile<SourceDigest>[];
  readonly goldDocs: readonly WriteFile<string>[];
}

/**
 * Build the complete write plan (silver digest JSON + gold markdown), resolved to absolute paths. Pure.
 * Unchanged from the pre-rewrite verb.
 *
 * @param sourceDigests the per-source digests
 * @param silverIndex the directory + opportunities read back from silver
 * @param builtAtIso the build timestamp stamped into the gold overview
 * @param home the Slopweaver home the paths resolve under
 * @returns the silver + gold files to write
 */
export function buildDistilWritePlan({
  sourceDigests,
  silverIndex,
  builtAtIso,
  home,
}: {
  sourceDigests: readonly SourceDigest[];
  silverIndex: SilverIndex;
  builtAtIso: string;
  home: string;
}): DistilWritePlan {
  const silverDigests = sourceDigests.map((digest) => ({
    content: digest,
    path: join(silverDigestsDir({ home }), `${digest.source}.json`),
  }));
  const goldDocs = buildGoldDocs({
    builtAtIso,
    containers: silverIndex.containers,
    opportunities: silverIndex.opportunities,
    people: silverIndex.people,
    sources: sourceDigests,
  }).map((doc) => ({ content: doc.markdown, path: join(goldDir({ home }), doc.path) }));
  return { goldDocs, silverDigests };
}
