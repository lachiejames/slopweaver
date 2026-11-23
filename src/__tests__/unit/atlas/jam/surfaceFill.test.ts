/**
 * Whether a surface is FILLED is read off the manifest, never off a literal.
 *
 * `surfaceFill.ts` carries the three sibling atlases this exists because of; what is asserted here is the
 * exact invariant — EVERY applicable kind carries a recorded success, not "most" and not "at least one".
 */
import { describe, expect, it } from "vitest";

import { initialJamManifest, type JamAtlasKind, type JamAtlasManifest } from "../../../../atlas/jam/model.js";
import {
  compiledKinds,
  jamDescriptorFor,
  jamSurfaceFill,
  probedKinds,
  walkedKinds,
} from "../../../../atlas/jam/surfaceFill.js";
import {
  JAM_MCP_SURFACE,
  JAM_ROUTE_SURFACE,
  JAM_SPEC_SURFACE,
  JAM_WEB_APP_SURFACE,
  JAM_WEB_CLIENT_SURFACE,
} from "../../../../atlas/jam/surfaces.js";

const AT = "2026-09-07T00:00:00.000Z";

/** A manifest with a recorded success on exactly the named kinds. */
function manifestWith({ succeeded }: { succeeded: readonly JamAtlasKind[] }): JamAtlasManifest {
  const base = initialJamManifest({ updatedAt: AT });
  const kinds = { ...base.kinds };
  for (const kind of succeeded) {
    kinds[kind] = { digest: null, entityCount: 1, lastAttempt: null, lastSuccessAt: AT };
  }
  return { ...base, kinds };
}

/** One surface's status off the derived descriptor. */
function statusOf({ manifest, surface }: { manifest: JamAtlasManifest | null; surface: string }): string {
  const found = jamDescriptorFor({ manifest }).surfaces.find((row) => row.name === surface);
  return found === undefined ? "absent" : found.status;
}

describe("jamSurfaceFill", () => {
  it("reports nothing filled when nothing has ever been published", () => {
    const fill = jamSurfaceFill({ kinds: compiledKinds(), manifest: null });
    expect(fill.filled).toBe(false);
    expect(fill.succeeded).toBe(0);
    expect(fill.outstanding).toEqual(["integration", "operation", "scope"]);
  });

  it("refuses to call a surface filled when ONE of its kinds is outstanding", () => {
    const fill = jamSurfaceFill({
      kinds: compiledKinds(),
      manifest: manifestWith({ succeeded: ["operation", "scope"] }),
    });
    expect(fill.filled).toBe(false);
    expect(fill.succeeded).toBe(2);
    expect(fill.outstanding).toEqual(["integration"]);
  });

  it("calls it filled only when every applicable kind carries a success", () => {
    const fill = jamSurfaceFill({ kinds: compiledKinds(), manifest: manifestWith({ succeeded: compiledKinds() }) });
    expect(fill.filled).toBe(true);
    expect(fill.outstanding).toEqual([]);
  });
});

describe("the three denominators are separate", () => {
  it("names three disjoint kind sets", () => {
    expect(compiledKinds()).toEqual(["integration", "operation", "scope"]);
    expect(probedKinds()).toEqual(["route"]);
    expect(walkedKinds()).toEqual(["page"]);
  });

  it("lets the route probe be filled while the description surface is not, and the reverse", () => {
    const onlyRoutes = manifestWith({ succeeded: ["route"] });
    expect(statusOf({ manifest: onlyRoutes, surface: JAM_ROUTE_SURFACE })).toBe("filled");
    expect(statusOf({ manifest: onlyRoutes, surface: JAM_SPEC_SURFACE })).toBe("declared-unfilled");

    const onlySpec = manifestWith({ succeeded: compiledKinds() });
    expect(statusOf({ manifest: onlySpec, surface: JAM_SPEC_SURFACE })).toBe("filled");
    expect(statusOf({ manifest: onlySpec, surface: JAM_ROUTE_SURFACE })).toBe("declared-unfilled");
  });

  it("flips both browser surfaces together, on the walked kind alone", () => {
    const walked = manifestWith({ succeeded: ["page"] });
    expect(statusOf({ manifest: walked, surface: JAM_WEB_APP_SURFACE })).toBe("filled");
    expect(statusOf({ manifest: walked, surface: JAM_WEB_CLIENT_SURFACE })).toBe("filled");
  });
});

describe("the MCP surface", () => {
  it("stays declared-unfilled however much else has succeeded, because nothing can fill it", () => {
    const everything = manifestWith({ succeeded: ["integration", "operation", "page", "route", "scope"] });
    expect(statusOf({ manifest: everything, surface: JAM_MCP_SURFACE })).toBe("declared-unfilled");
  });

  it("keeps the descriptor's own reason rather than a derived one", () => {
    const surface = jamDescriptorFor({ manifest: null }).surfaces.find((row) => row.name === JAM_MCP_SURFACE);
    expect(surface?.unfilledBecause).toContain("no Jam access token exists in this installation");
  });
});

describe("an unfilled surface names its own numbers and the verb that moves them", () => {
  it("says how many kinds are outstanding and which command fills them", () => {
    const surface = jamDescriptorFor({ manifest: manifestWith({ succeeded: ["operation"] }) }).surfaces.find(
      (row) => row.name === JAM_SPEC_SURFACE,
    );
    expect(surface?.unfilledBecause).toContain("1 of 3 applicable kind(s)");
    expect(surface?.unfilledBecause).toContain("slopweaver atlas jam sync");
  });
});
