/**
 * `slopweaver atlas jumpcloud sync` — walk the Directory API and publish a generation, or refuse to.
 *
 * ## Publication FAILS CLOSED, and that is the load-bearing decision
 *
 * The kit's success predicate is existential: one synced authoritative cell is enough to make a generation
 * look routable (`kit/coverage.ts`). So a sync that read four families and lost the other seventy to a
 * transport failure would publish, and every reader downstream would treat the result as the answer to
 * "what does this organisation hold". That is the shape the owner's every-family-in-full ruling refuses.
 *
 * So this refuses to publish while any kind carries a BLOCKING failure — one a later run could clear. The
 * three that are not blocking are answers rather than failures: a 404 is this organisation saying it has
 * no such product, a 403 is a permission boundary this credential genuinely does not cross, and an unbound
 * path is an operation whose parent collection yielded no ids. Treating those as blocking would make the
 * atlas permanently unpublishable on a tenancy that simply has not bought Apple MDM.
 *
 * ## Every publish re-projects what a previous one stored
 *
 * The field-denial set grows, so an entity carried forward from an older generation was projected by an
 * older rule. `reprojectStoredEntities` applies today's rules to everything a publish writes, which is the
 * difference between a boundary and a boundary that only ever held at the moment a record arrived.
 *
 * ## The whole document faces the sensitivity gate, after every record already faced it
 *
 * Each call's entities are admitted before they are journalled, so the resume journal can never hold what a
 * kind file would be refused for holding. The assembled generation is then admitted again as one document.
 * That is not belt-and-braces: the per-call gate cannot see a value that only becomes secret-shaped once
 * two families are read together, and the whole-document gate cannot stop a journal written an hour ago.
 */
import { appendAll } from "../../lib/arrays.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type AtlasCoverageCell, failedCoverageCell } from "../kit/coverage.js";
import { type JumpcloudReadOutcome, jumpcloudKindCoverageCells } from "./coverage.js";
import {
  assembleJumpcloudKindFile,
  type JumpcloudCoverageCell,
  type JumpcloudEntity,
  type JumpcloudKindFile,
  type JumpcloudKindStatus,
} from "./entities.js";
import { jumpcloudKindGaps } from "./gaps.js";
import { permissionBoundary, productAbsence, providerAnswers } from "./kindBoundary.js";
import { mergeJumpcloudKind, provenCompleteRead } from "./merge.js";
import { JUMPCLOUD_KINDS, JUMPCLOUD_VISIBILITY_SCOPE, type JumpcloudKind } from "./model.js";
import { planJumpcloudWalk } from "./pagedSurfaces.js";
import { isShapeIndexedKind, JUMPCLOUD_SHAPE_INDEXED, type JumpcloudKindPlan } from "./plan.js";
import { type JumpcloudAtlasSnapshot, jumpcloudAtlasPaths, readJumpcloudAtlas } from "./store.js";
import type { JumpcloudSyncDeps } from "./syncDeps.js";
import { type JumpcloudKindWalk, walkJumpcloud } from "./syncEngine.js";
import { reprojectStoredEntities } from "./syncEntities.js";
import {
  type AssembledGeneration,
  blockingFailures,
  type JumpcloudKindOutcome,
  type JumpcloudSyncReport,
  publishOrRefuse,
} from "./syncPublish.js";

/** Whether this kind's read may be treated as having finished. */
function outcomeFor({ walk }: { walk: JumpcloudKindWalk }): JumpcloudReadOutcome {
  const first = walk.failures[0];
  if (first === undefined) {
    return { answered: [], status: "complete" };
  }
  const answered = providerAnswers({ walk });
  return answered === null ? { error: first.error, status: "incomplete" } : { answered, status: "complete" };
}

/**
 * Narrow a kit coverage cell into the shape this atlas stores.
 *
 * The two differ in exactly one respect — the kit's `artifacts` is `readonly` and the Zod-derived stored
 * shape's is not — so this copies the array rather than aliasing the kit's own.
 *
 * @param cell the kit-shaped cell
 * @returns the cell as this atlas stores it
 */
function storedCell({ cell }: { cell: AtlasCoverageCell }): JumpcloudCoverageCell {
  return { ...cell, artifacts: [...cell.artifacts] };
}

/** The cell a shape-indexed kind publishes instead of a walk, quoting the reason its table row states. */
function shapeIndexedCell({ kind, reason }: { kind: JumpcloudKind; reason: string }): JumpcloudCoverageCell {
  return storedCell({
    cell: failedCoverageCell({
      previous: null,
      reason,
      role: "authoritative",
      scope: kind,
      state: "deferred",
      surface: "directory-api",
      unblockedBy:
        "recover the three pinned specification files, derive the family's allowed aggregate schema from them, and build the shape index from that schema rather than from observed records",
      visibilityScope: JUMPCLOUD_VISIBILITY_SCOPE,
    }),
  });
}

/**
 * Assemble one kind's file from its walk.
 *
 * @param walk what the walk accumulated
 * @param plan what the plan said would run
 * @param stored the entities this kind's file already holds
 * @param priorStatus what the manifest recorded for this kind before this run, so a failed attempt stops an
 * earlier success being current without erasing it
 * @param at this run's ISO timestamp
 * @returns the file and the manifest status it earns, or why the document is not storable
 */
function assembleKind({
  walk,
  plan,
  stored,
  priorStatus,
  at,
}: {
  walk: JumpcloudKindWalk;
  plan: JumpcloudKindPlan;
  stored: JumpcloudKindFile | null;
  priorStatus: JumpcloudKindStatus | null;
  at: string;
}): Result<{
  readonly file: JumpcloudKindFile;
  readonly status: JumpcloudKindStatus;
  readonly cell: JumpcloudCoverageCell;
}> {
  const outcome = outcomeFor({ walk });
  // Today's denial rules are applied to what a previous generation stored, not only to what this run read.
  const carried = reprojectStoredEntities({ stored: stored?.entities ?? [] });
  const merged = foldKind({ at, carried: carried.entities, walk });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const cells = jumpcloudKindCoverageCells({
    at,
    kind: walk.kind,
    outcome,
    previous: stored?.coverage.find((cell) => cell.surface === "directory-api") ?? null,
    // The re-projections are folded in as well as this run's, so a removal from a document nobody fetched
    // is still something coverage says out loud.
    alsoDropped: walk.journalledDrops,
    projections: [...walk.projections, ...carried.projections],
    role: "authoritative",
    surface: "directory-api",
  });
  const file = assembleJumpcloudKindFile({
    at,
    coverage: cells.map((cell) => storedCell({ cell })),
    entities: merged.value,
    gaps: jumpcloudKindGaps({ at, plan, walk }),
    kind: walk.kind,
    readEpoch: walk.firstAt === null || walk.lastAt === null ? null : { endedAt: walk.lastAt, startedAt: walk.firstAt },
  });
  if (file.isErr()) {
    return err(file.error);
  }
  return ok({
    // The builder's return type is a non-empty list, so a kind always has its first cell to report.
    cell: storedCell({ cell: cells[0] }),
    file: file.value,
    status: kindStatus({
      at,
      entityCount: merged.value.length,
      priorStatus,
      succeeded: outcome.status === "complete",
      walk,
    }),
  });
}

/**
 * Merge this run's entities onto what the store already held, staling only on proof.
 *
 * @param walk what the walk accumulated for this kind
 * @param carried the stored entities, already re-projected through today's denial rules
 * @param at this run's ISO timestamp
 * @returns the merged entity list, or the reason this run cannot be merged
 */
function foldKind({
  walk,
  carried,
  at,
}: {
  walk: JumpcloudKindWalk;
  carried: readonly JumpcloudEntity[];
  at: string;
}): Result<readonly JumpcloudEntity[]> {
  const proof = provenCompleteRead({
    declaredTotal: walk.declaredTotal,
    kind: walk.kind,
    observed: walk.entities.length,
    operationsRefused: walk.failures.length,
    pagesExhausted: walk.pagesExhausted,
  });
  return mergeJumpcloudKind({
    at,
    channel: "directory-api",
    complete: proof.isOk() ? proof.value : null,
    observed: walk.entities,
    stored: carried,
  });
}

/**
 * The manifest status one kind's run earns.
 *
 * @param walk what the walk accumulated, whose failures become the attempt's recorded reasons
 * @param succeeded whether the read finished
 * @param entityCount how many entities the merge produced
 * @param priorStatus what the manifest recorded before this run
 * @param at this run's ISO timestamp
 * @returns the status, with an earlier success carried forward rather than erased by a failed attempt
 */
function kindStatus({
  walk,
  succeeded,
  entityCount,
  priorStatus,
  at,
}: {
  walk: JumpcloudKindWalk;
  succeeded: boolean;
  entityCount: number;
  priorStatus: JumpcloudKindStatus | null;
  at: string;
}): JumpcloudKindStatus {
  const reasons = walk.failures.map((failure) => failure.error.message);
  const blocked = permissionBoundary({ succeeded, walk });
  const absent = productAbsence({ succeeded, walk });
  return {
    digest: null,
    entityCount,
    lastAttempt: { at, outcome: succeeded ? "ok" : "failed", reasons },
    // A failed attempt must not erase an earlier successful look, only stop it being current — so the prior
    // MANIFEST's success time carries forward, never a coverage cell that may belong to the other surface.
    lastSuccessAt: succeeded ? at : (priorStatus?.lastSuccessAt ?? null),
    ...(blocked === null ? {} : { permissionBlocked: { at, ...blocked } }),
    ...(absent === null ? {} : { productAbsent: { at, detail: absent } }),
  };
}

/**
 * Assemble every walked kind's file, status and outcome, collecting what would refuse a publication.
 *
 * @param walks what the walk produced, one per planned kind
 * @param plans the plans those walks ran
 * @param snapshot what the store already held
 * @param at this run's ISO timestamp
 * @returns the assembled generation, or the first document that could not be stored
 */
function assembleWalked({
  walks,
  plans,
  snapshot,
  at,
}: {
  walks: readonly JumpcloudKindWalk[];
  plans: readonly JumpcloudKindPlan[];
  snapshot: JumpcloudAtlasSnapshot;
  at: string;
}): Result<AssembledGeneration> {
  const files: Partial<Record<JumpcloudKind, JumpcloudKindFile>> = {};
  const statuses: Partial<Record<JumpcloudKind, JumpcloudKindStatus>> = {};
  const outcomes: JumpcloudKindOutcome[] = [];
  const refusals: string[] = [];
  for (const walk of walks) {
    const plan = plans.find((candidate) => candidate.kind === walk.kind);
    if (plan === undefined) {
      continue;
    }
    appendAll({ from: blockingFailures({ walk }), into: refusals });
    const assembled = assembleKind({
      at,
      plan,
      priorStatus: snapshot.manifest?.kinds[walk.kind] ?? null,
      stored: snapshot.files[walk.kind],
      walk,
    });
    if (assembled.isErr()) {
      return err(assembled.error);
    }
    files[walk.kind] = assembled.value.file;
    statuses[walk.kind] = assembled.value.status;
    outcomes.push({
      entityCount: assembled.value.file.entities.length,
      kind: walk.kind,
      reason: assembled.value.cell.reason,
      resumed: walk.resumed,
      state: assembled.value.cell.state,
    });
  }
  return ok({ files, outcomes, refusals, statuses });
}

/**
 * Carry every whole-kind shape-indexed family forward, saying why each is not walked.
 *
 * They keep whatever a previous generation stored and publish a `deferred` cell rather than vanishing,
 * because a kind that disappears from a generation reads as a kind that does not exist.
 *
 * @param generation what the walked kinds assembled, added to in place
 * @param snapshot what the store already held
 * @param at this run's ISO timestamp
 * @returns the generation with both families present, or why one could not be stored
 */
function addShapeIndexed({
  generation,
  snapshot,
  at,
}: {
  generation: AssembledGeneration;
  snapshot: JumpcloudAtlasSnapshot;
  at: string;
}): Result<AssembledGeneration> {
  const files = { ...generation.files };
  const statuses = { ...generation.statuses };
  const outcomes = [...generation.outcomes];
  for (const kind of JUMPCLOUD_KINDS.filter((candidate) => isShapeIndexedKind({ kind: candidate }))) {
    // Present: the filter above admits exactly the kinds that table holds an own row for.
    const cell = shapeIndexedCell({ kind, reason: JUMPCLOUD_SHAPE_INDEXED[kind]! });
    const stored = snapshot.files[kind];
    const file = assembleJumpcloudKindFile({
      at,
      coverage: [cell],
      // A highly voluminous family is catalogued as a SHAPE and never stored a row at a time. Carrying
      // `stored.entities` forward would be invisible while the only shape-indexed kinds held zero rows each, and
      // would be the defect the moment `systeminsights` was declared beside them with a full family of rows
      // already on disk. A shape-indexed kind
      // publishes NOTHING, so adopting a verdict is what takes the rows out rather than a migration.
      // `kit/store.ts`'s `shapeIndexedDropped` is why the evidence-loss guard does not refuse this.
      entities: [],
      gaps: stored?.gaps ?? [],
      kind,
      readEpoch: stored?.readEpoch ?? null,
    });
    if (file.isErr()) {
      return err(file.error);
    }
    files[kind] = file.value;
    statuses[kind] = {
      digest: null,
      entityCount: file.value.entities.length,
      lastAttempt: { at, outcome: "failed", reasons: [cell.reason] },
      lastSuccessAt: snapshot.manifest?.kinds[kind]?.lastSuccessAt ?? null,
    };
    outcomes.push({
      entityCount: file.value.entities.length,
      kind,
      reason: cell.reason,
      resumed: 0,
      state: cell.state,
    });
  }
  return ok({ files, outcomes, refusals: generation.refusals, statuses });
}

/**
 * Walk the Directory API and publish a generation, or refuse and say why.
 *
 * @param home the resolved state home
 * @param deps the client, clock and progress sink
 * @returns what each kind ended up with and whether the generation was published
 */
export async function syncJumpcloudAtlas({
  home,
  deps,
}: {
  home: string;
  deps: JumpcloudSyncDeps;
}): Promise<Result<JumpcloudSyncReport>> {
  const paths = jumpcloudAtlasPaths({ home });
  const snapshot = readJumpcloudAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const at = deps.now();
  const plans = planJumpcloudWalk();
  const walked = await walkJumpcloud({ deps: { ...deps, directory: paths.directory }, plans });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const assembled = assembleWalked({ at, plans, snapshot: snapshot.value, walks: walked.value });
  if (assembled.isErr()) {
    return err(assembled.error);
  }
  const whole = addShapeIndexed({ at, generation: assembled.value, snapshot: snapshot.value });
  if (whole.isErr()) {
    return err(whole.error);
  }
  return publishOrRefuse({
    generation: whole.value,
    knownSecrets: [deps.client.apiKey],
    paths,
    prior: snapshot.value.manifest,
  });
}
