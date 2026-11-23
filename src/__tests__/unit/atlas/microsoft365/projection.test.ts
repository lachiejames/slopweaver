import { describe, expect, it } from "vitest";

import { microsoft365EntityId } from "../../../../atlas/microsoft365/identity.js";
import { foldMicrosoft365Channel, mergeMicrosoft365Channel } from "../../../../atlas/microsoft365/merge.js";
import { microsoft365AtlasEntitySchema } from "../../../../atlas/microsoft365/model.js";
import { projectMicrosoft365Operation } from "../../../../atlas/microsoft365/projection.js";
import type { Microsoft365OperationRow } from "../../../../atlas/microsoft365/specRead.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const LATER = "2026-09-06T00:00:00.000Z";

/** One row, with every field set so a test states only what it is about. */
function row(over: Partial<Microsoft365OperationRow> = {}): Microsoft365OperationRow {
  return {
    aliasOf: null,
    disposition: "reachable",
    dispositionReason: "identity or configuration",
    dispositionRuleId: "configuration-default",
    kind: "users",
    method: "GET",
    operationId: "users.user.ListUser",
    pagination: "odata-top-skip",
    pathParams: [],
    pathShape: "/users",
    providerId: "GET /users",
    queryParams: ["$select", "$top"],
    responseFields: ["displayName", "id"],
    responseSchema: "microsoft.graph.user",
    summary: "List users",
    tags: ["users.user"],
    ...over,
  };
}

describe("projectMicrosoft365Operation", () => {
  it("fills only the compiled channel, because the other two have never looked", () => {
    const entity = projectMicrosoft365Operation({ at: AT, row: row() });
    expect(entity.channels.api).toBeNull();
    expect(entity.channels.browser).toBeNull();
    expect(entity.channels.compiled?.state).toBe("observed");
  });

  it("is a valid stored entity", () => {
    const entity = projectMicrosoft365Operation({ at: AT, row: row() });
    expect(microsoft365AtlasEntitySchema.safeParse(entity).success).toBe(true);
  });

  it("keeps only names — no value from the document reaches the detail", () => {
    const entity = projectMicrosoft365Operation({ at: AT, row: row() });
    expect(entity.channels.compiled?.detail).toEqual({
      aliasOf: null,
      disposition: "reachable",
      dispositionReason: "identity or configuration",
      method: "GET",
      operationId: "users.user.ListUser",
      pathParams: [],
      pathShape: "/users",
      queryParams: ["$select", "$top"],
      responseFields: ["displayName", "id"],
      responseSchema: "microsoft.graph.user",
      summary: "List users",
      tags: ["users.user"],
    });
  });

  it("records the Graph address the operation is reached at, as its reproduction handle", () => {
    const entity = projectMicrosoft365Operation({ at: AT, row: row() });
    expect(entity.channels.compiled?.source?.endpoint).toBe("https://graph.microsoft.com/v1.0/users");
  });

  it("carries the console page its KIND is governed on, when this atlas knows one", () => {
    const entity = projectMicrosoft365Operation({ at: AT, row: row() });
    expect(entity.channels.compiled?.source?.deepLinkStatus).toBe("provider-provided");
  });

  it("says a link is unavailable rather than constructing one it does not know", () => {
    const entity = projectMicrosoft365Operation({
      at: AT,
      row: row({ kind: "filterOperators", pathShape: "/filterOperators", providerId: "GET /filterOperators" }),
    });
    expect(entity.channels.compiled?.source?.deepLink).toBeNull();
    expect(entity.channels.compiled?.source?.deepLinkStatus).toBe("unavailable");
  });

  it("gives an operation a stable id from its kind and provider key", () => {
    const entity = projectMicrosoft365Operation({ at: AT, row: row() });
    expect(entity.id).toBe(microsoft365EntityId({ kind: "users", providerId: "GET /users" }));
  });

  it("does not collide across kinds that share a provider key", () => {
    expect(microsoft365EntityId({ kind: "users", providerId: "GET /x" })).not.toBe(
      microsoft365EntityId({ kind: "groups", providerId: "GET /x" }),
    );
  });
});

describe("mergeMicrosoft365Channel", () => {
  it("carries firstSeenAt forward, so a long-known operation is not reported as new", () => {
    const stored = [projectMicrosoft365Operation({ at: AT, row: row() })];
    const merged = unwrap(
      mergeMicrosoft365Channel({
        at: LATER,
        channel: "compiled",
        observed: [projectMicrosoft365Operation({ at: LATER, row: row() })],
        stored,
      }),
    );
    expect(merged[0]?.channels.compiled?.firstSeenAt).toBe(AT);
    expect(merged[0]?.channels.compiled?.lastSeenAt).toBe(LATER);
  });

  it("stales an operation this run did not see rather than dropping it", () => {
    const stored = [projectMicrosoft365Operation({ at: AT, row: row() })];
    const merged = unwrap(mergeMicrosoft365Channel({ at: LATER, channel: "compiled", observed: [], stored }));
    expect(merged.length).toBe(1);
    expect(merged[0]?.channels.compiled?.state).toBe("stale");
  });

  it("takes a new operation's own first sight, since nothing stored has a stamp to carry", () => {
    const merged = unwrap(
      mergeMicrosoft365Channel({
        at: LATER,
        channel: "compiled",
        observed: [projectMicrosoft365Operation({ at: LATER, row: row() })],
        stored: [],
      }),
    );
    expect(merged[0]?.channels.compiled?.firstSeenAt).toBe(LATER);
    expect(merged[0]?.channels.api).toBeNull();
  });

  it("refuses a run that reported the same operation twice", () => {
    const observed = [
      projectMicrosoft365Operation({ at: AT, row: row() }),
      projectMicrosoft365Operation({ at: AT, row: row() }),
    ];
    const merged = mergeMicrosoft365Channel({ at: AT, channel: "compiled", observed, stored: [] });
    expect(unwrapErr(merged)[0]).toContain("this run produced the same entity id twice:");
    expect(unwrapErr(merged)[1]).toBe(
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    );
  });
});

describe("foldMicrosoft365Channel", () => {
  const known = projectMicrosoft365Operation({ at: AT, row: row() });
  const seen = projectMicrosoft365Operation({ at: LATER, row: row() });

  it("stamps a channel the stored entity never held with this run's sighting, keeping the others it held", () => {
    const stored = { ...known, channels: { ...known.channels, browser: known.channels.compiled, compiled: null } };
    const folded = foldMicrosoft365Channel({ channel: "compiled", observed: seen, stored });
    expect(folded.channels.compiled).toEqual(seen.channels.compiled);
    expect(folded.channels.browser).toEqual(known.channels.compiled);
  });

  it("keeps the stored view of a channel this run saw nothing on, and every other channel the store held", () => {
    const stored = { ...known, channels: { ...known.channels, api: known.channels.compiled } };
    const folded = foldMicrosoft365Channel({ channel: "api", observed: seen, stored });
    expect(folded.channels.api).toEqual(known.channels.compiled);
    expect(folded.channels.compiled).toEqual(known.channels.compiled);
  });

  it("writes nothing on a channel a brand-new entity was not seen on", () => {
    const folded = foldMicrosoft365Channel({ channel: "api", observed: seen, stored: undefined });
    expect(folded.channels).toEqual(seen.channels);
  });
});
