/**
 * The `atlas-estate` row — the vendor-agnostic door into the atlas estate.
 *
 * MEASURED on one install: `turn brief --contracts` offered 35 atlas rows and the string
 * `atlas probe` appeared in none of them, so a turn asking "who has access to X" — naming no vendor —
 * could reach an atlas only by guessing which one. `../../../route/atlasCapability.ts` cannot close that
 * by construction: a derived row's vocabulary is the platform NAME alone.
 *
 * Two of the groups below are about the one sharp edge this row has. `atlasPlatformOf` reads
 * `command[indexOf("atlas") + 1]`, so this row's "platform" is the literal `probe`. That is inert, and
 * these cases are what make it inert on PURPOSE rather than by luck — they fail the day a platform called
 * `probe` is registered, or the day the row's command stops putting a non-platform word in that slot.
 *
 * Every assertion is on text a reader actually sees: `../../../live/turn/briefCapabilityContracts.ts`'s
 * `renderCapabilityContracts` prints `what`, `freshness` and `coverage`, and `buildRoutingCapabilities`
 * never reads `terms`, so a claim written into `availability.reason` alone would change nothing in the brief.
 */
import { describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../../atlas/registry.js";
import { withDerivedAtlasCapabilities } from "../../../route/atlasCapability.js";
import { ATLAS_ESTATE_CAPABILITY } from "../../../route/atlasEstateCapability.js";
import { atlasPlatformOf, deriveAtlasCapability } from "../../../route/atlasReading.js";
import { QUESTION_COMMAND_TOKEN, sourceCapabilitySchema } from "../../../route/profile.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/sourcePlan.js";

const ESTATE = ATLAS_ESTATE_CAPABILITY;

describe("the `atlas-estate` row", () => {
  // The row lives in its own module for `file-size-ratchet`'s sake, so this is the case that fails if
  // splicing it back into the generic table is ever dropped — the split must change nothing a brief prints.
  it("is the very row the generic table ships, not a second copy of it", () => {
    expect(GENERIC_SOURCE_CAPABILITIES).toContain(ATLAS_ESTATE_CAPABILITY);
  });

  it("is a reachable, current-truth read", () => {
    expect(ESTATE.availability).toEqual({ kind: "available" });
    expect(ESTATE.truthMode).toBe("current");
    expect(ESTATE.effect).toBe("read");
    expect(ESTATE.sourceClass).toBe("atlas");
  });

  it("runs the keyword-LESS scope read, never a whole question fed to a keyword filter", () => {
    expect(ESTATE.command).toEqual(["slopweaver", "atlas", "probe"]);
    expect(ESTATE.command).not.toContain(QUESTION_COMMAND_TOKEN);
  });

  it("names the keyword form as the separate reading act, in the text the brief prints", () => {
    expect(ESTATE.coverage.detail).toContain("slopweaver atlas probe <keyword> [<keyword>…]");
    expect(ESTATE.coverage.detail).toContain("reads as ABSENCE");
  });

  it("parses through the real schema, so nothing drops it on the way into a profile", () => {
    expect(sourceCapabilitySchema.parse(ESTATE).id).toBe("atlas-estate");
  });

  it("names the hand-off verb that carries the claim boundary, in the text the brief prints", () => {
    expect(ESTATE.coverage.detail).toContain("slopweaver atlas <platform> read --kind <kind> --query <keyword>");
  });

  it("states the STORED-records boundary, which is the sentence the estate-evidence finding is about", () => {
    expect(ESTATE.coverage.detail).toContain("proves nothing about what a provider holds");
    expect(ESTATE.coverage.detail).toContain("never a provider holding none");
  });

  it("names `store import-atlas` as what fills it, so an empty read is read as the store and not the estate", () => {
    expect(ESTATE.coverage.detail).toContain("slopweaver store import-atlas");
    expect(ESTATE.freshness.kind).toBe("snapshot");
    expect(ESTATE.freshness.detail).toContain("last-synced instant");
  });

  it("opens `what` on the vendor-agnostic claim, which is the whole reason it is not a derived row", () => {
    expect(ESTATE.what.startsWith("which of the atlases this store holds have a keyword at all")).toBe(true);
    expect(ESTATE.what).toContain("names no platform");
  });

  it("carries vendor-agnostic terms — the words a question that names no platform actually uses", () => {
    expect(ESTATE.terms).toContain("which platform");
    expect(ESTATE.terms).toContain("who has");
    expect(ESTATE.terms).toContain("across the estate");
  });
});

describe("the `probe` slot `atlasPlatformOf` reads out of this row", () => {
  it("is the literal `probe`, which is the edge the next two cases hold down", () => {
    expect(atlasPlatformOf({ capability: ESTATE })).toBe("probe");
  });

  it("is not a registered platform, so it suppresses no derived row", () => {
    expect(atlasPlatforms().length).toBeGreaterThan(0);
    expect(atlasPlatforms()).not.toContain("probe");
  });

  it("leaves the row untouched when nothing grades it, rather than clearing its command", () => {
    expect(deriveAtlasCapability({ capability: ESTATE, reading: undefined })).toEqual(ESTATE);
  });

  it("still derives a row for every registered platform with this row in the base table", () => {
    const derived = withDerivedAtlasCapabilities({
      atlases: [{ platform: "aether", summary: "The Aether pentest portal atlas" }],
      baseCapabilities: [ESTATE],
    });
    expect(derived.map((capability) => capability.id)).toEqual(["atlas-estate", "aether-atlas"]);
  });
});
