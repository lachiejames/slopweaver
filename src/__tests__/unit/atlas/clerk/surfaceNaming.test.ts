/**
 * The naming layer that decides which of Clerk's APIs a call belongs to, and what the two channels are
 * matched on.
 *
 * This is where a wrong answer manufactures a disagreement, so every edge the design argued about is
 * asserted here rather than left to a live walk: the two APIs sharing one host, the Frontend API's
 * templated server, the production custom domain the dashboard's own Frontend API sits on, and the
 * suffix test that keeps a look-alike domain out of a first-party surface map.
 */
import { describe, expect, it } from "vitest";

import {
  clerkApiForHost,
  clerkPaginationOf,
  clerkProviderId,
  clerkServerPath,
  clerkWirePath,
  isClerkApi,
  isFirstPartyClerkHost,
} from "../../../../atlas/clerk/surfaceNaming.js";

describe("clerkServerPath", () => {
  it("reads the path off a server URL that has one", () => {
    expect(clerkServerPath({ serverUrl: "https://api.clerk.com/v1" })).toBe("/v1");
  });

  it("answers empty for a bare host, which is what the Frontend API document declares", () => {
    expect(clerkServerPath({ serverUrl: "https://{domain}.clerk.accounts.dev" })).toBe("");
  });

  it("drops a trailing slash so two spellings of one prefix cannot produce two wire paths", () => {
    expect(clerkServerPath({ serverUrl: "https://api.clerk.com/v1/" })).toBe("/v1");
  });
});

describe("clerkWirePath", () => {
  it("prepends the server's own prefix to a declared path", () => {
    expect(clerkWirePath({ declaredPath: "/users", serverPath: "/v1" })).toBe("/v1/users");
  });

  it("leaves a path alone when its document's server carries no prefix", () => {
    expect(clerkWirePath({ declaredPath: "/v1/environment", serverPath: "" })).toBe("/v1/environment");
  });
});

describe("clerkApiForHost", () => {
  it("splits the two APIs that share api.clerk.com on the platform path prefix", () => {
    expect(clerkApiForHost({ host: "api.clerk.com", wirePath: "/v1/users" })).toBe("bapi");
    expect(clerkApiForHost({ host: "api.clerk.com", wirePath: "/v1/platform/applications" })).toBe("platform");
  });

  it("names the dashboard's own undocumented API", () => {
    expect(clerkApiForHost({ host: "dapi.clerk.com", wirePath: "/v1/workspace_status" })).toBe("dashboard");
  });

  it("folds a development Frontend API host onto fapi", () => {
    expect(clerkApiForHost({ host: "enabled-mole-42.clerk.accounts.dev", wirePath: "/v1/client" })).toBe("fapi");
  });

  it("folds a production Frontend API custom domain onto fapi, which is how the dashboard's own is reached", () => {
    expect(clerkApiForHost({ host: "clerk.clerk.com", wirePath: "/v1/environment" })).toBe("fapi");
  });

  it("records an unanticipated first-party host as other rather than dropping it", () => {
    expect(clerkApiForHost({ host: "scdn.clerk.com", wirePath: "/v1/projects/x/settings" })).toBe("other");
  });

  it("answers null for a host that is not Clerk's", () => {
    expect(clerkApiForHost({ host: "o449981.ingest.us.sentry.io", wirePath: "/api/1/envelope/" })).toBe(null);
  });

  it("answers null for Clerk's own telemetry domain, because the registrable domain is the line", () => {
    expect(clerkApiForHost({ host: "clerk-telemetry.com", wirePath: "/v1/event" })).toBe(null);
  });
});

describe("isFirstPartyClerkHost", () => {
  it("accepts the bare domain and any subdomain of it", () => {
    expect(isFirstPartyClerkHost({ host: "clerk.com" })).toBe(true);
    expect(isFirstPartyClerkHost({ host: "DAPI.CLERK.COM" })).toBe(true);
  });

  it("accepts a development Frontend API host, which sits on Clerk's second domain rather than clerk.com", () => {
    expect(isFirstPartyClerkHost({ host: "enabled-mole-42.clerk.accounts.dev" })).toBe(true);
  });

  it("rejects a look-alike of the second domain too", () => {
    expect(isFirstPartyClerkHost({ host: "notaccounts.dev" })).toBe(false);
  });

  it("rejects a look-alike prefix", () => {
    expect(isFirstPartyClerkHost({ host: "notclerk.com" })).toBe(false);
  });

  it("rejects a look-alike suffix, which a substring test would admit", () => {
    expect(isFirstPartyClerkHost({ host: "clerk.com.evil.test" })).toBe(false);
  });
});

describe("clerkProviderId", () => {
  it("keys on the method, the API and the wire path, upper-casing the method", () => {
    expect(clerkProviderId({ api: "bapi", method: "get", wirePath: "/v1/users" })).toBe("GET bapi:/v1/users");
  });

  it("gives the two APIs sharing a path different keys, which is why the API is in the key", () => {
    expect(clerkProviderId({ api: "bapi", method: "GET", wirePath: "/v1/api_keys" })).not.toBe(
      clerkProviderId({ api: "fapi", method: "GET", wirePath: "/v1/api_keys" }),
    );
  });
});

describe("clerkPaginationOf", () => {
  it("names limit-offset when both are declared", () => {
    expect(clerkPaginationOf({ parameterNames: ["limit", "offset", "query"] })).toBe("limit-offset");
  });

  it("names limit-only when just the limit is declared", () => {
    expect(clerkPaginationOf({ parameterNames: ["limit"] })).toBe("limit-only");
  });

  it("names none for a single-entity read", () => {
    expect(clerkPaginationOf({ parameterNames: ["user_id"] })).toBe("none");
  });
});

describe("isClerkApi", () => {
  it("accepts every declared API name", () => {
    expect(isClerkApi("dashboard")).toBe(true);
  });

  it("rejects a name this atlas does not declare", () => {
    expect(isClerkApi("webhooks")).toBe(false);
  });
});
