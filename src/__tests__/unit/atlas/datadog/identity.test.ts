import { describe, expect, it } from "vitest";

import { datadogEntityId, datadogGapId } from "../../../../atlas/datadog/identity.js";

describe("datadogEntityId", () => {
  it("is stable for the same kind and provider id", () => {
    expect(datadogEntityId({ kind: "monitor", providerId: "v1-monitors-list-monitors" })).toBe(
      datadogEntityId({ kind: "monitor", providerId: "v1-monitors-list-monitors" }),
    );
  });

  it("returns a 32-character hex digest", () => {
    expect(datadogEntityId({ kind: "monitor", providerId: "p" })).toMatch(/^[0-9a-f]{32}$/);
  });

  // Two kinds sharing a provider id must not collide, which is the whole reason the namespace carries the
  // kind as well as the platform.
  it("namespaces by kind, so one provider id in two kinds is two entities", () => {
    expect(datadogEntityId({ kind: "monitor", providerId: "shared" })).not.toBe(
      datadogEntityId({ kind: "dashboard", providerId: "shared" }),
    );
  });
});

describe("datadogGapId", () => {
  it("is the (condition, scope) pair and nothing else", () => {
    expect(datadogGapId({ condition: "api-never-called", scope: "monitor" })).toBe(
      datadogGapId({ condition: "api-never-called", scope: "monitor" }),
    );
    expect(datadogGapId({ condition: "api-never-called", scope: "monitor" })).not.toBe(
      datadogGapId({ condition: "console-never-walked", scope: "monitor" }),
    );
  });
});
