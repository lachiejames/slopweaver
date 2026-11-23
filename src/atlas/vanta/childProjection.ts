/**
 * Pure DTO → entity projection for the fan-out families.
 *
 * Separate from `censusProjection.ts` for one reason that is the whole of this file: a child entity is
 * identified by BOTH ends of the relation, and half of the families store the pairing rather than the row.
 */
import type { VantaChildDto, VantaChildFamily, VantaChildSurface } from "./childSurface.js";
import { vantaEntityId } from "./identity.js";
import type { VantaChannelEntity, VantaEntity, VantaSource } from "./model.js";

/** The `manage-api` source a child record carries — the concrete path that answered it. */
function childSource({ endpoint, at }: { endpoint: string; at: string }): VantaSource {
  return {
    artifacts: [],
    channel: "manage-api",
    deepLink: null,
    deepLinkStatus: "unavailable",
    endpoint,
    observedAt: at,
  };
}

/** Wrap one detail in the `manage-api` channel every child projection populates. */
function childChannel({
  detail,
  source,
  at,
}: {
  detail: unknown;
  source: VantaSource;
  at: string;
}): VantaChannelEntity {
  return { channel: "manage-api", detail, firstSeenAt: at, lastSeenAt: at, source, state: "observed" };
}

/**
 * Project one row of one child family into an entity.
 *
 * A `pairing` family stores the two ids and the surface that witnessed them, never the row: the row is a
 * copy of an object another kind already holds, and storing it twice is the duplication `covered-by-list`
 * exists to prevent. An `object` family stores the row exactly as Vanta returned it.
 *
 * @param family the family this row came from, which supplies the kind and what is stored
 * @param surface the surface that answered it, which supplies the parent kind and the path
 * @param parentId the provider id of the parent this row was read under
 * @param dto the row, already parsed by the surface's own strict schema
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function projectVantaChildRow({
  family,
  surface,
  parentId,
  dto,
  at,
}: {
  family: VantaChildFamily;
  surface: VantaChildSurface;
  parentId: string;
  dto: VantaChildDto;
  at: string;
}): VantaEntity {
  const childId = surface.childId(dto);
  const providerId = `${parentId}:${childId}`;
  const detail =
    family.payload === "pairing"
      ? { childId, parentId, parentKind: surface.parentKind, witnessedBy: surface.surface }
      : { ...dto, parentId };
  return {
    channels: {
      browser: null,
      "manage-api": childChannel({ at, detail, source: childSource({ at, endpoint: surface.specPath }) }),
    },
    financialDetail: null,
    id: vantaEntityId({ components: { providerId }, kind: family.kind }),
    kind: family.kind,
    providerId,
    sensitivity: family.handleWithCare ? { handleWithCare: true, providerMarkedSensitive: null } : null,
  };
}
