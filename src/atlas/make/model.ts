/**
 * The Make atlas's on-disk vocabulary — the generation the fill publishes, and the schemas that refuse to
 * trust it.
 *
 * ## Seven kinds, the shapes a later hunt needs
 *
 * The owner's ask is the organisation, its teams, scenarios and their schedules, connections
 * and recent executions — enough to find whatever links Vanta and KnowBe4, and the IT offboarding
 * automation. `folder` is how scenarios are arranged in the UI, and `hook` is the webhook or mailhook that
 * starts an instant scenario: without it, an "instant" schedule names no trigger at all.
 *
 * ## Two channels, and only `api` is filled
 *
 * `api` is Make's public API under the owner's own token, through a rail that lets only a GET out. `browser`
 * is named because the shared shape wants every channel up front; nothing fills it.
 */
import { z } from "zod";

import { channelSchemas } from "../kit/channelSchemas.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const MAKE_ATLAS_SCHEMA_VERSION = 1;

/** The platform discriminator. ONE per SaaS app. */
export const MAKE_ATLAS_PLATFORM = "make";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const MAKE_ATLAS_KINDS = [
  "connection",
  "execution",
  "folder",
  "hook",
  "organization",
  "scenario",
  "team",
] as const;

export type MakeAtlasKind = (typeof MAKE_ATLAS_KINDS)[number];

/** How a fact was reached. Each channel owns independent presence and detail. */
export const MAKE_ATLAS_CHANNELS = ["api", "browser"] as const;

/**
 * The claim boundary a coverage cell carries, one per channel: the `api` channel sees what the token's
 * scopes AND its owner's team roles both open; the `browser` channel would see what the signed-in role
 * renders.
 *
 * @internal
 */
export const MAKE_VISIBILITY_SCOPES = ["api-token-scopes-and-team-role", "browser-signed-in-role"] as const;

/**
 * The stored vocabulary this atlas shares with every other two-channel one, specialised to Make.
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
      connection: kindStatus,
      execution: kindStatus,
      folder: kindStatus,
      hook: kindStatus,
      organization: kindStatus,
      scenario: kindStatus,
      team: kindStatus,
    }),
  channels: MAKE_ATLAS_CHANNELS,
  kinds: MAKE_ATLAS_KINDS,
  platform: MAKE_ATLAS_PLATFORM,
  schemaVersion: MAKE_ATLAS_SCHEMA_VERSION,
  visibilityScopes: MAKE_VISIBILITY_SCOPES,
});

/** One kind's file on disk. */
export const makeAtlasKindFileSchema = shared.kindFile;

export type MakeAtlasKindFile = z.infer<typeof makeAtlasKindFileSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const makeAtlasManifestSchema = shared.manifest;

export type MakeAtlasManifest = z.infer<typeof makeAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialMakeManifest({ updatedAt }: { updatedAt: string }): MakeAtlasManifest {
  return shared.initialManifest({ updatedAt });
}

/**
 * One empty kind file per kind — what `reset` installs.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyMakeKindFiles({ at }: { at: string }): Readonly<Record<MakeAtlasKind, MakeAtlasKindFile>> {
  return {
    connection: shared.emptyKindFile({ kind: "connection", updatedAt: at }),
    execution: shared.emptyKindFile({ kind: "execution", updatedAt: at }),
    folder: shared.emptyKindFile({ kind: "folder", updatedAt: at }),
    hook: shared.emptyKindFile({ kind: "hook", updatedAt: at }),
    organization: shared.emptyKindFile({ kind: "organization", updatedAt: at }),
    scenario: shared.emptyKindFile({ kind: "scenario", updatedAt: at }),
    team: shared.emptyKindFile({ kind: "team", updatedAt: at }),
  };
}
