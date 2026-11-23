/**
 * The two organisation-level answers a failed JumpCloud kind can carry — `src/atlas/jumpcloud/kindBoundary.ts`.
 *
 * Each exempts the kind from the publish gate, so the cases that matter most are the ones that must NOT be
 * stamped: a mixed failure, and a 404 on one record among records the kind did read.
 */
import { describe, expect, it } from "vitest";

import { type JumpcloudReadError, JumpcloudReadErrors } from "../../../../atlas/jumpcloud/errors.js";
import { permissionBoundary, productAbsence, providerAnswers } from "../../../../atlas/jumpcloud/kindBoundary.js";
import type { JumpcloudKindWalk } from "../../../../atlas/jumpcloud/syncEngine.js";

const CONFIG = "v2-google-chrome-enterprise-premium-service-get-configuration";

/**
 * One kind's walk, defaulted to a walk that read nothing and failed nowhere.
 *
 * @param failures the typed failures the walk recorded
 * @param entityCount how many entities the walk read, as placeholders — only the count is judged
 * @returns the walk
 */
function walk({
  failures,
  entityCount = 0,
}: {
  failures: readonly JumpcloudReadError[];
  entityCount?: number;
}): JumpcloudKindWalk {
  return {
    clearableIncomplete: [],
    declaredTotal: null,
    emptyOperations: [],
    entities: Array.from({ length: entityCount }, () => ({}) as JumpcloudKindWalk["entities"][number]),
    failures: failures.map((error) => ({ error, surface: error.surface })),
    firstAt: null,
    incompleteOperations: [],
    journalledDrops: [],
    kind: "gcep",
    lastAt: null,
    pagesExhausted: true,
    projections: [],
    providerIds: [],
    providerIdsBySurface: {},
    resumed: 0,
  };
}

describe("productAbsence", () => {
  it("names the provider's own answer when every failure is a 404 and nothing was read", () => {
    const absent = productAbsence({
      succeeded: false,
      walk: walk({ failures: [JumpcloudReadErrors.routeAbsent({ surface: CONFIG })] }),
    });
    expect(absent).toBe(
      `${CONFIG}: ${CONFIG} answered 404: this organisation has no such route, product or record. That is an` +
        " answer about the tenancy, not a failed read",
    );
  });

  it("says nothing when a 404 sits beside a failure a later run could clear", () => {
    const absent = productAbsence({
      succeeded: false,
      walk: walk({
        failures: [
          JumpcloudReadErrors.routeAbsent({ surface: CONFIG }),
          JumpcloudReadErrors.redirectRefused({ status: 302, surface: "v2-gcep-device-state" }),
        ],
      }),
    });
    expect(absent).toBe(null);
  });

  it("says nothing when the 404 is one record gone among records the kind did read", () => {
    const absent = productAbsence({
      succeeded: false,
      walk: walk({ entityCount: 3, failures: [JumpcloudReadErrors.routeAbsent({ surface: CONFIG })] }),
    });
    expect(absent).toBe(null);
  });

  it("says nothing for a read that finished", () => {
    expect(productAbsence({ succeeded: true, walk: walk({ failures: [] }) })).toBe(null);
  });

  it("does not call a permission refusal an absent product", () => {
    const absent = productAbsence({
      succeeded: false,
      walk: walk({ failures: [JumpcloudReadErrors.permissionRefused({ status: 403, surface: CONFIG })] }),
    });
    expect(absent).toBe(null);
  });
});

describe("permissionBoundary", () => {
  it("does not call an absent product a permission boundary", () => {
    const blocked = permissionBoundary({
      succeeded: false,
      walk: walk({ failures: [JumpcloudReadErrors.routeAbsent({ surface: CONFIG })] }),
    });
    expect(blocked).toBe(null);
  });

  it("names the refusal and the grant when every failure is a 403", () => {
    const blocked = permissionBoundary({
      succeeded: false,
      walk: walk({ failures: [JumpcloudReadErrors.permissionRefused({ status: 403, surface: CONFIG })] }),
    });
    expect(blocked!.detail).toContain(`${CONFIG}: `);
    expect(blocked!.unblockedBy).toContain("a JumpCloud administrator role permitted to read this family");
  });
});

describe("providerAnswers", () => {
  const served = ({ surface }: { surface: string }): JumpcloudKindWalk["entities"][number] =>
    ({ providerId: `${surface}#a` }) as JumpcloudKindWalk["entities"][number];

  /**
   * A walk that read one record from `served` and recorded the given failures.
   *
   * @param failures the typed failures
   * @param from the operation the one read record came from
   * @returns the walk
   */
  function readWalk({ failures, from }: { failures: readonly JumpcloudReadError[]; from: string }): JumpcloudKindWalk {
    return { ...walk({ failures }), entities: [served({ surface: from })] };
  }

  it("names every 404 and 501 on a kind that otherwise read, as answers rather than failures", () => {
    const answers = providerAnswers({
      walk: readWalk({
        failures: [
          JumpcloudReadErrors.routeAbsent({ surface: "v2-backup-service-list-backups" }),
          JumpcloudReadErrors.notImplemented({ surface: "v2-systems-org-settings-get-ssao-devices-settings" }),
        ],
        from: "v2-list",
      }),
    });
    expect(answers!.length).toBe(2);
    expect(answers![1]).toContain("v2-systems-org-settings-get-ssao-devices-settings: ");
  });

  it("counts a 4xx on an operation that served OTHER records as a per-record answer", () => {
    const surface = "v2-get-field-config-select-options";
    const answers = providerAnswers({
      walk: readWalk({
        failures: [JumpcloudReadErrors.operationUnusable({ detail: "HTTP 400", surface })],
        from: surface,
      }),
    });
    expect(answers).toEqual([
      `${surface}: ${JumpcloudReadErrors.operationUnusable({ detail: "HTTP 400", surface }).message}`,
    ]);
  });

  it("refuses a 4xx on an operation that served nothing, because that is a contract this atlas is missing", () => {
    const answers = providerAnswers({
      walk: readWalk({
        failures: [JumpcloudReadErrors.operationUnusable({ detail: "HTTP 400", surface: "v2-applemdms-depkeyget" })],
        from: "v2-applemdms-list",
      }),
    });
    expect(answers).toBe(null);
  });

  it("refuses a 403, because a permission boundary is reachable with a grant and must stay visible", () => {
    const answers = providerAnswers({
      walk: readWalk({
        failures: [JumpcloudReadErrors.permissionRefused({ status: 403, surface: "v1-organization-list" })],
        from: "v1-organization-get",
      }),
    });
    expect(answers).toBe(null);
  });

  it("refuses a kind that read nothing, which is a whole-kind absence the stamps already name", () => {
    expect(providerAnswers({ walk: walk({ failures: [JumpcloudReadErrors.routeAbsent({ surface: CONFIG })] }) })).toBe(
      null,
    );
  });
});
