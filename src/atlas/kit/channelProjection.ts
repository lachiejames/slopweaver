/**
 * The three pieces every multi-channel atlas's projection needs, and nothing that is a platform's.
 *
 * A projection turns what one CHANNEL saw into entities, filling that channel's slot and leaving every
 * other one `null` — which is what makes `merge.ts`'s channel-scoped fold correct: an entity arriving with
 * one channel filled can never blank another. The three functions below are the whole of that mechanism,
 * and the Notion and Trelica projections had each written them.
 *
 * What a platform still owns is the DETAIL it puts in a channel slot and the provider key it matches on.
 * Neither is here, and neither generalises — see `kit/merge.ts`'s header on why a shared entity schema
 * would be the wrong direction.
 */
import type { AtlasArtifactRef, AtlasEntityState } from "./contract.js";

/**
 * One channel's independent view of one entity, as every multi-channel atlas stores it.
 *
 * The arrays here are MUTABLE and the deep-link status is a type parameter, both to match what a Zod
 * `z.infer` produces: a stored schema declares `z.array(...)`, which infers mutable, so a `readonly` here
 * would make every caller copy the kit's own output back into its own shape for no gain.
 *
 * @internal
 */
export interface AtlasChannelView<TChannel extends string, TStatus extends string> {
  readonly channel: TChannel;
  readonly detail: unknown;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly source: {
    artifacts: AtlasArtifactRef[];
    channel: TChannel;
    deepLink: string | null;
    deepLinkStatus: TStatus;
    endpoint: string;
    observedAt: string;
  } | null;
  readonly state: AtlasEntityState;
}

/**
 * One channel's view, stamped with this run's instant. A merge carries `firstSeenAt` back.
 *
 * @param channel which channel observed this
 * @param detail what that channel knows — the platform's own shape, opaque here
 * @param at this run's ISO timestamp
 * @param endpoint the reproduction handle a reader follows back to the source
 * @param deepLink the URL a human opens, or `null`
 * @param deepLinkStatus how that link was come by, which must SAY why an absent one is absent
 * @param artifacts the evidence backing this look — screenshots included
 * @returns the channel view
 */
export function atlasChannelView<TChannel extends string, TStatus extends string>({
  channel,
  detail,
  at,
  endpoint,
  deepLink,
  deepLinkStatus,
  artifacts,
}: {
  channel: TChannel;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  deepLinkStatus: TStatus;
  artifacts: readonly AtlasArtifactRef[];
}): AtlasChannelView<TChannel, TStatus> {
  return {
    channel,
    detail,
    firstSeenAt: at,
    lastSeenAt: at,
    source: { artifacts: [...artifacts], channel, deepLink, deepLinkStatus, endpoint, observedAt: at },
    state: "observed",
  };
}

/**
 * An entity carrying exactly one filled channel, every other slot left as the empty map gave it.
 *
 * @param kind the entity kind
 * @param providerId the provider's own key — what the channels are matched on, byte-exactly
 * @param id the stable identity, which the platform's own namespaced hash produced
 * @param channel which channel this projection filled
 * @param view that channel's view
 * @param empty the platform's own all-null channel map
 * @returns the entity
 */
export function atlasEntityWithChannel<
  TKind extends string,
  TChannel extends string,
  TChannels extends Record<TChannel, unknown>,
  TView,
>({
  kind,
  providerId,
  id,
  channel,
  view,
  empty,
}: {
  kind: TKind;
  providerId: string;
  id: string;
  channel: TChannel;
  view: TView;
  empty: TChannels;
}): { channels: TChannels; id: string; kind: TKind; providerId: string } {
  return { channels: { ...empty, [channel]: view }, id, kind, providerId };
}

/**
 * Deterministic order, so two runs over the same data write identical bytes.
 *
 * @param entities the entities to order
 * @returns the same entities, sorted by id
 */
export function sortedById<TEntity extends { readonly id: string }>({
  entities,
}: {
  entities: readonly TEntity[];
}): readonly TEntity[] {
  return [...entities].toSorted((left, right) => left.id.localeCompare(right.id));
}
