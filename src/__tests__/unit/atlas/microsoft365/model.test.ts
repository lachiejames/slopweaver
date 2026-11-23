import { describe, expect, it } from "vitest";

import {
  emptyMicrosoft365KindFile,
  initialMicrosoft365Manifest,
  MICROSOFT365_ATLAS_PLATFORM,
  MICROSOFT365_CHANNELS,
  MICROSOFT365_KINDS,
  MICROSOFT365_PAGE_KIND,
  microsoft365AtlasKindFileSchema,
  microsoft365AtlasManifestSchema,
  microsoft365VisibilityScopeFor,
} from "../../../../atlas/microsoft365/model.js";
import { MICROSOFT365_SPEC_PIN } from "../../../../atlas/microsoft365/specLock.js";

const AT = "2026-09-05T00:00:00.000Z";

describe("MICROSOFT365_KINDS", () => {
  it("is unique and sorted, so the catalogue a reader gets back is predictable", () => {
    expect(new Set(MICROSOFT365_KINDS).size).toBe(MICROSOFT365_KINDS.length);
    expect([...MICROSOFT365_KINDS]).toEqual([...MICROSOFT365_KINDS].toSorted());
  });

  it("declares one kind per pinned resource root, plus the browser surface's own", () => {
    expect(MICROSOFT365_KINDS.length).toBe(MICROSOFT365_SPEC_PIN.rootCount + 1);
    expect(MICROSOFT365_KINDS).toContain(MICROSOFT365_PAGE_KIND);
  });
});

describe("microsoft365VisibilityScopeFor", () => {
  it("gives each channel its own ceiling, because the three are unrelated", () => {
    expect(microsoft365VisibilityScopeFor({ channel: "compiled" })).toBe("compiled-published-specification");
    expect(microsoft365VisibilityScopeFor({ channel: "api" })).toBe("api-application-consent");
    expect(microsoft365VisibilityScopeFor({ channel: "browser" })).toBe("browser-signed-in-roles");
  });

  it("covers every declared channel", () => {
    const scopes = MICROSOFT365_CHANNELS.map((channel) => microsoft365VisibilityScopeFor({ channel }));
    expect(new Set(scopes).size).toBe(MICROSOFT365_CHANNELS.length);
  });
});

describe("initialMicrosoft365Manifest", () => {
  it("names every kind and vouches for nothing", () => {
    const manifest = initialMicrosoft365Manifest({ updatedAt: AT });
    expect(Object.keys(manifest.kinds).toSorted()).toEqual([...MICROSOFT365_KINDS]);
    expect(manifest.kinds["users"]).toEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: null,
      lastSuccessAt: null,
    });
    expect(microsoft365AtlasManifestSchema.safeParse(manifest).success).toBe(true);
  });
});

describe("emptyMicrosoft365KindFile", () => {
  it("is a valid, empty file for its own kind", () => {
    const file = emptyMicrosoft365KindFile({ kind: "policies", updatedAt: AT });
    expect(file.kind).toBe("policies");
    expect(file.platform).toBe(MICROSOFT365_ATLAS_PLATFORM);
    expect(file.entities).toEqual([]);
    expect(microsoft365AtlasKindFileSchema.safeParse(file).success).toBe(true);
  });

  it("refuses a kind file carrying a field the schema does not declare", () => {
    const file = { ...emptyMicrosoft365KindFile({ kind: "policies", updatedAt: AT }), tenant: "someone" };
    expect(microsoft365AtlasKindFileSchema.safeParse(file).success).toBe(false);
  });
});
