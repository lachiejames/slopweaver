/**
 * The Google SecOps atlas's on-disk vocabulary — the generation the fill will publish, and the schemas that
 * refuse to trust it.
 *
 * ## Every kind is declared before anything fills it
 *
 * The kinds below are the families behind the 39 GET rows of the pinned Chronicle v1 inventory
 * (`generated/surfaces.ts`), grouped by what a reader asks about rather than by proto file. Nothing fills
 * them yet: the fill reads under the SecOps grant, and a kind nothing declares is a kind no generation can
 * publish a non-`synced` state for, so it would read as a kind that does not exist.
 *
 * ## Two channels, and only `api` is ever filled through the API
 *
 * `api` is the Chronicle REST API under the SecOps door's own grant. `browser` is the SecOps console in the
 * owner's own Chrome, declared because the shared shape wants every channel named up front; no surface
 * fills it today, and the owner's ruling that nothing ever writes onto SecOps, neither via API
 * nor the browser, bounds whatever one day does to reading.
 */
import { z } from "zod";

import { channelSchemas } from "../kit/channelSchemas.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const GOOGLE_SECOPS_ATLAS_SCHEMA_VERSION = 1;

/** The platform discriminator. ONE per SaaS app. */
export const GOOGLE_SECOPS_ATLAS_PLATFORM = "google-secops";

/**
 * The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing.
 *
 * `rule` carries rules, their deployments, revisions, retrohunts and execution errors; `dashboard` carries
 * native and featured-content dashboards; `data-access` carries data-access labels and scopes. Long-running
 * `Operations` are not a kind: an operation is the receipt of a write somebody else made, not a thing the
 * instance is configured with.
 */
export const GOOGLE_SECOPS_ATLAS_KINDS = [
  "dashboard",
  "data-access",
  "data-table",
  "feed",
  "findings-refinement",
  "instance",
  "reference-list",
  "rule",
  "watchlist",
] as const;

export type GoogleSecopsAtlasKind = (typeof GOOGLE_SECOPS_ATLAS_KINDS)[number];

/** How a fact was reached. Each channel owns independent presence and detail. */
export const GOOGLE_SECOPS_ATLAS_CHANNELS = ["api", "browser"] as const;

/**
 * The claim boundary a coverage cell carries, one per channel: the `api` channel sees what the granted
 * OAuth scope AND the consenting account's IAM role on the instance's project both open; the `browser`
 * channel would see what the signed-in role renders.
 *
 * @internal
 */
export const GOOGLE_SECOPS_VISIBILITY_SCOPES = ["api-granted-scope-and-iam-role", "browser-signed-in-role"] as const;

/**
 * The stored vocabulary this atlas shares with every other two-channel one, specialised to Google SecOps.
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
      dashboard: kindStatus,
      "data-access": kindStatus,
      "data-table": kindStatus,
      feed: kindStatus,
      "findings-refinement": kindStatus,
      instance: kindStatus,
      "reference-list": kindStatus,
      rule: kindStatus,
      watchlist: kindStatus,
    }),
  channels: GOOGLE_SECOPS_ATLAS_CHANNELS,
  kinds: GOOGLE_SECOPS_ATLAS_KINDS,
  platform: GOOGLE_SECOPS_ATLAS_PLATFORM,
  schemaVersion: GOOGLE_SECOPS_ATLAS_SCHEMA_VERSION,
  visibilityScopes: GOOGLE_SECOPS_VISIBILITY_SCOPES,
});

/**
 * One tracked entity: a stable identity, plus whatever each channel independently knows about it.
 *
 * @internal
 */
export const googleSecopsAtlasEntitySchema = shared.entity;

/** One kind's file on disk. */
export const googleSecopsAtlasKindFileSchema = shared.kindFile;

export type GoogleSecopsAtlasKindFile = z.infer<typeof googleSecopsAtlasKindFileSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const googleSecopsAtlasManifestSchema = shared.manifest;

export type GoogleSecopsAtlasManifest = z.infer<typeof googleSecopsAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialGoogleSecopsManifest({ updatedAt }: { updatedAt: string }): GoogleSecopsAtlasManifest {
  return shared.initialManifest({ updatedAt });
}

/**
 * One empty kind file per kind — what `reset` installs.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyGoogleSecopsKindFiles({
  at,
}: {
  at: string;
}): Readonly<Record<GoogleSecopsAtlasKind, GoogleSecopsAtlasKindFile>> {
  return {
    dashboard: shared.emptyKindFile({ kind: "dashboard", updatedAt: at }),
    "data-access": shared.emptyKindFile({ kind: "data-access", updatedAt: at }),
    "data-table": shared.emptyKindFile({ kind: "data-table", updatedAt: at }),
    feed: shared.emptyKindFile({ kind: "feed", updatedAt: at }),
    "findings-refinement": shared.emptyKindFile({ kind: "findings-refinement", updatedAt: at }),
    instance: shared.emptyKindFile({ kind: "instance", updatedAt: at }),
    "reference-list": shared.emptyKindFile({ kind: "reference-list", updatedAt: at }),
    rule: shared.emptyKindFile({ kind: "rule", updatedAt: at }),
    watchlist: shared.emptyKindFile({ kind: "watchlist", updatedAt: at }),
  };
}
