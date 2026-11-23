/**
 * Turning what each channel saw into `api`, `method` and `page` entities.
 *
 * Pure. The two callers — `sync.ts` for the API channel and `walk.ts` for the browser one — each project
 * only their own channel and leave the other slot `null`, which is what makes `merge.ts`'s channel-scoped
 * fold correct: an entity arriving with one channel filled can never blank the other.
 *
 * ## Three provider-id shapes on ONE kind, and that is a decision worth the paragraph
 *
 * This atlas's `method` kind carries evidence from three different api-channel surfaces, and they do not
 * establish the same thing:
 *
 * - `<METHOD> <path>` — a published operation. The document states its contract.
 * - `* /api/v1/<noun>` — a noun the unauthenticated census found MOUNTED. The `*` is honest rather than
 *   lazy: a 401 establishes that the router has that subtree and says nothing about which methods it takes,
 *   because `apiProbe.ts` measured that the router authenticates the subtree before routing within it.
 * - `GRAPHQL <OperationName>` — an operation the shipped client can send to `app.hex.tech/graphql?op=…`.
 *
 * They are deliberately NOT folded onto each other. `GET /v1/projects` and `* /api/v1/projects` are two
 * different claims about the same noun, and collapsing them would manufacture agreement between a contract
 * and a status code. `report.ts` compares the noun SETS explicitly instead, which is a comparison a reader
 * can check.
 *
 * The third shape is what makes the browser channel corroborable at all: a walk that sees
 * `POST https://app.hex.tech/graphql?op=OrgDetails` folds to `GRAPHQL OrgDetails`, which is the same
 * provider id the bundle census minted — so an operation the client ships and never calls, and one it calls
 * that the bundle census missed, are both visible as themselves.
 */

import { absentAsNull } from "#lib/absent.js";
import { type ChannelView, compiledOperationView, pinnedDocumentView } from "../kit/channelEntity.js";
import { HEX_API_PREFIX, HEX_PROBE_CENSUS } from "./apiProbe.js";
import { hexGraphqlDispositionFor, hexGraphqlWithholdingFor } from "./disposition.js";
import { HEX_CLIENT_SURFACE, HEX_GRAPHQL_PATH, HEX_WEB_APP_ORIGIN } from "./generated/clientSurface.js";
import { hexEntityId } from "./identity.js";
import type { HexApiDetail, HexAtlasChannel, HexAtlasEntity, HexAtlasKind, HexMethodApiDetail } from "./model.js";
import type { HexSpecPin } from "./specPin.js";
import { type HexSpecSurface, hexMethodProviderId } from "./specSurface.js";

/** One entity carrying exactly one filled channel — the kit owns the assembly. */
function entityWith({
  kind,
  providerId,
  channel,
  filled,
}: {
  kind: HexAtlasKind;
  providerId: string;
  channel: HexAtlasChannel;
  filled: ChannelView<HexAtlasChannel>;
}): HexAtlasEntity {
  return {
    // Spelled out rather than assembled: the two slots are literal keys here, so no type assertion is
    // needed to keep them exact and REQUIRED — see `kit/channelSchemas.ts` on why that requiredness is the
    // property rather than a detail.
    channels: { api: channel === "api" ? filled : null, browser: channel === "browser" ? filled : null },
    id: hexEntityId({ kind, providerId }),
    kind,
    providerId,
  };
}

/**
 * The provider id one probed noun takes.
 *
 * @param noun the path segment directly under `/api/v1`
 * @returns `* /api/v1/<noun>` — see this file's header on why the method is a star
 *
 * @internal
 */
export function hexProbeProviderId({ noun }: { noun: string }): string {
  return `* ${HEX_API_PREFIX}/${noun}`;
}

/**
 * The provider id one GraphQL operation takes, on either channel.
 *
 * @param name the operation name
 * @returns `GRAPHQL <name>`
 */
export function hexGraphqlProviderId({ name }: { name: string }): string {
  return `GRAPHQL ${name}`;
}

/**
 * Project the three compiled evidence bodies into `api` entities on the `api` channel.
 *
 * @param pins the reviewed specification lock
 * @param at this run's ISO timestamp
 * @returns one entity per evidence body — the published document, the census, the client bundle
 */
export function projectHexApis({ pins, at }: { pins: readonly HexSpecPin[]; at: string }): readonly HexAtlasEntity[] {
  return [...projectHexDocuments({ at, pins }), projectHexCensus({ at }), projectHexBundle({ at })];
}

/** The pinned OpenAPI documents, one `api` entity each. */
function projectHexDocuments({ pins, at }: { pins: readonly HexSpecPin[]; at: string }): readonly HexAtlasEntity[] {
  const documents = pins.map((pin) => {
    const detail: HexApiDetail = {
      byteLength: pin.byteLength,
      family: "openapi-document",
      hosts: [...pin.hosts],
      operationCount: pin.operationCount,
      pathCount: pin.pathCount,
      securitySchemes: [...pin.securitySchemes],
      sha256: pin.sha256,
      title: pin.title,
      version: pin.version,
    };
    return entityWith({
      channel: "api",
      filled: pinnedDocumentView({ at, channel: "api", detail, url: pin.url }),
      kind: "api",
      providerId: pin.id,
    });
  });
  return documents;
}

/** The unauthenticated noun census, as one `api` entity carrying the whole denominator. */
function projectHexCensus({ at }: { at: string }): HexAtlasEntity {
  const mounted = HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401");
  const censusDetail: HexApiDetail = {
    byteLength: 0,
    family: "unauthenticated-probe",
    hosts: [HEX_WEB_APP_ORIGIN],
    operationCount: mounted.length,
    pathCount: HEX_PROBE_CENSUS.length,
    securitySchemes: [],
    // The census is a measurement rather than a document, so it has no bytes to digest. Zero here is a
    // real value, not a placeholder: `family` is what tells a reader which fields mean anything.
    sha256: "0".repeat(64),
    title: "unauthenticated /api/v1 noun census",
    version: "measured-2026-09-07",
  };
  return entityWith({
    channel: "api",
    filled: pinnedDocumentView({
      at,
      channel: "api",
      detail: censusDetail,
      url: `${HEX_WEB_APP_ORIGIN}${HEX_API_PREFIX}`,
    }),
    kind: "api",
    providerId: "hex-unauthenticated-probe",
  });
}

/** The shipped client's closed bundle graph, as one `api` entity. */
function projectHexBundle({ at }: { at: string }): HexAtlasEntity {
  const bundleDetail: HexApiDetail = {
    byteLength: HEX_CLIENT_SURFACE.byteLength,
    family: "client-bundle",
    hosts: [HEX_WEB_APP_ORIGIN],
    operationCount: HEX_CLIENT_SURFACE.graphqlOperations.length,
    pathCount: HEX_CLIENT_SURFACE.routes.length,
    securitySchemes: [],
    sha256: HEX_CLIENT_SURFACE.sha256,
    title: "shipped web client bundle graph",
    version: `${String(HEX_CLIENT_SURFACE.bundleCount)}-bundles`,
  };
  return entityWith({
    channel: "api",
    filled: pinnedDocumentView({ at, channel: "api", detail: bundleDetail, url: `${HEX_WEB_APP_ORIGIN}/login` }),
    kind: "api",
    providerId: "hex-client-bundle",
  });
}

/**
 * Project every operation the published document declares into a `method` entity on the `api` channel.
 *
 * @param surfaces the compiled documents
 * @param pins the reviewed lock, so an operation can cite the document a reader should open
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation, sorted by provider id
 */
export function projectHexSpecMethods({
  surfaces,
  pins,
  at,
}: {
  surfaces: readonly HexSpecSurface[];
  pins: readonly HexSpecPin[];
  at: string;
}): readonly HexAtlasEntity[] {
  const citeById = new Map(pins.map((pin) => [pin.id, pin.url]));
  return surfaces
    .flatMap((surface) =>
      surface.operations.map((operation) => {
        const providerId = hexMethodProviderId({ method: operation.method, path: operation.path });
        const detail: HexMethodApiDetail = {
          disposition: operation.disposition,
          evidence: "openapi-document",
          excludedBecause: operation.excludedBecause,
          host: operation.host,
          observational: operation.excludedBecause === null,
          operationId: operation.operationId,
          parameters: [...operation.parameters],
          responseFields: [...operation.responseFields],
          securitySchemes: [...operation.securitySchemes],
          withheldBecause: operation.withheldBecause,
        };
        return entityWith({
          channel: "api",
          filled: compiledOperationView({
            at,
            channel: "api",
            citeUrl: absentAsNull({ value: citeById.get(surface.specId) }),
            detail,
            providerId,
          }),
          kind: "method",
          providerId,
        });
      }),
    )
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * Project every noun the unauthenticated census found MOUNTED into a `method` entity on the `api` channel.
 *
 * A noun the census found absent gets no row: the census itself is one `api` entity carrying the whole
 * denominator, so the absence is held once rather than sixty-two times. What earns a row is the positive
 * finding — this path is routed.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per mounted noun, sorted by provider id
 */
export function projectHexProbeMethods({ at }: { at: string }): readonly HexAtlasEntity[] {
  return HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401")
    .map((row) => {
      const providerId = hexProbeProviderId({ noun: row.noun });
      const detail: HexMethodApiDetail = {
        // A routed noun is configuration until something says otherwise; nothing has been fetched from it.
        disposition: "entity",
        evidence: "unauthenticated-probe",
        excludedBecause: null,
        host: HEX_WEB_APP_ORIGIN,
        observational: true,
        operationId: null,
        parameters: [],
        responseFields: [],
        securitySchemes: ["bearerAuth"],
        withheldBecause: null,
      };
      return entityWith({
        channel: "api",
        filled: compiledOperationView({
          at,
          channel: "api",
          citeUrl: `${HEX_WEB_APP_ORIGIN}${HEX_API_PREFIX}/${row.noun}`,
          detail,
          providerId,
        }),
        kind: "method",
        providerId,
      });
    })
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * Project every GraphQL operation the shipped client declares into a `method` entity on the `api` channel.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per named operation, sorted by provider id
 */
export function projectHexGraphqlMethods({ at }: { at: string }): readonly HexAtlasEntity[] {
  return HEX_CLIENT_SURFACE.graphqlOperations
    .map((operation) => {
      const providerId = hexGraphqlProviderId({ name: operation.name });
      const detail: HexMethodApiDetail = {
        disposition: hexGraphqlDispositionFor({ name: operation.name }),
        evidence: "client-bundle",
        excludedBecause:
          operation.kind === "query"
            ? null
            : `a GraphQL ${operation.kind} changes state or opens a stream — this atlas only ever reads`,
        host: HEX_WEB_APP_ORIGIN,
        observational: operation.kind === "query",
        operationId: operation.name,
        parameters: [],
        responseFields: [],
        securitySchemes: [],
        withheldBecause: hexGraphqlWithholdingFor({ name: operation.name }),
      };
      return entityWith({
        channel: "api",
        filled: compiledOperationView({
          at,
          channel: "api",
          citeUrl: `${HEX_WEB_APP_ORIGIN}${HEX_GRAPHQL_PATH}?op=${operation.name}`,
          detail,
          providerId,
        }),
        kind: "method",
        providerId,
      });
    })
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}
