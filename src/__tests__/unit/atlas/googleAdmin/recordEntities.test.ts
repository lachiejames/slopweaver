/*
 * The record entities a fill contributes to one kind, built directly from a typed fill observation — pure,
 * so no filesystem, clock or network is needed.
 */
import { describe, expect, it } from "vitest";

import type { GoogleAdminFillObservation } from "../../../../atlas/googleAdmin/adminApi/observation.js";
import { recordEntities } from "../../../../atlas/googleAdmin/recordEntities.js";

const AT = "2026-09-06T04:00:00.000Z";

/** A fill that read the given records under one operation of one kind. */
function fillOf({
  kind,
  id,
  records,
}: {
  kind: string;
  id: string;
  records: GoogleAdminFillObservation["operations"][number]["records"];
}): GoogleAdminFillObservation {
  return {
    excluded: [],
    failed: [],
    filledAtIso: AT,
    grantedScopes: [],
    operations: [{ aggregate: false, document: "admin.reports_v1", id, kind, records, truncated: false }],
  };
}

describe("recordEntities", () => {
  it("builds no record for a shape-indexed kind, even when the fill read one", () => {
    const fill = fillOf({
      id: "reports.activities.list",
      kind: "reports-activities",
      records: [{ fields: ["id"], providerId: "1" }],
    });
    expect(recordEntities({ at: AT, fill, kind: "reports-activities" })).toStrictEqual([]);
  });

  it("sorts the records it builds by Google's own key", () => {
    const fill = fillOf({
      id: "directory.users.list",
      kind: "directory-users",
      records: [
        { fields: ["id"], providerId: "z" },
        { fields: ["id"], providerId: "a" },
      ],
    });
    const entities = recordEntities({ at: AT, fill, kind: "directory-users" });
    expect(entities.map((entity) => entity.providerId)).toStrictEqual(["a", "z"]);
    expect(entities.map((entity) => entity.family)).toStrictEqual(["record", "record"]);
  });

  it("builds nothing when no fill has run", () => {
    expect(recordEntities({ at: AT, fill: null, kind: "directory-users" })).toStrictEqual([]);
  });
});
