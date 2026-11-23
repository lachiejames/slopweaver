/**
 * Assembling one two-channel atlas entity — the shape every atlas that keeps an API view and a browser view
 * side by side had written for itself.
 *
 * ## Why the two slots, and why one filled channel at a time
 *
 * `docs/atlas-intent/02-both-surfaces.md` makes both surfaces mandatory because they diverge, and `docs/atlas-intent/04-corroboration.md` makes the divergence an
 * OUTPUT. That only works if one surface succeeding can never erase what the other already knew, so a run
 * projects only the channel it refreshed and leaves the other `null`. The channel-scoped merge then folds
 * it onto whatever the store holds. An entity arriving with both slots filled would defeat the whole design
 * by making every run an assertion about a channel it did not look at.
 *
 * What a platform still owns is its own channel NAMES, its detail shapes and its entity id. This owns only
 * the assembly, which is the part that was identical.
 */
import type { AtlasArtifactRef } from "./contract.js";

/** How a deep link was come by — the kit's own vocabulary, restated here so a caller needs one import. */
export type ChannelDeepLinkStatus = "provider-provided" | "browser-discovered" | "unverified" | "unavailable";

/** One channel's independent view of one entity, as this kit assembles it. */
export interface ChannelView<TChannel extends string> {
  readonly channel: TChannel;
  readonly detail: unknown;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly source: {
    /**
     * Mutable, matching what every atlas's stored Zod schema declares.
     *
     * The array is freshly copied here and handed straight to a schema that wants a mutable one, so a
     * `readonly` view would only force each caller to copy it a second time to satisfy its own store.
     */
    artifacts: AtlasArtifactRef[];
    readonly channel: TChannel;
    readonly deepLink: string | null;
    readonly deepLinkStatus: ChannelDeepLinkStatus;
    readonly endpoint: string;
    readonly observedAt: string;
  };
  readonly state: "observed";
}

/**
 * One channel's view of one entity, stamped with this run's instant.
 *
 * `firstSeenAt` is set to this run and carried BACK by the merge, so an entity observed for weeks does not
 * claim to have been discovered today — the merge owns that correction because only it has seen the stored
 * predecessor.
 *
 * @param channel which channel looked
 * @param detail what that channel knows; the shape is the platform's own
 * @param at this run's ISO timestamp
 * @param endpoint the reproduction handle — the operation, page or document this came from
 * @param deepLink the URL a human opens to see it, or `null`
 * @param deepLinkStatus why the link is absent, when it is
 * @param artifacts the evidence backing this look
 * @returns the channel view
 *
 * @internal
 */
export function channelView<TChannel extends string>({
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
  deepLinkStatus: ChannelDeepLinkStatus;
  artifacts: readonly AtlasArtifactRef[];
}): ChannelView<TChannel> {
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
 * The channel view for one pinned vendor document, whose own URL is both its endpoint and its proof link.
 *
 * Small, and shared because the reasoning is not obvious and was written twice: a published specification
 * document IS the thing a human opens to see that API, and the vendor handed us its address, so the deep
 * link is `provider-provided` rather than `unverified` and the reproduction handle is the same URL. An
 * atlas that filled these differently would report its own specification surface as unlinkable.
 *
 * @param url the pinned document's address — the only one ever fetched
 * @param detail what this channel knows about the document; the shape is the platform's own
 * @param channel the channel this look belongs to
 * @param at this run's ISO timestamp
 * @returns the channel view
 */
export function pinnedDocumentView<TChannel extends string>({
  url,
  detail,
  channel,
  at,
}: {
  url: string;
  detail: unknown;
  channel: TChannel;
  at: string;
}): ChannelView<TChannel> {
  return channelView({
    artifacts: [],
    at,
    channel,
    deepLink: url,
    deepLinkStatus: "provider-provided",
    detail,
    endpoint: url,
  });
}

/**
 * The channel view for one compiled operation, whose proof link is the document that declares it.
 *
 * The `citeUrl` may be absent — an operation compiled from a document no lock row claims has nothing to
 * cite — and the two states are kept distinguishable rather than collapsed: `unavailable` says the provider
 * offers no link, which is a different fact from nobody having looked.
 *
 * @param providerId the reproduction handle — `<METHOD> <path>`, byte-exact, which is what two channels are
 *   matched on
 * @param citeUrl the document a reader should open, or `null` when none is known
 * @param detail what this channel knows about the operation; the shape is the platform's own
 * @param channel the channel this look belongs to
 * @param at this run's ISO timestamp
 * @returns the channel view
 */
export function compiledOperationView<TChannel extends string>({
  providerId,
  citeUrl,
  detail,
  channel,
  at,
}: {
  providerId: string;
  citeUrl: string | null;
  detail: unknown;
  channel: TChannel;
  at: string;
}): ChannelView<TChannel> {
  return channelView({
    artifacts: [],
    at,
    channel,
    deepLink: citeUrl,
    deepLinkStatus: citeUrl === null ? "unavailable" : "provider-provided",
    detail,
    endpoint: providerId,
  });
}

/**
 * The channel view for one thing a driven browser OBSERVED — a page it landed on, or an operation the
 * platform's own client called.
 *
 * Kit-owned because it was copied. Two atlases' walk publishers assembled this object literal
 * byte-identically, differing only in which entity id they stamped beside it, and the clone ratchet said
 * so. The two decisions inside it are the ones a copy loses: an absent link is `unavailable` rather than
 * `unverified`, because "the browser never settled anywhere" is a different fact from "nobody looked"; and
 * the endpoint is the provider id rather than the URL, so the row's reproduction handle is the same key the
 * other channel is matched on.
 *
 * @param at this run's ISO timestamp
 * @param artifacts the proof screenshots backing this look, empty for an observed call
 * @param deepLink where the browser settled, or `null`/`""` when it settled nowhere
 * @param endpoint the provider id — the reproduction handle, and the key the channels are matched on
 * @param detail what this channel knows; the shape is the platform's own
 * @returns the browser channel view
 */
export function browserObservationView({
  at,
  artifacts,
  deepLink,
  endpoint,
  detail,
}: {
  at: string;
  artifacts: readonly AtlasArtifactRef[];
  deepLink: string | null;
  endpoint: string;
  detail: unknown;
}): ChannelView<"browser"> {
  const link = deepLink === null || deepLink === "" ? null : deepLink;
  return channelView({
    artifacts,
    at,
    channel: "browser",
    deepLink: link,
    deepLinkStatus: link === null ? "unavailable" : "browser-discovered",
    detail,
    endpoint,
  });
}
