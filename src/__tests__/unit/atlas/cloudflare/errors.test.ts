import { describe, expect, it } from "vitest";

import { CloudflareClientErrors, CloudflareScopeErrors } from "../../../../atlas/cloudflare/errors.js";

describe("CloudflareClientErrors", () => {
  it("builds an authentication error at 401", () => {
    const error = CloudflareClientErrors.authentication({ cause: new Error("nope"), operation: "accounts.get" });
    expect(error.kind).toBe("authentication");
    expect(error.status).toBe(401);
    expect(error.message).toContain("accounts.get");
    expect(error.message).toContain("nope");
  });

  it("builds a permission error at 403", () => {
    const error = CloudflareClientErrors.permission({ cause: new Error("denied"), operation: "zones.list" });
    expect(error.kind).toBe("permission");
    expect(error.status).toBe(403);
  });

  it("builds a not-found error at 404", () => {
    const error = CloudflareClientErrors.notFound({ cause: new Error("gone"), operation: "zones.get" });
    expect(error.kind).toBe("not-found");
    expect(error.status).toBe(404);
  });

  it("builds a rate-limit error at 429", () => {
    const error = CloudflareClientErrors.rateLimit({ cause: new Error("slow down"), operation: "zones.list" });
    expect(error.kind).toBe("rate-limit");
    expect(error.status).toBe(429);
  });

  it("builds a provider error carrying the actual status", () => {
    const error = CloudflareClientErrors.provider({ cause: new Error("boom"), operation: "zones.list", status: 502 });
    expect(error.kind).toBe("provider");
    expect(error.status).toBe(502);
  });

  it("builds a transport error with no status", () => {
    const error = CloudflareClientErrors.transport({ cause: new Error("timed out"), operation: "accounts.get" });
    expect(error.kind).toBe("transport");
    expect(error.message).toContain("timed out");
  });

  it("builds a response-envelope error", () => {
    const error = CloudflareClientErrors.responseEnvelope({
      cause: new Error("success:false"),
      operation: "zones.list",
    });
    expect(error.kind).toBe("response-envelope");
    expect(error.message).toContain("success:false");
  });

  it("builds a schema error", () => {
    const error = CloudflareClientErrors.schema({ cause: "missing field", operation: "zones.list" });
    expect(error.kind).toBe("schema");
    expect(error.message).toContain("missing field");
  });
});

describe("CloudflareScopeErrors", () => {
  it("builds a zone-not-found error naming the configured zone", () => {
    const error = CloudflareScopeErrors.zoneNotFound({ deepZoneName: "example.test" });
    expect(error.kind).toBe("zone-not-found");
    expect(error.deepZoneName).toBe("example.test");
    expect(error.message).toContain("example.test");
  });

  it("builds a zone-ambiguous error carrying the match count", () => {
    const error = CloudflareScopeErrors.zoneAmbiguous({ deepZoneName: "example.test", matchCount: 3 });
    expect(error.kind).toBe("zone-ambiguous");
    expect(error.matchCount).toBe(3);
    expect(error.message).toContain("3");
  });

  it("builds a zone-account-mismatch error naming both accounts", () => {
    const error = CloudflareScopeErrors.zoneAccountMismatch({
      actualAccountId: "b".repeat(32),
      deepZoneName: "example.test",
      expectedAccountId: "a".repeat(32),
    });
    expect(error.kind).toBe("zone-account-mismatch");
    expect(error.expectedAccountId).toBe("a".repeat(32));
    expect(error.actualAccountId).toBe("b".repeat(32));
  });
});
