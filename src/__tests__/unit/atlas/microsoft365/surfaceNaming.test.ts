import { describe, expect, it } from "vitest";

import {
  microsoft365AliasOf,
  microsoft365ConsoleLinkFor,
  microsoft365KindOf,
  microsoft365PaginationOf,
  microsoft365ProviderId,
} from "../../../../atlas/microsoft365/surfaceNaming.js";

describe("microsoft365KindOf", () => {
  it("takes Graph's own first path segment", () => {
    expect(microsoft365KindOf({ pathShape: "/users/{user-id}/manager" })).toBe("users");
  });

  it("cuts an OData function's arguments off the first segment", () => {
    expect(microsoft365KindOf({ pathShape: "/reports/getEmailActivityCounts(period='{period}')" })).toBe("reports");
  });

  it("answers null for a root this build does not declare, rather than inventing a kind", () => {
    expect(microsoft365KindOf({ pathShape: "/somethingMicrosoftAddedLastNight" })).toBeNull();
  });
});

describe("microsoft365ProviderId", () => {
  it("is the method and the path, upper-cased and joined by a space", () => {
    expect(microsoft365ProviderId({ method: "get", pathShape: "/users" })).toBe("GET /users");
  });
});

describe("microsoft365AliasOf", () => {
  const declared = new Set(["/users/{user-id}/messages", "/me/messages", "/me/drive"]);

  it("names the /users counterpart a /me path duplicates", () => {
    expect(microsoft365AliasOf({ declaredPaths: declared, pathShape: "/me/messages" })).toBe(
      "/users/{user-id}/messages",
    );
  });

  it("claims no alias when the counterpart is not declared", () => {
    expect(microsoft365AliasOf({ declaredPaths: declared, pathShape: "/me/drive" })).toBeNull();
  });

  it("claims no alias for a path that is not under /me", () => {
    expect(microsoft365AliasOf({ declaredPaths: declared, pathShape: "/users/{user-id}/messages" })).toBeNull();
  });

  it("does not mistake a root whose name merely starts with me", () => {
    expect(microsoft365AliasOf({ declaredPaths: declared, pathShape: "/messages" })).toBeNull();
  });
});

describe("microsoft365PaginationOf", () => {
  it("reads OData top/skip paging off the parameter names", () => {
    expect(microsoft365PaginationOf({ parameterNames: ["$top", "$skip", "$select"] })).toBe("odata-top-skip");
  });

  it("prefers a skip token when one is declared", () => {
    expect(microsoft365PaginationOf({ parameterNames: ["$top", "$skiptoken"] })).toBe("odata-skip-token");
  });

  it("answers none for a single-entity read", () => {
    expect(microsoft365PaginationOf({ parameterNames: ["$select", "$expand"] })).toBe("none");
  });
});

describe("microsoft365ConsoleLinkFor", () => {
  it("knows the console page a kind is governed on", () => {
    expect(microsoft365ConsoleLinkFor({ kind: "users" })).toBe(
      "https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade",
    );
  });

  it("answers null rather than constructing a link it does not know", () => {
    expect(microsoft365ConsoleLinkFor({ kind: "filterOperators" })).toBeNull();
  });
});
