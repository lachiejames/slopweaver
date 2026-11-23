/**
 * Turning a compiled operation row into a stored entity.
 *
 * ## The projection is an ALLOWLIST, and every field it keeps is a name
 *
 * Nothing from the pinned document reaches disk except through the fields named here — an HTTP method, a
 * path shape, parameter names, response field names, Graph's own operation id, tags and one-line summary,
 * and the disposition this repository decided. A field Microsoft adds to the document next month is dropped
 * at this boundary rather than stored because nobody thought to exclude it, which is the same posture
 * `onepassword/model.ts` takes and deliberately unlike the Vanta atlas's wholesale payload.
 *
 * There is no sensitivity gate here and there does not need to be one. The 1Password and JumpCloud atlases
 * need theirs because their responses carry secrets; this channel calls nothing and reads a public document,
 * so the strongest claim available — nothing here is a value at all — is a property of the input rather than
 * of a filter. The day a live Graph channel lands, it will need one, and it will need it for the same reason
 * they do: `passwordCredentials`, `keyCredentials` and `synchronization/secrets` are all on this surface.
 *
 * ## The deep link is per KIND, and it is honest about being one
 *
 * Graph publishes no portal address for an endpoint, so a per-operation link would have to be constructed —
 * which is inventing a link rather than knowing one. `surfaceNaming.ts` holds the console page each KIND is
 * governed on, hand-written from the consoles' own navigation, and an operation whose kind has none gets a
 * null link with `deepLinkStatus: "unavailable"`. That distinction is the whole point of the kit's contract:
 * "the provider offers none" and "nobody has looked" must not read the same.
 */
import { microsoft365EntityId } from "./identity.js";
import type { Microsoft365AtlasEntity, Microsoft365OperationCompiledDetail } from "./model.js";
import { MICROSOFT365_GRAPH_ORIGIN, MICROSOFT365_GRAPH_VERSION } from "./specLock.js";
import type { Microsoft365OperationRow } from "./specRead.js";
import { microsoft365ConsoleLinkFor } from "./surfaceNaming.js";

/**
 * Project one compiled operation row into an entity carrying only the `compiled` channel.
 *
 * @param row the operation as the pinned document declares it
 * @param at this run's ISO timestamp
 * @returns the entity, with `api` and `browser` left null because neither has looked
 */
export function projectMicrosoft365Operation({
  row,
  at,
}: {
  row: Microsoft365OperationRow;
  at: string;
}): Microsoft365AtlasEntity {
  const detail: Microsoft365OperationCompiledDetail = {
    aliasOf: row.aliasOf,
    disposition: row.disposition,
    dispositionReason: row.dispositionReason,
    method: row.method,
    operationId: row.operationId,
    pathParams: [...row.pathParams],
    pathShape: row.pathShape,
    queryParams: [...row.queryParams],
    responseFields: [...row.responseFields],
    responseSchema: row.responseSchema,
    summary: row.summary,
    tags: [...row.tags],
  };
  const deepLink = microsoft365ConsoleLinkFor({ kind: row.kind });
  return {
    channels: {
      api: null,
      browser: null,
      compiled: {
        channel: "compiled",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "compiled",
          deepLink,
          deepLinkStatus: deepLink === null ? "unavailable" : "provider-provided",
          endpoint: `${MICROSOFT365_GRAPH_ORIGIN}/${MICROSOFT365_GRAPH_VERSION}${row.pathShape}`,
          observedAt: at,
        },
        state: "observed",
      },
    },
    id: microsoft365EntityId({ kind: row.kind, providerId: row.providerId }),
    kind: row.kind,
    providerId: row.providerId,
  };
}

/**
 * Project every compiled row for one kind.
 *
 * @param rows this kind's operations, as the pinned document declares them
 * @param at this run's ISO timestamp
 * @returns the entities, in the order the rows arrived
 */
export function projectMicrosoft365Operations({
  rows,
  at,
}: {
  rows: readonly Microsoft365OperationRow[];
  at: string;
}): readonly Microsoft365AtlasEntity[] {
  return rows.map((row) => projectMicrosoft365Operation({ at, row }));
}
