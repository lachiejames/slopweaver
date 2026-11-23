/**
 * What the JumpCloud atlas holds from its `admin-console` surface: the declared pages a walk reached and the
 * first-party operations it saw them call, in a generation of their own.
 *
 * ## Its own manifest, beside the API generation rather than inside it
 *
 * The Directory API generation's kind list is the generated registry's reachable roots EXACTLY
 * (`descriptor.test.ts`), its manifest schema is an exhaustive record over those kinds, and the sync plans
 * every one of them. Adding `page` and `method` there would make the manifest already on disk unreadable and
 * put two kinds into a sync that can never read them. So the walk publishes a second, small generation under
 * `atlas/jumpcloud/console/`, and the two writers touch disjoint files — which is why neither can truncate the
 * other by construction and why, unlike Xero's, no publish lock is needed (`xero/store.ts` says the same of an
 * atlas whose walk gets its own kinds).
 *
 * The SHAPE is `kit/channelSchemas.ts`, with this atlas's own two surface names as its channels, so an entity
 * read back through `readAdapter.ts` projects exactly as an API entity does.
 */
import { z } from "zod";

import { channelSchemas } from "../kit/channelSchemas.js";
import { KIT_GAP_CONDITIONS } from "../kit/gaps.js";
import { atlasResponseAccountingSchema } from "../kit/pageObservation.js";

import { JUMPCLOUD_ATLAS_PLATFORM, JUMPCLOUD_VISIBILITY_SCOPE } from "./model.js";

/**
 * The two kinds a console walk publishes: the declared pages, and the operations they called.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_KINDS = ["page", "method"] as const;

/** One kind the console generation holds. */
export type JumpcloudConsoleKind = (typeof JUMPCLOUD_CONSOLE_KINDS)[number];

/**
 * The channels, named exactly as the descriptor names the atlas's two surfaces. Only `admin-console` is ever
 * written here; `directory-api` is present so an entity carries the same two slots an API entity does.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_CHANNELS = ["admin-console", "directory-api"] as const;

/**
 * Schema version of the console generation. Independent of the API generation's: the two are separate files
 * and a layout change to one says nothing about the other.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_SCHEMA_VERSION = 1;

/**
 * What the console channel can see: whatever the owner's own signed-in administrator session renders.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_VISIBILITY_SCOPE =
  "the owner's own signed-in JumpCloud administrator console, walked read-only in the owner's real Chrome — bounded by what that administrator's session renders";

/**
 * Every condition a console gap can carry.
 *
 * Two are this surface's own. `provider-publishes-no-browser-inventory` is permanent: JumpCloud publishes no
 * manifest of its console's routes, so the denominator is a hand list. `console-view-state-not-addressable`
 * is permanent too: the console keeps a list's filters and saved view in the client rather than in the
 * address, so no declared URL can override what the owner's own Chrome restores.
 *
 * @internal
 */
export const JUMPCLOUD_CONSOLE_GAP_CONDITIONS = [
  "browser-page-unreachable",
  "browser-page-not-addressable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
  "provider-publishes-no-browser-inventory",
  "console-view-state-not-addressable",
  ...KIT_GAP_CONDITIONS,
] as const;

/** One console gap condition. */
export type JumpcloudConsoleGapCondition = (typeof JUMPCLOUD_CONSOLE_GAP_CONDITIONS)[number];

const shared = channelSchemas({
  // Spelled out rather than assembled — see `kit/channelSchemas.ts` on why each slot stays required.
  channelSlots: ({ channelEntity }) =>
    z.object({
      "admin-console": channelEntity.nullable(),
      "directory-api": channelEntity.nullable(),
    }),
  channels: JUMPCLOUD_CONSOLE_CHANNELS,
  kinds: JUMPCLOUD_CONSOLE_KINDS,
  manifestKinds: ({ kindStatus }) => z.object({ method: kindStatus, page: kindStatus }),
  platform: JUMPCLOUD_ATLAS_PLATFORM,
  schemaVersion: JUMPCLOUD_CONSOLE_SCHEMA_VERSION,
  visibilityScopes: [JUMPCLOUD_CONSOLE_VISIBILITY_SCOPE, JUMPCLOUD_VISIBILITY_SCOPE],
});

/**
 * What the walk saw one declared page be.
 *
 * The kit's page detail plus `screenshotMissingBecause`, because "reached" and "photographed" are two facts and
 * the fill check reads both. `finalUrl` is stored REDACTED (`redactedConsoleAddress`), and empty for a page the walk never got to.
 *
 * @internal
 */
export const jumpcloudConsolePageDetailSchema = z
  .object({
    callCount: z.number().int().nonnegative(),
    captureComplete: z.boolean(),
    finalUrl: z.string(),
    redirected: z.boolean(),
    responseAccounting: atlasResponseAccountingSchema,
    screenshotMissingBecause: z.string().min(1).nullable(),
    statusCode: z.number().int().nullable(),
    title: z.string(),
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/** What the walk saw one declared page be. */
export type JumpcloudConsolePageDetail = z.infer<typeof jumpcloudConsolePageDetailSchema>;

/**
 * What the walk saw one first-party operation be: names only, never a value.
 *
 * @internal
 */
export const jumpcloudConsoleMethodDetailSchema = z
  .object({
    callCount: z.number().int().nonnegative(),
    /** Field names the denial boundary removed before the census ran — a count, never the names. */
    deniedFieldCount: z.number().int().nonnegative(),
    responseFields: z.array(z.string()),
    seenOnPages: z.array(z.string().min(1)),
    statusCode: z.number().int(),
  })
  .strict();

/** What the walk saw one first-party operation be. */
export type JumpcloudConsoleMethodDetail = z.infer<typeof jumpcloudConsoleMethodDetailSchema>;

/** One channel's view of one console entity. */
export type JumpcloudConsoleChannelEntity = z.infer<typeof shared.channelEntity>;

/** One console entity. */
export type JumpcloudConsoleEntity = z.infer<typeof shared.entity>;

/** One console coverage cell. */
export type JumpcloudConsoleCoverageCell = z.infer<typeof shared.coverageCell>;

/** One console gap. */
export type JumpcloudConsoleGap = z.infer<typeof shared.gap>;

/**
 * One console kind's file on disk.
 *
 * @internal
 */
export const jumpcloudConsoleKindFileSchema = shared.kindFile;

/** One console kind's file on disk. */
export type JumpcloudConsoleKindFile = z.infer<typeof jumpcloudConsoleKindFileSchema>;

/**
 * The console generation's manifest.
 *
 * @internal
 */
export const jumpcloudConsoleManifestSchema = shared.manifest;

/** The console generation's manifest. */
export type JumpcloudConsoleManifest = z.infer<typeof jumpcloudConsoleManifestSchema>;

/**
 * A console manifest with both kinds present and never attempted.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialJumpcloudConsoleManifest({ updatedAt }: { updatedAt: string }): JumpcloudConsoleManifest {
  return shared.initialManifest({ updatedAt });
}

/**
 * An empty console kind file, the shape a first walk merges onto.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyJumpcloudConsoleKindFile({
  kind,
  updatedAt,
}: {
  kind: JumpcloudConsoleKind;
  updatedAt: string;
}): JumpcloudConsoleKindFile {
  return shared.emptyKindFile({ kind, updatedAt });
}
