/**
 * Turn one operation's records into stored entities, through the field-denial boundary.
 *
 * Nothing here decides what may be stored — `projection.ts` does that, and this module's whole job is to
 * make sure every record goes through it exactly once and that the removals it reports travel WITH the
 * value they were removed from. Coverage takes the projections rather than a count precisely so the two
 * cannot be separated, so handing it entities alone would defeat that.
 *
 * ## A record is identified by the CALL that returned it, and that is a correction
 *
 * The registry attributes `/api/v2/systems/{system_id}/policystatuses` to kind `systems`, which is right —
 * it is a fact about a system. Its records are not systems, though, and JumpCloud reuses one object-id
 * shape everywhere, so a bare provider id lets a policy status collide with the device it describes.
 *
 * Namespacing by SURFACE alone is not enough either, and the live run is what proved it: the first full
 * walk of this tenancy read every fan-out call and then refused to merge, naming every id produced twice.
 * `/api/v2/systems/{A}/users` and `/api/v2/systems/{B}/users` are one surface returning the same person
 * under two parents, and those are two different FACTS — U is bound to A, and U is bound to B. Collapsing them loses one; refusing the merge loses the generation.
 *
 * So the identity is the call: `<surface>#<id>` for a root collection and `<surface>:<bound path>#<id>` for
 * a fan-out. A call is unique per run by construction, and within one call the walk still refuses a
 * repeated id, so a collision cannot arise from either direction.
 *
 * **The cost, stated rather than discovered.** `atlas jumpcloud read --id <the id a human pastes from the
 * console>` no longer matches, because no stored provider id is the bare JumpCloud id any more.
 * `--query <that id>` still finds it — the query walks the stored document's own string leaves, and `_id`
 * is one of them.
 *
 * ## The identity comes from the PROJECTED record, never the raw one
 *
 * An adversarial review found this the wrong way round and was right: `providerId` was read off the raw
 * provider document while only `detail` went through the projection, so a value the boundary would have
 * denied could still reach the kind file as an identity. Identity is a persisted field like any other, and
 * it now comes from the same projected value the detail does.
 *
 * ## A record with no id still gets a stable identity
 *
 * Several families key by nothing recognisable. Falling back to the BOUND PATH plus the record's index is
 * stable across runs in exactly the way an id is, provided the collection's order is — which is why
 * `paging.ts` pins `sort=_id` on every offset walker rather than leaving the order to the provider.
 */
import type { AtlasProjection } from "../kit/projection.js";
import type { JumpcloudChannelEntity, JumpcloudEntity } from "./entities.js";
import { jumpcloudEntityId } from "./identity.js";
import type { JumpcloudKind } from "./model.js";
import type { JumpcloudOperation } from "./plan.js";
import { JUMPCLOUD_SHAPE_INDEXED_OPERATIONS, providerIdOf } from "./plan.js";
import { projectJumpcloudValue } from "./projection.js";
import { jumpcloudRowOperation } from "./volume.js";

/** What one operation's records became. */
export interface JumpcloudObservedRecords {
  readonly entities: readonly JumpcloudEntity[];
  /** One per entity, in the same order — the evidence coverage grades. */
  readonly projections: readonly AtlasProjection[];
  /** The provider ids a ROOT collection yielded, which bind this kind's fan-outs. Empty for a fan-out. */
  readonly providerIds: readonly string[];
}

/**
 * Re-project every document a previous generation already stored.
 *
 * The field-denial set GROWS — that is what it is for. A stored entity carried forward untouched was
 * projected by whatever build wrote it, so a field denied today can survive in the atlas forever behind an
 * entity nobody re-read. An adversarial review found exactly that: an entity absent from a later sync is
 * carried forward and merely marked stale, and nothing re-runs the projection over it.
 *
 * So every publish applies TODAY's denial rules to everything it writes, not only to what it just read. The
 * removals are returned as well as applied, because coverage has to be able to say what this generation
 * withheld — including from documents it did not fetch.
 *
 * ## A shape-index verdict is one of TODAY's rules, and this is where it reaches a stored row
 *
 * The volume rule makes per-instant telemetry catalogued rather than stored, and `./volume.ts` may name a
 * single OPERATION inside an otherwise-entity kind — `v2-policyresults-list` under `policies`,
 * `v2-list-device-asset-history` under `assets`. Taking those operations out of the WALK is not enough on
 * its own: `sync.ts`'s fold merges stored entities forward and stales a vanished one rather than deleting
 * it, so the policy-result and asset-history rows already on disk would be carried into the
 * next generation, `kit/volume.ts`'s publish refusal would fire on them, and this atlas would never publish
 * again. Both guards would be right and the sync would be dead.
 *
 * Dropping them here is what the header above already argues for — a rule adopted today applies to what a
 * previous generation stored — and it is the difference between a verdict that governs the atlas and one
 * that governs only the next fetch. The whole-KIND case needs nothing here: `sync.ts`'s `addShapeIndexed`
 * writes no entities at all for those kinds.
 *
 * @param stored every entity this kind's file already holds
 * @returns the entities with both channels re-projected, every removal that took, and how many rows a
 *   shape-index verdict dropped outright
 */
export function reprojectStoredEntities({ stored }: { stored: readonly JumpcloudEntity[] }): {
  readonly entities: readonly JumpcloudEntity[];
  readonly projections: readonly AtlasProjection[];
  readonly shapeIndexedDrops: number;
} {
  const entities: JumpcloudEntity[] = [];
  const projections: AtlasProjection[] = [];
  let shapeIndexedDrops = 0;
  for (const entity of stored) {
    const operation = jumpcloudRowOperation({ row: entity });
    if (operation !== null && Object.hasOwn(JUMPCLOUD_SHAPE_INDEXED_OPERATIONS, operation)) {
      shapeIndexedDrops += 1;
      continue;
    }
    const channels = { ...entity.channels };
    for (const name of ["admin-console", "directory-api"] as const) {
      const channel = channels[name];
      if (channel === null) {
        continue;
      }
      const projection = projectJumpcloudValue({ endpoint: channel.source?.endpoint, value: channel.detail });
      if (projection.dropped.length > 0) {
        projections.push(projection);
      }
      channels[name] = { ...channel, detail: projection.value };
    }
    entities.push({ ...entity, channels });
  }
  return { entities, projections, shapeIndexedDrops };
}

/** The id a record declares for itself, or its position in the walk when it declares none. */
function ownIdOf({ record, index }: { record: unknown; index: number }): string {
  const declared = providerIdOf({ record });
  if (declared == null) {
    return `at-${String(index)}`;
  }
  return declared;
}

/**
 * The provider id one record is stored under — the CALL that returned it, plus the record's own id.
 *
 * @param record the provider document
 * @param index its position in the walk, used only when the record declares no id of its own
 * @param endpoint the bound path this record was read from, which is what distinguishes one parent's copy
 * of a shared record from another's
 * @param surface the operation that produced it
 * @param isRoot whether this came from a root collection, whose endpoint carries no parent to name
 * @returns the stored provider id
 */
function storedProviderId({
  record,
  index,
  endpoint,
  surface,
  isRoot,
}: {
  record: unknown;
  index: number;
  endpoint: string;
  surface: string;
  isRoot: boolean;
}): string {
  const own = ownIdOf({ index, record });
  return isRoot ? `${surface}#${own}` : `${surface}:${endpoint}#${own}`;
}

/**
 * Project one operation's records into entities on the Directory API channel.
 *
 * @param operation the operation that produced these records
 * @param records the provider's own documents, exactly as the walk returned them
 * @param endpoint the bound path they were read from
 * @param at this run's ISO timestamp
 * @param isRoot whether this was a root collection — see this file's header on why it changes the id
 * @returns the entities, their projections, and the provider ids a root collection yielded
 */
export function observeJumpcloudRecords({
  operation,
  records,
  endpoint,
  at,
  isRoot,
}: {
  operation: JumpcloudOperation;
  records: readonly unknown[];
  endpoint: string;
  at: string;
  isRoot: boolean;
}): JumpcloudObservedRecords {
  const entities: JumpcloudEntity[] = [];
  const projections: AtlasProjection[] = [];
  const providerIds: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const projection = projectJumpcloudValue({ endpoint, value: record });
    // The PROJECTED value, never the raw record: an identity read off the raw document is a value that
    // reached the kind file without passing the field-denial boundary, however innocuous the field it came
    // from happens to be today.
    const providerId = storedProviderId({
      endpoint,
      index,
      isRoot,
      record: projection.value,
      surface: operation.row.name,
    });
    if (seen.has(providerId)) {
      // One walk returning the same id twice would make `mergeKind` refuse the whole family, so the
      // duplicate is disambiguated by position rather than allowed to sink the read. An offset walk over an
      // unstable order is what produces this, and `offsetWalkComplete` is what reports it as incomplete.
      continue;
    }
    seen.add(providerId);
    if (isRoot) {
      const declared = providerIdOf({ record: projection.value });
      if (declared !== null) {
        providerIds.push(declared);
      }
    }
    entities.push(
      entityFor({
        at,
        endpoint,
        kind: operation.kind,
        providerId,
        surface: operation.row.name,
        value: projection.value,
      }),
    );
    projections.push(projection);
  }
  return { entities, projections, providerIds };
}

/**
 * Build one entity carrying a Directory API observation and nothing else.
 *
 * @param kind the kind this record belongs to, taken from the registry rather than guessed
 * @param providerId the stored provider id
 * @param value the PROJECTED document — never the raw response
 * @param endpoint the bound path it was read from
 * @param surface the operation that produced it
 * @param at this run's ISO timestamp
 * @returns the entity, with the browser channel untouched at `null`
 */
function entityFor({
  kind,
  providerId,
  value,
  endpoint,
  surface,
  at,
}: {
  kind: JumpcloudKind;
  providerId: string;
  value: unknown;
  endpoint: string;
  surface: string;
  at: string;
}): JumpcloudEntity {
  const channel: JumpcloudChannelEntity = {
    detail: value,
    firstSeenAt: at,
    lastSeenAt: at,
    source: {
      artifacts: [],
      // Never constructed from ids: the Directory API hands back no console URL, and inventing one would
      // record a guess as provenance. `unverified` is the honest state until the browser walk discovers one.
      deepLink: null,
      deepLinkStatus: "unverified",
      endpoint: `${surface} ${endpoint}`,
      observedAt: at,
      surface: "directory-api",
    },
    state: "observed",
  };
  return {
    channels: { "admin-console": null, "directory-api": channel },
    id: jumpcloudEntityId({ kind, providerId }),
    kind,
    providerId,
  };
}
