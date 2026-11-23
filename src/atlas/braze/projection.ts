/**
 * Turning a published operation row into a stored entity, one channel at a time.
 *
 * ## The projection is an ALLOWLIST, and every field it keeps is a name
 *
 * Nothing from either document reaches disk except through the fields named here — a method, a path shape,
 * parameter names and their declared types, header names, response field names, Braze's own title for the
 * operation, and the disposition this repository decided. A field Braze adds to a page next month is dropped
 * at this boundary rather than stored because nobody thought to exclude it, which is the same posture
 * `onepassword/model.ts` takes and deliberately unlike the Vanta atlas's wholesale payload.
 *
 * There is no sensitivity gate here and there does not need to be one. Both channels read published documents
 * and call nothing, so the strongest claim available — nothing here is a value at all — is a property of the
 * input rather than of a filter. The day a live REST channel lands it will need one, and it will need it for
 * the same reason its JumpCloud and 1Password siblings do: Braze's SCIM and SDK-authentication endpoints
 * return key material.
 *
 * ## The deep link differs by channel, and each says how it was come by
 *
 * The reference channel has a real per-operation URL — Braze's own page for it — so its link is
 * `provider-provided`. The collection channel does not: Postman's documenter addresses a request by an
 * internal id this reader does not carry, so its link is null with `deepLinkStatus: "unavailable"`. That
 * distinction is the whole point of the kit's contract: "the provider offers none" and "nobody has looked"
 * must not read the same.
 */
import type { BrazeCollectionOperationRow } from "./collection.js";
import type { BrazeDocsOperationRow } from "./docsCatalogue.js";
import { brazeEntityId } from "./identity.js";
import type { BrazeAtlasEntity, BrazeKind, BrazeOperationCollectionDetail, BrazeOperationDocsDetail } from "./model.js";
import { BRAZE_COLLECTION_URL } from "./specLock.js";

/** Every channel absent, which is what a projection of one channel starts from. */
const NO_CHANNELS = { api: null, browser: null, collection: null, docs: null } as const;

/**
 * Project one reference row into an entity carrying only the `docs` channel.
 *
 * @param row the operation as Braze's endpoint page declares it
 * @param at this run's ISO timestamp
 * @returns the entity, with the other three channels left null because none has looked
 */
export function projectBrazeDocsOperation({ row, at }: { row: BrazeDocsOperationRow; at: string }): BrazeAtlasEntity {
  const detail: BrazeOperationDocsDetail = {
    disposition: row.disposition,
    dispositionReason: row.dispositionReason,
    dispositionRuleId: row.dispositionRuleId,
    method: row.method,
    parameters: row.parameters.map((parameter) => ({ ...parameter })),
    pathShape: row.pathShape,
    rateLimit: row.rateLimit,
    responseFields: [...row.responseFields],
    title: row.title,
  };
  return {
    channels: {
      ...NO_CHANNELS,
      docs: {
        channel: "docs",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "docs",
          deepLink: row.url,
          deepLinkStatus: "provider-provided",
          endpoint: `${row.method} ${row.pathShape}`,
          observedAt: at,
        },
        state: "observed",
      },
    },
    id: brazeEntityId({ kind: row.kind, providerId: row.providerId }),
    kind: row.kind,
    providerId: row.providerId,
  };
}

/**
 * Project one collection row into an entity carrying only the `collection` channel.
 *
 * @param row the operation as the official Postman collection declares it
 * @param kind the kind this operation's file belongs to
 * @param at this run's ISO timestamp
 * @returns the entity, with the other three channels left null because none has looked
 */
export function projectBrazeCollectionOperation({
  row,
  kind,
  at,
}: {
  row: BrazeCollectionOperationRow;
  kind: BrazeKind;
  at: string;
}): BrazeAtlasEntity {
  const detail: BrazeOperationCollectionDetail = {
    folders: [...row.folders],
    headers: [...row.headers],
    method: row.method,
    name: row.name,
    pathShape: row.pathShape,
    queryParams: [...row.queryParams],
    requestBodyFields: [...row.requestBodyFields],
  };
  return {
    channels: {
      ...NO_CHANNELS,
      collection: {
        channel: "collection",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "collection",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: `${row.method} ${row.pathShape}`,
          observedAt: at,
        },
        state: "observed",
      },
    },
    id: brazeEntityId({ kind, providerId: row.providerId }),
    kind,
    providerId: row.providerId,
  };
}

/**
 * The address a reader opens to see the collection itself. There is no per-request address to offer.
 *
 * @returns the collection document's URL
 *
 * @internal
 */
export function brazeCollectionUrl(): string {
  return BRAZE_COLLECTION_URL;
}
