import { describe, expect, it } from "vitest";
import { countedOf, expectedOf, shortfallOf } from "../../../../atlas/knowbe4/fill/parentCount.js";
import { KNOWBE4_FILL_CALLS } from "../../../../atlas/knowbe4/fill/plan.js";

const groupMember = KNOWBE4_FILL_CALLS.find((call) => call.kind === "group-member")!;
const user = KNOWBE4_FILL_CALLS.find((call) => call.kind === "user")!;

const member = ({ id, status }: { id: string; status: string | null }) => ({
  detail: { status },
  providerId: `7:${id}`,
});

describe("expectedOf", () => {
  it("reads a group's projected memberCount", () => {
    expect(expectedOf({ call: groupMember, parent: { detail: { memberCount: 582 }, providerId: "7" } })).toBe(582);
  });

  it("holds a path with no published count to none", () => {
    expect(expectedOf({ call: user, parent: { detail: {}, providerId: "7" } })).toBe(null);
  });
});

describe("countedOf", () => {
  it("counts only a group's ACTIVE members — archived, unknown and missing status all fall outside", () => {
    const items = [
      member({ id: "1", status: "active" }),
      member({ id: "2", status: "archived" }),
      member({ id: "3", status: null }),
      member({ id: "4", status: "suspended" }),
      member({ id: "5", status: "active" }),
    ];
    expect(countedOf({ call: groupMember, items })).toBe(2);
  });

  it("counts every row on a path naming no subset", () => {
    expect(countedOf({ call: user, items: [member({ id: "1", status: "archived" })] })).toBe(1);
  });

  it("counts zero rows as zero", () => {
    expect(countedOf({ call: groupMember, items: [] })).toBe(0);
  });
});

describe("shortfallOf", () => {
  it("names a parent whose list read more rows than its count", () => {
    expect(shortfallOf({ expected: 582, got: 842, providerId: "6725657" })).toBe("6725657 (842 of 582)");
  });

  it("is silent when the count holds exactly", () => {
    expect(shortfallOf({ expected: 3, got: 3, providerId: "7" })).toBe(null);
  });

  it("is silent when there is no count to hold", () => {
    expect(shortfallOf({ expected: null, got: 3, providerId: "7" })).toBe(null);
  });
});
