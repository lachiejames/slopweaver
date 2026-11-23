/**
 * Turning what a run OBSERVED into the entities the store holds — pure, so the whole shape is provable
 * without a network.
 *
 * Every function here takes what was seen and this run's timestamp and returns a projection carrying exactly
 * ONE channel. The other two channels are left `null` and `mergeInngestChannel` is what carries forward what
 * they already knew: a compiled sync must never erase what a walk saw, and a walk must never erase the
 * catalogue.
 */
import { absentAs } from "#lib/absent.js";
import type { InngestDashboardRoute } from "./dashboardRoutes.js";
import { INNGEST_DASHBOARD_ORIGIN } from "./dashboardRoutes.js";
import type { InngestDispositionVerdict } from "./dispositions.js";
import { inngestEntityId } from "./identity.js";
import type {
  InngestArtifactRef,
  InngestAtlasEntity,
  InngestChannel,
  InngestChannelEntity,
  InngestKind,
  InngestProbeEvidence,
  InngestSource,
} from "./model.js";
import { INNGEST_GRAPHQL_OPERATION_KIND, INNGEST_OPERATION_KIND, INNGEST_PAGE_KIND } from "./model.js";
import type { InngestCatalogueOperation } from "./restCatalogue.js";
import { INNGEST_REST_ORIGIN, inngestOperationProviderId } from "./restCatalogue.js";

/**
 * What a probe established about one address, carried from the sync into a projection.
 *
 * `note` is NOT nullable, unlike the `probeNote` its stored row carries. Every producer here has something
 * to say — the address and its answer, the control that agreed, or why nothing was sent — so a nullable one
 * would only ever be rendered as an empty string, and a sentence assembled around an empty string is the
 * silent-degradation shape `house-rules` bans.
 */
export interface InngestProbeOutcome {
  readonly evidence: InngestProbeEvidence;
  /** The exact address probed and what it answered, or why nothing was sent. */
  readonly note: string;
}

/** One channel's view, wrapped so a projection never has to spell the four timestamps. */
function observedChannel({
  channel,
  detail,
  source,
  at,
}: {
  channel: InngestChannel;
  detail: unknown;
  source: InngestSource;
  at: string;
}): InngestChannelEntity {
  return { channel, detail, firstSeenAt: at, lastSeenAt: at, source, state: "observed" };
}

/** An entity carrying only the named channel. */
function entityWith({
  kind,
  providerId,
  channel,
  observation,
}: {
  kind: InngestKind;
  providerId: string;
  channel: InngestChannel;
  observation: InngestChannelEntity;
}): InngestAtlasEntity {
  const channels = { api: null, browser: null, compiled: null };
  return {
    channels: { ...channels, [channel]: observation },
    id: inngestEntityId({ kind, providerId }),
    kind,
    providerId,
  };
}

/**
 * Project one catalogued REST operation into its compiled-channel entity.
 *
 * @param operation the operation exactly as the published catalogue declares it
 * @param disposition what this atlas may do with it, and the rule that decided
 * @param probe what an unauthenticated request established about its address
 * @param at this run's ISO timestamp
 * @returns the entity, carrying the compiled channel alone
 */
export function projectInngestOperation({
  operation,
  disposition,
  probe,
  at,
}: {
  operation: InngestCatalogueOperation;
  disposition: InngestDispositionVerdict;
  probe: InngestProbeOutcome;
  at: string;
}): InngestAtlasEntity {
  const providerId = inngestOperationProviderId({ operation });
  return entityWith({
    channel: "compiled",
    kind: INNGEST_OPERATION_KIND,
    observation: observedChannel({
      at,
      channel: "compiled",
      detail: {
        description: operation.description,
        disposition: disposition.disposition,
        dispositionReason: disposition.reason,
        group: operation.group,
        host: INNGEST_REST_ORIGIN,
        operationId: operation.operationId,
        probeEvidence: probe.evidence,
        probeNote: probe.note,
        referenceUrl: operation.referenceUrl,
        title: operation.title,
        version: operation.version,
      },
      source: {
        artifacts: [],
        deepLink: operation.referenceUrl,
        deepLinkStatus: "provider-provided",
        endpoint: operation.referenceUrl,
        channel: "compiled" as const,
        observedAt: at,
      },
    }),
    providerId,
  });
}

/**
 * Project one declared dashboard route into its compiled-channel entity.
 *
 * The deep link is `unverified` for a parameterised route and `provider-provided` otherwise, because the
 * route table is the provider's own statement of the address while a `$param` address is not one a human can
 * open. What a walk later adds is the browser channel; this never claims a page was rendered.
 *
 * @param route the route the application's own table declares
 * @param probedUrl the concrete address this run probed, or `null` when the route has none
 * @param probe what the probe established about it
 * @param at this run's ISO timestamp
 * @returns the entity, carrying the compiled channel alone
 */
export function projectInngestRoute({
  route,
  probedUrl,
  probe,
  at,
}: {
  route: InngestDashboardRoute;
  probedUrl: string | null;
  probe: InngestProbeOutcome;
  at: string;
}): InngestAtlasEntity {
  return entityWith({
    channel: "compiled",
    kind: INNGEST_PAGE_KIND,
    observation: observedChannel({
      at,
      channel: "compiled",
      detail: {
        parameterised: route.parameterised,
        probeEvidence: probe.evidence,
        probedUrl,
        probeNote: probe.note,
        routePath: route.routePath,
        section: route.section,
      },
      source: {
        artifacts: [],
        deepLink: probedUrl,
        deepLinkStatus: probedUrl === null ? "unverified" : "provider-provided",
        endpoint: `${INNGEST_DASHBOARD_ORIGIN}${route.routePath}`,
        channel: "compiled" as const,
        observedAt: at,
      },
    }),
    providerId: route.routePath,
  });
}

/**
 * Project one walked page into its browser-channel entity.
 *
 * The screenshot rides on the source as an artifact addressed by digest, because the ruling is that the
 * atlas HOLDS the picture rather than a link to one. The deep link is the declared route rather than the
 * address actually visited: a visited address carries the environment slug, and an entity's own link is a
 * thing a reader opens rather than a private identifier this atlas writes down.
 *
 * @param page what the walk saw
 * @param section the dashboard section the compiled channel recorded for this route
 * @param at this run's ISO timestamp
 * @returns the entity, carrying the browser channel alone
 */
export function projectInngestWalkedPage({
  page,
  section,
  at,
}: {
  page: {
    readonly artifacts: readonly InngestArtifactRef[];
    readonly calls: readonly { readonly method: string }[];
    readonly captureComplete: boolean;
    readonly finalUrl: string;
    readonly observedAt: string;
    readonly redirected: boolean;
    readonly responseAccounting: { bodyFailed: number; bodySucceeded: number; eligible: number; seen: number };
    readonly statusCode: number | null;
    readonly surface: string;
    readonly title: string;
    readonly unreachableBecause: string | null;
  };
  section: string;
  at: string;
}): InngestAtlasEntity {
  return entityWith({
    channel: "browser",
    kind: INNGEST_PAGE_KIND,
    observation: observedChannel({
      at,
      channel: "browser",
      detail: {
        callCount: page.calls.length,
        captureComplete: page.captureComplete,
        finalUrl: page.finalUrl,
        redirected: page.redirected,
        responseAccounting: page.responseAccounting,
        section,
        statusCode: page.statusCode,
        title: page.title,
        unreachableBecause: page.unreachableBecause,
      },
      source: {
        artifacts: [...page.artifacts],
        channel: "browser" as const,
        deepLink: `${INNGEST_DASHBOARD_ORIGIN}${page.surface}`,
        deepLinkStatus: "browser-discovered",
        endpoint: page.surface,
        // A page the walk never ASKED FOR carries an empty `observedAt` from the kit's placeholder, and the
        // stored schema requires an ISO instant. MEASURED: one such row refused a whole walk's publish with
        // `Invalid ISO datetime` after the walk had already driven every page before it. The run's own
        // timestamp is the honest substitute — the observation is that this page was not reached, and that was observed now.
        observedAt: page.observedAt === "" ? at : page.observedAt,
      },
    }),
    providerId: page.surface,
  });
}

/** One observed GraphQL call, reduced to what a row needs. */
interface ObservedGraphqlCall {
  readonly host: string;
  readonly operationName: string | null;
  readonly operationType: "query" | "mutation" | "subscription" | "unnamed" | null;
  readonly rootFields: readonly string[];
}

/** What every sighting of one named operation added up to. */
interface GraphqlOperationTally {
  host: string;
  onPages: Set<string>;
  rootFields: Set<string>;
  type: "query" | "mutation" | "subscription" | "unnamed";
}

/** The tally already held for one operation name, or a fresh one opened by this call, its first sighting. */
function tallyFor({
  rows,
  name,
  host,
  type,
}: {
  rows: ReadonlyMap<string, GraphqlOperationTally>;
  name: string;
  host: string;
  type: GraphqlOperationTally["type"];
}): GraphqlOperationTally {
  const held = rows.get(name);
  if (held !== undefined) {
    return held;
  }
  return { host, onPages: new Set<string>(), rootFields: new Set<string>(), type };
}

/**
 * Fold every walked page's GraphQL calls into one tally per operation NAME.
 *
 * @param pages what the walk saw, each carrying its reduced calls
 * @returns one tally per distinct operation name
 */
function tallyGraphqlOperations({
  pages,
}: {
  pages: readonly { readonly surface: string; readonly calls: readonly ObservedGraphqlCall[] }[];
}): ReadonlyMap<string, GraphqlOperationTally> {
  const rows = new Map<string, GraphqlOperationTally>();
  for (const page of pages) {
    for (const call of page.calls) {
      if (call.operationType === null) {
        continue;
      }
      const name = absentAs({ value: call.operationName, whenAbsent: "(unnamed)" });
      const type = call.operationName === null ? "unnamed" : call.operationType;
      const held = tallyFor({ host: call.host, name, rows, type });
      held.onPages.add(page.surface);
      call.rootFields.forEach((field) => held.rootFields.add(field));
      rows.set(name, held);
    }
  }
  return rows;
}

/**
 * Project the GraphQL operations one walk observed into browser-channel entities.
 *
 * Keyed on the operation's own NAME rather than on a path shape, because every operation is posted to the
 * same `/gql` address — see `browserReduction.ts`. An operation the client sent with no readable document
 * becomes one `unnamed` row carrying the pages it happened on, so traffic the walk could not name is a
 * number rather than a silence.
 *
 * @param pages what the walk saw, each carrying its reduced calls
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation, sorted by name
 */
export function projectInngestGraphqlOperations({
  pages,
  at,
}: {
  pages: readonly { readonly surface: string; readonly calls: readonly ObservedGraphqlCall[] }[];
  at: string;
}): readonly InngestAtlasEntity[] {
  return [...tallyGraphqlOperations({ pages }).entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([operationName, row]) =>
      entityWith({
        channel: "browser",
        kind: INNGEST_GRAPHQL_OPERATION_KIND,
        observation: observedChannel({
          at,
          channel: "browser",
          detail: {
            onPages: [...row.onPages].toSorted((left, right) => left.localeCompare(right)),
            operationName,
            operationType: row.type,
            origin: `https://${row.host}`,
            rootFields: [...row.rootFields].toSorted((left, right) => left.localeCompare(right)),
          },
          source: {
            artifacts: [],
            channel: "browser" as const,
            deepLink: null,
            deepLinkStatus: "browser-discovered",
            endpoint: `POST https://${row.host}/gql ${operationName}`,
            observedAt: at,
          },
        }),
        providerId: operationName,
      }),
    );
}
