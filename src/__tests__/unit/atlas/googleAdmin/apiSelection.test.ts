/**
 * Which of Google's 528 APIs this atlas selected, and the near misses it recorded rather than dropped.
 *
 * The assertion that earns its place is the last one: the criterion's own prose must match what the
 * descriptor quotes, because three copies of a criterion is three places for it to drift, and a criterion
 * a reader cannot check is a criterion that has stopped constraining anything.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GOOGLE_ADMIN_ADJACENT_APIS,
  GOOGLE_ADMIN_SELECTION_CRITERION,
  googleAdminUnmappedConsoleApis,
} from "../../../../atlas/googleAdmin/apiSelection.js";
import { GOOGLE_ADMIN_ATLAS_DESCRIPTOR } from "../../../../atlas/googleAdmin/descriptor.js";
import { GOOGLE_ADMIN_DISCOVERY_PINS } from "../../../../atlas/googleAdmin/generated/discoveryLock.js";

describe("the Google Admin API selection", () => {
  it("pins eleven documents and rejects six named near misses", () => {
    expect(GOOGLE_ADMIN_DISCOVERY_PINS.length).toBe(11);
    expect(GOOGLE_ADMIN_ADJACENT_APIS.length).toBe(6);
  });

  it("names no rejected API that is also pinned", () => {
    const pinned = new Set(GOOGLE_ADMIN_DISCOVERY_PINS.map((pin) => pin.api));
    expect(GOOGLE_ADMIN_ADJACENT_APIS.filter((candidate) => pinned.has(candidate.api))).toStrictEqual([]);
  });

  it("gives every rejected API a reason, and none an empty one", () => {
    for (const candidate of GOOGLE_ADMIN_ADJACENT_APIS) {
      expect(candidate.reason.length).toBeGreaterThan(40);
    }
  });

  it("says which two misses actually cost a console page", () => {
    expect([...googleAdminUnmappedConsoleApis()]).toStrictEqual(["cloudsearch", "drivelabels"]);
  });

  it("does not count a console page a SELECTED document already administers", () => {
    // `appsmarket` is why `hasConsolePage` is not "a page exists" — the Marketplace-apps page is reached
    // through the selected `directory` and `chrome-management` documents, so its miss costs the map nothing.
    const marketplace = GOOGLE_ADMIN_ADJACENT_APIS.find((candidate) => candidate.api === "appsmarket")!;
    expect(marketplace.hasConsolePage).toBe(false);
  });

  it("records the one API that passes the computed criterion and is dropped by judgement", () => {
    const reseller = GOOGLE_ADMIN_ADJACENT_APIS.find((candidate) => candidate.api === "reseller")!;
    expect(reseller.reason).toContain("PASSES the computed criterion");
    expect(reseller.reason).toContain("dropped by judgement");
  });

  it("keeps the atlases page's own count of unmapped console pages tied to the code", () => {
    // A sentence once said "three" while this module derived two, and nothing
    // compared them. A number in prose beside a number in code is drift waiting to happen, so the prose
    // is now asserted here rather than trusted.
    const page = readFileSync(new URL("../../../../../docs/atlases/google-admin.md", import.meta.url), "utf8");
    const words = ["zero", "one", "two", "three", "four", "five", "six"];
    expect(page).toContain(`and ${words[googleAdminUnmappedConsoleApis().length]!} of them cost a real`);
  });

  it("quotes one criterion, so the descriptor and this module cannot drift apart", () => {
    expect(
      GOOGLE_ADMIN_ATLAS_DESCRIPTOR.excludes.some((entry) => entry.because.includes(GOOGLE_ADMIN_SELECTION_CRITERION)),
    ).toBe(true);
  });
});
