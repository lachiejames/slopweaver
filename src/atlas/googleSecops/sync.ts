/**
 * Publishing what one fill read — the generation, built pure from the observation and what the store held.
 *
 * One coverage cell per list, keyed by rpc — `cells.ts` says what each reads.
 *
 * ## How a kind is graded
 *
 * - every list answered: `lastSuccessAt` is this run, the entities are what was read;
 * - a list failed: the attempt is `failed` with Google's own words, `lastSuccessAt` is this run if another
 *   list of the kind answered and the earlier success otherwise, and the entities the failed list held LAST
 *   time carry forward — a failed read keeps what it had, it does not empty the kind (`kit/evidenceLoss.ts`
 *   would refuse the publish if it did);
 * - every failure was a 403: the kind is also stamped `permissionBlocked`, naming the IAM role that would
 *   lift it, which is what lets the kit tell a permission boundary from a broken atlas;
 * - never called (cloud-platform only): `permissionBlocked`, naming the scope, with no attempt recorded.
 *
 * Any other failure on a kind never acquired leaves it with no success and no block, and the kit's
 * mandatory-kind gate then refuses the whole publish. That is the intended fail-closed: a never-read empty
 * kind published beside real ones would read as "this instance has none".
 */
import { err, ok, type Result } from "#lib/result.js";
import { stableEntityId } from "../kit/identity.js";
import { cloudPlatformOnlyCell, failureWords, type GoogleSecopsPriorGeneration, listCell } from "./cells.js";
import {
  CLOUD_PLATFORM_UNBLOCKED_BY,
  GOOGLE_SECOPS_CLOUD_PLATFORM_ONLY_KINDS,
  GOOGLE_SECOPS_FILL_CALLS,
  IAM_ROLE_UNBLOCKED_BY,
} from "./fill/plan.js";
import type { GoogleSecopsFillObservation, SecopsCallAnswered } from "./fill/run.js";
import {
  emptyGoogleSecopsKindFiles,
  GOOGLE_SECOPS_ATLAS_KINDS,
  GOOGLE_SECOPS_ATLAS_PLATFORM,
  type GoogleSecopsAtlasKind,
  type GoogleSecopsAtlasKindFile,
  type GoogleSecopsAtlasManifest,
  initialGoogleSecopsManifest,
} from "./model.js";
import { googleSecopsAtlasPaths, publishGoogleSecopsAtlas, readGoogleSecopsAtlas } from "./store.js";

type Entity = GoogleSecopsAtlasKindFile["entities"][number];
type KindStatus = GoogleSecopsAtlasManifest["kinds"][GoogleSecopsAtlasKind];

/** What one publish produced. */
export interface GoogleSecopsSyncReport {
  readonly entitiesByKind: readonly { readonly kind: GoogleSecopsAtlasKind; readonly entities: number }[];
  readonly written: readonly string[];
}

/**
 * Which list an entity came from, read off its stored detail.
 *
 * @param entity a stored entity
 * @returns the family its `api` detail names, or `null` when it names none
 */
function familyOf({ entity }: { entity: Entity }): string | null {
  const detail: unknown = entity.channels.api?.detail;
  if (typeof detail !== "object" || detail === null || !("family" in detail)) {
    return null;
  }
  return typeof detail.family === "string" ? detail.family : null;
}

/**
 * The entities one answered list contributes, each keeping the first time any run saw it.
 *
 * @param answered the list that answered
 * @param earlier the kind's entities last time, by provider id
 * @param at this run's ISO timestamp
 * @returns the entities
 */
function answeredEntities({
  answered,
  earlier,
  at,
}: {
  answered: SecopsCallAnswered;
  earlier: ReadonlyMap<string, Entity>;
  at: string;
}): readonly Entity[] {
  return answered.items.map((item) => {
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
            endpoint: `GET ${answered.rpc}`,
            observedAt: at,
          },
          state: "observed",
        },
        browser: null,
      },
      id: stableEntityId({
        components: { providerId: item.providerId },
        namespace: `${GOOGLE_SECOPS_ATLAS_PLATFORM}:${answered.kind}`,
      }),
      kind: answered.kind,
      providerId: item.providerId,
    };
  });
}

/**
 * Every entity a called kind holds after this run: what answered, plus — for a list that failed — what that
 * list held last time, unchanged.
 *
 * @param kind the kind
 * @param fill what the run brought back
 * @param prior what the store held
 * @returns the entities, sorted by provider id so two runs over the same answers write the same bytes
 */
function calledKindEntities({
  kind,
  fill,
  prior,
}: {
  kind: GoogleSecopsAtlasKind;
  fill: GoogleSecopsFillObservation;
  prior: GoogleSecopsPriorGeneration;
}): readonly Entity[] {
  const priorFile = prior.files[kind];
  const earlierList: readonly Entity[] = priorFile === null ? [] : priorFile.entities;
  const earlier = new Map(earlierList.map((entity) => [entity.providerId, entity]));
  const fresh = fill.answered
    .filter((entry) => entry.kind === kind)
    .flatMap((answered) => answeredEntities({ answered, at: fill.filledAtIso, earlier }));
  const failedFamilies = new Set<string>(
    fill.failed.filter((entry) => entry.kind === kind).map((entry) => entry.family),
  );
  const carried = earlierList.filter((entity) => {
    const family = familyOf({ entity });
    return family !== null && failedFamilies.has(family);
  });
  return [...fresh, ...carried].toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * The manifest status a called kind earns.
 *
 * @param kind the kind
 * @param fill what the run brought back
 * @param prior what the store held
 * @param entityCount how many entities its file holds
 * @returns the status
 */
function calledKindStatus({
  kind,
  fill,
  prior,
  entityCount,
}: {
  kind: GoogleSecopsAtlasKind;
  fill: GoogleSecopsFillObservation;
  prior: GoogleSecopsPriorGeneration;
  entityCount: number;
}): KindStatus {
  const at = fill.filledAtIso;
  const failures = fill.failed.filter((entry) => entry.kind === kind);
  const reasons = failures.map((failure) => `${failure.rpc} ${failureWords({ failure })}`);
  if (failures.length === 0) {
    return { digest: null, entityCount, lastAttempt: { at, outcome: "ok", reasons }, lastSuccessAt: at };
  }
  // A list of this kind that answered is a success of this run's, beside the refusal — GitHub's rule
  // (`github/sync.ts`): a kind holding what it read now is not one that was never acquired.
  const answeredNow = fill.answered.some((entry) => entry.kind === kind);
  const earlier = prior.manifest === null ? null : prior.manifest.kinds[kind].lastSuccessAt;
  const status: KindStatus = {
    digest: null,
    entityCount,
    lastAttempt: { at, outcome: "failed", reasons },
    lastSuccessAt: answeredNow ? at : earlier,
  };
  if (!failures.every((failure) => failure.status === 403)) {
    return status;
  }
  return { ...status, permissionBlocked: { at, detail: reasons.join("; "), unblockedBy: IAM_ROLE_UNBLOCKED_BY } };
}

/**
 * One kind's file and manifest status.
 *
 * @param kind the kind
 * @param fill what the run brought back
 * @param prior what the store held
 * @returns both halves, built together so a file and its status cannot disagree about what was read
 */
function kindGeneration({
  kind,
  fill,
  prior,
}: {
  kind: GoogleSecopsAtlasKind;
  fill: GoogleSecopsFillObservation;
  prior: GoogleSecopsPriorGeneration;
}): { readonly file: GoogleSecopsAtlasKindFile; readonly status: KindStatus } {
  const at = fill.filledAtIso;
  const empty = emptyGoogleSecopsKindFiles({ at })[kind];
  if (GOOGLE_SECOPS_CLOUD_PLATFORM_ONLY_KINDS.includes(kind)) {
    return {
      file: { ...empty, coverage: [cloudPlatformOnlyCell({ kind, prior })] },
      status: {
        digest: null,
        entityCount: 0,
        lastAttempt: null,
        lastSuccessAt: null,
        permissionBlocked: {
          at,
          detail: "every GET under this kind accepts only cloud-platform; the grant carries chronicle.readonly",
          unblockedBy: CLOUD_PLATFORM_UNBLOCKED_BY,
        },
      },
    };
  }
  const entities = calledKindEntities({ fill, kind, prior });
  const coverage = GOOGLE_SECOPS_FILL_CALLS.filter((call) => call.kind === kind).map((call) =>
    listCell({ call, fill, prior }),
  );
  return {
    file: { ...empty, coverage, entities: [...entities] },
    status: calledKindStatus({ entityCount: entities.length, fill, kind, prior }),
  };
}

/**
 * Build the whole generation in memory — pure, so every grading rule is testable without a filesystem.
 *
 * @param fill what the run brought back
 * @param prior what the store held before it
 * @returns every kind file and the manifest
 */
export function buildGoogleSecopsGeneration({
  fill,
  prior,
}: {
  fill: GoogleSecopsFillObservation;
  prior: GoogleSecopsPriorGeneration;
}): {
  readonly files: Record<GoogleSecopsAtlasKind, GoogleSecopsAtlasKindFile>;
  readonly manifest: GoogleSecopsAtlasManifest;
} {
  const built = new Map(GOOGLE_SECOPS_ATLAS_KINDS.map((kind) => [kind, kindGeneration({ fill, kind, prior })]));
  const files = emptyGoogleSecopsKindFiles({ at: fill.filledAtIso });
  const manifest = initialGoogleSecopsManifest({ updatedAt: fill.filledAtIso });
  const kinds = { ...manifest.kinds };
  const written: Record<GoogleSecopsAtlasKind, GoogleSecopsAtlasKindFile> = { ...files };
  for (const kind of GOOGLE_SECOPS_ATLAS_KINDS) {
    const generation = built.get(kind)!;
    written[kind] = generation.file;
    kinds[kind] = generation.status;
  }
  return { files: written, manifest: { ...manifest, kinds } };
}

/**
 * Build and publish the generation one fill read.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param fill what the run brought back
 * @returns what was written, or why the store could not be read or the publish was refused
 */
export function syncGoogleSecopsAtlas({
  home,
  fill,
}: {
  home: string;
  fill: GoogleSecopsFillObservation;
}): Result<GoogleSecopsSyncReport> {
  const paths = googleSecopsAtlasPaths({ home });
  // The read is what establishes what this generation replaces: the compare-and-swap refuses a publish that
  // asserts `null` over a store that holds something, and asserting the live manifest unread is the lost update.
  const snapshot = readGoogleSecopsAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const prior = { files: snapshot.value.files, manifest: snapshot.value.manifest };
  const { files, manifest } = buildGoogleSecopsGeneration({ fill, prior });
  const written = publishGoogleSecopsAtlas({ derivedFrom: prior.manifest, files, manifest, paths });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({
    entitiesByKind: GOOGLE_SECOPS_ATLAS_KINDS.map((kind) => ({ entities: files[kind].entities.length, kind })),
    written: written.value,
  });
}
