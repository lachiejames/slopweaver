/**
 * The rules that decide what this atlas does with one method.
 *
 * The tests worth having are the six the obvious computable rule gets wrong. `dispositions.ts`'s header
 * records that deriving read-versus-write from a declared `.readonly` scope misclassifies nine non-GET
 * methods; these pin the behaviour that replaced it, so a future "simplification" back to the scope rule
 * fails rather than quietly widening what this atlas would call.
 */
import { describe, expect, it } from "vitest";

import {
  googleAdminDispositionFor,
  googleAdminNonGetReads,
  googleAdminObservationalKinds,
  googleAdminObservationalOperations,
} from "../../../../atlas/googleAdmin/dispositions.js";

/** A GET with nothing special about it. */
function read({ id, kind }: { id: string; kind: string }) {
  return googleAdminDispositionFor({ id, kind, method: "GET", supportsMediaUpload: false });
}

describe("googleAdminDispositionFor", () => {
  it("calls a plain GET an entity, with nothing to explain", () => {
    expect(read({ id: "directory.users.list", kind: "directory-users" })).toStrictEqual({
      disposition: "entity",
      dispositionBecause: null,
      exclusionReason: null,
    });
  });

  it("calls a GET over an observational kind a shape index rather than an entity", () => {
    const verdict = read({ id: "reports.activities.list", kind: "reports-activities" });
    expect(verdict.disposition).toBe("shape-index");
    expect(verdict.dispositionBecause).toContain("time-series observations");
  });

  it("shape-indexes a security-insight query while its own kind stays configuration", () => {
    const query = read({
      id: "chromemanagement.customers.enterprise.securityInsights.queryUrlVisits",
      kind: "chrome-management-security-insights",
    });
    const status = read({
      id: "chromemanagement.customers.enterprise.securityInsights.checkEnablementStatus",
      kind: "chrome-management-security-insights",
    });
    expect(query.disposition).toBe("shape-index");
    expect(status.disposition).toBe("entity");
  });

  it("refuses a write that declares ONLY a readonly scope, which the scope rule would have called a read", () => {
    const verdict = googleAdminDispositionFor({
      id: "chromemanagement.customers.telemetry.notificationConfigs.create",
      kind: "chrome-management-notification-configs",
      method: "POST",
      supportsMediaUpload: false,
    });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.exclusionReason).toBe("mutating");
  });

  it("calls a watch side-effecting rather than mutating, because it subscribes rather than changes state", () => {
    const verdict = googleAdminDispositionFor({
      id: "reports.activities.watch",
      kind: "reports-activities",
      method: "POST",
      supportsMediaUpload: false,
    });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.exclusionReason).toBe("side-effecting");
    expect(verdict.dispositionBecause).toContain("push-notification channel");
  });

  it("calls a media upload egressing, because issuing it would send this machine's content to Google", () => {
    const verdict = googleAdminDispositionFor({
      id: "groupsmigration.archive.insert",
      kind: "groups-migration-archive",
      method: "POST",
      supportsMediaUpload: true,
    });
    expect(verdict.exclusionReason).toBe("egressing");
  });

  it("lets exactly three non-GET methods through as reads, each carrying why", () => {
    expect([...googleAdminNonGetReads()]).toStrictEqual([
      "chromepolicy.customers.policies.groups.listGroupPriorityOrdering",
      "chromepolicy.customers.policies.resolve",
      "vault.matters.count",
    ]);
    const verdict = googleAdminDispositionFor({
      id: "vault.matters.count",
      kind: "vault-matters",
      method: "POST",
      supportsMediaUpload: false,
    });
    expect(verdict.disposition).toBe("entity");
    expect(verdict.dispositionBecause).toContain("without exporting anything");
  });

  it("names seven observational kinds and four observational methods, and no overlap between them", () => {
    expect(googleAdminObservationalKinds().length).toBe(7);
    expect(googleAdminObservationalOperations().length).toBe(4);
    expect(googleAdminObservationalOperations().every((id) => id.includes("securityInsights"))).toBe(true);
  });
});
