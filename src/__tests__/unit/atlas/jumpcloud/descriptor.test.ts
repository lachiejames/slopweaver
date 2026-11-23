import { describe, expect, it } from "vitest";

import { JUMPCLOUD_CONSOLE_KINDS } from "../../../../atlas/jumpcloud/consoleModel.js";
import { JUMPCLOUD_ATLAS_DESCRIPTOR } from "../../../../atlas/jumpcloud/descriptor.js";
import { JUMPCLOUD_EXCLUSIONS } from "../../../../atlas/jumpcloud/exclusions.js";
import { JUMPCLOUD_SURFACES } from "../../../../atlas/jumpcloud/generated/surfaces.js";
import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";

const descriptor = JUMPCLOUD_ATLAS_DESCRIPTOR;

describe("JUMPCLOUD_ATLAS_DESCRIPTOR", () => {
  it("names one platform, never a surface", () => {
    expect(descriptor.platform).toBe("jumpcloud");
  });

  it("declares both surfaces, so an API-only atlas cannot be silent about the browser", () => {
    expect(descriptor.surfaces.map((s) => s.acquisition)).toStrictEqual(["api", "driven-browser"]);
  });

  it("claims NO filled surface yet, because neither the sync nor the bridge has been proven", () => {
    expect(unfilledSurfaces({ descriptor }).length).toBe(2);
    expect(hasFilledBrowserSurface({ descriptor })).toBe(false);
  });

  it("says why each surface is unfilled, so the state is a statement rather than a silence", () => {
    expect(descriptor.surfaces.filter((s) => s.unfilledBecause === null)).toStrictEqual([]);
  });

  it("resyncs through the third-word verb the standing ruling settled", () => {
    expect(descriptor.resyncCommand).toBe("slopweaver atlas jumpcloud sync");
  });

  /**
   * The standing rule is "every family in full", so the kind list is the registry's reachable roots EXACTLY
   * — not a floor, and not a subset with the remainder parked as a measured shortfall, which is the end
   * state the rule rules out. Omitting twelve of these was once invisible to
   * both the type system and coverage, because a kind nothing declares is one no generation can publish a
   * non-`synced` state for.
   *
   * 74 rather than the 68 quoted elsewhere: 68 is the v2 GET-root census alone, while the registry spans v1
   * and Directory Insights roots too. This test is where that distinction was caught.
   */
  it("declares every reachable root the registry holds plus the console walk's two kinds, with none left over", () => {
    const roots = new Set(JUMPCLOUD_SURFACES.filter((r) => r.coverage === "reachable").map((r) => r.kind));
    expect(roots.size).toBe(74);
    expect(descriptor.kinds.toSorted()).toStrictEqual([...roots, ...JUMPCLOUD_CONSOLE_KINDS].toSorted());
  });

  it("declares no kind the registry cannot fill, beyond the console walk's own two", () => {
    const fromRegistry = new Set<string>([...JUMPCLOUD_SURFACES.map((r) => r.kind), ...JUMPCLOUD_CONSOLE_KINDS]);
    expect(descriptor.kinds.filter((k) => !fromRegistry.has(k))).toStrictEqual([]);
  });

  it("states the visibility boundary in the credential's own terms", () => {
    expect(descriptor.visibilityScope).toContain(
      "an administrator's API key and bounded by what that administrator's role can see",
    );
  });

  it("excludes the sixteen refused operations and the field-level boundary separately", () => {
    expect(descriptor.excludes.length).toBe(5);
    expect(descriptor.excludes[0]!.because).toContain("sixteen operations");
    expect(JUMPCLOUD_EXCLUSIONS.length).toBe(16);
  });

  it("names the field-level boundary, because an endpoint allowlist does not reach it", () => {
    expect(descriptor.excludes.some((e) => e.because.includes("idpPrivateKey"))).toBe(true);
  });
});
