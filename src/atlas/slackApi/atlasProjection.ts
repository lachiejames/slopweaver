/**
 * Turn one API read and one driven-browser session into atlas entities, coverage cells and gaps.
 *
 * Pure — every function here takes rows and returns rows. The SDK typings are read by the CLI shell and the
 * walk's own document is parsed by `drivenSession.ts`; what happens to what it found happens here, so the matching
 * rule, the disagreement detection and the coverage arithmetic are all testable with three literals.
 *
 * ## The match is the dotted method name, byte-exact
 *
 * Owner's call. Two surfaces contribute to one entity only when they name the same method
 * identically, and a name present on one surface alone becomes a RECORD rather than a match failure — see
 * `atlasModel.ts`'s header for the three outcomes and why a fuzzier rule would delete the finding.
 *
 * ## A disagreement is a gap, never a resolution
 *
 * `kit/gaps.ts` already says why: a resolver that quietly preferred one surface would destroy the signal
 * the second surface was added to produce. So {@link disagreementGaps} raises what differs and picks
 * nothing.
 */

import { incrementCount } from "#lib/collections.js";
import { stableEntityId } from "../kit/identity.js";
import {
  SLACK_ATLAS_PLATFORM,
  type SlackArtifactRef,
  type SlackAtlasChannel,
  type SlackAtlasEntity,
  type SlackChannelEntity,
} from "./atlasModel.js";
import type { CapturedCall } from "./harObservations.js";
import { observationsFromCalls } from "./harObservations.js";
import { type SdkMethod, TELEMETRY_PARAM } from "./model.js";
import { type SlackSurfacePage, type SlackSurfaceRoots, surfacePageKey, surfacePageUrl } from "./surfacePages.js";

/**
 * One page a driven browser actually visited, and everything that page produced.
 *
 * This is the handoff between the effectful browser leg and this pure one. `calls` are already reduced to
 * names by the caller; nothing here ever sees a body.
 */
export interface DrivenPage {
  /** The page's own path, which is its provider key — e.g. `/client/<workspace>/browse-channels`. */
  readonly path: string;
  /** The address the browser settled on, which a redirect may have changed. */
  readonly url: string;
  readonly title: string;
  /** Every `/api/<method>` call this page caused, reduced to names by the caller. */
  readonly calls: readonly CapturedCall[];
  /** The proof screenshot, or `null` when the page could be reached but not photographed. */
  readonly screenshot: SlackArtifactRef | null;
  /** Why there is no screenshot, when there is none. See `drivenSession.ts` for why this is not a boolean. */
  readonly screenshotMissingBecause: string | null;
  readonly observedAt: string;
}

/** A page the driven browser could not reach at all, and why. Becomes a gap, never a silent omission. */
export interface UnreachablePage {
  readonly path: string;
  readonly reason: string;
}

/**
 * Both halves of the SDK's declared response shape, flattened to one sorted path list.
 *
 * @param method the SDK row to read
 * @returns every declared response path, top level and one level down, deduplicated and sorted
 */
export function sdkResponsePaths({ method }: { method: SdkMethod }): readonly string[] {
  const top = method.responseFields.map((field) => field.name);
  const nested = Object.entries(method.responseNested).flatMap(([parent, names]) =>
    names.map((name) => `${parent}[].${name}`),
  );
  return [...new Set([...top, ...nested])].toSorted();
}

/** The stable id for one entity of one kind, matched on the provider's own key. */
function entityIdFor({ kind, providerId }: { kind: string; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `${SLACK_ATLAS_PLATFORM}:${kind}` });
}

/** One freshly observed channel view, stamped with this run's instant on both ends. */
function observedChannel({
  channel,
  detail,
  source,
  at,
}: {
  channel: SlackAtlasChannel;
  detail: unknown;
  source: SlackChannelEntity["source"];
  at: string;
}): SlackChannelEntity {
  return { channel, detail, firstSeenAt: at, lastSeenAt: at, source, state: "observed" };
}

/**
 * Project every method the installed SDK declares into an entity carrying only its `api` channel.
 *
 * The deep link is `unverified` rather than `provider-provided`: the SDK hands back no URL at all, and a
 * documentation address assembled from the method name is a guess this atlas has not checked. Stating that
 * honestly is the whole reason `deepLinkStatus` exists as a separate field from `deepLink`.
 *
 * @param methods every method the installed SDK declares
 * @param at this run's ISO timestamp
 * @returns one entity per method, `browser` channel empty, sorted by id
 */
export function projectApiMethods({
  methods,
  at,
}: {
  methods: readonly SdkMethod[];
  at: string;
}): readonly SlackAtlasEntity[] {
  return methods
    .map((method): SlackAtlasEntity => {
      const detail = {
        description: method.description,
        paramNames: method.params.map((param) => param.name).toSorted(),
        responsePaths: sdkResponsePaths({ method }),
      };
      return {
        channels: {
          api: observedChannel({
            at,
            channel: "api",
            detail,
            source: {
              artifacts: [],
              channel: "api",
              deepLink: null,
              deepLinkStatus: "unverified",
              endpoint: `/api/${method.name}`,
              observedAt: at,
            },
          }),
          browser: null,
        },
        id: entityIdFor({ kind: "method", providerId: method.name }),
        kind: "method",
        providerId: method.name,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/** What one walk saw about each method, accumulated across its pages. */
interface CallTally {
  /** The first page that caused each method's call — which decides its `browser-discovered` deep link. */
  readonly firstSighting: ReadonlyMap<string, DrivenPage>;
  readonly callCounts: ReadonlyMap<string, number>;
  /**
   * The FULL observed parameter set per method, not the diff `observationsFromCalls` returns. A channel
   * stores what it SAW; computing "which of these the SDK never declared" against the other channel's own
   * record is `disagreement.ts`'s job. Storing the diff here would make the browser channel unreadable on
   * its own, and would silently change meaning the day the SDK gained a parameter.
   */
  readonly observedParams: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The parameters a method has been seen with so far, or a fresh empty set the first time it is called. */
function paramsSoFar({ held }: { held: Set<string> | undefined }): Set<string> {
  if (held == null) {
    return new Set<string>();
  }
  return held;
}

/**
 * Accumulate what the walk saw about each method, walking the pages in the order they were driven.
 *
 * @param pages every page the driven browser reached, in walk order
 * @returns the per-method tallies
 */
function tallyCalls({ pages }: { pages: readonly DrivenPage[] }): CallTally {
  const firstSighting = new Map<string, DrivenPage>();
  const callCounts = new Map<string, number>();
  const observedParams = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const call of page.calls) {
      incrementCount({ counts: callCounts, key: call.name });
      const params = paramsSoFar({ held: observedParams.get(call.name) });
      for (const param of call.paramNames.filter((name) => !TELEMETRY_PARAM.test(name))) {
        params.add(param);
      }
      observedParams.set(call.name, params);
      if (!firstSighting.has(call.name)) {
        firstSighting.set(call.name, page);
      }
    }
  }
  return { callCounts, firstSighting, observedParams };
}

/**
 * Project what the driven browser saw into entities carrying only their `browser` channel.
 *
 * Every deep link here is `browser-discovered`, and it is the state only a driven browser can write: the
 * link is the address the browser was actually standing on when the call went out, not one any provider
 * handed back. A method seen on several pages keeps the FIRST page's address, which is deterministic
 * because the caller walks its page list in a fixed order.
 *
 * @param pages every page the driven browser reached, in the order it walked them
 * @param sdkMethodNames every method the installed SDK declares, so `publicSurface` is measured not assumed
 * @param sdkParamsByMethod each SDK method's declared argument names, so undocumented params are a real diff
 * @returns one entity per method the browser called, `api` channel empty, sorted by id
 */
export function projectBrowserMethods({
  pages,
  sdkMethodNames,
  sdkParamsByMethod,
}: {
  pages: readonly DrivenPage[];
  sdkMethodNames: ReadonlySet<string>;
  sdkParamsByMethod: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly SlackAtlasEntity[] {
  const rows = observationsFromCalls({
    calls: pages.flatMap((page) => page.calls),
    sdkMethodNames,
    sdkParamsByMethod,
  });
  const { callCounts, firstSighting, observedParams } = tallyCalls({ pages });
  return rows
    .map((row): SlackAtlasEntity => {
      // Every row came from a call on one of these pages, and `tallyCalls` records a first sighting, a count
      // and a parameter set for every call it walks, so all three always exist. Honest assertions rather than
      // fallbacks: a synthesised empty timestamp would publish a record claiming to have been observed at no
      // time at all, and a defaulted count would publish a frequency nobody measured.
      const page = firstSighting.get(row.name)!;
      return {
        channels: {
          api: null,
          browser: observedChannel({
            at: page.observedAt,
            channel: "browser",
            detail: {
              callCount: callCounts.get(row.name)!,
              paramNames: [...observedParams.get(row.name)!].toSorted(),
              responsePaths: [...row.responsePaths],
              responsePathsTotal: row.responsePathsTotal,
            },
            source: {
              artifacts: page.screenshot === null ? [] : [page.screenshot],
              channel: "browser",
              deepLink: page.url,
              deepLinkStatus: "browser-discovered",
              endpoint: `/api/${row.name}`,
              observedAt: page.observedAt,
            },
          }),
        },
        id: entityIdFor({ kind: "method", providerId: row.name }),
        kind: "method",
        providerId: row.name,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Project each page the driven browser walked into its own entity, holding its screenshot.
 *
 * A page has no API counterpart and never will — the `api` channel stays `null` permanently rather than
 * pending, which is the honest reading of "there are things via the browser you can't get by API".
 *
 * @param pages every page the driven browser reached
 * @returns one entity per page, sorted by id
 */
export function projectPages({ pages }: { pages: readonly DrivenPage[] }): readonly SlackAtlasEntity[] {
  return pages
    .map((page): SlackAtlasEntity => {
      const detail = { apiCallCount: page.calls.length, title: page.title, url: page.url };
      return {
        channels: {
          api: null,
          browser: observedChannel({
            at: page.observedAt,
            channel: "browser",
            detail,
            source: {
              artifacts: page.screenshot === null ? [] : [page.screenshot],
              channel: "browser",
              deepLink: page.url,
              deepLinkStatus: "browser-discovered",
              endpoint: page.path,
              observedAt: page.observedAt,
            },
          }),
        },
        id: entityIdFor({ kind: "page", providerId: page.path }),
        kind: "page",
        providerId: page.path,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Combine the two surfaces' method entities into one list, matched byte-exactly on the dotted name.
 *
 * Each channel is written independently and neither erases the other: an entity seen by one surface keeps
 * the other's `null` slot, which is what makes "browser only" and "api only" readable off the file with
 * `jq` rather than derivable by a consumer.
 *
 * @param api the entities projected from the SDK
 * @param browser the entities projected from the driven browser
 * @returns one entity per distinct method, both channels folded in, sorted by id
 */
export function matchMethodSurfaces({
  api,
  browser,
}: {
  api: readonly SlackAtlasEntity[];
  browser: readonly SlackAtlasEntity[];
}): readonly SlackAtlasEntity[] {
  const byId = new Map<string, SlackAtlasEntity>();
  for (const entity of api) {
    byId.set(entity.id, entity);
  }
  for (const entity of browser) {
    const existing = byId.get(entity.id);
    if (existing === undefined) {
      byId.set(entity.id, entity);
      continue;
    }
    byId.set(entity.id, {
      ...existing,
      channels: { api: existing.channels.api, browser: entity.channels.browser },
    });
  }
  return [...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Project the DECLARED surface map into `page` entities, whether or not a walk ever reached them.
 *
 * This is the owner's floor made mechanical: _"we should at least know all the pages that exist."_ A walk
 * reports where it went, so a page nobody visited leaves no trace in a walk-only projection — the same
 * invisibility `slack.ts` removes one level down for channels nobody has read. Declaring the denominator
 * here is what lets the atlas NAME a page it did not reach.
 *
 * The declaration lands on the `api` channel and the witness on `browser`, which is what makes
 * declared-versus-seen readable straight off the file with `jq` rather than derivable by a consumer. That
 * is a change of meaning for this kind and it is deliberate: `projectPages`'s old note that a page's `api`
 * channel "stays `null` permanently" was true only while nothing declared pages, and the same split is
 * what `graphqlHive/projection.ts` already does with its console routes.
 *
 * Every deep link is `unverified` — the address is composed from a declared template and this run has not
 * stood on it — except for a page with no address at all, whose link is `unavailable` because the platform
 * offers none rather than because nobody looked.
 *
 * @param pages the declared surface map
 * @param roots where the roots hang for this installation
 * @param at this run's ISO timestamp
 * @returns one entity per declared page, `browser` channel empty, sorted by id
 */
export function projectDeclaredPages({
  pages,
  roots,
  at,
}: {
  pages: readonly SlackSurfacePage[];
  roots: SlackSurfaceRoots;
  at: string;
}): readonly SlackAtlasEntity[] {
  return pages
    .map((page): SlackAtlasEntity => {
      const providerId = surfacePageKey({ page });
      const addressable = page.notNavigableBecause === null;
      const detail = {
        contentsHeldBy: page.contentsHeldBy,
        needsAdmin: page.needsAdmin,
        notNavigableBecause: page.notNavigableBecause,
        purpose: page.purpose,
        screenshotPolicy: page.screenshot,
      };
      return {
        channels: {
          api: observedChannel({
            at,
            channel: "api",
            detail,
            source: {
              artifacts: [],
              channel: "api",
              deepLink: addressable ? surfacePageUrl({ page, roots }) : null,
              deepLinkStatus: addressable ? "unverified" : "unavailable",
              endpoint: providerId,
              observedAt: at,
            },
          }),
          browser: null,
        },
        id: entityIdFor({ kind: "page", providerId }),
        kind: "page",
        providerId,
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}
