/**
 * The effectful half of the Xero API surface, read against the package this build actually installs.
 *
 * Every number here is a MEASUREMENT of `xero-node` 19.1.0 rather than a target, so a version bump moves the
 * assertions that use one. The assertions that matter more are the shape ones — a surface with no operations
 * or no response fields reads identically to one whose parser broke, and both are refused.
 */
import { describe, expect, it } from "vitest";

import { modelNameOf, readXeroSdkSurface, XERO_SDK_PACKAGE } from "../../../../atlas/xero/sdkRead.js";
import { unwrap } from "../../../../lib/result.js";

describe("readXeroSdkSurface", () => {
  const surface = unwrap(readXeroSdkSurface());

  it("reads the installed client's own generated API classes", () => {
    expect(surface.operations.length).toBeGreaterThan(0);
  });

  it("names the version that declared them, so the surface is version-scoped", () => {
    expect(surface.version.length).toBeGreaterThan(0);
  });

  it("gives every operation a module it was declared in", () => {
    expect(surface.operations.filter((operation) => operation.module.length === 0)).toEqual([]);
  });

  it("gives every operation an upper-cased HTTP method", () => {
    expect(
      surface.operations.filter((operation) => operation.httpMethod !== operation.httpMethod.toUpperCase()),
    ).toEqual([]);
  });

  it("gives every operation a path, because a row that cannot say what it addresses is not a handle", () => {
    expect(surface.operations.filter((operation) => operation.path.length === 0)).toEqual([]);
  });

  it("gives every operation a base path, so the product root is never guessed", () => {
    expect(surface.operations.filter((operation) => !operation.basePath.startsWith("https://"))).toEqual([]);
  });

  it("reads the accounting client, which is the one every Xero organisation exposes", () => {
    expect(surface.modules).toContain("accountingApi");
  });

  it("reads the bank feeds client, whose statement lines are half the voluminous class", () => {
    expect(surface.modules).toContain("bankfeedsApi");
  });

  it("finds the operation that lists invoices, which is the amount half of spend-per-vendor", () => {
    expect(
      surface.operations.some((operation) => operation.path === "/Invoices" && operation.httpMethod === "GET"),
    ).toBe(true);
  });

  it("finds the operation that lists the general ledger, which is the voluminous family the ask names", () => {
    expect(
      surface.operations.some((operation) => operation.path === "/Journals" && operation.httpMethod === "GET"),
    ).toBe(true);
  });

  it("reads the tenant header every accounting call is scoped by", () => {
    const invoices = surface.operations.find(
      (operation) => operation.path === "/Invoices" && operation.httpMethod === "GET",
    )!;
    expect(invoices.headerParams).toContain("xero-tenant-id");
  });

  it("reads response FIELDS, which is the half a hand-written endpoint list cannot carry", () => {
    expect(surface.modelFields["Invoice"]).toContain("AmountDue");
  });

  it("names the package it read, so an error can point somewhere", () => {
    expect(XERO_SDK_PACKAGE).toBe("xero-node");
  });
});

describe("modelNameOf", () => {
  it("upper-cases a generated file's stem into the name an operation deserialises into", () => {
    expect(modelNameOf({ file: "invoice.js" })).toBe("Invoice");
  });

  it("leaves an already-capitalised stem alone", () => {
    expect(modelNameOf({ file: "CISSettings.js" })).toBe("CISSettings");
  });
});
