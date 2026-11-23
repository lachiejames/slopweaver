/**
 * The pure naming and paging decisions the JumpCloud surface generator makes.
 *
 * Every case uses a value distinct from its neighbours, so a rule that read the wrong input, or applied its
 * checks in the wrong order, lands on a different answer rather than coincidentally the same one.
 */
import { describe, expect, it } from "vitest";

import {
  kebabOperationId,
  kindOf,
  normalizedPath,
  paginationOf,
  surfaceName,
} from "../../../../atlas/jumpcloud/surfaceNaming.js";

describe("kebabOperationId", () => {
  it("splits camelCase at each lower-to-upper boundary", () => {
    expect(kebabOperationId({ operationId: "getSystemInsightsApps" })).toBe("get-system-insights-apps");
  });

  it("splits at a digit-to-upper boundary too", () => {
    expect(kebabOperationId({ operationId: "v2Systemgroups" })).toBe("v2-systemgroups");
  });

  it("turns snake_case underscores into hyphens", () => {
    expect(kebabOperationId({ operationId: "list_policy_results" })).toBe("list-policy-results");
  });

  it("collapses a run of mixed separators into one hyphen", () => {
    expect(kebabOperationId({ operationId: "graphUser__memberOf..Groups" })).toBe("graph-user-member-of-groups");
  });

  it("strips leading and trailing separators instead of emitting a dangling hyphen", () => {
    expect(kebabOperationId({ operationId: "__ldap.servers--Get__" })).toBe("ldap-servers-get");
  });

  it("keeps an acronym run as one word, since only a lower-to-upper boundary splits", () => {
    expect(kebabOperationId({ operationId: "postSSOConfig" })).toBe("post-ssoconfig");
  });

  it("answers an empty fragment for an empty operation id", () => {
    expect(kebabOperationId({ operationId: "" })).toBe("");
  });
});

describe("surfaceName", () => {
  it("prefixes the v1 spec", () => {
    expect(surfaceName({ operationId: "systems_list", spec: "v1" })).toBe("v1-systems-list");
  });

  it("prefixes the v2 spec", () => {
    expect(surfaceName({ operationId: "graphUserMemberOf", spec: "v2" })).toBe("v2-graph-user-member-of");
  });

  it("prefixes the insights spec", () => {
    expect(surfaceName({ operationId: "listDirectoryApps", spec: "insights" })).toBe("insights-list-directory-apps");
  });
});

describe("normalizedPath", () => {
  it("hangs a v1 path off /api", () => {
    expect(normalizedPath({ pathKey: "/systems", spec: "v1" })).toBe("/api/systems");
  });

  it("hangs a v2 path off /api/v2", () => {
    expect(normalizedPath({ pathKey: "/users", spec: "v2" })).toBe("/api/v2/users");
  });

  it("hangs an insights path off /insights/directory/v1", () => {
    expect(normalizedPath({ pathKey: "/apps", spec: "insights" })).toBe("/insights/directory/v1/apps");
  });

  it("keeps the path key's brace parameters verbatim", () => {
    expect(normalizedPath({ pathKey: "/usergroups/{group_id}/members", spec: "v2" })).toBe(
      "/api/v2/usergroups/{group_id}/members",
    );
  });
});

describe("paginationOf", () => {
  it("walks by skip when skip is declared beside a cursor, whatever the declaration order", () => {
    expect(paginationOf({ parameterNames: ["limit", "cursor", "skip"] })).toBe("limit-skip");
  });

  it("lets skip beat offset", () => {
    expect(paginationOf({ parameterNames: ["offset", "skip"] })).toBe("limit-skip");
  });

  it("walks by offset when offset is declared beside a token", () => {
    expect(paginationOf({ parameterNames: ["next_token", "offset", "limit"] })).toBe("limit-offset");
  });

  it("reads a token spelling case-insensitively", () => {
    expect(paginationOf({ parameterNames: ["filter", "nextToken"] })).toBe("token");
  });

  it("reads a cursor spelling as a token walk, ahead of a limit", () => {
    expect(paginationOf({ parameterNames: ["limit", "pageCursor"] })).toBe("token");
  });

  it("reads search_after as a token walk", () => {
    expect(paginationOf({ parameterNames: ["sort", "search_after"] })).toBe("token");
  });

  it("reports limit alone as a cap rather than a walk", () => {
    expect(paginationOf({ parameterNames: ["fields", "limit"] })).toBe("limit-only");
  });

  it("matches skip, offset and limit as whole names, not as substrings", () => {
    expect(paginationOf({ parameterNames: ["skipCount", "offsets", "limits"] })).toBe("none");
  });

  it("answers none for an operation declaring no parameters", () => {
    expect(paginationOf({ parameterNames: [] })).toBe("none");
  });
});

describe("kindOf", () => {
  it("takes the first segment of an ordinary path", () => {
    expect(kindOf({ pathKey: "/systems/{system_id}/memberof" })).toBe("systems");
  });

  it("keeps the provider's own hyphenated vocabulary", () => {
    expect(kindOf({ pathKey: "/password-vault/items" })).toBe("password-vault");
  });

  it("skips a run of leading slashes", () => {
    expect(kindOf({ pathKey: "///systeminsights/apps" })).toBe("systeminsights");
  });

  it("reads a path with no leading slash", () => {
    expect(kindOf({ pathKey: "policyresults" })).toBe("policyresults");
  });

  it("answers root for the bare root path", () => {
    expect(kindOf({ pathKey: "/" })).toBe("root");
  });

  it("answers root for a path of slashes only", () => {
    expect(kindOf({ pathKey: "///" })).toBe("root");
  });

  it("answers root for an empty path", () => {
    expect(kindOf({ pathKey: "" })).toBe("root");
  });
});
