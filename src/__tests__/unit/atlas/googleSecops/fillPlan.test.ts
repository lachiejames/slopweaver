/**
 * Unit: the fill plan accounts for every readonly GET the grant reaches — each one either called or named
 * with why not — and every kind is either called or published blocked on the scope.
 */
import { describe, expect, it } from "vitest";

import {
  GOOGLE_SECOPS_CLOUD_PLATFORM_ONLY_KINDS,
  GOOGLE_SECOPS_FILL_CALLS,
  GOOGLE_SECOPS_NOT_CALLED,
} from "../../../../atlas/googleSecops/fill/plan.js";
import { GOOGLE_SECOPS_SURFACES } from "../../../../atlas/googleSecops/generated/surfaces.js";
import { GOOGLE_SECOPS_ATLAS_KINDS } from "../../../../atlas/googleSecops/model.js";

const READONLY = "https://www.googleapis.com/auth/chronicle.readonly";

/** Every GET the `chronicle.readonly` grant reaches, by id. */
const READONLY_GETS = GOOGLE_SECOPS_SURFACES.filter(
  (row) => row.httpMethod === "GET" && row.scopes.includes(READONLY),
).map((row) => row.id);

describe("GOOGLE_SECOPS_FILL_CALLS and GOOGLE_SECOPS_NOT_CALLED", () => {
  it("partition the 21 readonly GETs exactly", () => {
    expect(READONLY_GETS.length).toBe(21);
    const planned = [
      ...GOOGLE_SECOPS_FILL_CALLS.map((call) => call.id),
      ...GOOGLE_SECOPS_NOT_CALLED.map((row) => row.id),
    ];
    expect(new Set(planned).size).toBe(planned.length);
    expect(planned.toSorted()).toStrictEqual(READONLY_GETS.toSorted());
  });

  it("calls six lists and leaves fifteen uncalled", () => {
    expect(GOOGLE_SECOPS_FILL_CALLS.length).toBe(6);
    expect(GOOGLE_SECOPS_NOT_CALLED.length).toBe(15);
  });

  it("names each call's rpc as the last segment of its inventory id", () => {
    expect(GOOGLE_SECOPS_FILL_CALLS.length).toBeGreaterThan(0);
    expect(GOOGLE_SECOPS_FILL_CALLS.filter((call) => !call.id.endsWith(`.${call.rpc}`))).toStrictEqual([]);
  });
});

describe("GOOGLE_SECOPS_CLOUD_PLATFORM_ONLY_KINDS", () => {
  it("together with the called kinds covers every kind, with no overlap", () => {
    const called = [...new Set(GOOGLE_SECOPS_FILL_CALLS.map((call) => call.kind))];
    expect(called.filter((kind) => GOOGLE_SECOPS_CLOUD_PLATFORM_ONLY_KINDS.includes(kind))).toStrictEqual([]);
    expect([...called, ...GOOGLE_SECOPS_CLOUD_PLATFORM_ONLY_KINDS].toSorted()).toStrictEqual(
      [...GOOGLE_SECOPS_ATLAS_KINDS].toSorted(),
    );
  });
});
