/**
 * Unit: what one Admin API response means — the projection, the key, and the two shapes that are not
 * collections at all.
 */
import { describe, expect, it } from "vitest";

import {
  googleAdminNextPageToken,
  googleAdminProjectRecords,
  googleAdminProviderKey,
} from "../../../../../atlas/googleAdmin/adminApi/records.js";

describe("googleAdminProviderKey", () => {
  it("prefers the resource name every Google API published after the Directory one uses", () => {
    expect(googleAdminProviderKey({ fields: { id: "1", name: "groups/abc" } })).toBe("groups/abc");
  });

  it("falls back to the Directory API's own id", () => {
    expect(googleAdminProviderKey({ fields: { id: "112233", primaryEmail: "x@example.test" } })).toBe("112233");
  });

  it("takes the primary address for a resource keyed by neither", () => {
    expect(googleAdminProviderKey({ fields: { primaryEmail: "x@example.test" } })).toBe("x@example.test");
  });

  it("takes the org unit path, which is that resource's own key", () => {
    expect(googleAdminProviderKey({ fields: { orgUnitPath: "/Engineering" } })).toBe("/Engineering");
  });

  it("refuses an empty string rather than keying a record on nothing", () => {
    expect(googleAdminProviderKey({ fields: { id: "", name: "" } })).toBeNull();
  });

  it("refuses a non-string key rather than coercing one", () => {
    expect(googleAdminProviderKey({ fields: { id: 42 } })).toBeNull();
  });

  it("is null for a record carrying no key Google publishes", () => {
    expect(googleAdminProviderKey({ fields: { colour: "blue" } })).toBeNull();
  });
});

describe("googleAdminProjectRecords", () => {
  it("keeps the key and the field NAMES, and no value", () => {
    const projected = googleAdminProjectRecords({
      body: { users: [{ id: "1", primaryEmail: "a@example.test", suspended: false }] },
      collectionField: "users",
    });
    expect(projected.shape).toBe("records");
    expect(projected.records).toStrictEqual([{ fields: ["id", "primaryEmail", "suspended"], providerId: "1" }]);
  });

  it("sorts records by their key, so two reads of one collection publish identical bytes", () => {
    const projected = googleAdminProjectRecords({
      body: { groups: [{ id: "b" }, { id: "a" }] },
      collectionField: "groups",
    });
    expect(projected.records.map((record) => record.providerId)).toStrictEqual(["a", "b"]);
  });

  it("counts an unkeyed record rather than dropping it silently", () => {
    const projected = googleAdminProjectRecords({
      body: { groups: [{ id: "a" }, { colour: "blue" }] },
      collectionField: "groups",
    });
    expect(projected.records).toHaveLength(1);
    expect(projected.unkeyed).toBe(1);
  });

  it("counts a non-object item as unkeyed", () => {
    const projected = googleAdminProjectRecords({ body: { items: ["a string"] }, collectionField: "items" });
    expect(projected.records).toStrictEqual([]);
    expect(projected.unkeyed).toBe(1);
  });

  it("calls a scalar payload an aggregate, which is what countChromeOsDevices returns", () => {
    const projected = googleAdminProjectRecords({ body: { count: 412 }, collectionField: "count" });
    expect(projected.shape).toBe("aggregate");
    expect(projected.records).toStrictEqual([]);
  });

  it("calls an omitted collection absent, which is how Google says none exist", () => {
    const projected = googleAdminProjectRecords({ body: { etag: "x" }, collectionField: "users" });
    expect(projected.shape).toBe("absent");
    expect(projected.records).toStrictEqual([]);
  });

  it("calls an empty array records rather than absent, because it was read and holds none", () => {
    const projected = googleAdminProjectRecords({ body: { users: [] }, collectionField: "users" });
    expect(projected.shape).toBe("records");
    expect(projected.records).toStrictEqual([]);
  });

  it("calls a non-object body absent rather than throwing on it", () => {
    expect(googleAdminProjectRecords({ body: "not json", collectionField: "users" }).shape).toBe("absent");
  });
});

describe("googleAdminNextPageToken", () => {
  it("reads the token Google returns", () => {
    expect(googleAdminNextPageToken({ body: { nextPageToken: "abc" } })).toBe("abc");
  });

  it("is null on the last page, which carries none", () => {
    expect(googleAdminNextPageToken({ body: { users: [] } })).toBeNull();
  });

  it("treats an empty token as the last page rather than asking for a page of nothing", () => {
    expect(googleAdminNextPageToken({ body: { nextPageToken: "" } })).toBeNull();
  });

  it("is null for a body that is not an object", () => {
    expect(googleAdminNextPageToken({ body: null })).toBeNull();
  });
});
