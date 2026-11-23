/**
 * Turning what each channel saw into `method`, `page` and `family` entities.
 *
 * Pure. The two callers — `sync.ts` for the API channel and `browserSurface.ts` for the browser one — each
 * project only their own channel and leave the other slot `null`, which is what makes `merge.ts`'s
 * channel-scoped fold correct: an entity arriving with one channel filled can never blank the other.
 *
 * ## The provider id is `<METHOD> <host><path shape>`, byte-exact
 *
 * That exactness IS the disagreement detector. A normalising match would fold a documented endpoint and an
 * undocumented client route into one entity and manufacture an agreement that was never observed — hiding
 * precisely the undocumented surface the both-surfaces ruling is about. A path seen on one channel and not
 * the other is therefore a RECORD, never a match failure.
 *
 * The one normalisation that IS applied is on the SDK side, and it is stated rather than hidden: a declared
 * path parameter is rewritten to the placeholder the browser reduction would produce for the value that
 * fills it, so `/Invoices/{InvoiceID}` and an observed `/Invoices/{id}` are one row rather than two. Its
 * residue is named in `disagreement.ts` — a parameter whose value is NOT id-shaped, `{FileName}` being the
 * measured case, still reads as a disagreement, and that is a known limit rather than a finding.
 */

import { absentAsEmpty } from "#lib/absent.js";
import { pushInto } from "#lib/collections.js";
import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../kit/channelProjection.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { foldObservedOperations } from "../kit/observedOperations.js";
import { XERO_BROWSER_PAGES } from "./browserPages.js";
import type { XeroObservedCall } from "./browserReduction.js";
import type { XeroPageObservation } from "./browserWalk.js";
import type { XeroFamily } from "./families.js";
import { xeroEntityId } from "./identity.js";
import type {
  XeroAtlasChannel,
  XeroAtlasEntity,
  XeroChannelEntity,
  XeroDeepLinkStatus,
  XeroFamilyDetail,
  XeroMethodApiDetail,
  XeroMethodBrowserDetail,
  XeroMethodDeclaration,
  XeroPageDetail,
} from "./model.js";
import type { XeroSdkOperation } from "./sdkEndpoints.js";

/**
 * The placeholder a declared path parameter whose name ends in an id suffix is rewritten to.
 *
 * @internal
 */
export const XERO_ID_PLACEHOLDER = "{id}";

/**
 * The placeholder every other declared path parameter is rewritten to.
 *
 * Deliberately NOT `{id}`: a parameter the browser reduction would leave as a readable segment must not be
 * spelled the same way as one it redacts, or the two channels would appear to agree about a route neither
 * observed the same way.
 *
 * @internal
 */
export const XERO_VALUE_PLACEHOLDER = "{v}";

/** The suffix a Xero path parameter carries when its value is one of Xero's own uuids. */
const ID_SUFFIX = "id";

/**
 * The provider key for one method entity — what the two channels are matched on.
 *
 * @param httpMethod the verb, upper-cased here so a channel spelling it in lower case still matches
 * @param host the host the call goes to, lower-cased; Xero spreads its surface over several
 * @param pathShape the path with every value segment already replaced
 * @returns the key, byte-exact on both channels
 */
export function methodProviderId({
  httpMethod,
  host,
  pathShape,
}: {
  httpMethod: string;
  host: string;
  pathShape: string;
}): string {
  return `${httpMethod.toUpperCase()} ${host.toLowerCase()}${pathShape}`;
}

/**
 * Rewrite one SDK-declared path template into the shape the browser reduction produces.
 *
 * @param path the declared path, with each parameter as `{Name}`
 * @returns the path with each parameter replaced by its value's placeholder
 *
 * @internal
 */
export function normalisedSdkPath({ path }: { path: string }): string {
  return path
    .split("/")
    .map((segment) => {
      if (!segment.startsWith("{") || !segment.endsWith("}")) {
        return segment;
      }
      const name = segment.slice(1, -1).toLowerCase();
      return name.endsWith(ID_SUFFIX) ? XERO_ID_PLACEHOLDER : XERO_VALUE_PLACEHOLDER;
    })
    .join("/");
}

/** The host and root path one operation's declared base path resolves to. */
function baseOf({ basePath }: { basePath: string }): { host: string; root: string } {
  try {
    const parsed = new URL(basePath);
    return { host: parsed.hostname.toLowerCase(), root: parsed.pathname.replace(/\/+$/, "") };
  } catch {
    // A base path this atlas cannot parse still has to produce a stable, distinguishable key rather than
    // collapsing every such operation onto one row.
    return { host: basePath, root: "" };
  }
}

/**
 * The `api` channel's provider key for one SDK-declared operation.
 *
 * @param operation the declared operation
 * @returns the key, in the same form the browser channel produces
 */
export function apiProviderId({ operation }: { operation: XeroSdkOperation }): string {
  const base = baseOf({ basePath: operation.basePath });
  return methodProviderId({
    host: base.host,
    httpMethod: operation.httpMethod,
    pathShape: `${base.root}${normalisedSdkPath({ path: operation.path })}`,
  });
}

/**
 * Every channel slot empty, which is what {@link atlasEntityWithChannel} fills exactly one of.
 *
 * A projection that filled both would let a channel-scoped merge blank what the other channel knew, which
 * is the whole property `merge.ts` exists to hold.
 */
const EMPTY_CHANNELS = { api: null, browser: null } as const;

/** One channel's view, stamped with this run's instant. Kit-owned — see `kit/channelProjection.ts`. */
function channelEntity({
  channel,
  detail,
  at,
  endpoint,
  deepLink,
  deepLinkStatus,
  artifacts,
}: {
  channel: XeroAtlasChannel;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  deepLinkStatus: XeroDeepLinkStatus;
  artifacts: readonly AtlasArtifactRef[];
}): XeroChannelEntity {
  return atlasChannelView({ artifacts, at, channel, deepLink, deepLinkStatus, detail, endpoint });
}

/**
 * The wire field names one operation's response model declares.
 *
 * A model reference the package writes as `Array<Thing>` is unwrapped to `Thing`, because the fields a
 * caller sees are the element's. A reference to a primitive — `string`, `object`, `Buffer` — resolves to
 * nothing, which is correct rather than missing: those operations genuinely return no named fields.
 *
 * @param responseModel the model name the operation deserialises into, or `null`
 * @param modelFields every model's declared fields, keyed by model name
 * @returns the field names, sorted, or an empty list when the model declares or resolves to none
 *
 * @internal
 */
export function responseFieldsFor({
  responseModel,
  modelFields,
}: {
  responseModel: string | null;
  modelFields: Readonly<Record<string, readonly string[]>>;
}): readonly string[] {
  if (responseModel === null) {
    return [];
  }
  const unwrapped =
    responseModel.startsWith("Array<") && responseModel.endsWith(">")
      ? responseModel.slice("Array<".length, -1)
      : responseModel;
  return absentAsEmpty({ value: modelFields[unwrapped] });
}

/**
 * What one generated client declares about one route, reduced to names.
 *
 * @param operation the SDK-declared operation
 * @param modelFields every model's declared wire field names, keyed by model name
 * @returns the declaration this client contributes to its route's row
 */
function declarationOf({
  operation,
  modelFields,
}: {
  operation: XeroSdkOperation;
  modelFields: Readonly<Record<string, readonly string[]>>;
}): XeroMethodDeclaration {
  return {
    headerParams: [...operation.headerParams].toSorted(),
    module: operation.module,
    name: operation.name,
    pathParams: [...operation.pathParams].toSorted(),
    queryParams: [...operation.queryParams].toSorted(),
    requestModel: operation.requestModel,
    responseFields: [...responseFieldsFor({ modelFields, responseModel: operation.responseModel })],
    responseModel: operation.responseModel,
    summary: operation.summary,
  };
}

/**
 * Project the installed SDK's declared operations into `method` entities on the `api` channel.
 *
 * @param operations every operation the SDK declares
 * @param modelFields every model's declared wire field names, keyed by model name
 * @param at this run's ISO timestamp
 * @returns one entity per declared operation, sorted by id so a published file is stable
 */
export function projectXeroApiMethods({
  operations,
  modelFields,
  at,
}: {
  operations: readonly XeroSdkOperation[];
  modelFields: Readonly<Record<string, readonly string[]>>;
  at: string;
}): readonly XeroAtlasEntity[] {
  // Three payroll clients hang different methods off one root and share 62 paths between them, so a route
  // can be declared more than once. Every declaration is kept — see `XeroMethodApiDetail` on why dropping
  // one loses a fact and unioning their parameters would invent one.
  const byRoute = new Map<string, XeroMethodDeclaration[]>();
  for (const operation of operations) {
    pushInto({
      buckets: byRoute,
      key: apiProviderId({ operation }),
      value: declarationOf({ modelFields, operation }),
    });
  }
  return [...byRoute.entries()]
    .map(([providerId, declared]): XeroAtlasEntity => {
      const declarations = declared.toSorted((left, right) =>
        `${left.module}.${left.name}`.localeCompare(`${right.module}.${right.name}`),
      );
      const detail: XeroMethodApiDetail = {
        declarations,
        responseFields: [...new Set(declarations.flatMap((one) => one.responseFields))].toSorted(),
      };
      return {
        channels: {
          api: channelEntity({
            artifacts: [],
            at,
            channel: "api",
            // The REST API is not a place a human opens, so there is no deep link at all — and the status
            // has to SAY that, rather than leaving an absent link indistinguishable from an unattempted one.
            deepLink: null,
            deepLinkStatus: "unavailable",
            detail,
            endpoint: providerId,
          }),
          browser: null,
        },
        id: xeroEntityId({ kind: "method", providerId }),
        kind: "method",
        providerId,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Project a walk's observed operations into `method` entities on the `browser` channel.
 *
 * The FOLD across pages is the kit's ({@link foldObservedOperations}) — a call made on two pages can return
 * different fields on each, and keeping only the last understates the surface. What is this atlas's own is
 * the KEY, because that is what the API channel has to match byte-exactly for corroboration to mean anything.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation, sorted by id so a published file is stable
 */
export function projectXeroBrowserMethods({
  pages,
  at,
}: {
  pages: readonly XeroPageObservation[];
  at: string;
}): readonly XeroAtlasEntity[] {
  const folded = foldObservedOperations<XeroObservedCall>({
    fieldsOf: ({ call }) => call.responseFields,
    keyOf: ({ call }) => methodProviderId({ host: call.host, httpMethod: call.method, pathShape: call.pathShape }),
    pages,
  });
  const entities = [...folded.entries()].map(([providerId, seen]): XeroAtlasEntity => {
    const detail: XeroMethodBrowserDetail = {
      callCount: seen.callCount,
      responseFields: [...seen.responseFields],
      seenOnPages: [...seen.seenOn],
      statusCode: seen.call.statusCode,
    };
    return atlasEntityWithChannel({
      channel: "browser",
      empty: EMPTY_CHANNELS,
      id: xeroEntityId({ kind: "method", providerId }),
      kind: "method",
      providerId,
      view: channelEntity({
        artifacts: [],
        at,
        channel: "browser",
        deepLink: seen.deepLink.length > 0 ? seen.deepLink : null,
        deepLinkStatus: "browser-discovered",
        detail,
        endpoint: providerId,
      }),
    });
  });
  return sortedById({ entities });
}

/**
 * Project a walk's page observations into `page` entities on the `browser` channel.
 *
 * The stored detail is `kit/pageObservation.ts`'s schema, which is the on-disk mirror of the walk's own
 * observation — so this maps between two shapes the kit already reconciles rather than naming eight fields
 * a third time.
 *
 * A page that could not be ADDRESSED at all still owes a reproduction handle, and its own declared surface
 * name is the only one it has.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per declared page, sorted by id so a published file is stable
 */
export function projectXeroPages({
  pages,
  at,
}: {
  pages: readonly XeroPageObservation[];
  at: string;
}): readonly XeroAtlasEntity[] {
  const entities = pages.map((page): XeroAtlasEntity => {
    const detail: XeroPageDetail = {
      callCount: page.calls.length,
      captureComplete: page.captureComplete,
      finalUrl: page.finalUrl,
      redirected: page.redirected,
      responseAccounting: page.responseAccounting,
      statusCode: page.statusCode,
      title: page.title,
      unreachableBecause: page.unreachableBecause,
    };
    return atlasEntityWithChannel({
      channel: "browser",
      empty: EMPTY_CHANNELS,
      id: xeroEntityId({ kind: "page", providerId: page.surface }),
      kind: "page",
      providerId: page.surface,
      view: channelEntity({
        artifacts: page.artifacts,
        at,
        channel: "browser",
        deepLink: page.requestedUrl.length > 0 ? page.requestedUrl : null,
        deepLinkStatus: "browser-discovered",
        detail,
        endpoint: page.requestedUrl.length > 0 ? page.requestedUrl : page.surface,
      }),
    });
  });
  return sortedById({ entities });
}

/**
 * Project the derived families into `family` entities on the `api` channel.
 *
 * This is the kind that carries the owner's one bound — a highly voluminous surface is enumerated and
 * declared rather than stored whole — so every row says what its records ARE, which operations reach them,
 * which declared page shows them, and whether this atlas holds them.
 *
 * `ingest` is `not-ingested` for every family today and says exactly what would change that. That is the
 * honest state rather than a placeholder: the browser is the ingest FALLBACK by the owner's own ruling, and
 * the API that should answer first has no credential on this installation yet.
 *
 * @param families every family derived from the SDK's own operations
 * @param at this run's ISO timestamp
 * @param ingestBlockedBy what would let this atlas hold a family's rows
 * @returns one entity per family, sorted by id so a published file is stable
 */
export function projectXeroFamilies({
  families,
  at,
  ingestBlockedBy,
}: {
  families: readonly XeroFamily[];
  at: string;
  ingestBlockedBy: string;
}): readonly XeroAtlasEntity[] {
  const pagesByFamily = new Map<string, string[]>();
  for (const page of XERO_BROWSER_PAGES) {
    if (page.family !== null) {
      pushInto({ buckets: pagesByFamily, key: page.family, value: page.surface });
    }
  }
  return families
    .map((family): XeroAtlasEntity => {
      const detail: XeroFamilyDetail = {
        disposition: family.disposition,
        dispositionReason: family.reason,
        ingest: "not-ingested",
        ingestBlockedBy,
        operations: [...family.operations],
        pages: absentAsEmpty({ value: pagesByFamily.get(family.key) }).toSorted(),
        product: family.product,
        voluminousOperations: [...family.voluminousOperations],
      };
      return {
        channels: {
          api: channelEntity({
            artifacts: [],
            at,
            channel: "api",
            deepLink: null,
            deepLinkStatus: "unavailable",
            detail,
            endpoint: family.key,
          }),
          browser: null,
        },
        id: xeroEntityId({ kind: "family", providerId: family.key }),
        kind: "family",
        providerId: family.key,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}
