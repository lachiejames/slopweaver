/**
 * The record entities an Admin API fill contributes to one kind of the Google Admin atlas. Pure over the
 * committed registry and its arguments — `sync.ts` places them in each kind file through {@link recordEntities}.
 */
import { stableEntityId } from "../kit/identity.js";
import type { GoogleAdminFillObservation } from "./adminApi/observation.js";
import { GOOGLE_ADMIN_SURFACES } from "./generated/surfaces.js";
import { filledFor } from "./liveCoverage.js";
import {
  emptyGoogleAdminChannels,
  GOOGLE_ADMIN_ATLAS_PLATFORM,
  type GoogleAdminAtlasEntity,
  type GoogleAdminAtlasKind,
} from "./model.js";

/**
 * Every kind the committed registry shape-indexes, which is where a stored record is REFUSED.
 *
 * `store.ts`'s publish gate refuses a generation carrying a record of one of these, so the fill must not
 * build one in the first place — a gate that refuses the whole generation is the right shape for a defect
 * and the wrong shape for a routine exclusion. The set is derived from the registry rather than listed, on
 * the same reasoning `store.ts` gives for deriving its own copy.
 */
const RECORD_REFUSING_KINDS: ReadonlySet<string> = new Set(
  GOOGLE_ADMIN_SURFACES.filter((row) => row.disposition === "shape-index").map((row) => row.kind),
);

/**
 * The record entities one kind holds from a fill.
 *
 * Empty for a shape-indexed kind even when the fill read records for it — see {@link RECORD_REFUSING_KINDS}.
 * The records are not lost from the report either way, because the coverage cell counts what was READ.
 *
 * @param kind the kind to build
 * @param fill what the fill brought back, or `null` when none has run
 * @param at the fill's own ISO timestamp
 * @returns the entities, in provider-key order
 */
export function recordEntities({
  kind,
  fill,
  at,
}: {
  kind: GoogleAdminAtlasKind;
  fill: GoogleAdminFillObservation | null;
  at: string;
}): readonly GoogleAdminAtlasEntity[] {
  if (RECORD_REFUSING_KINDS.has(kind)) {
    return [];
  }
  const entities: GoogleAdminAtlasEntity[] = [];
  for (const operation of filledFor({ fill, kind })) {
    for (const record of operation.records) {
      entities.push({
        channels: {
          ...emptyGoogleAdminChannels(),
          "admin-api": {
            detail: { fields: [...record.fields], operation: operation.id, withheldValues: true },
            firstSeenAt: at,
            lastSeenAt: at,
            source: {
              artifacts: [],
              channel: "admin-api",
              deepLink: null,
              deepLinkStatus: "unavailable",
              endpoint: operation.id,
              observedAt: at,
            },
            state: "observed",
          },
        },
        family: "record",
        id: stableEntityId({
          components: { providerId: record.providerId },
          namespace: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:${kind}`,
        }),
        kind,
        providerId: record.providerId,
      });
    }
  }
  return entities.toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}
