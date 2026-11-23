import { describe, expect, it } from "vitest";

import {
  microsoft365DispositionFor,
  microsoft365DispositionRuleIds,
} from "../../../../atlas/microsoft365/dispositions.js";

describe("microsoft365DispositionFor", () => {
  it("excludes every method that mutates, whatever the path looks like", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const ruling = microsoft365DispositionFor({ method, pathShape: "/users/{user-id}" });
      expect(ruling.disposition).toBe("excluded");
      expect(ruling.ruleId).toBe("mutation");
    }
  });

  it("admits the reviewed read-shaped POSTs, which no GET answers", () => {
    const ruling = microsoft365DispositionFor({
      method: "POST",
      pathShape: "/users/{user-id}/getMemberGroups",
    });
    expect(ruling.disposition).toBe("reachable");
    expect(ruling.ruleId).toBe("configuration-default");
  });

  it("refuses a POST that only LOOKS like traversal", () => {
    const ruling = microsoft365DispositionFor({
      method: "POST",
      pathShape: "/groups/{group-id}/members/$ref",
    });
    expect(ruling.disposition).toBe("excluded");
    expect(ruling.ruleId).toBe("mutation");
  });

  it("classes the unified audit log voluminous", () => {
    const ruling = microsoft365DispositionFor({ method: "GET", pathShape: "/auditLogs/signIns" });
    expect(ruling.disposition).toBe("voluminous");
    expect(ruling.ruleId).toBe("unified-audit-log");
  });

  it("keeps the COUNT over a voluminous collection, because a count is the enumeration", () => {
    const ruling = microsoft365DispositionFor({ method: "GET", pathShape: "/auditLogs/signIns/$count" });
    expect(ruling.disposition).toBe("reachable");
    expect(ruling.ruleId).toBe("collection-count");
  });

  it("cuts through the mail family: messages are voluminous, the folder list is configuration", () => {
    expect(microsoft365DispositionFor({ method: "GET", pathShape: "/users/{user-id}/messages" }).disposition).toBe(
      "voluminous",
    );
    expect(microsoft365DispositionFor({ method: "GET", pathShape: "/users/{user-id}/mailFolders" }).disposition).toBe(
      "reachable",
    );
  });

  it("cuts through the security family: the daily score is a series, the control catalogue is not", () => {
    expect(microsoft365DispositionFor({ method: "GET", pathShape: "/security/secureScores" }).ruleId).toBe(
      "security-telemetry",
    );
    expect(
      microsoft365DispositionFor({ method: "GET", pathShape: "/security/secureScoreControlProfiles" }).ruleId,
    ).toBe("configuration-default");
  });

  it("gives a SharePoint list item its own reason rather than the file rule's", () => {
    const ruling = microsoft365DispositionFor({
      method: "GET",
      pathShape: "/sites/{site-id}/lists/{list-id}/items",
    });
    expect(ruling.ruleId).toBe("list-items");
    expect(ruling.disposition).toBe("voluminous");
  });

  it("classes conditional access policies as configuration this atlas holds", () => {
    const ruling = microsoft365DispositionFor({ method: "GET", pathShape: "/policies/conditionalAccessPolicies" });
    expect(ruling.disposition).toBe("reachable");
    expect(ruling.ruleId).toBe("configuration-default");
  });

  it("always carries a reason, including for the default", () => {
    const ruling = microsoft365DispositionFor({ method: "GET", pathShape: "/groups" });
    expect(ruling.reason.length).toBeGreaterThan(0);
  });
});

describe("microsoft365DispositionRuleIds", () => {
  it("is sorted, unique, and contains every id the function can return", () => {
    const ids = microsoft365DispositionRuleIds();
    expect([...ids]).toEqual([...ids].toSorted());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("mutation");
    expect(ids).toContain("collection-count");
    expect(ids).toContain("configuration-default");
    expect(ids).toContain("unified-audit-log");
  });
});
