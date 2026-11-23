/**
 * The on-disk vocabulary, pinned to the registry it is supposed to mirror.
 *
 * The assertion that earns its place is the first one: a kind list written by hand beside a generated
 * registry is a list that drifts, and the symptom would be an operation with nowhere to be filed.
 */
import { describe, expect, it } from "vitest";

import { NIGHTFALL_SURFACES } from "../../../../atlas/nightfall/generated/surfaces.js";
import {
  emptyNightfallChannels,
  initialNightfallManifest,
  NIGHTFALL_ATLAS_CHANNELS,
  NIGHTFALL_ATLAS_KINDS,
  NIGHTFALL_ENTITY_FAMILIES,
  nightfallAtlasEntitySchema,
  nightfallVisibilityScopeFor,
} from "../../../../atlas/nightfall/model.js";

describe("the Nightfall atlas model", () => {
  it("declares every kind the registry names, plus the console's landing kind and nothing else", () => {
    const registryKinds = [...new Set(NIGHTFALL_SURFACES.map((row) => row.kind))].toSorted();
    expect([...NIGHTFALL_ATLAS_KINDS].toSorted()).toStrictEqual([...registryKinds, "page"].toSorted());
    expect(NIGHTFALL_ATLAS_KINDS.length).toBe(19);
  });

  it("declares no operation kind, because the surface map is filed under what it maps", () => {
    expect(NIGHTFALL_ATLAS_KINDS.includes("operation" as never)).toBe(false);
  });

  it("gives every channel its own visibility ceiling", () => {
    expect(NIGHTFALL_ATLAS_CHANNELS.map((channel) => nightfallVisibilityScopeFor({ channel }))).toStrictEqual([
      "published-documents",
      "bearer-token-scopes",
      "console-signed-in-roles",
    ]);
  });

  it("starts every kind in the manifest unsynced", () => {
    const manifest = initialNightfallManifest({ updatedAt: "2026-09-05T00:00:00.000Z" });
    expect(Object.keys(manifest.kinds).toSorted()).toStrictEqual([...NIGHTFALL_ATLAS_KINDS].toSorted());
    expect(manifest.kinds.violation).toStrictEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: null,
      lastSuccessAt: null,
    });
  });

  it("refuses an entity whose family is not one of the three", () => {
    const parsed = nightfallAtlasEntitySchema.safeParse({
      channels: emptyNightfallChannels(),
      family: "detection",
      id: "a",
      kind: "violation",
      providerId: "p",
    });
    expect(parsed.success).toBe(false);
    expect([...NIGHTFALL_ENTITY_FAMILIES]).toStrictEqual(["operation", "record-shape", "record"]);
  });

  it("accepts an entity no channel has looked at yet", () => {
    const parsed = nightfallAtlasEntitySchema.safeParse({
      channels: emptyNightfallChannels(),
      family: "record",
      id: "a",
      kind: "violation",
      providerId: "p",
    });
    expect(parsed.success).toBe(true);
  });
});
