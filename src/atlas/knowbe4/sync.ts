/**
 * Publishing what one sync read — the generation, built pure from the observation and what the store held.
 *
 * Every kind is read by exactly one path, so a kind's grade is its path's outcome:
 *
 * - the path answered whole: `lastSuccessAt` is this run and the entities are what was read;
 * - the path answered but stopped at a bound: the kind keeps its last WHOLE read unchanged, or before one, what
 *   this read reached with every earlier entity carried beside it, and the attempt is `failed` naming the bound
 *   while `lastSuccessAt` stays the last whole read — a partial read never reads as a fresh one;
 * - the path failed: the attempt is `failed` with KnowBe4's own words, `lastSuccessAt` stays the earlier
 *   success, and the entities the kind held LAST time carry forward — a failed read keeps what it had, it does
 *   not empty the kind (`kit/evidenceLoss.ts` would refuse the publish if it did);
 * - the failure was a 403: the kind is also stamped `permissionBlocked`, naming the subscription tier that
 *   would lift it, which is what lets the kit tell a permission boundary from a broken atlas.
 *
 * Any other failure on a kind never acquired leaves it with no success and no block, and the kit's
 * mandatory-kind gate then refuses the whole publish. That is the intended fail-closed: a never-read empty kind
 * published beside real ones would read as "nobody in this account owes training".
 */
import { err, ok, type Result } from "#lib/result.js";
import { stableEntityId } from "../kit/identity.js";
import { failureWords, type Knowbe4PriorGeneration, pathCell, unreadPartitionCells } from "./cells.js";
import { KNOWBE4_FILL_CALLS, type Knowbe4FillCall, SUBSCRIPTION_UNBLOCKED_BY } from "./fill/plan.js";
import { isProjectedDetail } from "./fill/projectShapes.js";
import type { Knowbe4CallAnswered, Knowbe4FillObservation } from "./fill/run.js";
import {
  emptyKnowbe4KindFiles,
  initialKnowbe4Manifest,
  KNOWBE4_ATLAS_KINDS,
  KNOWBE4_ATLAS_PLATFORM,
  type Knowbe4AtlasKind,
  type Knowbe4AtlasKindFile,
  type Knowbe4AtlasManifest,
} from "./model.js";
import { knowbe4AtlasPaths, publishKnowbe4Atlas, readKnowbe4Atlas } from "./store.js";

type Entity = Knowbe4AtlasKindFile["entities"][number];
type KindStatus = Knowbe4AtlasManifest["kinds"][Knowbe4AtlasKind];

/** What one publish produced. */
export interface Knowbe4SyncReport {
  readonly entitiesByKind: readonly { readonly kind: Knowbe4AtlasKind; readonly entities: number }[];
  readonly written: readonly string[];
}

/**
 * The entities one answered path contributes, each keeping the first time any run saw it.
 *
 * @param answered the path that answered
 * @param earlier the kind's entities last time, by provider id
 * @param at this run's ISO timestamp
 * @returns the entities, sorted by provider id so two runs over the same answers write the same bytes
 */
function answeredEntities({
  answered,
  earlier,
  at,
}: {
  answered: Knowbe4CallAnswered;
  earlier: ReadonlyMap<string, Entity>;
  at: string;
}): readonly Entity[] {
  return answered.items
    .map((item): Entity => {
      const before = earlier.get(item.providerId)?.channels.api;
      const firstSeenAt = before == null ? at : before.firstSeenAt;
      return {
        channels: {
          api: {
            channel: "api",
            detail: item.detail,
            firstSeenAt,
            lastSeenAt: at,
            source: {
              artifacts: [],
              channel: "api",
              deepLink: null,
              deepLinkStatus: "unavailable",
              endpoint: `GET ${answered.template}`,
              observedAt: at,
            },
            state: "observed",
          },
          browser: null,
        },
        id: stableEntityId({
          components: { providerId: item.providerId },
          namespace: `${KNOWBE4_ATLAS_PLATFORM}:${answered.kind}`,
        }),
        kind: answered.kind,
        providerId: item.providerId,
      };
    })
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * A bounded read is PARTIAL, so it never stands in for the whole kind. Where a whole read stands behind it, that
 * whole read is kept exactly as it was, so the file IS the kind as of its `lastSuccessAt` — merging the partial
 * read in would republish a membership a re-read group dropped beside ones it added, a set no reader can take
 * apart (p3), and retiring the dropped one instead is a failed run shrinking the kind, which the kit's
 * evidence-loss gate refuses. Before any whole read, the partial read is published with every earlier entity
 * it did not reach carried beside it, and the kind still claims no success. A complete read replaces the kind
 * outright, which is how an entity KnowBe4 no longer lists leaves it.
 *
 * @param read the entities this run read for the kind
 * @param earlierList the kind's entities last time
 * @param truncated whether the read stopped at a bound with more to read
 * @param wholeBefore whether the kind has a whole read behind it
 * @returns the kind's entities, sorted by provider id
 */
function withUnreachedCarried({
  read,
  earlierList,
  truncated,
  wholeBefore,
}: {
  read: readonly Entity[];
  earlierList: readonly Entity[];
  truncated: boolean;
  wholeBefore: boolean;
}): readonly Entity[] {
  if (!truncated) {
    return read;
  }
  if (wholeBefore) {
    return earlierList;
  }
  const reached = new Set(read.map((entity) => entity.providerId));
  return [...read, ...earlierList.filter((entity) => !reached.has(entity.providerId))].toSorted((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
}

/**
 * One kind's file and manifest status.
 *
 * @param call the one path that reads the kind
 * @param fill what the run brought back
 * @param prior what the store held
 * @returns both halves, built together so a file and its status cannot disagree about what was read
 */
function kindGeneration({
  call,
  fill,
  prior,
}: {
  call: Knowbe4FillCall;
  fill: Knowbe4FillObservation;
  prior: Knowbe4PriorGeneration;
}): { readonly file: Knowbe4AtlasKindFile; readonly status: KindStatus } {
  const at = fill.filledAtIso;
  const kind = call.kind;
  const empty = emptyKnowbe4KindFiles({ at })[kind];
  const coverage = [pathCell({ call, fill, prior }), ...unreadPartitionCells({ at, call })];
  const priorFile = prior.files[kind];
  const earlierList: readonly Entity[] = priorFile === null ? [] : priorFile.entities;
  const priorSuccess = prior.manifest === null ? null : prior.manifest.kinds[kind].lastSuccessAt;
  const answered = fill.answered.find((entry) => entry.template === call.template);
  if (answered !== undefined) {
    const earlier = new Map(earlierList.map((entity) => [entity.providerId, entity]));
    const entities = withUnreachedCarried({
      earlierList,
      read: answeredEntities({ answered, at, earlier }),
      truncated: answered.truncatedBy !== null,
      wholeBefore: priorSuccess !== null,
    });
    const file = { ...empty, coverage, entities: [...entities] };
    if (answered.truncatedBy === null) {
      return {
        file,
        status: {
          digest: null,
          entityCount: entities.length,
          lastAttempt: { at, outcome: "ok", reasons: [] },
          lastSuccessAt: at,
        },
      };
    }
    // A bounded read published what it reached, but it is not a whole read: the kind stays as fresh as its last
    // complete one, so a carried row is never dressed as seen this run.
    return {
      file,
      status: {
        digest: null,
        entityCount: entities.length,
        lastAttempt: { at, outcome: "failed", reasons: [`${call.template} stopped at ${answered.truncatedBy}`] },
        lastSuccessAt: priorSuccess,
      },
    };
  }
  return {
    file: { ...empty, coverage, entities: [...earlierList] },
    status: failedStatus({ at, call, entityCount: earlierList.length, fill, priorSuccess }),
  };
}

/**
 * A failed path's status: the earlier generation's entities and last success carried forward, and a 403 stamped
 * as the subscription tier's block rather than a fault.
 *
 * @param at this run's instant
 * @param call the path that failed
 * @param entityCount the carried entities' count
 * @param fill what the run brought back, where the failure is found
 * @param priorSuccess the kind's last whole read, or `null` when it has none
 * @returns the kind's status
 */
function failedStatus({
  at,
  call,
  entityCount,
  fill,
  priorSuccess,
}: {
  at: string;
  call: Knowbe4FillCall;
  entityCount: number;
  fill: Knowbe4FillObservation;
  priorSuccess: string | null;
}): KindStatus {
  const failure = fill.failed.find((entry) => entry.template === call.template)!;
  const reasons = [`${call.template} ${failureWords({ failure })}`];
  const status: KindStatus = {
    digest: null,
    entityCount,
    lastAttempt: { at, outcome: "failed", reasons },
    lastSuccessAt: priorSuccess,
  };
  if (failure.status !== 403) {
    return status;
  }
  return {
    ...status,
    permissionBlocked: { at, detail: reasons.join("; "), unblockedBy: SUBSCRIPTION_UNBLOCKED_BY },
  };
}

/**
 * Build the whole generation in memory — pure, so every grading rule is testable without a filesystem.
 *
 * @param fill what the run brought back
 * @param prior what the store held before it
 * @returns every kind file and the manifest
 */
export function buildKnowbe4Generation({
  fill,
  prior,
}: {
  fill: Knowbe4FillObservation;
  prior: Knowbe4PriorGeneration;
}): {
  readonly files: Record<Knowbe4AtlasKind, Knowbe4AtlasKindFile>;
  readonly manifest: Knowbe4AtlasManifest;
} {
  const manifest = initialKnowbe4Manifest({ updatedAt: fill.filledAtIso });
  const kinds = { ...manifest.kinds };
  const files: Record<Knowbe4AtlasKind, Knowbe4AtlasKindFile> = { ...emptyKnowbe4KindFiles({ at: fill.filledAtIso }) };
  for (const call of KNOWBE4_FILL_CALLS) {
    const generation = kindGeneration({ call, fill, prior });
    files[call.kind] = generation.file;
    kinds[call.kind] = generation.status;
  }
  return { files, manifest: { ...manifest, kinds } };
}

/**
 * Build and publish the generation one sync read. An item whose detail no KnowBe4 projector built is refused
 * outright, so the allowlist in `fill/project.ts` holds at the publish and not only at the read.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param fill what the run brought back
 * @returns what was written, or why the store could not be read or the publish was refused
 */
export function syncKnowbe4Atlas({
  home,
  fill,
}: {
  home: string;
  fill: Knowbe4FillObservation;
}): Result<Knowbe4SyncReport> {
  // Only what a projector built is published: an item carrying any other detail object could carry a field
  // the allowlist never chose, so the whole sync is refused before anything is read or written.
  const unprojected = fill.answered.flatMap((answered) =>
    answered.items
      .filter((item) => !isProjectedDetail({ detail: item.detail, template: answered.template }))
      .map((item) => `${answered.template} ${item.providerId}`),
  );
  if (unprojected.length > 0) {
    return err([
      `refused to publish ${String(unprojected.length)} KnowBe4 item(s) their path's projector did not build, first ${unprojected[0]!}`,
    ]);
  }
  const paths = knowbe4AtlasPaths({ home });
  // The read is what establishes what this generation replaces: the compare-and-swap refuses a publish that
  // asserts `null` over a store that holds something, and asserting the live manifest unread is the lost update.
  const snapshot = readKnowbe4Atlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const prior = { files: snapshot.value.files, manifest: snapshot.value.manifest };
  const { files, manifest } = buildKnowbe4Generation({ fill, prior });
  const written = publishKnowbe4Atlas({ derivedFrom: prior.manifest, files, manifest, paths });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({
    entitiesByKind: KNOWBE4_ATLAS_KINDS.map((kind) => ({ entities: files[kind].entities.length, kind })),
    written: written.value,
  });
}
