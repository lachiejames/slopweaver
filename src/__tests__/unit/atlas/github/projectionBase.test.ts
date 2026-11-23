/**
 * The shared readers every GitHub projection reaches into a response with, and the provenance every stored
 * entity carries.
 *
 * Every source field carries its own sentinel, so a reader that reached for the wrong key, the wrong entry
 * field or the wrong half of the context returns a visibly different value rather than a coincidentally
 * equal one. The context's `at` and `observedAt` are deliberately different instants for the same reason.
 */
import { describe, expect, it } from "vitest";

import { githubEntityId } from "../../../../atlas/github/identity.js";
import {
  baseOf,
  bool,
  idsOf,
  int,
  iso,
  nested,
  type ProjectionContext,
  providerIdOf,
  scopedOf,
  sourceOf,
  str,
  strings,
} from "../../../../atlas/github/projectionBase.js";

const CONTEXT: ProjectionContext = {
  at: "2026-09-01T01:01:01.000Z",
  source: {
    endpoint: "GET /orgs/context-endpoint-sentinel",
    observedAt: "2026-09-02T02:02:02.000Z",
    surface: "rest-live",
  },
};

const DEEP_LINK = "https://github.com/deep-link-sentinel";

/** One response body; every key holds a value of a different type, so a wrong-key read is visible. */
const RAW: Record<string, unknown> = {
  array_field: ["array-sentinel"],
  bool_field: true,
  empty_text: "",
  false_field: false,
  id: 90210,
  ids_field: [
    { id: "id-47", name: "name-decoy-47" },
    { id: 31, name: "name-decoy-31" },
    { id: "", name: "name-decoy-empty" },
    { name: "name-decoy-idless", other: 9 },
    { id: 31, name: "name-decoy-duplicate" },
    { id: true, name: "name-decoy-boolean" },
    "bare-string-entry",
    null,
  ],
  infinite_field: Number.POSITIVE_INFINITY,
  int_field: 17.9,
  invalid_iso: "not-a-date",
  iso_field: "2026-09-05T10:30:00+10:00",
  iso_utc_field: "2026-09-06T11:12:13Z",
  nan_field: Number.NaN,
  negative_field: -3.7,
  nested_field: { inner: "nested-sentinel" },
  node_id: "node-id-decoy",
  null_field: null,
  numeric_text: "17",
  other_text: "other-text-sentinel",
  strings_field: ["zeta", "alpha", "zeta", "", 44, null],
  text_bool: "true",
  text_field: "text-sentinel",
  whole_field: 42,
};

describe("str", () => {
  it("reads the named string field and not a neighbour", () => {
    expect(str({ key: "text_field", raw: RAW })).toBe("text-sentinel");
    expect(str({ key: "other_text", raw: RAW })).toBe("other-text-sentinel");
  });

  it("returns null for an empty string, a non-string, an explicit null and a missing key", () => {
    expect(str({ key: "empty_text", raw: RAW })).toBe(null);
    expect(str({ key: "int_field", raw: RAW })).toBe(null);
    expect(str({ key: "bool_field", raw: RAW })).toBe(null);
    expect(str({ key: "null_field", raw: RAW })).toBe(null);
    expect(str({ key: "absent_field", raw: RAW })).toBe(null);
  });
});

describe("bool", () => {
  it("reads true from the true field and false from its false neighbour", () => {
    expect(bool({ key: "bool_field", raw: RAW })).toBe(true);
    expect(bool({ key: "false_field", raw: RAW })).toBe(false);
  });

  it("returns null rather than false for a string, a number, an explicit null and a missing key", () => {
    expect(bool({ key: "text_bool", raw: RAW })).toBe(null);
    expect(bool({ key: "whole_field", raw: RAW })).toBe(null);
    expect(bool({ key: "null_field", raw: RAW })).toBe(null);
    expect(bool({ key: "absent_field", raw: RAW })).toBe(null);
  });
});

describe("int", () => {
  it("truncates toward zero and keeps a whole number unchanged", () => {
    expect(int({ key: "int_field", raw: RAW })).toBe(17);
    expect(int({ key: "negative_field", raw: RAW })).toBe(-3);
    expect(int({ key: "whole_field", raw: RAW })).toBe(42);
  });

  it("returns null for a numeric string, a non-finite number, an explicit null and a missing key", () => {
    expect(int({ key: "numeric_text", raw: RAW })).toBe(null);
    expect(int({ key: "infinite_field", raw: RAW })).toBe(null);
    expect(int({ key: "nan_field", raw: RAW })).toBe(null);
    expect(int({ key: "null_field", raw: RAW })).toBe(null);
    expect(int({ key: "absent_field", raw: RAW })).toBe(null);
  });
});

describe("iso", () => {
  it("normalises a numeric-offset timestamp to the same instant in UTC", () => {
    expect(iso({ key: "iso_field", raw: RAW })).toBe("2026-09-05T00:30:00.000Z");
  });

  it("keeps a UTC timestamp's instant and writes it with milliseconds", () => {
    expect(iso({ key: "iso_utc_field", raw: RAW })).toBe("2026-09-06T11:12:13.000Z");
  });

  it("returns null for an unparseable string, an empty string, a number and a missing key", () => {
    expect(iso({ key: "invalid_iso", raw: RAW })).toBe(null);
    expect(iso({ key: "empty_text", raw: RAW })).toBe(null);
    expect(iso({ key: "whole_field", raw: RAW })).toBe(null);
    expect(iso({ key: "absent_field", raw: RAW })).toBe(null);
  });
});

describe("strings", () => {
  it("keeps every non-empty string, sorted and de-duplicated, and drops the rest", () => {
    expect(strings({ key: "strings_field", raw: RAW })).toEqual(["alpha", "zeta"]);
  });

  it("reads the named array and not a neighbour", () => {
    expect(strings({ key: "array_field", raw: RAW })).toEqual(["array-sentinel"]);
  });

  it("returns an empty list for a field that is not an array, and for a missing key", () => {
    expect(strings({ key: "text_field", raw: RAW })).toEqual([]);
    expect(strings({ key: "absent_field", raw: RAW })).toEqual([]);
  });
});

describe("idsOf", () => {
  it("keeps every numeric and non-empty string id, as strings, sorted and de-duplicated, never another field", () => {
    expect(idsOf({ key: "ids_field", raw: RAW })).toEqual(["31", "id-47"]);
  });

  it("returns an empty list for a field that is not an array, and for a missing key", () => {
    expect(idsOf({ key: "nested_field", raw: RAW })).toEqual([]);
    expect(idsOf({ key: "absent_field", raw: RAW })).toEqual([]);
  });
});

describe("nested", () => {
  it("returns the named nested record", () => {
    expect(nested({ key: "nested_field", raw: RAW })).toEqual({ inner: "nested-sentinel" });
  });

  it("returns an empty record for an array, a string, an explicit null and a missing key", () => {
    expect(nested({ key: "array_field", raw: RAW })).toEqual({});
    expect(nested({ key: "text_field", raw: RAW })).toEqual({});
    expect(nested({ key: "null_field", raw: RAW })).toEqual({});
    expect(nested({ key: "absent_field", raw: RAW })).toEqual({});
  });
});

describe("providerIdOf", () => {
  it("reads a numeric id as its string, ignoring the neighbouring node id", () => {
    expect(providerIdOf({ fallback: "fallback-sentinel", raw: RAW })).toBe("90210");
  });

  it("keeps a non-empty string id as given", () => {
    expect(providerIdOf({ fallback: "fallback-sentinel", raw: { id: "provider-string-id" } })).toBe(
      "provider-string-id",
    );
  });

  it("uses the fallback for an empty string id, a boolean id and a body with no id", () => {
    expect(providerIdOf({ fallback: "fallback-empty", raw: { id: "" } })).toBe("fallback-empty");
    expect(providerIdOf({ fallback: "fallback-boolean", raw: { id: true } })).toBe("fallback-boolean");
    expect(providerIdOf({ fallback: "fallback-absent", raw: { node_id: "node-id-decoy" } })).toBe("fallback-absent");
  });
});

describe("sourceOf", () => {
  it("carries a provider-provided deep link and the context's endpoint, observation time and surface", () => {
    expect(sourceOf({ context: CONTEXT, deepLink: DEEP_LINK })).toEqual({
      artifacts: [],
      deepLink: DEEP_LINK,
      deepLinkStatus: "provider-provided",
      endpoint: "GET /orgs/context-endpoint-sentinel",
      observedAt: "2026-09-02T02:02:02.000Z",
      surface: "rest-live",
    });
  });

  it("marks a missing deep link unavailable", () => {
    expect(sourceOf({ context: CONTEXT, deepLink: null })).toEqual({
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "GET /orgs/context-endpoint-sentinel",
      observedAt: "2026-09-02T02:02:02.000Z",
      surface: "rest-live",
    });
  });
});

describe("baseOf", () => {
  it("fills the base fields from the run's `at`, the derived identity and the source", () => {
    expect(
      baseOf({
        context: CONTEXT,
        deepLink: DEEP_LINK,
        kind: "webhook",
        providerId: "provider-sentinel",
        scopeRef: "scope-sentinel",
      }),
    ).toEqual({
      firstSeenAt: "2026-09-01T01:01:01.000Z",
      id: githubEntityId({ kind: "webhook", providerId: "provider-sentinel", scopeRef: "scope-sentinel" }),
      providerId: "provider-sentinel",
      source: {
        artifacts: [],
        deepLink: DEEP_LINK,
        deepLinkStatus: "provider-provided",
        endpoint: "GET /orgs/context-endpoint-sentinel",
        observedAt: "2026-09-02T02:02:02.000Z",
        surface: "rest-live",
      },
      state: "observed",
    });
  });

  it("derives a different identity when the scope and provider id trade places", () => {
    const base = baseOf({
      context: CONTEXT,
      deepLink: null,
      kind: "webhook",
      providerId: "provider-sentinel",
      scopeRef: "scope-sentinel",
    });
    expect(base.id).not.toBe(
      githubEntityId({ kind: "webhook", providerId: "scope-sentinel", scopeRef: "provider-sentinel" }),
    );
  });
});

describe("scopedOf", () => {
  it("adds the scope level and reference to the base fields", () => {
    expect(
      scopedOf({
        context: CONTEXT,
        deepLink: null,
        kind: "deploy-key",
        providerId: "scoped-provider-sentinel",
        scopeLevel: "repository",
        scopeRef: "owner-sentinel/repo-sentinel",
      }),
    ).toEqual({
      firstSeenAt: "2026-09-01T01:01:01.000Z",
      id: githubEntityId({
        kind: "deploy-key",
        providerId: "scoped-provider-sentinel",
        scopeRef: "owner-sentinel/repo-sentinel",
      }),
      providerId: "scoped-provider-sentinel",
      scopeLevel: "repository",
      scopeRef: "owner-sentinel/repo-sentinel",
      source: {
        artifacts: [],
        deepLink: null,
        deepLinkStatus: "unavailable",
        endpoint: "GET /orgs/context-endpoint-sentinel",
        observedAt: "2026-09-02T02:02:02.000Z",
        surface: "rest-live",
      },
      state: "observed",
    });
  });
});
