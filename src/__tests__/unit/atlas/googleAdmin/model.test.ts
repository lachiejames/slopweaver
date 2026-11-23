/**
 * The on-disk vocabulary, pinned to the registry it is supposed to mirror.
 *
 * The assertion that earns its place is the first one: a kind list written by hand beside a generated
 * registry is a list that drifts, and the symptom would be a method with nowhere to be filed.
 */
import { describe, expect, it } from "vitest";

import { GOOGLE_ADMIN_SURFACES } from "../../../../atlas/googleAdmin/generated/surfaces.js";
import {
  emptyGoogleAdminChannels,
  GOOGLE_ADMIN_ATLAS_CHANNELS,
  GOOGLE_ADMIN_ATLAS_KINDS,
  GOOGLE_ADMIN_ENTITY_FAMILIES,
  googleAdminAtlasEntitySchema,
  googleAdminVisibilityScopeFor,
  initialGoogleAdminManifest,
} from "../../../../atlas/googleAdmin/model.js";

describe("the Google Admin atlas model", () => {
  it("declares every kind the registry names, plus the console's landing kind and nothing else", () => {
    const registryKinds = [...new Set(GOOGLE_ADMIN_SURFACES.map((row) => row.kind))];
    expect([...GOOGLE_ADMIN_ATLAS_KINDS].toSorted()).toStrictEqual([...registryKinds, "page"].toSorted());
    expect(GOOGLE_ADMIN_ATLAS_KINDS.length).toBe(83);
  });

  it("declares no operation kind, because the surface map is filed under what it maps", () => {
    expect(GOOGLE_ADMIN_ATLAS_KINDS.includes("operation" as never)).toBe(false);
  });

  it("gives every channel its own visibility ceiling", () => {
    expect(GOOGLE_ADMIN_ATLAS_CHANNELS.map((channel) => googleAdminVisibilityScopeFor({ channel }))).toStrictEqual([
      "published-documents",
      "granted-admin-scopes",
      "console-admin-roles",
    ]);
  });

  it("starts every kind in the manifest unsynced", () => {
    const manifest = initialGoogleAdminManifest({ updatedAt: "2026-09-05T00:00:00.000Z" });
    expect(Object.keys(manifest.kinds).toSorted()).toStrictEqual([...GOOGLE_ADMIN_ATLAS_KINDS].toSorted());
    expect(manifest.kinds["directory-users"]).toStrictEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: null,
      lastSuccessAt: null,
    });
  });

  it("refuses an entity whose family is not one of the four", () => {
    const parsed = googleAdminAtlasEntitySchema.safeParse({
      channels: emptyGoogleAdminChannels(),
      family: "setting",
      id: "a",
      kind: "directory-users",
      providerId: "p",
    });
    expect(parsed.success).toBe(false);
    expect([...GOOGLE_ADMIN_ENTITY_FAMILIES]).toStrictEqual(["operation", "record-shape", "page", "record"]);
  });

  it("accepts an entity no channel has looked at yet", () => {
    const parsed = googleAdminAtlasEntitySchema.safeParse({
      channels: emptyGoogleAdminChannels(),
      family: "page",
      id: "a",
      kind: "page",
      providerId: "/ac/home",
    });
    expect(parsed.success).toBe(true);
  });
});
