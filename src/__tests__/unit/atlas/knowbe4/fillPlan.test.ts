/**
 * The KnowBe4 call plan accounts for every GET the Reporting API publishes: the paths it calls and the paths it
 * names as deliberately uncalled partition the spec's 24, and the plan calls exactly the transport's closed list.
 */
import { describe, expect, it } from "vitest";

import { KNOWBE4_ATLAS_DESCRIPTOR, KNOWBE4_REPORTING_SPEC } from "../../../../atlas/knowbe4/descriptor.js";
import { KNOWBE4_FILL_CALLS, KNOWBE4_NOT_CALLED } from "../../../../atlas/knowbe4/fill/plan.js";
import { KNOWBE4_ATLAS_KINDS } from "../../../../atlas/knowbe4/model.js";
import { KNOWBE4_PATH_TEMPLATES } from "../../../../live/knowbe4/transport.js";

describe("the KnowBe4 fill plan", () => {
  it("calls exactly the transport's closed list", () => {
    expect(KNOWBE4_FILL_CALLS.map((call) => call.template).toSorted()).toEqual([...KNOWBE4_PATH_TEMPLATES]);
  });

  it("names eleven called and thirteen uncalled paths, which together are the spec's 24 GETs", () => {
    const called = KNOWBE4_FILL_CALLS.map((call) => call.template);
    const notCalled = KNOWBE4_NOT_CALLED.map((entry) => entry.template);
    expect([called.length, notCalled.length, KNOWBE4_REPORTING_SPEC.getPathTemplates]).toEqual([11, 13, 24]);
    expect(new Set([...called, ...notCalled]).size).toBe(24);
  });

  it("gives every uncalled path a reason", () => {
    expect(KNOWBE4_NOT_CALLED.length).toBeGreaterThan(0);
    expect(KNOWBE4_NOT_CALLED.filter((entry) => entry.because.length === 0)).toEqual([]);
  });

  it("reads every kind with exactly one path", () => {
    expect(KNOWBE4_FILL_CALLS.map((call) => call.kind).toSorted()).toEqual([...KNOWBE4_ATLAS_KINDS].toSorted());
  });

  it("calls a per-parent path only after the list that names its parents", () => {
    const order = KNOWBE4_FILL_CALLS.map((call) => call.template);
    const children = KNOWBE4_FILL_CALLS.filter((call) => call.parent !== null);
    expect(children.map((call) => [call.template, call.parent])).toEqual([
      ["/v1/groups/{id}/members", "/v1/groups"],
      ["/v1/phishing/security_tests/{id}/recipients", "/v1/phishing/security_tests"],
    ]);
    expect(children.filter((call) => order.indexOf(call.parent!) > order.indexOf(call.template))).toEqual([]);
  });

  it("reads the account first, so a later 403 is read against its subscription tier", () => {
    expect(KNOWBE4_FILL_CALLS[0]!.template).toBe("/v1/account");
  });
});

describe("the KnowBe4 descriptor", () => {
  it("declares the Reporting API as 24 published GETs with the eleven the plan calls reached", () => {
    const api = KNOWBE4_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "reporting-api-v1")!;
    expect([api.denominator, api.acquisition, api.role]).toEqual([
      { exists: 24, known: true, reached: 11, source: expect.any(String) },
      "api",
      "authoritative",
    ]);
  });

  it("refuses every write and declares the per-person due date a claim it does not make", () => {
    expect(KNOWBE4_ATLAS_DESCRIPTOR.writePolicy).toBe("refuse-every-write");
    expect(KNOWBE4_ATLAS_DESCRIPTOR.excludes.map((entry) => entry.ground)).toContain("claim-not-made");
  });
});
