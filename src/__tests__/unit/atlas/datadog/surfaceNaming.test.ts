import { describe, expect, it } from "vitest";

import {
  isUnstablePath,
  kebab,
  kindOf,
  pageSizeParameterOf,
  pagingOf,
  pagingParameterOf,
  surfaceName,
} from "../../../../atlas/datadog/surfaceNaming.js";

describe("kebab", () => {
  it("splits camelCase into hyphenated lower case", () => {
    expect(kebab({ identifier: "listDowntimes" })).toBe("list-downtimes");
  });

  it("collapses a run of non-alphanumerics to one hyphen and trims the ends", () => {
    expect(kebab({ identifier: "__get_system__insights__" })).toBe("get-system-insights");
  });

  it("keeps a digit attached to the word it follows, so v1 does not become v-1", () => {
    expect(kebab({ identifier: "getV2Thing" })).toBe("get-v2-thing");
  });
});

describe("surfaceName", () => {
  it("drops the Api suffix, which every class carries and therefore distinguishes nothing", () => {
    expect(surfaceName({ operationKey: "v1.DowntimesApi.listDowntimes" })).toBe("v1-downtimes-list-downtimes");
  });

  it("keeps an acronym class name readable rather than exploding it letter by letter", () => {
    expect(surfaceName({ operationKey: "v2.APIKeysApi.listAPIKeys" })).toBe("v2-apikeys-list-apikeys");
  });
});

describe("kindOf", () => {
  it("takes the provider's own first meaningful segment", () => {
    expect(kindOf({ path: "/api/v1/monitor/{monitor_id}" })).toBe("monitor");
  });

  it("gives v1 and v2 of one thing the SAME kind, because they are two ways to reach it", () => {
    expect(kindOf({ path: "/api/v1/monitor" })).toBe(kindOf({ path: "/api/v2/monitor/policy" }));
  });

  it("strips the unstable prefix, so an unstable endpoint joins its family rather than hiding in its own", () => {
    expect(kindOf({ path: "/api/unstable/fleet/tracers" })).toBe("fleet");
  });

  it("answers root for a path with no named segment", () => {
    expect(kindOf({ path: "/" })).toBe("root");
  });

  it("handles a path with no /api prefix at all", () => {
    expect(kindOf({ path: "/v1/input" })).toBe("input");
  });
});

describe("isUnstablePath", () => {
  it("is true only for Datadog's own unstable path prefix", () => {
    expect(isUnstablePath({ path: "/api/unstable/fleet/tracers" })).toBe(true);
    expect(isUnstablePath({ path: "/api/v2/fleet/agents" })).toBe(false);
  });
});

describe("pagingOf", () => {
  it("prefers a cursor over an offset, because a cursor survives concurrent writes", () => {
    expect(pagingOf({ parameterNames: ["page[offset]", "page[cursor]"] })).toBe("cursor");
  });

  it("recognises each of Datadog's cursor spellings", () => {
    expect(pagingOf({ parameterNames: ["next_record_id"] })).toBe("cursor");
    expect(pagingOf({ parameterNames: ["page[continuation_token]"] })).toBe("cursor");
    expect(pagingOf({ parameterNames: ["page_token"] })).toBe("cursor");
  });

  it("reads an offset when there is no cursor", () => {
    expect(pagingOf({ parameterNames: ["page[offset]", "page[limit]"] })).toBe("offset");
  });

  it("reads a page number when there is neither", () => {
    expect(pagingOf({ parameterNames: ["page_number", "page_size"] })).toBe("page-number");
  });

  // A bare limit is a CAP rather than a walk, and reporting it as one is what stops a reducer treating a
  // single page as a census.
  it("calls a bare limit what it is, which is not a walk", () => {
    expect(pagingOf({ parameterNames: ["limit"] })).toBe("limit-only");
    expect(pagingOf({ parameterNames: ["page[size]"] })).toBe("limit-only");
  });

  it("answers none when the operation declares no paging parameter at all", () => {
    expect(pagingOf({ parameterNames: ["filter[tag]"] })).toBe("none");
    expect(pagingOf({ parameterNames: [] })).toBe("none");
  });
});

describe("pagingParameterOf — the shape is not issuable, the NAME is", () => {
  it("returns the exact parameter the shape was recognised by", () => {
    expect(pagingParameterOf({ parameterNames: ["page[offset]", "page[cursor]"] })).toBe("page[cursor]");
  });

  it("agrees with pagingOf on which rung it picked, so a walker cannot be handed a mismatched pair", () => {
    const names = ["page[size]", "page[number]"];
    expect(pagingOf({ parameterNames: names })).toBe("page-number");
    expect(pagingParameterOf({ parameterNames: names })).toBe("page[number]");
  });

  it("names nothing when the operation does not walk", () => {
    expect(pagingParameterOf({ parameterNames: ["query", "from", "to"] })).toBe(null);
  });

  it("names a bare size cap, because `limit-only` is still a rung of the same table", () => {
    expect(pagingParameterOf({ parameterNames: ["count"] })).toBe("count");
  });
});

describe("pageSizeParameterOf", () => {
  it("finds a size cap that sits alongside a cursor, which the paging SHAPE hides", () => {
    expect(pageSizeParameterOf({ parameterNames: ["page[cursor]", "page[size]"] })).toBe("page[size]");
  });

  it("recognises each spelling Datadog uses for a page size", () => {
    expect(pageSizeParameterOf({ parameterNames: ["per_page"] })).toBe("per_page");
    expect(pageSizeParameterOf({ parameterNames: ["limit"] })).toBe("limit");
    expect(pageSizeParameterOf({ parameterNames: ["count"] })).toBe("count");
  });

  it("names nothing when the operation declares no cap", () => {
    expect(pageSizeParameterOf({ parameterNames: ["page[number]"] })).toBe(null);
  });
});
