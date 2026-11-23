import { describe, expect, it } from "vitest";

import { MICROSOFT365_BROWSER_PAGES } from "../../../../atlas/microsoft365/browserPages.js";
import { declaredPageGaps } from "../../../../atlas/microsoft365/declaredPageGaps.js";

const AT = "2026-09-05T00:00:00.000Z";

describe("declaredPageGaps", () => {
  const gaps = declaredPageGaps({ at: AT });

  it("opens one browser-page-not-attempted gap per declared page, scoped to the page's surface", () => {
    expect(MICROSOFT365_BROWSER_PAGES.length).toBeGreaterThan(0);
    expect(gaps.map((gap) => gap.scope)).toEqual(MICROSOFT365_BROWSER_PAGES.map((page) => page.surface));
    expect(gaps.filter((gap) => gap.condition !== "browser-page-not-attempted")).toEqual([]);
  });

  it("names a page on a console with a fixed origin by its address", () => {
    const audit = gaps.find((gap) => gap.scope === "purview-audit-search")!;
    expect(audit.reason).toBe(
      "declared and never visited: the unified audit log search — the console face of the voluminous audit " +
        "family (https://purview.microsoft.com/audit/auditsearch)",
    );
  });

  it("names a SharePoint page, whose origin is resolved only at run time, by its console and path", () => {
    const sharing = gaps.find((gap) => gap.scope === "sharepoint-sharing-policy")!;
    expect(sharing.reason).toBe(
      "declared and never visited: external sharing policy for SharePoint and OneDrive " +
        "(tenant-root: _layouts/15/online/AdminHome.aspx#/sharing)",
    );
  });
});
