/**
 * The corroboration report — an output, never a build-time check.
 *
 * Per `docs/atlas-intent/04-corroboration.md`: both records are kept and which surface wins is the owner's call once
 * they can see real instances. So the tests hold this to reporting the instances and resolving none of them.
 */
import { describe, expect, it } from "vitest";

import { workosDisagreementReport, workosFamilyCoverage } from "../../../../atlas/workos/disagreement.js";
import type { WorkosAtlasEntity, WorkosChannelEntity } from "../../../../atlas/workos/model.js";

import { AT } from "./workosFixtures.js";

/** One channel's view, with whatever detail a case needs. */
function channel({
  name,
  detail,
  deepLink,
}: {
  name: WorkosChannelEntity["channel"];
  detail: unknown;
  deepLink: string | null;
}): WorkosChannelEntity {
  return {
    channel: name,
    detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: [],
      channel: name,
      deepLink,
      deepLinkStatus: "unverified",
      endpoint: "/organizations",
      observedAt: AT,
    },
    state: "observed",
  };
}

/** A page entity with whichever channels a case needs. */
function page({
  providerId,
  api,
  browser,
}: {
  providerId: string;
  api: WorkosChannelEntity | null;
  browser: WorkosChannelEntity | null;
}): WorkosAtlasEntity {
  return { channels: { api, browser }, id: `id-${providerId}`, kind: "page", providerId };
}

describe("workosDisagreementReport", () => {
  it("reports a declared address no walk has landed on", () => {
    const report = workosDisagreementReport({
      pages: [
        page({
          api: channel({ deepLink: "https://dashboard.workos.com/organizations", detail: {}, name: "api" }),
          browser: null,
          providerId: "/organizations",
        }),
      ],
    });
    expect(report.disagreements).toEqual([
      {
        finding: "declared-and-unwitnessed",
        providerId: "/organizations",
        reason: "no dashboard walk has landed on this address",
        url: "https://dashboard.workos.com/organizations",
      },
    ]);
  });

  it("reports a declared address a walk could not open, carrying the walk's own reason", () => {
    const report = workosDisagreementReport({
      pages: [
        page({
          api: channel({ deepLink: "https://dashboard.workos.com/api-keys", detail: {}, name: "api" }),
          browser: channel({ deepLink: null, detail: { unreachableBecause: "needs an admin role" }, name: "browser" }),
          providerId: "/api-keys",
        }),
      ],
    });
    expect(report.disagreements[0]?.finding).toBe("declared-and-unreachable");
    expect(report.disagreements[0]?.reason).toBe("needs an admin role");
  });

  it("reports an address a walk reached that this atlas's table does not declare", () => {
    const report = workosDisagreementReport({
      pages: [
        page({
          api: null,
          browser: channel({ deepLink: "https://dashboard.workos.com/vault", detail: {}, name: "browser" }),
          providerId: "/vault",
        }),
      ],
    });
    expect(report.disagreements[0]?.finding).toBe("witnessed-and-undeclared");
  });

  it("reports nothing at all when a declared page was reached", () => {
    const report = workosDisagreementReport({
      pages: [
        page({
          api: channel({ deepLink: "https://dashboard.workos.com/users", detail: {}, name: "api" }),
          browser: channel({ deepLink: null, detail: { unreachableBecause: null }, name: "browser" }),
          providerId: "/users",
        }),
      ],
    });
    expect(report.disagreements).toEqual([]);
  });

  it("counts both channels independently", () => {
    const report = workosDisagreementReport({
      pages: [
        page({ api: channel({ deepLink: null, detail: {}, name: "api" }), browser: null, providerId: "/a" }),
        page({ api: null, browser: channel({ deepLink: null, detail: {}, name: "browser" }), providerId: "/b" }),
      ],
    });
    expect(report.declaredCount).toBe(1);
    expect(report.witnessedCount).toBe(1);
  });
});

describe("workosFamilyCoverage", () => {
  /** An operation entity carrying a family and a verdict. */
  const operation = ({ family, verdict }: { family: string; verdict: string }): WorkosAtlasEntity => ({
    channels: { api: channel({ deepLink: null, detail: { family, verdict }, name: "api" }), browser: null },
    id: `${family}-${verdict}`,
    kind: "operation",
    providerId: `GET /${family}`,
  });

  it("tallies present against absent per family, sorted by family name", () => {
    const families = workosFamilyCoverage({
      operations: [
        operation({ family: "Vault", verdict: "authenticated-foreign-vocabulary" }),
        operation({ family: "Fine-Grained Authorization", verdict: "absent" }),
        operation({ family: "Organizations", verdict: "authenticated" }),
      ],
    });
    expect(families).toEqual([
      { absent: 1, family: "Fine-Grained Authorization", present: 0 },
      { absent: 0, family: "Organizations", present: 1 },
      { absent: 0, family: "Vault", present: 1 },
    ]);
  });

  it("adds every route of one family into that family's single row", () => {
    const families = workosFamilyCoverage({
      operations: [
        operation({ family: "Organizations", verdict: "authenticated" }),
        operation({ family: "Organizations", verdict: "absent" }),
        operation({ family: "Organizations", verdict: "authenticated-foreign-vocabulary" }),
      ],
    });
    expect(families).toEqual([{ absent: 1, family: "Organizations", present: 2 }]);
  });

  it("ignores an entity whose api channel carries no family at all", () => {
    const orphan: WorkosAtlasEntity = {
      channels: { api: channel({ deepLink: null, detail: {}, name: "api" }), browser: null },
      id: "orphan",
      kind: "operation",
      providerId: "GET /x",
    };
    expect(workosFamilyCoverage({ operations: [orphan] })).toEqual([]);
  });
});
