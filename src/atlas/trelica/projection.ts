/**
 * Turning what each channel saw into entities — and, for the entity kinds, the CLOSED projection that
 * decides what a generation may hold.
 *
 * Pure. Each publisher projects only its own channel and leaves the other slots `null`, which is what makes
 * `merge.ts`'s channel-scoped fold correct: an entity arriving with one channel filled can never blank
 * another. The `browser` channel's two projections are `browserProjection.ts`'s, built on the entity helpers
 * exported here.
 *
 * ## The provider id is `<METHOD> <path shape>`, byte-exact, for a method
 *
 * That exactness IS the disagreement detector. A normalising match would fold the published
 * `GET /api/apps/v1` and the web client's `POST /AppsApi/CustomerApp/FilterItems` into one entity and
 * manufacture an agreement that was never observed — hiding precisely the undocumented surface the
 * both-surfaces ruling is about. A path seen on one channel and not another is a RECORD, never a match
 * failure.
 *
 * ## An application is read through an ALLOWLIST, not stored wholesale
 *
 * One inventory record carries far more top-level fields than this atlas reads, including the vendor's own
 * staff and per-person licence assignments. {@link projectTrelicaApps} reads a named list, so a field the vendor adds next month
 * is dropped at the boundary rather than stored because nobody thought to exclude it — the posture
 * `atlas/onepassword/model.ts` takes, for the same reason. `descriptor.ts`'s `excludes` says what is
 * dropped and why.
 */
import { isRecord } from "../../lib/parsers.js";
import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../kit/channelProjection.js";
import type { AtlasArtifactRef } from "../kit/contract.js";

import type { TrelicaCallResult } from "./client.js";
import { numberOf, textOf, trelicaContactsOf } from "./fields.js";
import { trelicaEntityId } from "./identity.js";
import { foldTrelicaFirstPartyCalls } from "./methodFold.js";
import {
  emptyTrelicaChannels,
  type TrelicaAppDetail,
  type TrelicaAtlasChannel,
  type TrelicaAtlasEntity,
  type TrelicaChannelEntity,
  type TrelicaDeepLinkStatus,
  type TrelicaMethodPublishedDetail,
  type TrelicaRoleDetail,
} from "./model.js";
import { foldTrelicaPublishedDeclaration } from "./publishedFold.js";
import type { TrelicaPublishedSurface } from "./publishedSpec.js";

/**
 * The provider key for one method entity — what the channels are matched on.
 *
 * @param httpMethod the verb, upper-cased here so a channel spelling it in lower case still matches
 * @param pathShape the path with every value segment already replaced
 * @returns the key, byte-exact on every channel
 *
 * @internal
 */
export function trelicaMethodProviderId({ httpMethod, pathShape }: { httpMethod: string; pathShape: string }): string {
  return `${httpMethod.toUpperCase()} ${pathShape}`;
}

/**
 * One channel's view, stamped with this run's instant. The mechanism is `kit/channelProjection.ts`'s.
 *
 * @returns the view, ready to fill one slot of an entity
 */
export function channelEntity({
  channel,
  detail,
  at,
  endpoint,
  deepLink,
  deepLinkStatus,
  artifacts,
}: {
  channel: TrelicaAtlasChannel;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  deepLinkStatus: TrelicaDeepLinkStatus;
  artifacts: readonly AtlasArtifactRef[];
}): TrelicaChannelEntity {
  return atlasChannelView({ artifacts, at, channel, deepLink, deepLinkStatus, detail, endpoint });
}

/**
 * An entity carrying exactly one filled channel.
 *
 * @returns the entity, every other channel slot left `null`
 */
export function entityWithChannel({
  kind,
  providerId,
  channel,
  view,
}: {
  kind: TrelicaAtlasEntity["kind"];
  providerId: string;
  channel: TrelicaAtlasChannel;
  view: TrelicaChannelEntity;
}): TrelicaAtlasEntity {
  return atlasEntityWithChannel({
    channel,
    empty: emptyTrelicaChannels(),
    id: trelicaEntityId({ kind, providerId }),
    kind,
    providerId,
    view,
  });
}

/**
 * Deterministic order, so two runs over the same data write identical bytes.
 *
 * @returns the same entities, sorted by id
 */
export function byId({ entities }: { entities: readonly TrelicaAtlasEntity[] }): readonly TrelicaAtlasEntity[] {
  return sortedById({ entities });
}

/**
 * Project the vendor's published API documents into `method` entities on the `published-api` channel.
 *
 * @param surface every document that parsed
 * @param at this run's ISO timestamp
 * @returns one entity per declared operation, sorted by id so a published file is stable
 */
export function projectTrelicaPublishedMethods({
  surface,
  at,
}: {
  surface: TrelicaPublishedSurface;
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const byProviderId = new Map<string, TrelicaMethodPublishedDetail>();
  for (const document of surface.documents) {
    for (const operation of document.operations) {
      const providerId = trelicaMethodProviderId({ httpMethod: operation.httpMethod, pathShape: operation.path });
      // Two documents declaring one operation is the vendor's editorial choice, not a defect: fold them and
      // record both names, rather than minting two entities with one id and failing the whole merge.
      byProviderId.set(
        providerId,
        foldTrelicaPublishedDeclaration({ declaration: operation, held: byProviderId.get(providerId) }),
      );
    }
  }
  const entities = [...byProviderId.entries()].map(([providerId, detail]): TrelicaAtlasEntity =>
    entityWithChannel({
      channel: "published-api",
      kind: "method",
      providerId,
      view: channelEntity({
        artifacts: [],
        at,
        channel: "published-api",
        // A REST endpoint is not a place a human opens, so there is no deep link at all — and the status
        // has to SAY that, rather than leaving an absent link indistinguishable from an unattempted one.
        deepLink: null,
        deepLinkStatus: "unavailable",
        detail,
        endpoint: providerId,
      }),
    }),
  );
  return byId({ entities });
}

/**
 * Project the calls this atlas actually made into `method` entities on the `first-party-api` channel.
 *
 * `calledDirectly` is `true` for every entity here, and that is the point of separating this from the
 * walk's projection: a call this atlas made and got an answer from proves a session can reach it, where a
 * call merely watched proves only that it exists.
 *
 * @param results what each admitted call returned
 * @param fieldNames the response field names observed per call id, already reduced to names
 * @param at this run's ISO timestamp
 * @returns one entity per call made, sorted by id
 */
export function projectTrelicaFirstPartyMethods({
  results,
  fieldNames,
  at,
}: {
  results: readonly TrelicaCallResult[];
  fieldNames: ReadonlyMap<string, readonly string[]>;
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const calls = results.map(({ callId, httpMethod, path, statusCode }) => {
    return { callId, providerId: trelicaMethodProviderId({ httpMethod, pathShape: path }), statusCode };
  });
  const folded = foldTrelicaFirstPartyCalls({ calls, fieldNames });
  const entities = [...folded.entries()].map(([providerId, detail]): TrelicaAtlasEntity => {
    return entityWithChannel({
      channel: "first-party-api",
      kind: "method",
      providerId,
      view: channelEntity({
        artifacts: [],
        at,
        channel: "first-party-api",
        deepLink: null,
        deepLinkStatus: "unavailable",
        detail,
        endpoint: providerId,
      }),
    });
  });
  return byId({ entities });
}

/**
 * The licence-plan NAMES an application carries. Names only — never a seat list.
 *
 * A plan's `name` is localised, keyed by locale: MEASURED, every plan on the live tenant answered
 * `{"en-US": …}` and none a plain string, so a reader expecting a string held no plan name at all. Every locale's
 * name is kept, and one plan named alike in two locales is one name.
 */
function licensePlanNames({ record }: { record: Record<string, unknown> }): readonly string[] {
  const raw = record["customerLicensePlans"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const names = raw
    .flatMap((entry) => (isRecord(entry) && isRecord(entry["name"]) ? Object.values(entry["name"]) : []))
    .flatMap((name) => (typeof name === "string" && name.trim().length > 0 ? [name.trim()] : []));
  return [...new Set(names)].toSorted();
}

/**
 * Project one provider inventory record through the closed allowlist.
 *
 * @param record the provider's own record
 * @param inCatalog whether this application is also offered in the end-user catalogue
 * @returns the projected detail, or `null` when the record carries no name and so identifies nothing
 *
 * @internal
 */
export function projectTrelicaAppDetail({
  record,
  inCatalog,
}: {
  record: Record<string, unknown>;
  inCatalog: boolean;
}): TrelicaAppDetail | null {
  const name = textOf({ key: "name", record });
  if (name === null) {
    return null;
  }
  return {
    discoveredBy: textOf({ key: "appDiscoveredBy", record }),
    discoveredByProviderId: textOf({ key: "appDiscoveredByProviderId", record }),
    displayName: textOf({ key: "displayName", record }) ?? name,
    inCatalog,
    internalContacts: trelicaContactsOf({ record }),
    lastYearSpend: numberOf({ key: "lastYearSpend", record }),
    licensePlans: [...licensePlanNames({ record })],
    name,
    riskScore: numberOf({ key: "riskScore", record }),
    status: textOf({ key: "status", record }) ?? "Unknown",
    userCount: numberOf({ key: "userCount", record }),
    vendorName: textOf({ key: "vendorName", record }),
  };
}

/**
 * The provider's own id for one inventory or catalogue record.
 *
 * ## `id` and not `applicationId`, and this was MEASURED the wrong way round first
 *
 * An inventory record carries both: `id` is the TENANT's own row for the application, and `applicationId`
 * is the vendor's global catalogue entry for the product. The end-user catalogue answers only `id`, and it
 * is the tenant row — so `id` is the shared key and `applicationId` is a different key space entirely.
 *
 * Measured against the live tenant, after a first cut preferred `applicationId` and published more
 * applications than the inventory holds: the catalogue rows **matched inventory `id`s and not one matched an
 * inventory `applicationId`**, so every catalogue row became a second entity for an application
 * the inventory already held and `inCatalog` was never set on any of them. Reproduce by comparing the two
 * lists' id sets, or read the count back with
 * `slopweaver atlas trelica read --kind app --json | jq '.page.matched'`.
 *
 * @param record the provider's own record
 * @returns the shared key, or `null` when the record carries none
 *
 * @internal
 */
export function trelicaAppProviderId({ record }: { record: Record<string, unknown> }): string | null {
  return textOf({ key: "id", record });
}

/**
 * Project the application inventory and the end-user catalogue into `app` entities.
 *
 * The two lists are folded on the provider's own shared key, so an application in both is ONE entity that
 * knows it is offered to staff — rather than two rows a reader has to reconcile. An application in the
 * catalogue and not the inventory is still an entity, because the catalogue is a place the platform says it
 * exists.
 *
 * @param inventory every record the organisation-wide inventory returned
 * @param catalog every record the end-user catalogue returned
 * @param at this run's ISO timestamp
 * @returns one entity per distinct application, sorted by id
 */
export function projectTrelicaApps({
  inventory,
  catalog,
  at,
}: {
  inventory: readonly unknown[];
  catalog: readonly unknown[];
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const catalogued = new Set<string>();
  for (const entry of catalog) {
    if (!isRecord(entry)) {
      continue;
    }
    const key = trelicaAppProviderId({ record: entry });
    if (key !== null) {
      catalogued.add(key);
    }
  }
  const byProviderId = new Map<string, TrelicaAppDetail>();
  for (const entry of [...inventory, ...catalog]) {
    if (!isRecord(entry)) {
      continue;
    }
    const providerId = trelicaAppProviderId({ record: entry });
    if (providerId === null || byProviderId.has(providerId)) {
      continue;
    }
    const detail = projectTrelicaAppDetail({ inCatalog: catalogued.has(providerId), record: entry });
    if (detail !== null) {
      byProviderId.set(providerId, detail);
    }
  }
  const entities = [...byProviderId.entries()].map(([providerId, detail]): TrelicaAtlasEntity =>
    entityWithChannel({
      channel: "first-party-api",
      kind: "app",
      providerId,
      view: channelEntity({
        artifacts: [],
        at,
        channel: "first-party-api",
        deepLink: null,
        // The provider serves an application's own page under the TENANT origin, whose label is a private
        // identifier this repository may not carry — so the link is left unattempted rather than assembled
        // here, and the status says which.
        deepLinkStatus: "unverified",
        detail,
        endpoint: "app-inventory",
      }),
    }),
  );
  return byId({ entities });
}

/**
 * Project the tenant's own roles into `role` entities.
 *
 * @param records every record the roles call returned
 * @param at this run's ISO timestamp
 * @returns one entity per role, sorted by id
 */
export function projectTrelicaRoles({
  records,
  at,
}: {
  records: readonly unknown[];
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const entities = records.flatMap((entry: unknown): readonly TrelicaAtlasEntity[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const providerId = textOf({ key: "id", record: entry });
    const name = textOf({ key: "name", record: entry });
    if (providerId === null || name === null) {
      return [];
    }
    const detail: TrelicaRoleDetail = { isSystemRole: entry["isSystemRole"] === true, name };
    return [
      entityWithChannel({
        channel: "first-party-api",
        kind: "role",
        providerId,
        view: channelEntity({
          artifacts: [],
          at,
          channel: "first-party-api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          detail,
          endpoint: "roles",
        }),
      }),
    ];
  });
  return byId({ entities });
}
