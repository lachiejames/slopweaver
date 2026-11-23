/**
 * The on-disk vocabulary, and the two ways it could silently drift.
 *
 * The kind list is written out as a literal so the type is a real union rather than `string`, which means it
 * can fall out of step with the vendor tags it is supposed to mirror. That is what the first test guards —
 * it is the whole reason the list is allowed to be a literal at all.
 */
import { describe, expect, it } from "vitest";

import {
  byCanvaKind,
  CANVA_ATLAS_CHANNELS,
  CANVA_ATLAS_KINDS,
  CANVA_ATLAS_PLATFORM,
  CANVA_PAGE_KIND,
  canvaAtlasKindFileSchema,
  canvaVisibilityScopeFor,
  emptyCanvaChannels,
  emptyCanvaKindFile,
  initialCanvaManifest,
} from "../../../../atlas/canva/model.js";
import { CANVA_OPERATION_KINDS } from "../../../../atlas/canva/surfaceNaming.js";

describe("CANVA_ATLAS_KINDS", () => {
  it("is exactly the vendor's own tags plus the browser surface's own kind", () => {
    expect([...CANVA_ATLAS_KINDS]).toStrictEqual([...CANVA_OPERATION_KINDS, CANVA_PAGE_KIND].toSorted());
  });

  it("holds seventeen kinds — sixteen the vendor tags, and page", () => {
    expect(CANVA_ATLAS_KINDS.length).toBe(17);
  });
});

describe("canvaVisibilityScopeFor", () => {
  it("gives each channel its own ceiling, because the three are unrelated", () => {
    expect(canvaVisibilityScopeFor({ channel: "published-api" })).toBe("published-description");
    expect(canvaVisibilityScopeFor({ channel: "connect-api" })).toBe("integration-scopes-and-entitlements");
    expect(canvaVisibilityScopeFor({ channel: "web-app" })).toBe("web-app-signed-in-account");
  });
});

describe("byCanvaKind", () => {
  it("builds one entry per declared kind and passes each kind to the builder", () => {
    const built = byCanvaKind({ build: ({ kind }) => kind.toUpperCase() });
    expect(Object.keys(built).toSorted()).toStrictEqual([...CANVA_ATLAS_KINDS].toSorted());
    expect(built.folder).toBe("FOLDER");
  });
});

describe("emptyCanvaChannels", () => {
  it("gives every channel a null slot, so a channel that never looked says so", () => {
    expect(emptyCanvaChannels()).toStrictEqual({ "connect-api": null, "published-api": null, "web-app": null });
    expect(Object.keys(emptyCanvaChannels()).toSorted()).toStrictEqual([...CANVA_ATLAS_CHANNELS].toSorted());
  });
});

describe("the kind file schema", () => {
  it("accepts an empty file for a declared kind", () => {
    const file = emptyCanvaKindFile({ kind: "design", updatedAt: "2026-09-06T00:00:00.000Z" });
    const parsed = canvaAtlasKindFileSchema.safeParse(file);
    expect(parsed.success).toBe(true);
    expect(file.platform).toBe(CANVA_ATLAS_PLATFORM);
  });

  it("refuses a file whose kind the model does not declare", () => {
    const file = { ...emptyCanvaKindFile({ kind: "design", updatedAt: "2026-09-06T00:00:00.000Z" }), kind: "brands" };
    expect(canvaAtlasKindFileSchema.safeParse(file).success).toBe(false);
  });

  it("refuses an unknown field rather than dropping it, because the schema is strict", () => {
    const file = { ...emptyCanvaKindFile({ kind: "design", updatedAt: "2026-09-06T00:00:00.000Z" }), extra: 1 };
    expect(canvaAtlasKindFileSchema.safeParse(file).success).toBe(false);
  });
});

describe("initialCanvaManifest", () => {
  it("names every declared kind and claims nothing has been synced", () => {
    const manifest = initialCanvaManifest({ updatedAt: "2026-09-06T00:00:00.000Z" });
    expect(Object.keys(manifest.kinds).toSorted()).toStrictEqual([...CANVA_ATLAS_KINDS].toSorted());
    expect(manifest.kinds.design).toStrictEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: null,
      lastSuccessAt: null,
    });
  });
});
