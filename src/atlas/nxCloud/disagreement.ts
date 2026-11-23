/**
 * Where the two surfaces disagree — the OUTPUT, not a resolution.
 *
 * `docs/atlas-intent/04-corroboration.md`: corroboration between the two surfaces is itself a thing the atlas shows, and
 * what a disagreement MEANS is the owner's call, reserved until the owner can see real instances. So this file
 * reports instances and resolves none of them. Both records are kept regardless: one surface succeeding must
 * never erase what the other already knew, which is why `merge.ts` is channel-scoped.
 *
 * ## What the two surfaces actually are here, and why they can differ at all
 *
 * Both present the same credential — the owner's signed-in session — so this is not an API-token-versus-role
 * comparison the way it is for Notion. What differs is the CALLER: `web-data` asks for a loader route
 * directly, while `browser` observes what the rendered client asks for. A client fetches things a direct
 * read never would (its own manifest, its feature flags, a deferred second page), and a direct read can ask
 * for a loader the UI only reaches behind a click. So an operation on one side and not the other is a real
 * finding about the surface rather than an artefact of two different credentials.
 *
 * ## A field one surface has and the other does not is the finer half
 *
 * The same operation can answer with more fields to one caller than the other — a loader that streams a
 * deferred page, say, whose fields exist only once the client has awaited it. Those names are what a reader
 * needs, so a disagreement carries them rather than a count.
 */
import { isRecord } from "../../lib/parsers.js";

import type { NxCloudAtlasEntity } from "./model.js";

/** One operation the two channels do not agree about. */
export interface NxCloudDisagreement {
  /** `<METHOD> <path pattern>` — the operation both channels are keyed on. */
  readonly providerId: string;
  /** Which channels hold this operation at all. */
  readonly heldBy: readonly ("web-data" | "browser")[];
  /** Response field paths the browser channel has and the direct read does not. */
  readonly browserOnlyFields: readonly string[];
  /** Response field paths the direct read has and the browser channel does not. */
  readonly webDataOnlyFields: readonly string[];
  /** Query parameter names the browser channel sends and the direct read does not. */
  readonly browserOnlyParams: readonly string[];
}

/**
 * Read one channel's string-array detail field.
 *
 * @param entity the endpoint entity
 * @param channel which channel to read
 * @param field which detail field
 * @returns the names, or an empty list when the channel has never looked
 */
function names({
  entity,
  channel,
  field,
}: {
  entity: NxCloudAtlasEntity;
  channel: "web-data" | "browser";
  field: string;
}): readonly string[] {
  const held = entity.channels[channel];
  if (held === null) {
    // This channel has never looked at the operation, so it holds no names for it.
    return [];
  }
  if (!isRecord(held.detail)) {
    return [];
  }
  const value = held.detail[field];
  return Array.isArray(value) ? value.filter((entry: unknown): entry is string => typeof entry === "string") : [];
}

/**
 * Every name in `left` that is not in `right`.
 *
 * @param left the names to filter
 * @param right the names to filter against
 * @returns the difference, sorted
 */
function only({ left, right }: { left: readonly string[]; right: readonly string[] }): readonly string[] {
  const held = new Set(right);
  return left.filter((name) => !held.has(name)).toSorted();
}

/**
 * Every operation the two channels disagree about, and exactly how.
 *
 * An operation both channels hold with identical fields and parameters is NOT a disagreement and is absent
 * from the result, because identical surfaces are a fine outcome rather than a wasted pass.
 *
 * @param entities every endpoint entity the generation holds
 * @returns one row per disagreement, sorted by operation
 */
export function nxCloudDisagreements({
  entities,
}: {
  entities: readonly NxCloudAtlasEntity[];
}): readonly NxCloudDisagreement[] {
  return entities
    .filter((entity) => entity.kind === "endpoint")
    .flatMap((entity): readonly NxCloudDisagreement[] => {
      // A STALE channel is one that looked this run and did not find the operation, so counting it as held
      // would report a retired endpoint as a live one-sided finding — which is exactly what happened when
      // this atlas's own inventory changed a path and the old row stayed, correctly, in the generation.
      const heldBy = (["web-data", "browser"] as const).filter(
        (channel) => entity.channels[channel]?.state === "observed",
      );
      const browserFields = names({ channel: "browser", entity, field: "responseFields" });
      const webDataFields = names({ channel: "web-data", entity, field: "responseFields" });
      const browserOnlyFields = only({ left: browserFields, right: webDataFields });
      const webDataOnlyFields = only({ left: webDataFields, right: browserFields });
      const browserOnlyParams = only({
        left: names({ channel: "browser", entity, field: "queryParams" }),
        right: names({ channel: "web-data", entity, field: "queryParams" }),
      });
      const oneSided = heldBy.length === 1;
      if (heldBy.length === 0) {
        return [];
      }
      if (
        !oneSided &&
        browserOnlyFields.length === 0 &&
        webDataOnlyFields.length === 0 &&
        browserOnlyParams.length === 0
      ) {
        return [];
      }
      return [{ browserOnlyFields, browserOnlyParams, heldBy, providerId: entity.providerId, webDataOnlyFields }];
    })
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * What a report prints at the top: how much of the surface the two channels agree about.
 *
 * @internal
 */
export interface NxCloudCorroboration {
  readonly operationCount: number;
  /** Operations both channels hold. */
  readonly bothChannels: number;
  /** Operations only the direct read holds. */
  readonly webDataOnly: number;
  /** Operations only the rendered client was seen to make. */
  readonly browserOnly: number;
  /** Operations both hold that nonetheless differ in fields or parameters. */
  readonly differingDetail: number;
}

/**
 * Count how far the two channels corroborate each other.
 *
 * @param entities every endpoint entity the generation holds
 * @returns the counts a report leads with
 */
export function nxCloudCorroboration({ entities }: { entities: readonly NxCloudAtlasEntity[] }): NxCloudCorroboration {
  const endpoints = entities.filter((entity) => entity.kind === "endpoint");
  const disagreements = nxCloudDisagreements({ entities: endpoints });
  return {
    bothChannels: endpoints.filter(
      (entity) => entity.channels["web-data"]?.state === "observed" && entity.channels.browser?.state === "observed",
    ).length,
    browserOnly: disagreements.filter((row) => row.heldBy.length === 1 && row.heldBy[0] === "browser").length,
    differingDetail: disagreements.filter((row) => row.heldBy.length === 2).length,
    operationCount: endpoints.length,
    webDataOnly: disagreements.filter((row) => row.heldBy.length === 1 && row.heldBy[0] === "web-data").length,
  };
}
