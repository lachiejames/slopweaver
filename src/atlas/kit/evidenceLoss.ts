/**
 * The two rules that stop a publish from writing away a record the store already holds.
 *
 * ## The measurement
 *
 * Four walks driving one Chrome relay at once (`browser/relayLease.ts` carries the rest). Three
 * crashed, and a crashed walk still published: `github`'s `/settings/profile` went from landed, photographed
 * and nine endpoints to `outcome: failed` with no screenshots. The good record was gone, and the only reason
 * anybody knew what it used to hold was that re-running the walk alone put it back.
 *
 * The lease makes that particular collision unreachable. This is the second half, and it is deliberately
 * NOT about concurrency: a walk crashes for its own reasons — a signed-out session, a console that changed
 * under it, a laptop that slept — and every one of them produces the same shape, an attempt that failed
 * carrying less than the attempt before it. The owner's ruling asks for other kinds of
 * corruption to be made impossible too, where feasible, and this is the cheapest one there is.
 *
 * ## The second rule, and whose it is
 *
 * Owner ruling: a sync is a SOFT RECONCILE that pulls what changed, and is never capable of wiping a
 * platform's local atlas. Erasing and repulling is a HARD sync and a different, explicit verb —
 * which in this tree is `atlas <platform> reset`, and `./reset.ts` is where that half lives.
 *
 * The rule above was not enough for that, and the gap was PROVEN rather than argued: published 500 entities
 * through the real kit, republished the same kind with `entities: []` and `lastAttempt: null`, and
 * `publishAtlas` returned `ok` with the store then holding nothing. Nothing fired, because the only rule
 * here read a verdict the publish never claimed. Reproduce with
 * `src/__tests__/unit/atlas/kit/evidenceLoss.test.ts`'s "a successful pass may not empty a kind" case.
 *
 * ## What it refuses, stated as the criterion rather than as an example
 *
 * Two rules, judged per kind by {@link refusingRule}:
 *
 * - **emptied** — a kind the store holds with at least one entity may not be published with zero,
 *   whatever the attempt says about itself. This is the ruling above, and it reads no verdict at all.
 * - **degraded** — a kind whose incoming manifest status says `lastAttempt.outcome === "failed"` may not be
 *   published with fewer entities, or fewer distinct artifacts, than the file already on disk.
 *
 * Every other publish is untouched:
 *
 * - a SUCCEEDING pass may still SHRINK a kind to any non-zero count, because a provider that genuinely lost
 *   some records is a fact and the atlas is supposed to record it;
 * - a FAILING pass that kept everything still publishes, which is what `failedKindStatus` was already
 *   documented to do — *"a failed read keeps them, it does not empty the file"* — and this makes that
 *   sentence true rather than hoped for;
 * - a first publish, a `0 -> 0` publish, and a publish after a reset archived the directory compare
 *   against nothing.
 *
 * A provider that genuinely dropped every row of a kind is real, so the emptied rule has an escape hatch
 * rather than an exception: `atlas-evidence-loss` in `src/hatch/registry.ts`, read by `./store.ts` and
 * passed in as `overrideOpen`. This module stays pure.
 *
 * ## What it does NOT close on its own, and what does
 *
 * This is a check, not a lock, so what it guarantees is about ONE writer: a publish cannot empty a kind IT
 * read as non-empty. A Codex review pass found the counterexample and it is worth carrying verbatim rather
 * than paraphrasing: with the hatch closed, writer A reads a kind holding 0 entities, is admitted 0 -> 0,
 * and is descheduled before `./generationSwap.ts` installs anything; writer B then publishes one entity and
 * completes; A resumes and installs its already-approved empty file over B's, taking the kind 1 -> 0 with
 * no hatch open. The window is between the read in `store.ts`'s `evidenceChanges` and the swap after it.
 *
 * That window is CLOSED, and not by this module. `store.ts`'s `publishAtlas` takes `./mutationLock.ts`'s
 * lock on every publish and compare-and-swaps against the whole manifest a candidate was derived from —
 * both mandatory, neither a parameter — so writer A's resumed publish is refused on a `derivedFrom` that is
 * no longer what the store holds, and every guard here now runs under that held lock rather than ahead of
 * an unguarded write. The two-writer witness is
 * `src/__tests__/unit/atlas/kit/publicationCorrectness.test.ts`. This module keeps the single-writer half,
 * which is what still catches a pass that read the store correctly and then decided to empty it.
 *
 * ## Why artifacts are counted, and counted STRUCTURALLY
 *
 * Entity count alone would have missed the measured case: the GitHub walk republished all of its declared
 * pages and lost only their screenshots, so the row count never moved. Evidence is what a reader would go
 * and look at, and in this kit that is `atlasArtifactRefSchema` — a digest and a path, reachable from any
 * entity through `sources[].artifacts[]`. Counted by scanning the entity for that SHAPE rather than by
 * walking a declared path, because the kit's own store types a kind file's entity as no more than
 * `{ id: string }`; a path-walking count would have to be re-taught by every atlas, which is precisely how a
 * rule stops being one.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { readKindFileIfPresent } from "../atlasFile.js";
import { type AtlasPublishError, AtlasPublishErrors } from "./publishErrors.js";
import type { AtlasKindFileLike, AtlasManifestLike, AtlasStorePaths } from "./store.js";
// Type-only, and that is what keeps it legal: `./volume.ts` already imports `KindEvidenceChange` from here
// as a type, so both edges of this pair are erased and neither module reaches the other at runtime.
import type { AtlasVolumeDeclaration } from "./volume.js";

/** How much a kind file evidences, in the two terms every atlas's kind file has. */
export interface KindEvidence {
  readonly entities: number;
  /** Distinct artifact digests reachable anywhere within the entities. */
  readonly artifacts: number;
}

/** The digest length `atlasArtifactRefSchema` fixes, which is what makes an artifact recognisable by shape. */
const ARTIFACT_DIGEST_LENGTH = 64;

/** Collect every artifact digest reachable inside one value, however deeply the atlas nests its sources. */
function collectDigests({ value, into }: { value: unknown; into: Set<string> }): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDigests({ into, value: item });
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const digest = value["sha256"];
  if (
    typeof digest === "string" &&
    digest.length === ARTIFACT_DIGEST_LENGTH &&
    typeof value["relativePath"] === "string"
  ) {
    into.add(digest);
  }
  for (const nested of Object.values(value)) {
    collectDigests({ into, value: nested });
  }
}

/**
 * Measure what a kind file evidences.
 *
 * @param entities the kind file's own entity records, as read or as about to be written
 * @returns the entity count and the number of distinct artifacts they reach
 */
export function evidenceOf({ entities }: { entities: readonly unknown[] }): KindEvidence {
  const digests = new Set<string>();
  collectDigests({ into: digests, value: entities });
  return { artifacts: digests.size, entities: entities.length };
}

/**
 * The operations one kind has RETIRED — declared shape-indexed by operation rather than whole.
 *
 * MEASURED on one install's JumpCloud atlas, and this is the deadlock it exists to end —
 * re-derive the on-disk counts below with
 * `grep -o '"providerId":"[^":#]*' ~/.slopweaver/atlas/jumpcloud/<kind>.jsonl | sed 's/"providerId":"//' | sort | uniq -c | sort -rn`.
 * The owner's
 * ruling declared `v2-policyresults-list` and `v2-list-device-asset-history` shape-indexed
 * (`src/atlas/jumpcloud/volume.ts`), so a walk may never produce their rows again — while rows of both
 * operations in `policies.jsonl` and `assets.jsonl` were already on disk from before the declaration. So no
 * run whose attempt at those kinds failed could publish, judged against rows the same repository forbids it
 * to fetch. A scheduled resync walked its whole fan-out and was refused `degraded`: `policies` and `assets`
 * each published fewer rows than the file on disk, by the retired operations' rows, with the atlas clock
 * unmoved.
 *
 * `./volume.ts`'s `shapeIndexedDropped` handles the WHOLE-kind case by dropping the kind from the
 * comparison entirely. That is wrong for an operation-scoped verdict, because the kind keeps its entity
 * half and a publish emptying THAT half is still the loss it looks like. So the kind stays judged and the
 * retired rows leave BOTH sides of the comparison.
 *
 * @param kind the kind being judged
 * @param volumes the atlas's own volume declaration
 * @returns the operation names this kind has retired, empty when it has retired none
 */
function retiredOperations<TKind extends string>({
  kind,
  volumes,
}: {
  kind: TKind;
  volumes: AtlasVolumeDeclaration<TKind>;
}): ReadonlySet<string> {
  const retired = new Set<string>();
  for (const verdict of volumes.verdicts) {
    if (verdict.kind !== kind || verdict.disposition !== "shape-index") {
      continue;
    }
    const operation = verdict.operation;
    if (operation === undefined) {
      continue;
    }
    retired.add(operation);
  }
  return retired;
}

/**
 * The rows of either side a publish is still answerable for — everything a retired operation did not produce.
 *
 * An atlas that declares no row-provenance reader keeps every row, visibly: `AtlasRowOperation`'s own header
 * is explicit that a platform supplying none gets whole-kind enforcement and no operation-level enforcement,
 * and inheriting a guess here would be exactly the silent widening that rule refuses.
 *
 * @param rows a kind file's rows — the stored file's or the incoming generation's
 * @param retired the operations this kind has retired
 * @param volumes the declaration, read for its row-provenance reader
 * @returns the rows the evidence comparison still judges
 */
function keptRows<TKind extends string>({
  rows,
  retired,
  volumes,
}: {
  rows: readonly unknown[];
  retired: ReadonlySet<string>;
  volumes: AtlasVolumeDeclaration<TKind>;
}): readonly unknown[] {
  const operationOf = volumes.operationOf;
  if (operationOf === undefined || retired.size === 0) {
    return rows;
  }
  return rows.filter((row) => {
    const operation = operationOf({ row });
    if (operation === null) {
      return true;
    }
    return !retired.has(operation);
  });
}

/** One kind's side of the comparison, as the store has it at publish time. */
export interface KindEvidenceChange {
  readonly kind: string;
  /** Whether this run's own attempt at this kind failed. Only a failed attempt is judged. */
  readonly attemptFailed: boolean;
  readonly incoming: KindEvidence;
  /** What the store already holds for this kind, or `null` when it holds nothing. */
  readonly existing: KindEvidence | null;
}

/**
 * Which rule, if any, refuses one kind's change.
 *
 * Two rules, and the second is the one the owner's ruling added.`degraded` is the original: a
 * run that FAILED may not publish less than the store already holds. `emptied` is new and reads no verdict
 * at all — a kind going from non-zero entities to zero is refused whatever the attempt claims about itself.
 *
 * Keeping them separate is what lets the refusal say WHICH rule fired, and the distinction is not cosmetic:
 * a degraded publish is a run to re-run, while an emptied one is either a provider that genuinely lost
 * everything or a bug, and those want different things from the reader.
 *
 * @param change the kind's two sides, as the store has them at publish time
 * @returns the rule that refuses this change, or `null` when it may be published
 */
function refusingRule({ change }: { change: KindEvidenceChange }): "degraded" | "emptied" | null {
  const existing = change.existing;
  if (existing === null) {
    return null;
  }
  if (existing.entities > 0 && change.incoming.entities === 0) {
    return "emptied";
  }
  if (!change.attemptFailed) {
    return null;
  }
  const lessEvidence = change.incoming.entities < existing.entities || change.incoming.artifacts < existing.artifacts;
  return lessEvidence ? "degraded" : null;
}

/** One refused kind's line: which rule caught it, and both sides of the comparison it lost. */
function lostLine({ change, rule }: { change: KindEvidenceChange; rule: "degraded" | "emptied" }): string {
  const replacing =
    `  ${change.kind} (${rule}): ${String(change.incoming.entities)} entities / ` +
    `${String(change.incoming.artifacts)} artifact(s), replacing `;
  // A store holding nothing for the kind held zero of both.
  if (change.existing === null) {
    return `${replacing}0 / 0`;
  }
  return `${replacing}${String(change.existing.entities)} / ${String(change.existing.artifacts)}`;
}

/**
 * Refuse a generation that would lose what the store already holds.
 *
 * Judges the two rules {@link refusingRule} describes. The `emptied` half is deliberately blind to the
 * attempt's own verdict, because the verdict is not a fact this kit can read: `./mandatoryKinds.ts`'s header
 * records that lifting a `lastAttempt.outcome` check into the kit failed 42 unit tests across five atlases,
 * since some stamp `ok` for a run that merely COMPLETED while others stamp it only for a kind actually read.
 * Entity counts carry no such per-platform meaning, so counting is the only criterion that means the same
 * thing on all 36.
 *
 * @param platform the atlas's own platform name, so a refusal says which atlas was about to lose a record
 * @param changes one entry per kind being written
 * @param overrideOpen whether the operator has opened the evidence-loss hatch for this one run, which
 *   admits the loss rather than hiding it — the caller reads the hatch, so this module does no I/O
 * @returns nothing when nothing is lost, or exactly what would have been lost and under which rule
 */
export function refuseEvidenceLoss({
  platform,
  changes,
  overrideOpen = false,
}: {
  platform: string;
  changes: readonly KindEvidenceChange[];
  overrideOpen?: boolean;
}): Result<null, AtlasPublishError> {
  if (overrideOpen) {
    return ok(null);
  }
  const lost = changes.flatMap((change) => {
    const rule = refusingRule({ change });
    return rule === null ? [] : [{ change, rule }];
  });
  if (lost.length === 0) {
    return ok(null);
  }
  return err(
    AtlasPublishErrors.evidenceWouldBeLost({
      emptied: lost.some((entry) => entry.rule === "emptied"),
      lost: lost.map((entry) => lostLine({ change: entry.change, rule: entry.rule })),
      platform,
    }),
  );
}

/**
 * Read what each kind being written would replace, so {@link refuseEvidenceLoss} has both sides.
 *
 * A kind whose file cannot be read counts as holding NOTHING rather than as a refusal: this guard exists to
 * protect a good record, and a file the store cannot read is not one. `readAtlas` is where an unreadable
 * kind file is a first-class problem — see `gradeKind`.
 *
 * BOTH sides are measured over {@link keptRows} — the rows an operation this atlas has retired produced
 * are taken off each. Symmetry is the point, and an adversarial review pass proved why: with only the
 * existing side filtered, a generation carrying 5 retired rows and 0 kept ones read as 5 → 5 against a store
 * holding 5 kept rows, so every kept row could be lost unrefused whenever the row-volume hatch let the
 * retired rows past `./volume.ts`'s `refuseVoluminousRows`. That gate reads the kind files directly rather
 * than this comparison, so filtering here hides nothing from it.
 *
 * @param paths the resolved atlas paths
 * @param kinds the platform's own kind list
 * @param files the kind files about to be written
 * @param manifest the stamped manifest, whose per-kind attempt says which of them FAILED
 * @param volumes the atlas's own volume declaration, read for the operations it has retired. Required
 *   rather than optional because there is one caller and an atlas that omitted it would silently get the
 *   deadlock {@link retiredOperations} measures back
 * @returns one change per kind being written
 */
export function evidenceChanges<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  kinds,
  files,
  manifest,
  volumes,
}: {
  paths: AtlasStorePaths<TKind>;
  kinds: readonly TKind[];
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
  volumes: AtlasVolumeDeclaration<TKind>;
}): readonly KindEvidenceChange[] {
  return kinds.flatMap((kind): readonly KindEvidenceChange[] => {
    const file = files[kind];
    if (file === undefined) {
      return [];
    }
    const onDisk = readKindFileIfPresent({ path: paths.kinds[kind] });
    const stored = onDisk.isOk() ? onDisk.value : null;
    const retired = retiredOperations({ kind, volumes });
    const existing =
      stored === null ? null : evidenceOf({ entities: keptRows({ retired, rows: stored.entities, volumes }) });
    return [
      {
        attemptFailed: manifest.kinds[kind].lastAttempt?.outcome === "failed",
        existing,
        incoming: evidenceOf({ entities: keptRows({ retired, rows: file.entities, volumes }) }),
        kind,
      },
    ];
  });
}
