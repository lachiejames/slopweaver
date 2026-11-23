/**
 * Whether a surface is FILLED is read off this install's own store, never off a literal in the descriptor.
 *
 * ## The failure this exists to prevent, measured three times on siblings
 *
 * A descriptor's `status` is a static string. Left that way it is filled on every install, including one
 * where nothing has ever run — and the sibling atlases prove the failure is not hypothetical. The Slack
 * atlas graded its browser surface synced whenever pages-walked exceeded zero, while canon records it
 * reached almost none of the destinations it asked for. The CrowdStrike walk declared its whole console
 * route list and almost none of it landed. The Notion walk reported every page reached and photographed,
 * and every screenshot was the same not-found shell.
 *
 * So each flip is computed here, from what the manifest actually records, against an exact invariant:
 * **every applicable kind carries a recorded success.** Not "most", not "at least one".
 *
 * ## Three denominators, because three different runs are answerable for three different things
 *
 * The compiled description surface is answerable for `operation`, `scope` and `integration` — the three
 * kinds a compile of Jam's published documents produces. The route surface is answerable for `route` alone,
 * because the probe is a different acquisition with a different failure mode: a table can compile perfectly
 * while every host is unreachable. And the browser surfaces are answerable for `page` alone — a walk also
 * writes the browser channel of `operation` and `integration`, but a walk that reached every page and
 * observed no call at all has still done its job, so requiring those here would make the page surface's fill
 * depend on something it does not control.
 *
 * `mcp-resource` has no code path that could publish evidence at all — this installation holds no token — so
 * it stays `declared-unfilled` from the ABSENCE of evidence rather than from a literal somebody could edit,
 * and keeps the reason the descriptor gives.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { JAM_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { JamAtlasKind, JamAtlasManifest } from "./model.js";
import { JAM_ROUTE_SURFACE, JAM_SPEC_SURFACE, JAM_WEB_APP_SURFACE, JAM_WEB_CLIENT_SURFACE } from "./surfaces.js";

/**
 * The kinds a compile of the published documents is answerable for.
 *
 * @returns the three compiled kinds, sorted
 *
 * @internal
 */
export function compiledKinds(): readonly JamAtlasKind[] {
  return ["integration", "operation", "scope"];
}

/**
 * The kind the credential-free route probe is answerable for.
 *
 * @returns the probed kind
 *
 * @internal
 */
export function probedKinds(): readonly JamAtlasKind[] {
  return ["route"];
}

/**
 * The kind a walk is answerable for.
 *
 * @returns the walked kind
 *
 * @internal
 */
export function walkedKinds(): readonly JamAtlasKind[] {
  return ["page"];
}

/**
 * What the store says about one surface.
 * @internal
 */
export interface JamSurfaceFill {
  /** Applicable kinds in total. */
  readonly applicable: number;
  readonly filled: boolean;
  /** Kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
  /** Kinds carrying a recorded success. */
  readonly succeeded: number;
}

/**
 * Judge one surface from the manifest alone.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @param kinds the kinds that surface's own run is answerable for
 * @returns whether the surface is filled, and the numbers behind the verdict
 */
export function jamSurfaceFill({
  manifest,
  kinds,
}: {
  manifest: JamAtlasManifest | null;
  kinds: readonly JamAtlasKind[];
}): JamSurfaceFill {
  const outstanding = kinds.filter((kind) => manifest?.kinds[kind].lastSuccessAt == null).toSorted();
  return {
    applicable: kinds.length,
    filled: manifest !== null && outstanding.length === 0,
    outstanding,
    succeeded: kinds.length - outstanding.length,
  };
}

/** The sentence an unfilled surface carries, naming the numbers and the command that moves them. */
function unfilledBecause({ fill, command }: { fill: JamSurfaceFill; command: string }): string {
  return (
    `${String(fill.succeeded)} of ${String(fill.applicable)} applicable kind(s) carry a recorded success; ` +
    `still outstanding: ${fill.outstanding.join(", ")}. Run: ${command}`
  );
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns the descriptor with every fillable surface's status derived rather than declared
 */
export function jamDescriptorFor({ manifest }: { manifest: JamAtlasManifest | null }): AtlasDescriptor {
  const spec = jamSurfaceFill({ kinds: compiledKinds(), manifest });
  const probe = jamSurfaceFill({ kinds: probedKinds(), manifest });
  const walk = jamSurfaceFill({ kinds: walkedKinds(), manifest });
  return {
    ...JAM_ATLAS_DESCRIPTOR,
    surfaces: JAM_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (surface.name === JAM_SPEC_SURFACE) {
        return spec.filled
          ? { ...surface, status: "filled" as const, unfilledBecause: null }
          : {
              ...surface,
              unfilledBecause: unfilledBecause({ command: "slopweaver atlas jam sync", fill: spec }),
            };
      }
      if (surface.name === JAM_ROUTE_SURFACE) {
        return probe.filled
          ? { ...surface, status: "filled" as const, unfilledBecause: null }
          : {
              ...surface,
              unfilledBecause: unfilledBecause({ command: "slopweaver atlas jam sync", fill: probe }),
            };
      }
      if (surface.name === JAM_WEB_APP_SURFACE || surface.name === JAM_WEB_CLIENT_SURFACE) {
        return walk.filled
          ? { ...surface, status: "filled" as const, unfilledBecause: null }
          : {
              ...surface,
              unfilledBecause: unfilledBecause({ command: "slopweaver atlas jam walk", fill: walk }),
            };
      }
      return surface;
    }),
  };
}
