import { describe, expect, it } from "vitest";

import { CROWDSTRIKE_ATLAS_DESCRIPTOR } from "../../../../atlas/crowdstrike/descriptor.js";
import { CROWDSTRIKE_CALLS } from "../../../../atlas/crowdstrike/inventory.js";
import {
  CROWDSTRIKE_KINDS,
  type CrowdstrikeKind,
  crowdstrikeConsoleOrigin,
  isExpectedReachable,
} from "../../../../atlas/crowdstrike/model.js";
import { CROWDSTRIKE_STORE_SPEC } from "../../../../atlas/crowdstrike/store.js";

describe("crowdstrikeConsoleOrigin", () => {
  it("derives the console host from the API host, so the region is configured once", () => {
    expect(crowdstrikeConsoleOrigin({ apiHost: "https://api.us-2.crowdstrike.com" })).toBe(
      "https://falcon.us-2.crowdstrike.com",
    );
  });

  it("handles the unregioned host", () => {
    expect(crowdstrikeConsoleOrigin({ apiHost: "https://api.crowdstrike.com" })).toBe("https://falcon.crowdstrike.com");
  });

  it("refuses a host that is not shaped like a Falcon API host", () => {
    expect(crowdstrikeConsoleOrigin({ apiHost: "https://example.test" })).toBe(null);
    expect(crowdstrikeConsoleOrigin({ apiHost: "not a url" })).toBe(null);
  });
});

describe("the kind list is one list", () => {
  it("has at least one entry in CROWDSTRIKE_KINDS, so the guards below are not vacuously green", () => {
    expect(CROWDSTRIKE_KINDS.length).toBeGreaterThan(0);
  });

  it("is the same tuple the descriptor, the store spec and the paths all agree on", () => {
    expect([...CROWDSTRIKE_ATLAS_DESCRIPTOR.kinds].toSorted()).toEqual([...CROWDSTRIKE_KINDS].toSorted());
    expect([...CROWDSTRIKE_STORE_SPEC.kinds].toSorted()).toEqual([...CROWDSTRIKE_KINDS].toSorted());
  });

  it("expects every declared kind to be reachable with the scopes this install holds", () => {
    expect(CROWDSTRIKE_KINDS.filter((kind) => !isExpectedReachable({ kind }))).toEqual([]);
  });

  it("gives every API kind at least one admitted call", () => {
    const covered = new Set<CrowdstrikeKind | null>(CROWDSTRIKE_CALLS.map((call) => call.kind));
    const uncovered = CROWDSTRIKE_KINDS.filter((kind) => !covered.has(kind) && kind !== "console-request");
    expect(uncovered).toEqual([]);
  });
});

describe("the descriptor declares both surfaces", () => {
  it("names one API surface and one driven-browser surface of ONE platform", () => {
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.acquisition)).toEqual([
      "api",
      "driven-browser",
    ]);
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.platform).toBe("crowdstrike");
  });

  it("says what it deliberately does not hold", () => {
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.excludes.length).toBeGreaterThan(0);
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.excludes.map((entry) => entry.because).join(" ")).toContain("write operation");
  });
});
