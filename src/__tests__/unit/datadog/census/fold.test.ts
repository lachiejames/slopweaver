import { describe, expect, it } from "vitest";

import type { TrackEvent } from "../../../../datadog/census/event.js";
import { envsOf, foldExemplars, statusesOf, templateFrom, withoutSigil } from "../../../../datadog/census/fold.js";

/** Two exemplars of one shape, differing in the values that vary per event. */
function exemplars(): readonly TrackEvent[] {
  return [
    {
      attributes: {
        "@err.code": "P2028",
        "@http.status_code": 500,
        "@usr.email": "someone@example.com",
        message: "[handler] transaction 4821 failed",
        service: "jobs-api",
        status: "error",
        tags: ["env:production", "service:jobs-api"],
      },
      message: "[handler] transaction 4821 failed",
      occurredAtIso: "2026-09-15T10:00:00.000Z",
    },
    {
      attributes: {
        "@err.code": "P2028",
        "@http.status_code": null,
        env: "staging",
        message: "[handler] transaction 9137 failed",
        service: "jobs-api",
        status: "warn",
      },
      message: "[handler] transaction 9137 failed",
      occurredAtIso: "2026-09-15T12:30:00.000Z",
    },
  ];
}

describe("withoutSigil", () => {
  it("strips the @ a custom attribute carries, so the facet allowlist sees the facet's own name", () => {
    expect(withoutSigil({ path: "@http.status_code" })).toBe("http.status_code");
  });

  it("leaves a reserved path untouched", () => {
    expect(withoutSigil({ path: "status" })).toBe("status");
  });
});

describe("envsOf — the tag list and the field are both read, because the tracks disagree", () => {
  it("reads an environment out of the tags array, which is where a log carries it", () => {
    expect(envsOf({ events: exemplars() })).toEqual(["production", "staging"]);
  });

  it("keeps an EMPTY list rather than inventing (none) when nothing declared one", () => {
    expect(
      envsOf({ events: [{ attributes: { service: "x" }, message: null, occurredAtIso: "2026-09-15T00:00:00.000Z" }] }),
    ).toEqual([]);
  });
});

describe("statusesOf", () => {
  it("collects every status the exemplars carried", () => {
    expect(statusesOf({ events: exemplars() })).toEqual(["error", "warn"]);
  });
});

describe("templateFrom — the per-event values are replaced so two instances fold to one template", () => {
  it("normalises the numbers that vary per event", () => {
    expect(templateFrom({ events: exemplars() })).toBe("[handler] transaction <n> failed");
  });

  it("answers nothing when no exemplar carried a message", () => {
    expect(
      templateFrom({ events: [{ attributes: {}, message: null, occurredAtIso: "2026-09-15T00:00:00.000Z" }] }),
    ).toBeNull();
  });
});

describe("foldExemplars", () => {
  it("keeps every attribute path with the types seen at it, in the query spelling", () => {
    const folded = foldExemplars({ events: exemplars() });
    const statusCode = folded.paths.find((path) => path.path === "@http.status_code")!;
    expect(statusCode.types).toEqual(["null", "number"]);
  });

  it("keeps an allowlisted facet's values", () => {
    const folded = foldExemplars({ events: exemplars() });
    const errCode = folded.facets.find((facet) => facet.path === "err.code")!;
    expect(errCode.values).toEqual(["P2028"]);
  });

  it("keeps NO value for a path outside the allowlist, however useful it looks", () => {
    const folded = foldExemplars({ events: exemplars() });
    expect(folded.facets.map((facet) => facet.path)).not.toContain("usr.email");
  });

  it("carries the first and last instant of the exemplars it folded", () => {
    const folded = foldExemplars({ events: exemplars() });
    expect(folded.firstSeenIso).toBe("2026-09-15T10:00:00.000Z");
    expect(folded.lastSeenIso).toBe("2026-09-15T12:30:00.000Z");
    expect(folded.exemplars).toBe(2);
  });

  it("answers the counted-but-never-exemplified shape for an empty sample", () => {
    const folded = foldExemplars({ events: [] });
    expect(folded.exemplars).toBe(0);
    expect(folded.paths).toEqual([]);
    expect(folded.firstSeenIso).toBeNull();
  });
});
