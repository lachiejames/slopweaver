/**
 * What a browser walk recorded about one declared page: every count a non-negative integer, every key named,
 * and an unreachable page carrying a reason rather than an empty string.
 */
import { describe, expect, it } from "vitest";

import { atlasPageDetailSchema, atlasResponseAccountingSchema } from "../../../../atlas/kit/pageObservation.js";

const ACCOUNTING = { bodyFailed: 2, bodySucceeded: 12, eligible: 14, seen: 20 };

const DETAIL = {
  callCount: 7,
  captureComplete: false,
  finalUrl: "https://example.test/settings",
  redirected: true,
  responseAccounting: ACCOUNTING,
  statusCode: 200,
  title: "Settings",
  unreachableBecause: null,
};

describe("atlasResponseAccountingSchema", () => {
  it("parses the four counts to themselves", () => {
    expect(atlasResponseAccountingSchema.parse(ACCOUNTING)).toEqual(ACCOUNTING);
  });

  it("refuses a negative count", () => {
    expect(atlasResponseAccountingSchema.safeParse({ ...ACCOUNTING, bodyFailed: -1 }).success).toBe(false);
  });

  it("refuses a fractional count", () => {
    expect(atlasResponseAccountingSchema.safeParse({ ...ACCOUNTING, seen: 1.5 }).success).toBe(false);
  });

  it("refuses a key it does not name", () => {
    expect(atlasResponseAccountingSchema.safeParse({ ...ACCOUNTING, dropped: 0 }).success).toBe(false);
  });
});

describe("atlasPageDetailSchema", () => {
  it("parses a full detail to itself", () => {
    expect(atlasPageDetailSchema.parse(DETAIL)).toEqual(DETAIL);
  });

  it("accepts a null status code and a reason for an unreachable page", () => {
    const unreachable = { ...DETAIL, statusCode: null, unreachableBecause: "the client rendered a sign-in page" };

    expect(atlasPageDetailSchema.parse(unreachable)).toEqual(unreachable);
  });

  it("refuses an empty unreachableBecause, which would be a reason that says nothing", () => {
    expect(atlasPageDetailSchema.safeParse({ ...DETAIL, unreachableBecause: "" }).success).toBe(false);
  });

  it("refuses an empty finalUrl", () => {
    expect(atlasPageDetailSchema.safeParse({ ...DETAIL, finalUrl: "" }).success).toBe(false);
  });

  it("refuses a fractional call count", () => {
    expect(atlasPageDetailSchema.safeParse({ ...DETAIL, callCount: 2.5 }).success).toBe(false);
  });

  it("refuses a negative count nested in the response accounting", () => {
    expect(
      atlasPageDetailSchema.safeParse({ ...DETAIL, responseAccounting: { ...ACCOUNTING, eligible: -3 } }).success,
    ).toBe(false);
  });

  it("refuses a key it does not name", () => {
    expect(atlasPageDetailSchema.safeParse({ ...DETAIL, screenshot: "shot.png" }).success).toBe(false);
  });
});
