/**
 * Turning what this organisation answered into entities the atlas can publish.
 *
 * Two groups come out of one response, and the difference between them is the point. An OPERATION entity is
 * the same entity `./catalogue.ts` fixed the contract for, with only its `api` channel replaced. An ESTATE
 * entity, a monitor or a dashboard or a notebook, is this organisation's own record exploded out of the list
 * operation's answer, and it carries an `api` channel and no compiled one at all. That absence is how a
 * reader tells the two apart.
 *
 * Nothing here calls the API and nothing here decides what a gap is. Each function is handed an observation
 * and returns entities, which is why `./syncApiPass.ts` imports this module and this module imports nothing
 * of the pass.
 */

import { err, ok, type Result } from "../../lib/result.js";
import { DATADOG_API_CHANNEL } from "./apiCoverage.js";
import type { DatadogEntity } from "./documents.js";
import { type DatadogEstateRow, datadogEstateRecords, datadogEstateRowFor } from "./estateAcquisition.js";
import { datadogEntityId } from "./identity.js";
import type { DatadogKind } from "./model.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";
import type { DatadogApiOperationOutcome } from "./syncApiTypes.js";

/**
 * One answered operation as an entity carrying only its `api` channel.
 *
 * @returns the entity, or null when the operation never answered and there is nothing to publish
 */
export function entityFor({
  kind,
  outcome,
  at,
  scope,
}: {
  kind: DatadogKind;
  outcome: DatadogApiOperationOutcome;
  at: string;
  scope: string;
}): DatadogEntity | null {
  const { observation, projection, row } = outcome;
  if (observation === null || projection === null) {
    return null;
  }
  return {
    channels: {
      api: {
        channel: "api",
        detail: {
          bodies: projection.value,
          bound: observation.bound,
          boundarySource: observation.boundarySource,
          pagingParameter: observation.pagingParameter,
          status: observation.status,
        },
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          // No console link is constructed: an API operation has no page, and `kit/contract.ts` would
          // rather carry none than a fabricated one.
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: `${row.method} ${row.path}`,
          observedAt: at,
          surface: DATADOG_API_CHANNEL,
        },
        state: "observed",
      },
      "compiled-catalogue": null,
      console: null,
    },
    id: datadogEntityId({ kind, providerId: row.name }),
    kind,
    providerId: row.name,
    // The organisation and site this was read at — which is the whole difference between this channel and
    // the compiled one, whose scope is the pinned client.
    scope,
  };
}

/**
 * One of this organisation's own records as an entity carrying only its `api` channel.
 *
 * It has NO `compiled-catalogue` channel and never will: the compiled sync publishes one per registry row,
 * and a monitor is not a registry row. That absence is the thing a reader can tell an estate record apart
 * by, rather than a field two passes would have to remember to set — `readAdapter.ts`'s observation list is
 * where it surfaces, one line naming `api` and nothing else.
 *
 * @param kind the kind whose estate this record belongs to
 * @param record the provider's own record, already projected through this kind's field denials
 * @param row the estate row, for the list operation the record came out of
 * @param at this run's ISO timestamp
 * @param scope the organisation and site this was read at
 * @returns the entity to merge onto the `api` channel
 */
function estateEntityFor({
  kind,
  record,
  row,
  at,
  scope,
}: {
  kind: DatadogKind;
  record: { readonly providerId: string; readonly record: unknown };
  row: DatadogSurfaceRow;
  at: string;
  scope: string;
}): DatadogEntity {
  return {
    channels: {
      api: {
        channel: "api",
        detail: record.record,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: `${row.method} ${row.path}`,
          observedAt: at,
          surface: DATADOG_API_CHANNEL,
        },
        state: "observed",
      },
      "compiled-catalogue": null,
      console: null,
    },
    id: datadogEntityId({ kind, providerId: record.providerId }),
    kind,
    providerId: record.providerId,
    scope,
  };
}

/**
 * This kind's estate, exploded out of the list operation's own answer.
 *
 * Returns nothing at all for a kind `estateAcquisition.ts` holds no row for, and for a row whose operation
 * this pass did not answer — a failed list call must leave the kind saying what it said before, never
 * publishing an empty estate that reads as an organisation holding none.
 *
 * @param kind the kind being published
 * @param outcomes every admitted operation's result for this kind
 * @param at this run's ISO timestamp
 * @param scope the organisation and site this was read at
 * @returns the entities and the counts the outcome reports, or the collision that stopped publication
 */
export function estateFor({
  kind,
  outcomes,
  at,
  scope,
}: {
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
  at: string;
  scope: string;
}): Result<{ entities: readonly DatadogEntity[]; records: number; unidentified: number }> {
  const row: DatadogEstateRow | null = datadogEstateRowFor({ kind });
  if (row === null) {
    return ok({ entities: [], records: 0, unidentified: 0 });
  }
  const listed = outcomes.find((outcome) => outcome.row.name === row.surface);
  if (listed?.projection == null) {
    return ok({ entities: [], records: 0, unidentified: 0 });
  }
  const extracted = datadogEstateRecords({ bodies: asPages({ value: listed.projection.value }), row });
  if (extracted.isErr()) {
    return err([extracted.error.message]);
  }
  return ok({
    entities: extracted.value.records.map((record) => estateEntityFor({ at, kind, record, row: listed.row, scope })),
    records: extracted.value.records.length,
    unidentified: extracted.value.unidentified,
  });
}

/**
 * The projected `bodies` list, which `projectDatadogValue` hands back as an opaque `unknown`.
 *
 * The kit's projection walks whatever it is given and returns the same SHAPE, so a `readonly unknown[]` in
 * is a `readonly unknown[]` out — but its declared type is `unknown`, and a cast here would be a promise
 * rather than a check. A guard that answers "no pages" on a shape nobody has seen is the honest version:
 * the estate is then zero for a reason this file can state, not a crash.
 *
 * @param value the projection's own output
 * @returns the pages, empty when the projection returned something other than a list
 */
function asPages({ value }: { value: unknown }): readonly unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}
