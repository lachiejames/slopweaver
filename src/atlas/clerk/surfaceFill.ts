/**
 * Whether each fillable surface is FILLED is read off the stored generation, never off a literal in the
 * descriptor.
 *
 * ## The failure this exists to prevent
 *
 * A descriptor's `status` is a static string. Left that way it is `filled` on every install, including one
 * where `atlas clerk sync` and `atlas clerk walk` have never run — and `jumpcloud/surfaceFill.ts` records
 * the two measured cases where a static or existential grade was simply false about what a walk had
 * reached. So both flips are computed here.
 *
 * ## The evidence is a CHANNEL on a stored row, not a manifest timestamp, and that is the sharper part
 *
 * The sibling Microsoft 365 atlas grades its one compiled surface on `lastSuccessAt` per kind, which is
 * sound there because exactly one writer stamps each kind. Here it would not be: the walk writes the
 * `operation` kind too — that is the whole design, since the corroboration between the two channels is the
 * output — so a manifest-timestamp rule would report `published-api` filled after a run that compiled
 * nothing. The rule below therefore asks the rows themselves which channel actually looked.
 *
 * The dashboard surface is graded harder still: a page row must carry a browser observation AND a
 * screenshot artifact. A walk that reached forty pages and photographed none has not done what this atlas
 * says it does, and `kit/walkPublish.ts` carries the same reasoning one level down — the evidence is the
 * bytes, never the reference.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { CLERK_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  CLERK_OPERATION_KIND,
  CLERK_PAGE_KIND,
  CLERK_WEBHOOK_EVENT_KIND,
  type ClerkAtlasKind,
  type ClerkAtlasKindFile,
} from "./model.js";

/**
 * The surface name the compiled channel's coverage is reported under. Matches the descriptor's own.
 *
 * @internal
 */
export const CLERK_SPEC_SURFACE = "published-api";

/**
 * The surface name the dashboard walk's coverage is reported under.
 *
 * @internal
 */
export const CLERK_DASHBOARD_SURFACE = "dashboard";

/**
 * The surface name the live Clerk API channel's coverage is reported under, filled or not.
 *
 * @internal
 */
export const CLERK_API_SURFACE = "instance-api";

/**
 * What the stored generation says about the two fillable surfaces.
 *
 * @internal
 */
export interface ClerkSurfaceFill {
  /** Operation rows carrying a compiled observation. */
  readonly compiledOperations: number;
  /** Webhook-event rows carrying a compiled observation. */
  readonly compiledWebhookEvents: number;
  /** Declared pages carrying a browser observation AND a verified screenshot. */
  readonly photographedPages: number;
  /** Operation rows carrying a browser observation. */
  readonly observedOperations: number;
  readonly specFilled: boolean;
  readonly dashboardFilled: boolean;
}

/** One kind's stored rows, or an empty list when the kind has no file. */
function rowsOf({
  files,
  kind,
}: {
  files: Readonly<Partial<Record<ClerkAtlasKind, ClerkAtlasKindFile | null>>>;
  kind: ClerkAtlasKind;
}): ClerkAtlasKindFile["entities"] {
  const entities = files[kind]?.entities;
  if (entities == null) {
    return [];
  }
  return entities;
}

/**
 * Judge both fillable surfaces from the stored rows alone.
 *
 * @param files every kind's stored file, as the store handed them back
 * @returns the four counts and the two verdicts
 *
 * @internal
 */
export function clerkSurfaceFill({
  files,
}: {
  files: Readonly<Partial<Record<ClerkAtlasKind, ClerkAtlasKindFile | null>>>;
}): ClerkSurfaceFill {
  const compiledOperations = rowsOf({ files, kind: CLERK_OPERATION_KIND }).filter(
    (entity) => entity.channels.compiled !== null,
  ).length;
  const compiledWebhookEvents = rowsOf({ files, kind: CLERK_WEBHOOK_EVENT_KIND }).filter(
    (entity) => entity.channels.compiled !== null,
  ).length;
  const observedOperations = rowsOf({ files, kind: CLERK_OPERATION_KIND }).filter(
    (entity) => entity.channels.browser !== null,
  ).length;
  const photographedPages = rowsOf({ files, kind: CLERK_PAGE_KIND }).filter((entity) => {
    const browser = entity.channels.browser;
    // A row with no source has no artifact at all, so it is not photographed.
    return browser !== null && browser.source !== null && browser.source.artifacts.length > 0;
  }).length;
  return {
    compiledOperations,
    compiledWebhookEvents,
    dashboardFilled: photographedPages > 0,
    observedOperations,
    photographedPages,
    specFilled: compiledOperations > 0 && compiledWebhookEvents > 0,
  };
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param files every kind's stored file, as the store handed them back
 * @returns the descriptor with both fillable surfaces' statuses derived rather than declared
 */
export function clerkDescriptorFor({
  files,
}: {
  files: Readonly<Partial<Record<ClerkAtlasKind, ClerkAtlasKindFile | null>>>;
}): AtlasDescriptor {
  const fill = clerkSurfaceFill({ files });
  return {
    ...CLERK_ATLAS_DESCRIPTOR,
    surfaces: CLERK_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (surface.name === CLERK_SPEC_SURFACE && fill.specFilled) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      if (surface.name === CLERK_DASHBOARD_SURFACE && fill.dashboardFilled) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      return surface;
    }),
  };
}
