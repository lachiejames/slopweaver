/**
 * Pure DTO → entity projection for the census families and the event-log shape index.
 *
 * `projection.ts` holds one function per original kind because each one differs — a deep link here, a
 * withheld financial field there. The census families differ in nothing but their kind and their id, so one
 * function covers all twelve; a family that ever needs its own decision belongs in `projection.ts` instead.
 *
 * ## `connectionErrorMessage` is stored, and that is the deliberate choice
 *
 * An integration's `connectionErrorMessage` is free text a provider writes, so it is the one field here that
 * could carry something a committed file should not. It is stored anyway, unchanged: this atlas lives under
 * `$SLOPWEAVER_HOME` and is never committed to the repository, the hygiene gate runs over the repository
 * rather than over the state home, and a redacted error message is an error message no operator can act on.
 * What must not happen is that text reaching an outbound message unread — which is the sending surface's
 * rule, not this one's. Measured on this account, every `connectionErrorMessage` is null.
 */
import type { VantaCensusDto, VantaCensusFamily } from "./census.js";
import type { VantaEventShape } from "./eventShapes.js";
import { vantaEntityId } from "./identity.js";
import type { VantaChannelEntity, VantaEntity, VantaSource } from "./model.js";

/** The `manage-api` source every census record shares, differing only in the endpoint that produced it. */
function censusSource({ path, at }: { path: string; at: string }): VantaSource {
  return {
    artifacts: [],
    channel: "manage-api",
    deepLink: null,
    deepLinkStatus: "unavailable",
    endpoint: path,
    observedAt: at,
  };
}

/** Wrap one detail in the `manage-api` channel every census projection populates. */
function censusChannel({
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
 * Project one row of one census family into an entity, storing the row exactly as Vanta returned it.
 *
 * @param family the family this row came from, which supplies the kind, endpoint and id rule
 * @param dto the row, already parsed by the family's own strict schema
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function projectVantaCensusRow({
  family,
  dto,
  at,
}: {
  family: VantaCensusFamily;
  dto: VantaCensusDto;
  at: string;
}): VantaEntity {
  const providerId = family.providerId(dto);
  return {
    channels: {
      browser: null,
      "manage-api": censusChannel({ at, detail: dto, source: censusSource({ at, path: family.path }) }),
    },
    financialDetail: null,
    id: vantaEntityId({ components: { providerId }, kind: family.kind }),
    kind: family.kind,
    providerId,
    sensitivity: family.handleWithCare ? { handleWithCare: true, providerMarkedSensitive: null } : null,
  };
}

/**
 * Project one indexed event shape into an entity. The shape's `action` is its provider id, because an event
 * kind is what this entity IS — there is no event here to identify.
 *
 * @param shape one event kind's index, from `indexVantaEventShapes`
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function projectVantaEventShape({ shape, at }: { shape: VantaEventShape; at: string }): VantaEntity {
  return {
    channels: {
      browser: null,
      "manage-api": censusChannel({ at, detail: shape, source: censusSource({ at, path: "/v1/event-logs" }) }),
    },
    financialDetail: null,
    id: vantaEntityId({ components: { providerId: shape.action }, kind: "event-shape" }),
    kind: "event-shape",
    providerId: shape.action,
    sensitivity: null,
  };
}
