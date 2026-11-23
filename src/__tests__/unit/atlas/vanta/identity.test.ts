import { describe, expect, it } from "vitest";

import { stableGapId } from "../../../../atlas/kit/identity.js";
import { vantaEntityId } from "../../../../atlas/vanta/identity.js";

describe("vantaEntityId", () => {
  it("is stable for the same kind and components", () => {
    const a = vantaEntityId({ components: { providerId: "c1" }, kind: "control" });
    const b = vantaEntityId({ components: { providerId: "c1" }, kind: "control" });
    expect(a).toBe(b);
  });

  it("differs across kinds sharing a provider id", () => {
    const control = vantaEntityId({ components: { providerId: "same" }, kind: "control" });
    const risk = vantaEntityId({ components: { providerId: "same" }, kind: "risk" });
    expect(control).not.toBe(risk);
  });

  it("differs when a component value differs", () => {
    const a = vantaEntityId({ components: { providerId: "c1" }, kind: "control" });
    const b = vantaEntityId({ components: { providerId: "c2" }, kind: "control" });
    expect(a).not.toBe(b);
  });

  it("is a 32-character hex digest", () => {
    const id = vantaEntityId({ components: { providerId: "c1" }, kind: "control" });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("stableGapId", () => {
  it("is stable for the same condition and scope", () => {
    const a = stableGapId({ condition: "schema-drift", scope: "controls-active" });
    const b = stableGapId({ condition: "schema-drift", scope: "controls-active" });
    expect(a).toBe(b);
  });

  it("differs across scopes for the same condition", () => {
    const a = stableGapId({ condition: "schema-drift", scope: "controls-active" });
    const b = stableGapId({ condition: "schema-drift", scope: "controls-deactivated" });
    expect(a).not.toBe(b);
  });
});
