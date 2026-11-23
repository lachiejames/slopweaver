/**
 * Read GitHub's configuration through the closed inventory and publish it as a generation.
 *
 * This is the `rest-live` surface, plus the `rest-openapi` surface it publishes alongside — the compiled
 * one costs no network call, so a sync that produced it separately would be two commands where the
 * descriptor promises one.
 *
 * ## The exit condition is UNIVERSAL, and that is the whole point of the summary
 *
 * `kit/coverage.ts`'s own `hasUsableCoverage` is `cells.some(...)`. Under it, sixteen kinds could fail, one
 * succeed, and the sync would report success and publish. {@link GithubSyncSummary.uncovered} is computed
 * from `githubUncoveredMandatoryKinds` instead, which requires EVERY mandatory kind to be either read or
 * honestly absent, and the CLI exits on it. A kind that GitHub refused is not honestly absent — it is a
 * boundary the reader has to see, which is why a kind refused for PERMISSIONS alone leaves the exit
 * condition only once it is stamped `permissionBlocked`, naming the grant that would lift it.
 *
 * ## A 403 is graded against the call's own expectation, not against a global rule
 *
 * `inventory.ts` states, per call, which statuses mean "not here, and that is a normal state". A repository
 * without Pages, an organisation without Advanced Security and a token without an SSO grant all produce a
 * 403 or 404 that says nothing is wrong. Grading them all as failures would make a healthy installation
 * report a mostly-red coverage table, and a reader who learns to ignore red has lost the instrument.
 *
 * ## Nothing here decides what a scope IS
 *
 * The organisations and repositories to read are handed in. That keeps this module pure of configuration
 * discovery and, more importantly, keeps the atlas honest about `visibilityScope`: an enumeration that
 * silently capped itself would produce a generation claiming to cover an organisation it had only partly
 * walked. The caller enumerates, states what it enumerated, and hands over the list.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { reconcileGaps } from "../kit/gaps.js";
import type { GithubAtlasApi } from "./client.js";
import {
  githubKindScope,
  githubUncoveredMandatoryKinds,
  replaceGithubCoverageCell,
  succeededGithubCoverageCell,
} from "./coverage.js";
import { GithubRefusalErrors, githubRefusalErrorLines } from "./errors.js";
import type { GithubCall } from "./inventoryShape.js";
import {
  assembleGithubKindFile,
  type GithubCoverageCell,
  type GithubEntity,
  type GithubKindFile,
  type GithubManifest,
  initialGithubManifest,
} from "./kindFiles.js";
import { GITHUB_KINDS, type GithubKind } from "./model.js";
import { mergeGithubKind, provenCompleteRead } from "./reconcile.js";
import { type GithubKindFailure, permissionBlockedField } from "./refusalGrade.js";
import { type GithubAtlasPaths, publishGithubAtlas, readGithubAtlas } from "./store.js";
import { GITHUB_COMPANION_CALLS, projectCallOutcome } from "./syncProjectors.js";
import { type CallOutcome, type GithubSyncScopes, readEveryScope } from "./syncRead.js";
import { foldFailure, type KindSlot, seedCompiledOperations } from "./syncSlot.js";

/** What one sync produced, and what it could not. */
export interface GithubSyncSummary {
  readonly at: string;
  /** How many entities each kind holds after the merge. */
  readonly counts: Readonly<Partial<Record<GithubKind, number>>>;
  /**
   * Mandatory kinds that are neither read, honestly absent, nor stamped `permissionBlocked` — the sync's own
   * exit condition.
   */
  readonly uncovered: readonly GithubKind[];
  /** Every call that failed, with the typed reason, so a caller can print them without re-deriving. */
  readonly failures: readonly { readonly route: string; readonly reason: string }[];
  readonly written: readonly string[];
}

/**
 * Fold one call's outcome into its kind's bucket — entities and a coverage cell, or a graded failure.
 *
 * @param outcome what the call came to
 * @param slot the kind's accumulator
 * @param outcomes every outcome this run produced, so a companion call's records can be found
 * @param at this run's ISO timestamp
 * @returns the call's failure as a one-item list, expected or not, or an empty list when the call succeeded;
 * or the refusal when the call is in neither half of the closed inventory
 */
function foldOutcome({
  outcome,
  slot,
  outcomes,
  at,
}: {
  outcome: CallOutcome;
  slot: KindSlot;
  outcomes: readonly CallOutcome[];
  at: string;
}): Result<readonly GithubKindFailure[]> {
  const scope = githubKindScope({ callId: outcome.call.id, kind: outcome.call.kind, scopeRef: outcome.scopeRef });
  if (outcome.error !== null) {
    return ok([foldFailure({ at, error: outcome.error, outcome, scope, slot })]);
  }
  // An Ok outcome may still not have reached the end of its own result set: `GithubReadOutcome` carries
  // `pagesExhausted`, and a read that stopped early is a successful read of PART of a listing. Ignoring the
  // field is what let a partial page-one read manufacture a completeness proof and stale everything it did
  // not reach — the same defect as a failed call, arriving through the success path.
  const exhausted = outcome.outcome.pagesExhausted;
  if (!exhausted) {
    slot.everyReadSucceeded = false;
  }
  const companion = companionRecords({ call: outcome.call, outcomes, scopeRef: outcome.scopeRef });
  const folded = projectCallOutcome({ at, companion, outcome });
  if (folded.isErr()) {
    return err(githubRefusalErrorLines({ error: folded.error }));
  }
  const projected = folded.value;
  slot.entities.push(...projected);
  slot.cells.push(
    succeededGithubCoverageCell({
      artifacts: [],
      at,
      reason: exhausted
        ? `${String(projected.length)} record(s) from ${outcome.route}`
        : `${String(projected.length)} record(s) from ${outcome.route}, which did NOT reach the end of its own listing`,
      role: "authoritative",
      scope,
      // A read that stopped short is `deferred`, never `synced`: it succeeded at reading PART of a listing,
      // and a coverage table that called that synced would let a sync exit zero over a partial enumeration.
      state: exhausted ? "synced" : "deferred",
      surface: "rest-live",
    }),
  );
  return ok([]);
}

/** A kind's accumulator: its first call opens it, and every later call for the same kind adds to that one. */
function kindSlot({ perKind, kind }: { perKind: Map<GithubKind, KindSlot>; kind: GithubKind }): KindSlot {
  const existing = perKind.get(kind);
  if (existing !== undefined) {
    return existing;
  }
  const opened: KindSlot = { cells: [], entities: [], everyReadSucceeded: true, gaps: [] };
  perKind.set(kind, opened);
  return opened;
}

/**
 * Merge one kind's fresh observations into its stored file.
 *
 * @param kind the kind being assembled
 * @param slot what this run accumulated for it
 * @param stored the kind's file as the store already holds it, or `null` on a first generation
 * @param at this run's ISO timestamp
 * @returns the file to publish and its coverage cells, or why it cannot be stored
 */
function assembleOneKind({
  kind,
  slot,
  stored,
  at,
}: {
  kind: GithubKind;
  slot: KindSlot;
  stored: GithubKindFile | null;
  at: string;
}): Result<{ file: GithubKindFile; cells: readonly GithubCoverageCell[] }> {
  // `pagesExhausted` is the slot's own record of whether every call feeding this kind finished, never a
  // constant: passing `true` unconditionally is what let a refused read stale live entities.
  const complete = provenCompleteRead({
    kind,
    observed: slot.entities.length,
    pagesExhausted: slot.everyReadSucceeded,
    reportedTotal: null,
  });
  if (!slot.everyReadSucceeded && complete.isOk()) {
    return err(githubRefusalErrorLines({ error: GithubRefusalErrors.completenessContradicted({ kind }) }));
  }
  const merged = mergeGithubKind({
    at,
    // An incomplete read merges what it saw and stales nothing.
    complete: complete.isErr() ? null : complete.value,
    observed: slot.entities,
    stored: stored?.entities ?? [],
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = reconcileGaps({
    at,
    observed: slot.gaps,
    rechecks: [],
    runFailed: false,
    stored: stored?.gaps ?? [],
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  let cells: readonly GithubCoverageCell[] = stored?.coverage ?? [];
  for (const cell of slot.cells) {
    cells = replaceGithubCoverageCell({ cell, cells });
  }
  const file = assembleGithubKindFile({ at, coverage: cells, entities: merged.value, gaps: gaps.value, kind });
  return file.isErr() ? err(file.error) : ok({ cells, file: file.value });
}

/**
 * Merge every kind this run touched into its stored file.
 *
 * @param perKind what each kind accumulated
 * @param snapshot the generation currently on disk
 * @param at this run's ISO timestamp
 * @returns the files to publish, the merged counts and each kind's coverage cells, or the first refusal
 */
function assembleEveryKind({
  perKind,
  snapshot,
  at,
}: {
  perKind: ReadonlyMap<GithubKind, KindSlot>;
  snapshot: { files: Readonly<Record<GithubKind, GithubKindFile | null>> };
  at: string;
}): Result<{
  files: Partial<Record<GithubKind, GithubKindFile>>;
  counts: Partial<Record<GithubKind, number>>;
  cellsByKind: Partial<Record<GithubKind, readonly GithubCoverageCell[]>>;
}> {
  const files: Partial<Record<GithubKind, GithubKindFile>> = {};
  const counts: Partial<Record<GithubKind, number>> = {};
  const cellsByKind: Partial<Record<GithubKind, readonly GithubCoverageCell[]>> = {};
  for (const kind of GITHUB_KINDS) {
    const slot = perKind.get(kind);
    if (slot === undefined) {
      continue;
    }
    const storedFile = snapshot.files[kind];
    const assembled = assembleOneKind({
      at,
      kind,
      slot,
      stored: storedFile?.kind === kind ? storedFile : null,
    });
    if (assembled.isErr()) {
      return err(assembled.error);
    }
    files[kind] = assembled.value.file;
    counts[kind] = assembled.value.file.entities.length;
    cellsByKind[kind] = assembled.value.cells;
  }
  return ok({ cellsByKind, counts, files });
}

/**
 * Read every scope through the closed inventory and publish one generation.
 *
 * @param api the injected GitHub seam
 * @param paths the resolved atlas paths
 * @param scopes the organisations and repositories to read
 * @param restOperations the compiled `rest-openapi` entities, produced with no network call
 * @param at this run's ISO timestamp
 * @param progress where a line of progress goes; omitted discards it
 * @returns what the sync produced, or every reason publication was refused
 */
export async function syncGithubAtlas({
  api,
  paths,
  scopes,
  restOperations,
  at,
  progress,
}: {
  api: GithubAtlasApi;
  paths: GithubAtlasPaths;
  scopes: GithubSyncScopes;
  restOperations: readonly GithubEntity[];
  at: string;
  progress?: (input: { line: string }) => void;
}): Promise<Result<GithubSyncSummary>> {
  const snapshot = readGithubAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const outcomes = await readEveryScope({ api, scopes, ...(progress === undefined ? {} : { progress }) });

  const perKind = new Map<GithubKind, KindSlot>();
  seedCompiledOperations({ at, restOperations, slot: kindSlot({ kind: "rest-operation", perKind }) });

  const failures: GithubKindFailure[] = [];
  for (const outcome of outcomes) {
    const folded = foldOutcome({ at, outcome, outcomes, slot: kindSlot({ kind: outcome.call.kind, perKind }) });
    if (folded.isErr()) {
      return err(folded.error);
    }
    failures.push(...folded.value);
  }

  const assembled = assembleEveryKind({ at, perKind, snapshot: snapshot.value });
  if (assembled.isErr()) {
    return err(assembled.error);
  }
  const { files, counts, cellsByKind } = assembled.value;

  const prior = snapshot.value.manifest;
  const manifest = stampSyncedKinds({ at, failures, files, prior });
  const unexpected = failures.filter((failure) => !failure.expected);
  const written = publishGithubAtlas({ derivedFrom: prior, files, manifest, paths });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({
    at,
    counts,
    failures: unexpected.map(({ reason, route }) => ({ reason, route })),
    uncovered: uncoveredAfterStamping({ cellsByKind, manifest, unexpected }),
    written: written.value,
  });
}

/**
 * The mandatory kinds this run leaves uncovered, once a permission boundary it named has been set aside.
 *
 * A kind this run stamped `permissionBlocked` from refusals its calls DECLARE has ended honestly: the owner's
 * ruling (`atlas/kit/permissionBlock.ts`) is that a surface the credential may not read is the
 * atlas working correctly, and the stamp names the grant that would lift it. An UNEXPECTED refusal —
 * `/orgs/{org}` itself answering 403 — still holds the exit, because no call said that was ordinary. Keyed on
 * the typed stamp and never on a cell's `unblockedBy`, which an unexpected AUTH_FAILED also carries once
 * `foldFailure` forces it to `unreadable`. Residue: a stored cell for a scope this run did not read (a
 * `--repos` subset) is not re-judged for a stamped kind; the scheduled resync reads every scope.
 */
function uncoveredAfterStamping({
  cellsByKind,
  manifest,
  unexpected,
}: {
  cellsByKind: Readonly<Partial<Record<GithubKind, readonly GithubCoverageCell[]>>>;
  manifest: GithubManifest;
  unexpected: readonly GithubKindFailure[];
}): readonly GithubKind[] {
  return githubUncoveredMandatoryKinds({ cells: cellsByKind }).filter(
    (kind) => manifest.kinds[kind].permissionBlocked == null || unexpected.some((failure) => failure.kind === kind),
  );
}

/**
 * The records of the call that folds into this one's entity, at the same scope.
 *
 * @param call the absorbing call
 * @param scopeRef the scope both calls were made for
 * @param outcomes every call outcome this run produced
 * @returns the companion's records, or an empty list when it has none or did not succeed
 */
function companionRecords({
  call,
  scopeRef,
  outcomes,
}: {
  call: GithubCall;
  scopeRef: string;
  outcomes: readonly CallOutcome[];
}): readonly unknown[] {
  const absorbed = Object.entries(GITHUB_COMPANION_CALLS).find(([, into]) => into === call.id)?.[0];
  if (absorbed === undefined) {
    return [];
  }
  const found = outcomes.find((entry) => entry.call.id === absorbed && entry.scopeRef === scopeRef);
  return found?.outcome?.records ?? [];
}

/** Stamp every kind this run wrote, leaving a kind it did not touch exactly as it was. */
function stampSyncedKinds({
  prior,
  files,
  failures,
  at,
}: {
  prior: GithubManifest | null;
  files: Readonly<Partial<Record<GithubKind, GithubKindFile>>>;
  failures: readonly GithubKindFailure[];
  at: string;
}): GithubManifest {
  const base = prior ?? initialGithubManifest({ updatedAt: at });
  const kinds = { ...base.kinds };
  for (const kind of GITHUB_KINDS) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    // PER KIND, because one refused route used to stamp `failed` on every kind
    // in the generation and deny `lastSuccessAt` to each one holding no entities. MEASURED by the kit's own
    // publish gate the day it landed — a single `/orgs/{org}` refusal left every kind that had answered
    // cleanly with an empty list looking never-acquired, and the gate refused the whole generation for it.
    // That is the owner's "one failure must not sink the batch" as a defect rather than a preference.
    const mine = failures.filter((failure) => failure.kind === kind);
    const unexpected = mine.filter((failure) => !failure.expected);
    kinds[kind] = {
      digest: base.kinds[kind].digest,
      entityCount: file.entities.length,
      lastAttempt: {
        at,
        outcome: unexpected.length > 0 ? "failed" : "ok",
        reasons: unexpected.map((failure) => failure.reason),
      },
      lastSuccessAt: unexpected.length === 0 || file.entities.length > 0 ? at : base.kinds[kind].lastSuccessAt,
      ...permissionBlockedField({ at, failures: mine, kind }),
    };
  }
  return { kinds, schemaVersion: base.schemaVersion, updatedAt: at };
}
