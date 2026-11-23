import { describe, expect, it } from "vitest";

import { hiveDisagreementReport } from "../../../../atlas/graphqlHive/disagreement.js";

import { channel, entity } from "./hiveFixtures.js";

describe("hiveDisagreementReport", () => {
  it("counts what each channel holds, so a reader can size the findings", () => {
    const report = hiveDisagreementReport({
      pages: [
        entity({ api: channel({ deepLink: "https://x.test/a", name: "api" }), providerId: "/a" }),
        entity({ browser: channel({ deepLink: "https://x.test/b", name: "browser" }), providerId: "/b" }),
      ],
    });
    expect({ declared: report.declaredCount, witnessed: report.witnessedCount }).toStrictEqual({
      declared: 1,
      witnessed: 1,
    });
  });

  it("reports a declared address no walk has landed on", () => {
    const report = hiveDisagreementReport({
      pages: [entity({ api: channel({ deepLink: "https://x.test/a", name: "api" }), providerId: "/a" })],
    });
    expect(report.disagreements[0]!.finding).toBe("declared-and-unwitnessed");
  });

  it("reports a page the walk reached somewhere this atlas never declared", () => {
    const report = hiveDisagreementReport({
      pages: [entity({ browser: channel({ deepLink: "https://x.test/b", name: "browser" }), providerId: "/b" })],
    });
    expect(report.disagreements[0]!.finding).toBe("witnessed-and-undeclared");
  });

  it("reports a declared page the walk tried and could not open, with the walk's own reason", () => {
    const report = hiveDisagreementReport({
      pages: [
        entity({
          api: channel({ deepLink: "https://x.test/a", name: "api" }),
          browser: channel({ detail: { unreachableBecause: "403" }, name: "browser" }),
          providerId: "/a",
        }),
      ],
    });
    expect(report.disagreements[0]).toStrictEqual({
      finding: "declared-and-unreachable",
      providerId: "/a",
      reason: "403",
      url: "https://x.test/a",
    });
  });

  it("reports nothing for a declared page a walk opened cleanly, because that is agreement", () => {
    const report = hiveDisagreementReport({
      pages: [
        entity({
          api: channel({ deepLink: "https://x.test/a", name: "api" }),
          browser: channel({ detail: { unreachableBecause: null }, name: "browser" }),
          providerId: "/a",
        }),
      ],
    });
    expect(report.disagreements).toStrictEqual([]);
  });
});
