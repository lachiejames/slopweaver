/**
 * Whether a surface is FILLED is read off the store, never off a literal in the descriptor.
 *
 * ## The failure this exists to prevent
 *
 * A descriptor's `status` is a static string. Left that way it is `filled` on every install, including one
 * where the verb that fills it has never run — and `jumpcloud/surfaceFill.ts` records the two measured cases
 * where a static or existential grade was simply false about what a walk had reached. So each flip is
 * computed here, from what the manifest actually records, against an exact invariant: **every applicable kind
 * carries a recorded success.** Not "most", not "at least one".
 *
 * ## Three surfaces have a route to `filled`, and each is graded on the evidence ONLY its own filler writes
 *
 * The compiled surface's denominator is the manifest over `operation` and `page` together, because one sync
 * fills both from two published sources and a run that got only one of them has not filled the surface.
 *
 * The two BROWSER surfaces cannot be graded that way, and the first draft of this file got it wrong in
 * exactly the manner its own header warns about — caught by `unit/atlas/inngest/sync.test.ts` rather than in
 * review. `page` is written by BOTH the sync and the walk, so a manifest `lastSuccessAt` on it says only
 * that somebody published the kind; a sync that never opened a browser flipped `dashboard` to `filled` and
 * the atlas asserted a walked surface on an install where no page had ever been rendered.
 *
 * So each browser surface is graded on a COVERAGE CELL that only its own walk writes: a `synced` cell naming
 * that surface, carrying a real `lastSuccessAt`. A sync writes cells for those surfaces too — `unreadable`,
 * saying no page has been walked — which is the honest state and does not satisfy this test.
 *
 * `rest-api` has no code path that could publish evidence at all — this installation holds no signing key —
 * so it stays `declared-unfilled` from the ABSENCE of evidence rather than from a literal somebody could
 * edit, and keeps the reason the descriptor gives.
 */

import { absentAsEmpty } from "#lib/absent.js";
import type { AtlasDescriptor } from "../kit/contract.js";
import {
  INNGEST_ATLAS_DESCRIPTOR,
  INNGEST_CATALOGUE_SURFACE,
  INNGEST_DASHBOARD_SURFACE,
  INNGEST_GRAPHQL_SURFACE,
} from "./descriptor.js";
import {
  INNGEST_GRAPHQL_OPERATION_KIND,
  INNGEST_OPERATION_KIND,
  INNGEST_PAGE_KIND,
  type InngestAtlasKindFile,
  type InngestAtlasManifest,
  type InngestKind,
} from "./model.js";

/**
 * Every kind file a fill judgement reads, as the store hands them back.
 *
 * @internal
 */
export type InngestKindFiles = Readonly<Partial<Record<InngestKind, InngestAtlasKindFile | null>>>;

/**
 * Whether one surface carries a coverage cell that only its own acquisition could have written.
 *
 * @param files the kind files as the store holds them
 * @param kind the kind that surface's filler writes its cell on
 * @param surface the surface name to look for
 * @returns whether a successful, current cell for that surface is present
 *
 * @internal
 */
export function surfaceHasWalkedEvidence({
  files,
  kind,
  surface,
}: {
  files: InngestKindFiles;
  kind: InngestKind;
  surface: string;
}): boolean {
  return absentAsEmpty({ value: files[kind]?.coverage }).some(
    (cell) => cell.surface === surface && cell.state === "synced" && cell.lastSuccessAt !== null,
  );
}

/**
 * What the store says about one surface.
 *
 * @internal
 */
export interface InngestSurfaceFill {
  readonly filled: boolean;
  /** Applicable kinds carrying a recorded success. */
  readonly succeeded: number;
  /** Applicable kinds in total. */
  readonly applicable: number;
  /** Kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
}

/** Judge one surface from the manifest alone, over the kinds that surface is answerable for. */
function fillOver({
  manifest,
  kinds,
}: {
  manifest: InngestAtlasManifest | null;
  kinds: readonly InngestKind[];
}): InngestSurfaceFill {
  const outstanding = kinds.filter((kind) => manifest?.kinds[kind].lastSuccessAt == null).toSorted();
  return {
    applicable: kinds.length,
    filled: manifest !== null && outstanding.length === 0,
    outstanding,
    succeeded: kinds.length - outstanding.length,
  };
}

/**
 * What the store says about the compiled catalogue surface.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether the surface is filled, and the numbers behind the verdict
 *
 * @internal
 */
export function inngestCatalogueFill({ manifest }: { manifest: InngestAtlasManifest | null }): InngestSurfaceFill {
  return fillOver({ kinds: [INNGEST_OPERATION_KIND, INNGEST_PAGE_KIND], manifest });
}

/**
 * Whether a walk has actually rendered a dashboard page on this install.
 *
 * @param files the kind files as the store holds them
 * @returns whether the walk wrote its own successful coverage cell
 *
 * @internal
 */
export function inngestDashboardFilled({ files }: { files: InngestKindFiles }): boolean {
  return surfaceHasWalkedEvidence({ files, kind: INNGEST_PAGE_KIND, surface: INNGEST_DASHBOARD_SURFACE });
}

/**
 * Whether a walk has actually observed a GraphQL operation on this install.
 *
 * @param files the kind files as the store holds them
 * @returns whether the walk wrote its own successful coverage cell
 *
 * @internal
 */
export function inngestGraphqlFilled({ files }: { files: InngestKindFiles }): boolean {
  return surfaceHasWalkedEvidence({
    files,
    kind: INNGEST_GRAPHQL_OPERATION_KIND,
    surface: INNGEST_GRAPHQL_SURFACE,
  });
}

/** The `unfilledBecause` one unfilled surface earns, naming the verb that would fill it. */
function unfilledReason({ resync }: { resync: string }): string {
  return `no run has recorded a success for this surface yet. Run: ${resync}`;
}

/** Which verb fills one surface, or `null` for the surface no verb here can fill. */
function fillerFor({ surface }: { surface: string }): string | null {
  if (surface === INNGEST_CATALOGUE_SURFACE) {
    return "slopweaver atlas inngest sync";
  }
  if (surface === INNGEST_DASHBOARD_SURFACE || surface === INNGEST_GRAPHQL_SURFACE) {
    return "slopweaver atlas inngest walk";
  }
  return null;
}

/** Whether one surface's own evidence is present in this generation. */
function isFilled({
  surface,
  manifest,
  files,
}: {
  surface: string;
  manifest: InngestAtlasManifest | null;
  files: InngestKindFiles;
}): boolean {
  if (surface === INNGEST_CATALOGUE_SURFACE) {
    return inngestCatalogueFill({ manifest }).filled;
  }
  if (surface === INNGEST_DASHBOARD_SURFACE) {
    return inngestDashboardFilled({ files });
  }
  if (surface === INNGEST_GRAPHQL_SURFACE) {
    return inngestGraphqlFilled({ files });
  }
  return false;
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @param files the kind files, which is where the two browser surfaces' own evidence lives
 * @returns the descriptor with every fillable surface's status derived rather than declared
 */
export function inngestDescriptorFor({
  manifest,
  files,
}: {
  manifest: InngestAtlasManifest | null;
  files: InngestKindFiles;
}): AtlasDescriptor {
  return {
    ...INNGEST_ATLAS_DESCRIPTOR,
    surfaces: INNGEST_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      const resync = fillerFor({ surface: surface.name });
      if (resync === null) {
        return surface;
      }
      if (isFilled({ files, manifest, surface: surface.name })) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      return { ...surface, unfilledBecause: unfilledReason({ resync }) };
    }),
  };
}
