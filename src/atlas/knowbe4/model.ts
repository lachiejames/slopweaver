/**
 * The KnowBe4 atlas's on-disk vocabulary — the generation `sync` publishes, and the schemas that refuse to
 * trust it.
 *
 * ## An integration returns to the kit only when a real use case exists
 *
 * A KnowBe4 atlas that answered nothing is not kept; one returns when a real use case exists. The use case is
 * that the Vanta ↔ KnowBe4 group mapping needs to know which KnowBe4 groups exist, who is in each and which groups each training campaign enrols, and the
 * policy-acceptance update prompt needs each person's incomplete enrolments. The kinds below are
 * the original atlas's, less the two browser-console kinds and `user-event-type` (the User Events API is a separate product on a
 * separate host), held in the shape every current atlas shares (`kit/channelSchemas.ts`).
 *
 * ## This atlas holds EVERYTHING REACHABLE
 *
 * `docs/atlas-intent/06-holdings.md`'s test: does something better suited already hold these entities? No. Vanta's
 * own KnowBe4 connector reads completion back into Vanta's training tests, but holds neither the groups, nor
 * which campaign enrols which group, nor a phishing result per person — so the records are kinds here.
 *
 * ## Two channels, and only `api` is ever filled
 *
 * `api` is the KMSAT Reporting API under a bearer token the owner mints. `browser` is the KMSAT console,
 * declared because the shared shape wants every channel named up front; no surface fills it today, and the
 * descriptor says why.
 */
import { z } from "zod";

import { channelSchemas } from "../kit/channelSchemas.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const KNOWBE4_ATLAS_SCHEMA_VERSION = 1;

/** The platform discriminator. ONE per SaaS app. */
export const KNOWBE4_ATLAS_PLATFORM = "knowbe4";

/**
 * The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing.
 *
 * `group-member` is an edge rather than a field on `user` because a training campaign is aimed at GROUPS, so
 * "who was in scope for this campaign" is unanswerable from a user record and a campaign record alone.
 * `phishing-recipient` is one person's row in one phishing RUN (`phishing-security-test`) — delivered,
 * opened, clicked, reported — and is not derivable from the run it belongs to.
 */
export const KNOWBE4_ATLAS_KINDS = [
  "account",
  "group",
  "group-member",
  "phishing-campaign",
  "phishing-recipient",
  "phishing-security-test",
  "policy",
  "store-purchase",
  "training-campaign",
  "training-enrollment",
  "user",
] as const;

export type Knowbe4AtlasKind = (typeof KNOWBE4_ATLAS_KINDS)[number];

/** How a fact was reached. Each channel owns independent presence and detail. */
export const KNOWBE4_ATLAS_CHANNELS = ["api", "browser"] as const;

/**
 * The claim boundary a coverage cell carries, one per channel: the `api` channel sees what the account's
 * Reporting API token and its subscription tier open; the `browser` channel would see what the signed-in
 * admin's console role renders.
 *
 * @internal
 */
export const KNOWBE4_VISIBILITY_SCOPES = ["api-reporting-token-and-tier", "browser-signed-in-role"] as const;

/**
 * The stored vocabulary this atlas shares with every other two-channel one, specialised to KnowBe4.
 * `kit/channelSchemas.ts` owns the shape and says why.
 */
const shared = channelSchemas({
  // Spelled out rather than assembled from the tuple — see `kit/channelSchemas.ts`'s `channelSlots`.
  channelSlots: ({ channelEntity }) =>
    z.object({
      api: channelEntity.nullable(),
      browser: channelEntity.nullable(),
    }),
  manifestKinds: ({ kindStatus }) =>
    z.object({
      account: kindStatus,
      group: kindStatus,
      "group-member": kindStatus,
      "phishing-campaign": kindStatus,
      "phishing-recipient": kindStatus,
      "phishing-security-test": kindStatus,
      policy: kindStatus,
      "store-purchase": kindStatus,
      "training-campaign": kindStatus,
      "training-enrollment": kindStatus,
      user: kindStatus,
    }),
  channels: KNOWBE4_ATLAS_CHANNELS,
  kinds: KNOWBE4_ATLAS_KINDS,
  platform: KNOWBE4_ATLAS_PLATFORM,
  schemaVersion: KNOWBE4_ATLAS_SCHEMA_VERSION,
  visibilityScopes: KNOWBE4_VISIBILITY_SCOPES,
});

/** One kind's file on disk. */
export const knowbe4AtlasKindFileSchema = shared.kindFile;

export type Knowbe4AtlasKindFile = z.infer<typeof knowbe4AtlasKindFileSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const knowbe4AtlasManifestSchema = shared.manifest;

export type Knowbe4AtlasManifest = z.infer<typeof knowbe4AtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialKnowbe4Manifest({ updatedAt }: { updatedAt: string }): Knowbe4AtlasManifest {
  return shared.initialManifest({ updatedAt });
}

/**
 * One empty kind file per kind — what `reset` installs and what `sync` builds each generation over.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyKnowbe4KindFiles({
  at,
}: {
  at: string;
}): Readonly<Record<Knowbe4AtlasKind, Knowbe4AtlasKindFile>> {
  return {
    account: shared.emptyKindFile({ kind: "account", updatedAt: at }),
    group: shared.emptyKindFile({ kind: "group", updatedAt: at }),
    "group-member": shared.emptyKindFile({ kind: "group-member", updatedAt: at }),
    "phishing-campaign": shared.emptyKindFile({ kind: "phishing-campaign", updatedAt: at }),
    "phishing-recipient": shared.emptyKindFile({ kind: "phishing-recipient", updatedAt: at }),
    "phishing-security-test": shared.emptyKindFile({ kind: "phishing-security-test", updatedAt: at }),
    policy: shared.emptyKindFile({ kind: "policy", updatedAt: at }),
    "store-purchase": shared.emptyKindFile({ kind: "store-purchase", updatedAt: at }),
    "training-campaign": shared.emptyKindFile({ kind: "training-campaign", updatedAt: at }),
    "training-enrollment": shared.emptyKindFile({ kind: "training-enrollment", updatedAt: at }),
    user: shared.emptyKindFile({ kind: "user", updatedAt: at }),
  };
}
