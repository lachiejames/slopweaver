/**
 * Unit: what a fill observation DOES to the published generation — the half that decides whether the atlas
 * tells the truth about itself, and the half no network is needed to test.
 */
import { describe, expect, it } from "vitest";

import type { GoogleAdminFillObservation } from "../../../../../atlas/googleAdmin/adminApi/observation.js";
import { buildGoogleAdminGeneration } from "../../../../../atlas/googleAdmin/sync.js";
import { unwrap } from "../../../../../lib/result.js";

const AT = "2026-09-06T04:00:00.000Z";

/** A fill that read two users and nothing else. */
function usersFill({
  aggregate = false,
  truncated = false,
  records = [
    { fields: ["id", "primaryEmail"], providerId: "1" },
    { fields: ["id", "primaryEmail"], providerId: "2" },
  ],
}: {
  aggregate?: boolean;
  truncated?: boolean;
  records?: GoogleAdminFillObservation["operations"][number]["records"];
} = {}): GoogleAdminFillObservation {
  return {
    excluded: [],
    failed: [],
    filledAtIso: AT,
    grantedScopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
    operations: [
      {
        aggregate,
        document: "admin.directory_v1",
        id: "directory.users.list",
        kind: "directory-users",
        records,
        truncated,
      },
    ],
  };
}

/** The `admin-api` cell one kind carries in a built generation. */
function apiCell({ generation, kind }: { generation: ReturnType<typeof builtWith>; kind: string }) {
  return generation.files[kind as keyof typeof generation.files].coverage.find((cell) => cell.channel === "admin-api")!;
}

/** Build a generation with one fill observation, unwrapping the Result a caller would check. */
function builtWith({ fill }: { fill: GoogleAdminFillObservation | null }) {
  return unwrap(buildGoogleAdminGeneration({ at: AT, fill }));
}

describe("with no fill at all", () => {
  const generation = builtWith({ fill: null });

  it("leaves every admin-api cell not-configured, which is what it was before this verb existed", () => {
    expect(apiCell({ generation, kind: "directory-users" }).state).toBe("not-configured");
  });

  it("keeps the no-admin-scope gap on a kind nothing has read", () => {
    const gaps = generation.files["directory-users"].gaps.map((gap) => gap.condition);
    expect(gaps).toContain("no-admin-scope");
  });
});

describe("with a fill that read a kind", () => {
  const generation = builtWith({ fill: usersFill() });

  it("marks that kind synced and counts what it stored", () => {
    const cell = apiCell({ generation, kind: "directory-users" });
    expect(cell.state).toBe("synced");
    expect(cell.reason).toContain("stored 2 record(s)");
  });

  it("stamps the cell with the FILL's own instant, not the publish time", () => {
    expect(apiCell({ generation, kind: "directory-users" }).lastSuccessAt).toBe(AT);
  });

  it("closes the no-admin-scope gap on that kind by making it false", () => {
    const gaps = generation.files["directory-users"].gaps.map((gap) => gap.condition);
    expect(gaps).not.toContain("no-admin-scope");
  });

  it("leaves the gap standing on a kind the fill did not reach", () => {
    const gaps = generation.files["directory-groups"].gaps.map((gap) => gap.condition);
    expect(gaps).toContain("no-admin-scope");
  });

  it("leaves every other kind's admin-api cell not-configured", () => {
    expect(apiCell({ generation, kind: "directory-groups" }).state).toBe("not-configured");
  });

  it("stores one record entity per record, keyed by Google's own key", () => {
    const records = generation.files["directory-users"].entities.filter((entity) => entity.family === "record");
    expect(records.map((entity) => entity.providerId)).toStrictEqual(["1", "2"]);
  });

  it("keeps the compiled operation entities beside the records rather than replacing them", () => {
    const operations = generation.files["directory-users"].entities.filter((entity) => entity.family === "operation");
    expect(operations.length).toBeGreaterThan(0);
  });

  it("fills the record's admin-api channel and leaves its other two empty", () => {
    const record = generation.files["directory-users"].entities.find((entity) => entity.family === "record")!;
    expect(record.channels.discovery).toBeNull();
    expect(record.channels["admin-console"]).toBeNull();
    expect(record.channels["admin-api"]!.state).toBe("observed");
  });

  it("stores the field names and says out loud that the values were withheld", () => {
    const record = generation.files["directory-users"].entities.find((entity) => entity.family === "record")!;
    expect(record.channels["admin-api"]!.detail).toStrictEqual({
      fields: ["id", "primaryEmail"],
      operation: "directory.users.list",
      withheldValues: true,
    });
  });
});

describe("when the read is knowingly partial", () => {
  it("is deferred rather than synced once a page bound was reached", () => {
    const generation = builtWith({ fill: usersFill({ truncated: true }) });
    const cell = apiCell({ generation, kind: "directory-users" });
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toContain("a page bound was reached");
  });

  it("is deferred when the payload was an aggregate rather than a collection", () => {
    const generation = builtWith({ fill: usersFill({ aggregate: true, records: [] }) });
    const cell = apiCell({ generation, kind: "directory-users" });
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toContain("an aggregate rather than a collection");
  });

  it("is synced when a collection answered genuinely empty, which is not an aggregate", () => {
    const generation = builtWith({ fill: usersFill({ records: [] }) });
    const cell = apiCell({ generation, kind: "directory-users" });
    expect(cell.state).toBe("synced");
    expect(cell.reason).toBe(
      "1 operation(s) were called and stored 0 record(s) to the end of every collection; this claim is bounded by the admin role the granted account holds",
    );
  });
});

describe("when Google refused", () => {
  const generation = builtWith({
    fill: {
      excluded: [],
      failed: [
        {
          id: "directory.users.list",
          kind: "directory-users",
          message: "Admin SDK API has not been used in project 1 before or it is disabled",
          status: 403,
        },
      ],
      filledAtIso: AT,
      grantedScopes: [],
      operations: [],
    },
  });

  it("marks the kind unreadable rather than leaving it looking unattempted", () => {
    expect(apiCell({ generation, kind: "directory-users" }).state).toBe("unreadable");
  });

  it("carries Google's own status and words, because they name the act that fixes it", () => {
    const cell = apiCell({ generation, kind: "directory-users" });
    expect(cell.reason).toContain("403");
    expect(cell.reason).toContain("has not been used in project");
  });

  it("names the console act in unblockedBy rather than telling a reader to re-consent", () => {
    expect(apiCell({ generation, kind: "directory-users" }).unblockedBy).toContain("enable that API");
  });
});

describe("the publish gate's shape-indexed kinds", () => {
  it("stores no record for one, even when the fill read records for it", () => {
    const generation = builtWith({
      fill: {
        excluded: [],
        failed: [],
        filledAtIso: AT,
        grantedScopes: [],
        operations: [
          {
            aggregate: false,
            document: "admin.reports_v1",
            id: "reports.activities.list",
            kind: "reports-activities",
            records: [{ fields: ["id"], providerId: "event-1" }],
            truncated: false,
          },
        ],
      },
    });
    const records = generation.files["reports-activities"].entities.filter((entity) => entity.family === "record");
    expect(records).toStrictEqual([]);
  });
});
