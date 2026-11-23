/**
 * Whether the compiled-catalogue surface is FILLED is read off the store, never off a literal in the
 * descriptor.
 *
 * ## The failure this exists to prevent
 *
 * A descriptor's `status` is a static string. Left that way it is `filled` on every install, including one
 * where `atlas datadog sync` has never run — and `descriptor.ts`'s own header records why this atlas
 * refuses to repeat the sibling Slack atlas's "reported N, reached one". So the flip is computed here, from
 * what the manifest actually records, against an exact invariant: **every one of the declared kinds must
 * carry a recorded success.** Not "most", not "at least one".
 *
 * There is no excluded denominator, and that is a real difference from `microsoft365/surfaceFill.ts`, which
 * has to hold its `page` kind out because a compile can never fill it. Every Datadog kind exists BECAUSE
 * the registry carries rows for it (`model.ts`), so one compile fills all of them or the compile is broken.
 * A denominator with an exception in it is a denominator somebody can widen; this one cannot be.
 *
 * ## `api` is now DERIVED too, and it derives to `declared-unfilled` on purpose
 *
 * `atlas datadog sync --live` exists, so this surface finally has a code path that publishes evidence — and
 * the invariant it is judged against is deliberately one it cannot yet satisfy. A kind counts as reached
 * only when its stored `api` cell records a success AND is not `deferred`, and every kind carrying a paging
 * operation, an identifier-taking operation, a shape-index operation or an answer admitted on the
 * specification's names alone gets a `deferred` cell by construction (`syncApi.ts`'s four remainders). So a live pass moves this surface's REASON — from "no
 * call has ever been made" to an exact count of what answered and what is still bounded — without ever
 * moving its status.
 *
 * That is the point rather than a limitation. `descriptor.ts`'s header names the sibling Slack atlas, which
 * grades its browser surface synced whenever pages-walked exceeds zero while canon records it reached only
 * one of the destinations it asked for. An `api` surface that flipped to `filled` because 329 of 1,069
 * reachable operations answered would be the same claim in a new costume.
 *
 * ## `console` is derived from the `console-page` kind, and its bar has a third leg
 *
 * `atlas datadog walk` publishes a `console` cell on `console-page` (`consoleSurface.ts`). Filled needs
 * that cell `synced` — every declared route attempted — AND the live left nav re-read on the same run
 * with no drift from the declared list, because the denominator here is the nav on one date
 * (`consolePages.ts`) and a walk of a list the console has since changed has walked the wrong thing. Until
 * a walk has run the descriptor's own sentence stands, unchanged.
 */
import { isRecord } from "../../lib/parsers.js";
import type { AtlasDescriptor } from "../kit/contract.js";

import { DATADOG_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { DatadogCoverageCell, DatadogManifest } from "./documents.js";
import { DATADOG_REGISTRY_KINDS } from "./model.js";

/**
 * What the store says about the compiled-catalogue surface.
 * @internal
 */
export interface DatadogCompiledFill {
  readonly filled: boolean;
  /** Kinds carrying a recorded success. */
  readonly succeeded: number;
  /** Kinds in total — the whole declared list, with no exception. */
  readonly declared: number;
  /** Kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
}

/**
 * Judge the compiled-catalogue surface from the manifest alone.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether the surface is filled, and the numbers behind the verdict
 */
export function datadogCompiledFill({ manifest }: { manifest: DatadogManifest | null }): DatadogCompiledFill {
  const outstanding = DATADOG_REGISTRY_KINDS.filter((kind) =>
    manifest === null ? true : manifest.kinds[kind].lastSuccessAt === null,
  ).toSorted();
  return {
    declared: DATADOG_REGISTRY_KINDS.length,
    filled: manifest !== null && outstanding.length === 0,
    outstanding,
    succeeded: DATADOG_REGISTRY_KINDS.length - outstanding.length,
  };
}

/**
 * What the store says about the `api` surface.
 * @internal
 */
export interface DatadogApiFill {
  readonly filled: boolean;
  /** Kinds whose stored `api` cell records a success and is not `deferred`. */
  readonly complete: number;
  /** Kinds whose `api` cell records a success that is still bounded by an unbuilt pass. */
  readonly bounded: number;
  /** Kinds whose `api` cell has never recorded a success at all. */
  readonly unreached: number;
  readonly declared: number;
}

/**
 * Judge the `api` surface from the stored coverage cells.
 *
 * Read off the CELLS rather than the manifest, and that is forced rather than preferred: one manifest entry
 * per kind carries a single `lastSuccessAt` that the compiled publish already stamped for every kind, so it
 * cannot distinguish a kind this organisation answered from one that was only ever compiled. The cell can —
 * `syncApi.ts` writes exactly one per kind under `surface: "api"`.
 *
 * @param files the published kind files, keyed by kind; a kind absent here has no cell and is unreached
 * @returns whether the surface is filled, and the three counts behind the verdict
 * @internal
 */
export function datadogApiFill({
  files,
}: {
  files: Readonly<Partial<Record<string, { readonly coverage: readonly DatadogCoverageCell[] } | null>>>;
}): DatadogApiFill {
  let complete = 0;
  let bounded = 0;
  let unreached = 0;
  for (const kind of DATADOG_REGISTRY_KINDS) {
    const cell = files[kind]?.coverage.find((one) => one.surface === "api");
    // A kind with no file, a file with no `api` cell, and a cell that has never recorded a success are three
    // different absences and one answer: nothing has reached this kind through this channel.
    if (cell?.lastSuccessAt == null) {
      unreached += 1;
      continue;
    }
    if (cell.state === "synced") {
      complete += 1;
      continue;
    }
    bounded += 1;
  }
  return {
    bounded,
    complete,
    declared: DATADOG_REGISTRY_KINDS.length,
    filled: unreached === 0 && bounded === 0,
    unreached,
  };
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @param files the published kind files, which are what the `api` surface's verdict is read off; omitted
 * leaves that surface's declared reason exactly as the descriptor states it
 * @returns the descriptor with the compiled-catalogue and `api` surfaces derived rather than declared
 */
export function datadogDescriptorFor({
  manifest,
  files,
}: {
  manifest: DatadogManifest | null;
  files?: DatadogFillFiles;
}): AtlasDescriptor {
  return {
    ...DATADOG_ATLAS_DESCRIPTOR,
    surfaces: DATADOG_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (surface.acquisition === "compiled") {
        return compiledSurface({ manifest, surface });
      }
      if (surface.acquisition === "api" && files !== undefined) {
        return apiSurface({ files, surface });
      }
      if (surface.acquisition === "driven-browser" && files !== undefined) {
        return consoleSurface({ files, surface });
      }
      return surface;
    }),
  };
}

/** The compiled-catalogue surface, judged against "every declared kind carries a recorded success". */
function compiledSurface({
  manifest,
  surface,
}: {
  manifest: DatadogManifest | null;
  surface: AtlasDescriptor["surfaces"][number];
}): AtlasDescriptor["surfaces"][number] {
  const fill = datadogCompiledFill({ manifest });
  if (fill.filled) {
    return { ...surface, status: "filled" as const, unfilledBecause: null };
  }
  const head = fill.outstanding.slice(0, 8).join(", ");
  const tail = fill.outstanding.length > 8 ? ", …" : "";
  return {
    ...surface,
    status: "declared-unfilled" as const,
    unfilledBecause: `${String(fill.succeeded)} of ${String(fill.declared)} declared kinds carry a recorded success; still outstanding: ${head}${tail}. Run: slopweaver atlas datadog sync`,
  };
}

/** The `api` surface, whose reason moves on every live pass while its status does not. */
function apiSurface({
  files,
  surface,
}: {
  files: Readonly<Partial<Record<string, { readonly coverage: readonly DatadogCoverageCell[] } | null>>>;
  surface: AtlasDescriptor["surfaces"][number];
}): AtlasDescriptor["surfaces"][number] {
  const fill = datadogApiFill({ files });
  if (fill.filled) {
    return { ...surface, status: "filled" as const, unfilledBecause: null };
  }
  if (fill.complete === 0 && fill.bounded === 0) {
    // No live pass has ever run here, so the descriptor's own sentence is still the true one and rewriting
    // it with three zeroes would say less than it does.
    return surface;
  }
  return {
    ...surface,
    status: "declared-unfilled" as const,
    unfilledBecause: `a live pass has run: of ${String(fill.declared)} declared kinds, ${String(fill.complete)} were read in full, ${String(fill.bounded)} answered but remain bounded by a pass that is not built (a paging walk, an identifier fan-out, or a windowed shape index — each kind's \`api\` coverage cell names which), and ${String(fill.unreached)} were never reached. Run: slopweaver atlas datadog sync --live`,
  };
}

/**
 * The kind files as this module reads them: a `console` cell, the gap conditions still open, and each
 * entity's console channel — enough to count the pages the last walk rendered without the whole schema.
 */
export type DatadogFillFiles = Readonly<
  Partial<
    Record<
      string,
      {
        readonly coverage: readonly DatadogCoverageCell[];
        readonly entities: readonly { readonly channels: { readonly console: { readonly detail: unknown } | null } }[];
        readonly gaps: readonly { readonly condition: string; readonly status: "open" | "closed" }[];
      } | null
    >
  >
>;

/**
 * What the store says about the `console` surface.
 * @internal
 */
export interface DatadogConsoleFill {
  readonly filled: boolean;
  /** Whether any walk has ever published a `console-page` cell. */
  readonly walked: boolean;
  /** Whether the last walk attempted every declared route (its cell is `synced` rather than `deferred`). */
  readonly complete: boolean;
  /** Whether the last walk re-read the live nav and found it matching the declared list. */
  readonly navChecked: boolean;
  readonly navDrifted: boolean;
  /** Pages whose last recorded outcome is `landed` — the numerator of the descriptor's denominator. */
  readonly landed: number;
  readonly reason: string | null;
}

/**
 * Judge the `console` surface from the `console-page` kind's cell and gaps.
 *
 * Filled means three things at once, and each is read off the store rather than declared: a walk has run,
 * it attempted every declared route (`synced`, never `deferred`), and it re-read the live nav and found it
 * matching the declared list — no open `console-nav-drifted` and no open `console-nav-unread`. A walk that
 * reached every page of a list the console has since changed is a walk of the wrong denominator, which is
 * the one thing the owner's acceptance of the live nav does not cover.
 *
 * @param files the published kind files, keyed by kind
 * @returns whether the surface is filled, and the facts behind the verdict
 * @internal
 */
export function datadogConsoleFill({ files }: { files: DatadogFillFiles }): DatadogConsoleFill {
  const file = files["console-page"];
  const cell = file?.coverage.find((one) => one.surface === "console");
  if (cell?.lastSuccessAt == null) {
    return {
      complete: false,
      filled: false,
      landed: 0,
      navChecked: false,
      navDrifted: false,
      reason: null,
      walked: false,
    };
  }
  const open = new Set(file!.gaps.filter((gap) => gap.status === "open").map((gap) => gap.condition));
  const navDrifted = open.has("console-nav-drifted");
  const navChecked = !open.has("console-nav-unread") && !navDrifted;
  const complete = cell.state === "synced";
  const landed = file!.entities.filter((entity) => {
    const detail = entity.channels.console?.detail;
    return isRecord(detail) && detail["outcome"] === "landed";
  }).length;
  return {
    complete,
    filled: complete && navChecked,
    landed,
    navChecked,
    navDrifted,
    reason: cell.reason,
    walked: true,
  };
}

/** The `console` surface, judged against "every declared page attempted, and the live nav still agrees". */
function consoleSurface({
  files,
  surface,
}: {
  files: DatadogFillFiles;
  surface: AtlasDescriptor["surfaces"][number];
}): AtlasDescriptor["surfaces"][number] {
  const fill = datadogConsoleFill({ files });
  const denominator =
    surface.denominator.known && fill.walked ? { ...surface.denominator, reached: fill.landed } : surface.denominator;
  if (fill.filled) {
    return { ...surface, denominator, status: "filled" as const, unfilledBecause: null };
  }
  // `reason` is the walk's own cell text; `walked` is exactly its presence.
  if (!fill.walked || fill.reason === null) {
    return surface;
  }
  const because = [
    fill.complete ? null : "the last walk did not attempt every declared route",
    fill.navDrifted ? "the live left nav no longer matches the declared list" : null,
    fill.navChecked || fill.navDrifted ? null : "the live left nav could not be re-read",
  ].filter((line): line is string => line !== null);
  return {
    ...surface,
    denominator,
    status: "declared-unfilled" as const,
    unfilledBecause: `a walk has run — ${fill.reason} — but ${because.join(", and ")}. Run: slopweaver atlas datadog walk`,
  };
}
