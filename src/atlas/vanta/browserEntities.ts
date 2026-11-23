/**
 * What a walk saw, as the `browser-page` and `browser-operation` entities on the `browser` channel.
 *
 * Pure: observations in, entity records out. `browserSurface.ts` is the caller, and grades, gaps and
 * publishes what these build.
 */
import { type VantaObservedCall, vantaCallProviderId } from "./browserReduction.js";
import type { VantaPageObservation } from "./browserWalk.js";
import { vantaEntityId } from "./identity.js";
import type { VantaArtifactRef, VantaChannelEntity, VantaEntity } from "./model.js";

/**
 * The browser channel's source record for one entity — the page it was seen on, when, and what proves it.
 *
 * @param url the address the browser settled on
 * @param at when it was seen
 * @param artifacts the verified screenshot backing this look, empty when there is none
 * @returns the channel record
 */
function browserSource({
  url,
  at,
  artifacts,
}: {
  url: string;
  at: string;
  artifacts: readonly VantaArtifactRef[];
}): VantaChannelEntity {
  return {
    channel: "browser",
    detail: null,
    firstSeenAt: at,
    lastSeenAt: at,
    source: {
      artifacts: [...artifacts],
      channel: "browser",
      deepLink: url,
      deepLinkStatus: "browser-discovered",
      endpoint: url,
      observedAt: at,
    },
    state: "observed",
  };
}

/**
 * The browser channel for a page that was never observed: this run's instant, and no source at all.
 *
 * @param at this run's ISO timestamp
 * @returns the channel record
 */
function unobservedSource({ at }: { at: string }): VantaChannelEntity {
  return { channel: "browser", detail: null, firstSeenAt: at, lastSeenAt: at, source: null, state: "observed" };
}

/**
 * One declared page, as an entity. Its detail carries the reachability verdict and the accounting.
 *
 * ## A page that was never OBSERVED carries no source, and that is a schema fact rather than tidiness
 *
 * MEASURED on the first live run of the migrated walk: some declared pages came back
 * unattempted or failed, and the engine's own row for those carries `observedAt: ""` and `finalUrl: ""` —
 * honestly, because nothing was seen. Building a source out of those refused the WHOLE generation, with
 * `Invalid ISO datetime; Invalid URL; Too small` once per such page and `nothing was written`. A source says
 * where a fact was seen and when; there is no such where and no such when for a page nobody reached, so the
 * channel carries `null` and the run's own timestamp, and the detail carries the reason. The alternative —
 * inventing an instant and an address — is what makes an unreached page indistinguishable from a reached
 * one two files later.
 *
 * @param page the observation
 * @param at this run's ISO timestamp, used when the page has no instant of its own
 * @returns the entity
 */
export function pageEntity({ page, at }: { page: VantaPageObservation; at: string }): VantaEntity {
  const observed = page.observedAt !== "" && page.finalUrl !== "";
  const channel = observed
    ? browserSource({ artifacts: page.artifacts, at: page.observedAt, url: page.finalUrl })
    : unobservedSource({ at });
  return {
    channels: {
      browser: {
        ...channel,
        detail: {
          attempted: page.attempted,
          captureComplete: page.captureComplete,
          finalUrl: page.finalUrl,
          operationCount: page.calls.length,
          redirected: page.redirected,
          responseAccounting: page.responseAccounting,
          screenshotMissingBecause: page.screenshotMissingBecause,
          statusCode: page.statusCode,
          surface: page.surface,
          title: page.title,
          unreachableBecause: page.unreachableBecause,
        },
      },
      "manage-api": null,
    },
    financialDetail: null,
    id: vantaEntityId({ components: { providerId: page.surface }, kind: "browser-page" }),
    kind: "browser-page",
    providerId: page.surface,
    sensitivity: null,
  };
}

/**
 * Fold every page's calls into one entity per distinct operation, recording which pages made it.
 *
 * A page the client would not render contributes NOTHING, and that filter is the point rather than a
 * tidiness. Vanta's client is a single-page app: a route it has never heard of still paints a chrome full
 * of first-party GraphQL calls, so a not-found page's navigation calls would otherwise be stored as
 * evidence that the surface behind them was covered — the exact failure `VANTA_NOT_FOUND_TITLE` exists to
 * catch, one layer along. The page's own row still carries them, because what the client asked for is a
 * fact; what it is not is corroboration.
 *
 * @returns one entity per distinct operation, ordered by provider id
 */
export function operationEntities({ pages }: { pages: readonly VantaPageObservation[] }): readonly VantaEntity[] {
  const byId = new Map<string, { call: VantaObservedCall; surfaces: Set<string>; at: string; url: string }>();
  for (const page of pages.filter((candidate) => candidate.unreachableBecause === null)) {
    for (const call of page.calls) {
      const id = vantaCallProviderId({ call });
      const existing = byId.get(id);
      if (existing === undefined) {
        byId.set(id, { at: page.observedAt, call, surfaces: new Set([page.surface]), url: page.finalUrl });
        continue;
      }
      existing.surfaces.add(page.surface);
      // Widen the observed field set rather than letting the last page seen win: a call made on two pages
      // can return different fields on each, and keeping only one of those understates the surface.
      const fields = new Set([...existing.call.responseFields, ...call.responseFields]);
      existing.call = { ...existing.call, responseFields: [...fields].toSorted() };
    }
  }
  return [...byId.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([id, seen]): VantaEntity => {
      const channel = browserSource({ artifacts: [], at: seen.at, url: seen.url });
      return {
        channels: {
          browser: {
            ...channel,
            detail: {
              method: seen.call.method,
              operation: seen.call.operation,
              pathShape: seen.call.pathShape,
              responseFields: seen.call.responseFields,
              seenOnSurfaces: [...seen.surfaces].toSorted(),
              statusCode: seen.call.statusCode,
            },
          },
          "manage-api": null,
        },
        financialDetail: null,
        id: vantaEntityId({ components: { providerId: id }, kind: "browser-operation" }),
        kind: "browser-operation",
        providerId: id,
        sensitivity: null,
      };
    });
}
