/**
 * Projecting the committed operation registry into entities on the `compiled-catalogue` channel.
 *
 * ## What this channel actually knows, stated exactly
 *
 * It knows what the pinned `@datadog/datadog-api-client` DECLARES — that an operation exists, what it is
 * called, which path and method reach it, whether Datadog marks it unstable or deprecated, and what THIS
 * atlas does with it. It needs no credential, makes no request and touches no organisation, which is why it
 * is the one surface an installation with no Datadog access can still fill. `documents.ts` states the
 * distinction the three channels exist to keep: this one answers "does Datadog have this call at all",
 * never "does this organisation have any of it".
 *
 * ## Every row becomes an entity, including the 988 the atlas will never call
 *
 * `exclusions.ts` already rules this: an excluded operation is "addressable by surface name for inventory
 * and coverage, publishing `state: excluded` with the reason, because an atlas that silently omitted them
 * would answer 'Datadog has no such endpoint', which is false". An entity is how it becomes addressable, so
 * the projection is over the WHOLE registry and the disposition rides on the detail rather than deciding
 * whether a row appears.
 *
 * ## The detail goes through the projection even though nothing can be dropped
 *
 * The reason is not that a row might carry a secret — none of its twelve fields is a denied name, and `catalogue.test.ts` pins that. It is that the
 * projection is the storage boundary, and a boundary that some callers skip because they are sure is a
 * boundary that stops being one the first time somebody is wrong. It also costs nothing here: the drop
 * report it returns is what `coverage.ts` needs to say the cell withheld nothing.
 *
 * ## `scope` is the pinned client, on every entity in this atlas
 *
 * The entity's `scope` is one field shared by all three channels, and an operation's is the artifact that
 * declares it rather than the organisation that answers it. When the `api` channel lands it fills the SAME
 * entity's `api` slot with what this organisation returned; WHERE that was read is carried on that
 * channel's own coverage cell and source, not by rewriting the operation's scope. Baking an org into the
 * scope would also make it change under an installation re-pointed at another Datadog site, for an
 * operation that did not move.
 */
import type { AtlasProjection } from "../kit/projection.js";

import type { DatadogEntity } from "./documents.js";
import { DATADOG_SDK_PIN } from "./generated/sdkLock.js";
import { DATADOG_SURFACES } from "./generated/surfaces.js";
import { datadogEntityId } from "./identity.js";
import type { DatadogKind } from "./model.js";
import { projectDatadogValue } from "./projection.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";

/**
 * The channel this module writes, named once so a caller cannot pass a different one.
 * @internal
 */
export const DATADOG_COMPILED_CHANNEL = "compiled-catalogue";

/**
 * The scope every entity in this atlas carries — the artifact that declares the operations.
 * @internal
 */
export const DATADOG_COMPILED_SCOPE = `@datadog/datadog-api-client ${DATADOG_SDK_PIN.version}`;

/** One row's projection, kept beside its entity so the coverage cell can report what was removed. */
export interface DatadogCatalogueEntry {
  readonly entity: DatadogEntity;
  readonly projection: AtlasProjection;
}

/**
 * Every registry row, grouped by the kind whose file it belongs in.
 *
 * @returns the rows, grouped, in registry order
 */
export function datadogRowsByKind(): ReadonlyMap<string, readonly DatadogSurfaceRow[]> {
  const byKind = new Map<string, DatadogSurfaceRow[]>();
  for (const row of DATADOG_SURFACES) {
    const held = byKind.get(row.kind);
    if (held === undefined) {
      byKind.set(row.kind, [row]);
      continue;
    }
    held.push(row);
  }
  return byKind;
}

/**
 * Project one kind's registry rows into entities on the compiled channel.
 *
 * @param kind the atlas kind these rows belong to, which decides the field-denial scope
 * @param rows that kind's registry rows
 * @param at this run's ISO timestamp
 * @returns one entry per row, each carrying the entity and the projection that produced its detail
 */
export function projectDatadogCatalogue({
  kind,
  rows,
  at,
}: {
  kind: DatadogKind;
  rows: readonly DatadogSurfaceRow[];
  at: string;
}): readonly DatadogCatalogueEntry[] {
  return rows.map((row): DatadogCatalogueEntry => {
    const projection = projectDatadogValue({ kind, value: row });
    return {
      entity: {
        channels: {
          api: null,
          "compiled-catalogue": {
            channel: DATADOG_COMPILED_CHANNEL,
            detail: projection.value,
            firstSeenAt: at,
            lastSeenAt: at,
            source: {
              artifacts: [],
              // Never constructed from an id: Datadog's reference pages are not addressable from an SDK
              // operation key without guessing, and `kit/contract.ts` would rather have no link than a
              // fabricated one. `unavailable` is the honest status — the provider offers none here, which
              // is a different fact from nobody having looked.
              deepLink: null,
              deepLinkStatus: "unavailable",
              endpoint: `${row.method} ${row.path}`,
              observedAt: at,
              surface: DATADOG_COMPILED_CHANNEL,
            },
            state: "observed",
          },
          console: null,
        },
        id: datadogEntityId({ kind, providerId: row.name }),
        kind,
        providerId: row.name,
        scope: DATADOG_COMPILED_SCOPE,
      },
      projection,
    };
  });
}
