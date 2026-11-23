/**
 * Publication: the one seam that writes an atlas generation, and the two things that make it correct.
 *
 * `./store.ts` is the READ half and the document contract — this module is the write. They were one file
 * until publication grew a lock and a compare-and-swap of its own and took it past the `file-size-ratchet`
 * cap; the cut is the seam that file's own header already described, so nothing here reaches back into it
 * except for the contract types and the manifest read the compare-and-swap performs.
 *
 * ## Both correctness properties are MANDATORY, and neither is a parameter
 *
 * {@link publishAtlas} takes `./mutationLock.ts`'s lock and refuses a candidate whose derivation basis is
 * no longer what the store holds. An atlas cannot opt out of either, which is the whole point: correctness
 * used to be a call thirteen platform stores made and the rest did not, so a NEW atlas lost an update
 * silently and nothing said so. The owner's rule is that correctness is never opt-in.
 *
 * ## Whole-or-nothing, and what runs under the lock
 *
 * Every file is staged beside its own destination and the set is installed by rename — `./generationSwap.ts`
 * carries the protocol, what it closes and the one residue it does not. Every guard here runs INSIDE the
 * held lock, {@link ../kit/evidenceLoss.js#evidenceChanges} included: it reads the live kind files off disk,
 * and a guard that read them outside the lock would be judging a store that can still move before the write.
 */
import { mkdirSync } from "node:fs";

import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusalLines } from "../../hatch/render.js";
import { err, ok, type Result } from "../../lib/result.js";
import { digestOfKindFile, stableJson, writeAtomic, writeAtomicKindFile } from "../atlasFile.js";

import { evidenceChanges, refuseEvidenceLoss } from "./evidenceLoss.js";
import { type GenerationFile, swapGeneration } from "./generationSwap.js";
import type { AtlasKindStatus } from "./kindStatus.js";
import { mandatoryKindRefusal, unacquiredMandatoryKinds } from "./mandatoryKinds.js";
import { derivedManifestClock, kindClocks, manifestClockDefects } from "./manifestClock.js";
import { type AtlasMutationLease, refuseForeignLease, withAtlasMutationLock } from "./mutationLock.js";
import { type AtlasPublishError, AtlasPublishErrors, atlasPublishErrorLines } from "./publishErrors.js";
import {
  type AtlasKindFileLike,
  type AtlasManifestLike,
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  kindFileParts,
  readAtlas,
  readKindFile,
  readManifest,
} from "./store.js";
import { incoherentKinds, kindDisagreements, validateGeneration } from "./storeCoherence.js";
import { refuseVoluminousRows, rowVolumeHatchOpen, shapeIndexedDropped } from "./volume.js";

/** Record a digest and entity count for every kind file this generation writes. */
function stampDigests<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  files,
  manifest,
  kinds,
}: {
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
  kinds: readonly TKind[];
}): TManifest {
  const stamped: Record<TKind, AtlasKindStatus> = { ...manifest.kinds };
  for (const kind of kinds) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    stamped[kind] = {
      ...stamped[kind],
      digest: digestOfKindFile(kindFileParts({ file })),
      entityCount: file.entities.length,
    };
  }
  return { ...manifest, kinds: stamped };
}

/**
 * The mandatory-kind refusal for one publish, or no lines when the generation may be written.
 *
 * Split out of {@link publishAtlas} so that function stays inside the `max-function-lines` budget, and
 * because the join it performs — which kinds this publish writes, against what the manifest says they have
 * ever held — is the whole input to `./mandatoryKinds.ts` and reads better named than inline.
 *
 * @param files the kind files this publish is writing; a kind absent here is left untouched on disk
 * @param manifest the stamped manifest about to be published
 * @param spec the platform's own document contract, carrying its declared obligations
 * @returns the refusal lines, or an empty list when nothing is owed
 */
function refuseUnacquiredMandatory<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  files,
  manifest,
  spec,
}: {
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
}): readonly string[] {
  const unacquired = unacquiredMandatoryKinds({
    kinds: spec.kinds,
    manifest,
    obligations: spec.kindObligations,
    present: spec.kinds.filter((kind) => files[kind] !== undefined),
  });
  return mandatoryKindRefusal({ platform: spec.platform, unacquired });
}

/** The evidence-loss hatch row, looked up once so the reader and the refusal cannot name different rows. */
const EVIDENCE_LOSS_HATCH = hatchFor({ id: "atlas-evidence-loss" });

/**
 * Whether the operator has opened the evidence-loss hatch for this run.
 *
 * Read here rather than in `./evidenceLoss.ts` so the decision stays pure and this module keeps the one
 * environment read. Written as a statement rather than a parameter default deliberately — `hatch-release`
 * in `yarn lint` refuses a defaulted hatch read anywhere in the tree, because a caller passing its own
 * argument skips a default and can therefore CLOSE a hatch the operator opened.
 *
 * @returns whether the ambient variable this hatch declares is set to `1`
 */
function evidenceLossHatchOpen(): boolean {
  return process.env["SLOPWEAVER_ALLOW_ATLAS_EVIDENCE_LOSS"] === "1";
}

/**
 * Refuse a publish whose derivation basis is no longer what the store holds — the compare-and-swap.
 *
 * Run under the mutation lock, and it is the half of publication correctness the lock cannot supply. A
 * mutex around the final rename serialises two writers and still loses an update: both read generation A,
 * both pass every guard against A, and whichever commits second installs a file set that never saw the
 * first one's rows. A Codex review pass built exactly that against the zero-evidence-loss guard — writer A
 * is descheduled after `refuseEvidenceLoss` admits its empty walk 0 → 0, writer B publishes one entity, A
 * resumes and installs its already-approved empty file over it, taking the store 1 → 0 with the hatch shut.
 *
 * The comparison is over the WHOLE manifest, serialised by {@link stableJson}. `updatedAt` is not a
 * generation identity: it is derived from the kind files a generation vouches for, so two candidates built
 * from the same evidence in the same second legitimately share one, and a token two writers can both
 * present is not a token at all.
 *
 * Three edges, each a decision rather than a fall-through:
 *
 * - A `null` basis asserts the store held NOTHING. It therefore refuses whenever a manifest exists, which
 *   is what stops a first-run publisher blanking a generation somebody else has since installed.
 * - A manifest that cannot be READ refuses too, carrying the reader's own lines. That is a live behaviour
 *   change and it is the point: before this, a build writing schema 4 that met a schema-6 generation
 *   published straight over it, and the newer generation was the one destroyed. `atlas <platform> restore`
 *   and a newer build are the remedies `supersedeAdvice` already names.
 * - `reset` and `restore` rename the live generation away BEFORE they publish, so the read finds nothing
 *   and their `null` basis is true rather than excused.
 */
function refuseIfGenerationMoved<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  derivedFrom,
  paths,
  spec,
}: {
  derivedFrom: TManifest | null;
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
}): Result<null, AtlasPublishError> {
  const live = readManifest({ paths, spec });
  if (live.isErr()) {
    // The reader's own lines say what is wrong with the generation on disk and what to do about it, so they
    // are forwarded as the variant's reasons rather than framed by a sentence of this module's own.
    return err(AtlasPublishErrors.generationUnreadable({ reasons: live.error }));
  }
  if (live.value === null && derivedFrom === null) {
    return ok(null);
  }
  if (
    live.value !== null &&
    derivedFrom !== null &&
    stableJson({ value: live.value }) === stableJson({ value: derivedFrom })
  ) {
    return ok(null);
  }
  return err(AtlasPublishErrors.generationMoved({ platform: spec.platform }));
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * Two refusals happen before anything is written, and both are about a document that would parse: a manifest
 * whose per-kind numbers contradict each other ({@link incoherentKinds}), and a kind file holding a record
 * that belongs to another kind ({@link kindDisagreements}, also applied on every read).
 *
 * Whole-or-nothing. Every file is staged beside its own destination and the set is installed by rename —
 * `./generationSwap.ts` carries the protocol, what it closes and the one residue it does not.
 *
 * Every read of `paths` below happens under the caller's held mutation lock, which is why this is a
 * separate function rather than inline: {@link kindClocks} and {@link evidenceChanges} both read the live
 * generation off disk, and a guard that reads outside the lock judges a store that may have moved by the
 * time it is written to.
 */
function publishHeldGeneration<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
  files,
  manifest,
  derivedFrom,
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
  derivedFrom: TManifest | null;
}): Result<readonly string[], AtlasPublishError> {
  const unmoved = refuseIfGenerationMoved({ derivedFrom, paths, spec });
  if (unmoved.isErr()) {
    return err(unmoved.error);
  }
  const clocks = kindClocks({ files, kinds: spec.kinds, manifest, paths });
  const twoClocks = manifestClockDefects({ clocks });
  if (twoClocks.length > 0) {
    return err(AtlasPublishErrors.clocksDisagree({ problems: twoClocks }));
  }
  const dated = { ...manifest, updatedAt: derivedManifestClock({ clocks, fallback: manifest.updatedAt }) };
  const stamped = stampDigests({ files, kinds: spec.kinds, manifest: dated });
  const refused = refuseStampedGeneration({ derivedFrom, files, manifest: stamped, paths, spec });
  if (refused.isErr()) {
    return err(refused.error);
  }
  mkdirSync(paths.directory, { recursive: true });
  return swapGeneration({ files: generationWrites({ files, kinds: spec.kinds, manifest: stamped, paths }) });
}

/**
 * Every refusal that judges the STAMPED manifest, in the order a reader should meet them.
 *
 * Split out of {@link publishHeldGeneration} so that function stays inside the `max-function-lines` budget,
 * and it is the right seam anyway: everything here is a judgement over a candidate whose digests and clock
 * are already final, while its caller owns deriving them and then writing. Every one of these runs under
 * the caller's held mutation lock, {@link evidenceChanges} included — it reads the live kind files, and a
 * guard that read them outside the lock would be judging a store that can still move.
 */
function refuseStampedGeneration<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
  files,
  manifest,
  derivedFrom,
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
  derivedFrom: TManifest | null;
}): Result<null, AtlasPublishError> {
  const incoherent = incoherentKinds({ kinds: spec.kinds, manifest });
  if (incoherent.length > 0) {
    return err(AtlasPublishErrors.kindsIncoherent({ problems: incoherent }));
  }
  // Named rather than `?? ok(null)`: a platform with NO publish guard is a real, common case and deserves
  // to be spelled, and `no-silent-fallback` refuses the operator that would hide it.
  const guardPublish = spec.guardPublish;
  if (guardPublish !== undefined) {
    const guarded = guardPublish({ next: manifest, prior: derivedFrom });
    if (guarded.isErr()) {
      return err(AtlasPublishErrors.publishGuardRefused({ problems: guarded.error }));
    }
  }
  const undegraded = refuseEvidenceLoss({
    changes: shapeIndexedDropped({
      changes: evidenceChanges({ files, kinds: spec.kinds, manifest, paths, volumes: spec.kindVolumes }),
      volumes: spec.kindVolumes,
    }),
    overrideOpen: evidenceLossHatchOpen(),
    platform: spec.platform,
  });
  if (undegraded.isErr()) {
    const hatchLines = hatchRefusalLines({ hatch: EVIDENCE_LOSS_HATCH });
    return err(AtlasPublishErrors.evidenceLossRefused({ hatchLines, refusal: undegraded.error }));
  }
  const invalid = validateGeneration({ files, manifest, spec });
  if (invalid.length > 0) {
    return err(AtlasPublishErrors.generationInvalid({ problems: invalid }));
  }
  const owed = refuseUnacquiredMandatory({ files, manifest, spec });
  if (owed.length > 0) {
    return err(AtlasPublishErrors.mandatoryKindsOwed({ problems: owed }));
  }
  const voluminous = rowVolumeHatchOpen() ? [] : refuseVoluminousRows({ files, spec });
  if (voluminous.length > 0) {
    return err(AtlasPublishErrors.rowsVoluminous({ problems: voluminous }));
  }
  return ok(null);
}

/**
 * Publish a generation under this atlas's mutation lock, refusing one derived from a generation that moved.
 *
 * Both halves are MANDATORY and neither is a parameter. Correctness used to be opt-in — thirteen platform
 * stores took `./publishGuard.ts`'s lock voluntarily and eight more atlas modules reached for
 * `admit/operationLock.ts` themselves, so a new atlas that simply omitted the call lost an update silently
 * and nothing said so. `./mutationLock.ts`'s header carries why the lock has its own key, and
 * {@link refuseIfGenerationMoved} carries why a lock alone is not enough.
 *
 * @param paths the resolved atlas paths, whose `home` the lock lives under
 * @param spec the platform's own document contract
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish, whose `updatedAt` is REPLACED by the clock derived from the
 *   generation's own files — a caller cannot assert one, the same way it cannot assert a digest
 * @param derivedFrom the manifest this candidate was built ON, which is both the compare-and-swap token and
 *   the platform publish guard's `prior`; `null` asserts the store held no generation at all
 * @param lease a mutation lease a caller already holds, so a multi-step transaction such as `reset` can
 *   publish from inside its own lock rather than deadlocking on it
 * @param nowIso the instant the lock attempt judges a held lock's staleness by. Read from the wall clock
 *   rather than threaded from a caller deliberately: a sync stamps `at` when it STARTS, and a pass that
 *   spent twenty minutes with a provider would present a clock old enough to declare a live holder stale
 *   and take its lock. A test pins it; nothing else passes it.
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishAtlas<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
  files,
  manifest,
  derivedFrom,
  lease,
  nowIso = new Date().toISOString(),
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
  files: Readonly<Partial<Record<TKind, TFile>>>;
  manifest: TManifest;
  derivedFrom: TManifest | null;
  lease?: AtlasMutationLease;
  nowIso?: string;
}): Result<readonly string[]> {
  // The one place a typed publish failure leaves the kit: every platform reads these as lines.
  const held = (): Result<readonly string[]> =>
    publishHeldGeneration({ derivedFrom, files, manifest, paths, spec }).mapErr((error) =>
      atlasPublishErrorLines({ error }),
    );
  if (lease !== undefined) {
    const own = refuseForeignLease({ home: paths.home, lease, platform: spec.platform });
    if (own.isErr()) {
      return err(atlasPublishErrorLines({ error: own.error }));
    }
    return held();
  }
  return withAtlasMutationLock({
    home: paths.home,
    mutate: held,
    nowIso,
    platform: spec.platform,
  });
}

/**
 * The write plan for one generation: every kind file this publish carries, then the manifest last.
 *
 * Split out of {@link publishAtlas} to keep it inside the `max-function-lines` budget, and it is the right
 * seam anyway — everything above it in that function is a REFUSAL, and everything here is the write. The
 * manifest goes last because it is what vouches for the files beside it.
 *
 * @param files the kind files this publish is writing; a kind absent here is left untouched on disk
 * @param kinds every kind the platform declares, iterated so order never comes from a directory listing
 * @param manifest the stamped manifest, written after every file it names
 * @param paths where this platform's generation lives
 * @returns the ordered writes for the atomic swap
 */
function generationWrites<TKind extends string, TFile extends AtlasKindFileLike, TManifest>({
  files,
  kinds,
  manifest,
  paths,
}: {
  files: Readonly<Partial<Record<TKind, TFile>>>;
  kinds: readonly TKind[];
  manifest: TManifest;
  paths: AtlasStorePaths<TKind>;
}): readonly GenerationFile[] {
  const generation: GenerationFile[] = [];
  for (const kind of kinds) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    const parts = kindFileParts({ file });
    // A staged sibling shares its destination's directory, which `commitGeneration` flushes once after the
    // last install — so flushing it here per kind would buy nothing (see `writeAtomicKindFile`).
    generation.push({
      path: paths.kinds[kind],
      write: ({ path }) => writeAtomicKindFile({ ...parts, flushDirectory: false, path }),
    });
  }
  generation.push({ path: paths.manifest, write: ({ path }) => writeAtomic({ path, value: manifest }) });
  return generation;
}
/**
 * Every store read and write, bound to one atlas's spec.
 *
 * @internal
 */
export interface BoundAtlasStore<TKind extends string, TFile, TManifest> {
  readManifest: (input: { paths: AtlasStorePaths<TKind> }) => Result<TManifest | null>;
  readKindFile: (input: { paths: AtlasStorePaths<TKind>; kind: TKind }) => Result<TFile | null>;
  readAtlas: (input: { paths: AtlasStorePaths<TKind> }) => Result<AtlasSnapshot<TKind, TFile, TManifest>>;
  publish: (input: {
    paths: AtlasStorePaths<TKind>;
    files: Readonly<Partial<Record<TKind, TFile>>>;
    manifest: TManifest;
    derivedFrom: TManifest | null;
  }) => Result<readonly string[]>;
}

/**
 * Bind every store read and write to one atlas's spec, so a platform's own store module holds its PATHS and
 * its SCHEMAS and nothing else.
 *
 * ## Why a binding rather than four free functions
 *
 * Every one of these takes the same `spec` on every call, so an atlas calling them directly ends up with
 * four identical wrappers AND an identical import list — which the clone ratchet caught between two atlas
 * stores written a day apart. That is not a tidiness complaint: a wrapper that forgets to pass the spec
 * cannot exist here, and the import list stops being a place two atlases silently diverge in what they reach
 * for. What genuinely differs per platform is where its files live and what validates them, and that is
 * exactly what stays behind.
 *
 * The publish GUARDS are deliberately not here — `kit/publishGuard.ts` owns those, because an atlas with one
 * writer does not need them and one with two needs both halves of the pair.
 *
 * @param spec the atlas's own store spec — its kinds, schemas, platform name and supersede remedy
 * @returns every store read and write, with the spec already applied
 */
export function bindAtlasStore<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({ spec }: { spec: AtlasStoreSpec<TKind, TFile, TManifest> }): BoundAtlasStore<TKind, TFile, TManifest> {
  return {
    publish: ({ paths, files, manifest, derivedFrom }) => publishAtlas({ derivedFrom, files, manifest, paths, spec }),
    readAtlas: ({ paths }) => readAtlas({ paths, spec }),
    readKindFile: ({ paths, kind }) => readKindFile({ kind, paths, spec }),
    readManifest: ({ paths }) => readManifest({ paths, spec }),
  };
}
