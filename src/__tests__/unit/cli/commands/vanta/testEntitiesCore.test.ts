import { describe, expect, it } from "vitest";

import type { VantaTestEntityDto } from "../../../../../atlas/vanta/controlEvidenceApiSchemas.js";
import { emptyVantaKindFile, type VantaEntity } from "../../../../../atlas/vanta/model.js";
import {
  exitCodeForVantaTestEntitySweep,
  parseVantaTestEntitiesOptions,
  renderVantaTestEntitySweep,
  sweepPlanFromKindFile,
  type VantaSweepPlan,
  type VantaTestEntitySweep,
  vantaTestEntitySweepDocument,
} from "../../../../../cli/commands/vanta/testEntitiesCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-09-30T00:00:00.000Z";

/** A stored test entity, as the sync writes one. */
function storedTest({
  providerId,
  detail,
  state,
}: {
  providerId: string;
  detail: unknown;
  state: "observed" | "stale";
}): VantaEntity {
  return {
    channels: {
      browser: null,
      "manage-api": { channel: "manage-api", detail, firstSeenAt: AT, lastSeenAt: AT, source: null, state },
    },
    financialDetail: null,
    id: `test:${providerId}`,
    kind: "test",
    providerId,
    sensitivity: null,
  };
}

const deactivated = ({ id, reason }: { id: string; reason: string | null }): VantaTestEntityDto => ({
  createdDate: "2026-01-01T00:00:00.000Z",
  deactivatedReason: reason,
  displayName: `resource ${id}`,
  entityStatus: "DEACTIVATED",
  id,
  lastUpdatedDate: "2026-06-01T00:00:00.000Z",
  responseType: "Repository",
});

const PLAN: VantaSweepPlan = {
  notWalked: 1,
  storedAt: AT,
  targets: [
    { testId: "t1", testName: "Branch protection" },
    { testId: "t2", testName: null },
  ],
};

describe("parseVantaTestEntitiesOptions", () => {
  it("reads a sweep of every stored test when --test is absent", () => {
    expect(unwrap(parseVantaTestEntitiesOptions({ defaultHome: "/h", rest: ["--status", "DEACTIVATED"] }))).toEqual({
      clientIdFile: null,
      clientSecretFile: null,
      home: "/h",
      json: false,
      limit: 200,
      status: "DEACTIVATED",
      testId: null,
    });
  });

  it("refuses a missing --status rather than letting Vanta's FAILING default answer", () => {
    expect(unwrapErr(parseVantaTestEntitiesOptions({ defaultHome: "/h", rest: ["--test", "t1"] }))).toEqual([
      "--status is required and must be one of FAILING|DEACTIVATED — Vanta's own entityStatus values; it " +
        "answers FAILING when none is sent, so this verb never leaves it implicit",
    ]);
  });

  it("refuses a status the spec does not name", () => {
    expect(unwrapErr(parseVantaTestEntitiesOptions({ defaultHome: "/h", rest: ["--status", "deactivated"] }))).toEqual([
      "--status is required and must be one of FAILING|DEACTIVATED — Vanta's own entityStatus values; it " +
        "answers FAILING when none is sent, so this verb never leaves it implicit",
    ]);
  });

  it("refuses a non-positive --limit", () => {
    expect(
      unwrapErr(parseVantaTestEntitiesOptions({ defaultHome: "/h", rest: ["--status", "FAILING", "--limit", "0"] })),
    ).toEqual(["--limit must be a positive whole number"]);
  });
});

describe("sweepPlanFromKindFile", () => {
  it("walks every observed test with its stored name, and counts the stale ones it leaves out", () => {
    const file = {
      ...emptyVantaKindFile({ kind: "test", updatedAt: AT }),
      entities: [
        storedTest({ detail: { name: "Branch protection" }, providerId: "t1", state: "observed" }),
        storedTest({ detail: { name: "Old" }, providerId: "t0", state: "stale" }),
        storedTest({ detail: null, providerId: "t2", state: "observed" }),
      ],
    };
    expect(sweepPlanFromKindFile({ file })).toEqual(PLAN);
  });
});

describe("renderVantaTestEntitySweep", () => {
  it("prints each deactivated entity under its test, with its reason and Vanta's last-updated date", () => {
    const sweep: VantaTestEntitySweep = {
      plan: PLAN,
      reads: [
        { entities: [deactivated({ id: "e1", reason: "archived repo" })], kind: "read", target: PLAN.targets[0]! },
        { entities: [], kind: "read", target: PLAN.targets[1]! },
      ],
      status: "DEACTIVATED",
    };
    expect(renderVantaTestEntitySweep({ limit: 200, sweep })).toEqual([
      "vanta test-entities --status DEACTIVATED: 1 entit(ies)",
      `scope: read 2 of the 2 tests the stored list holds (stored ${AT}), 0 failed, 1 stored test(s) not walked ` +
        "because the last sync marked them stale",
      "",
      "t1 · Branch protection",
      "  resource e1 (e1) · Repository",
      "    reason: archived repo",
      "    Vanta's last-updated date: 2026-06-01T00:00:00.000Z · created: 2026-01-01T00:00:00.000Z",
      "",
      "who deactivated an entity, and when, is not in this API: lastUpdatedDate is the last change of any kind",
    ]);
  });

  it("never states a zero as a none when a test could not be read", () => {
    const sweep: VantaTestEntitySweep = {
      plan: PLAN,
      reads: [
        { entities: [], kind: "read", target: PLAN.targets[0]! },
        { kind: "failed", reasons: ["returned HTTP 500"], target: PLAN.targets[1]! },
      ],
      status: "DEACTIVATED",
    };
    const lines = renderVantaTestEntitySweep({ limit: 200, sweep });
    expect(lines[2]).toBe("a zero here is NOT a none: 1 test(s) could not be read, and their entities are unknown");
    expect(lines).toContain("  t2: returned HTTP 500");
  });

  it("bounds the rows it prints and says how many it held back", () => {
    const sweep: VantaTestEntitySweep = {
      plan: null,
      reads: [
        {
          entities: [deactivated({ id: "e1", reason: null }), deactivated({ id: "e2", reason: null })],
          kind: "read",
          target: { testId: "t1", testName: null },
        },
      ],
      status: "DEACTIVATED",
    };
    const lines = renderVantaTestEntitySweep({ limit: 1, sweep });
    expect(lines.filter((line) => line.startsWith("  resource "))).toEqual(["  resource e1 (e1) · Repository"]);
    expect(lines).toContain("1 more entit(ies) not printed — raise --limit to see them");
    expect(lines).toContain("    reason: (none recorded)");
  });
});

describe("vantaTestEntitySweepDocument", () => {
  it("carries the counts over every row read, and the rows up to the limit", () => {
    const sweep: VantaTestEntitySweep = {
      plan: null,
      reads: [
        {
          entities: [deactivated({ id: "e1", reason: "a" }), deactivated({ id: "e2", reason: "b" })],
          kind: "read",
          target: { testId: "t1", testName: null },
        },
      ],
      status: "DEACTIVATED",
    };
    const document = vantaTestEntitySweepDocument({ limit: 1, sweep });
    expect([document["entityCount"], document["printed"], document["testsRead"], document["testsFailed"]]).toEqual([
      2, 1, 1, 0,
    ]);
  });
});

describe("exitCodeForVantaTestEntitySweep", () => {
  it("is the error code when any test could not be read, and ok otherwise", () => {
    const target = { testId: "t1", testName: null };
    const failed: VantaTestEntitySweep = {
      plan: null,
      reads: [{ kind: "failed", reasons: ["x"], target }],
      status: "FAILING",
    };
    const read: VantaTestEntitySweep = {
      plan: null,
      reads: [{ entities: [], kind: "read", target }],
      status: "FAILING",
    };
    expect(exitCodeForVantaTestEntitySweep({ exitError: 1, exitOk: 0, sweep: failed })).toBe(1);
    expect(exitCodeForVantaTestEntitySweep({ exitError: 1, exitOk: 0, sweep: read })).toBe(0);
  });
});
