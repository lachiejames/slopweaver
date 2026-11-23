/**
 * Unit: the two live channels' cells for one kind, built over the stored kind file — the seam that keeps one
 * channel's publish from erasing the other channel's last success.
 */
import { describe, expect, it } from "vitest";

import type { GoogleAdminFillObservation } from "../../../../atlas/googleAdmin/adminApi/observation.js";
import { googleAdminApiCoverageCell, googleAdminWalkedCoverageCell } from "../../../../atlas/googleAdmin/coverage.js";
import {
  filledFor,
  googleAdminLiveCoverageCells,
  storedGoogleAdminCell,
} from "../../../../atlas/googleAdmin/liveCoverage.js";
import { emptyGoogleAdminKindFile, type GoogleAdminAtlasKindFile } from "../../../../atlas/googleAdmin/model.js";

const EARLIER = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-02T00:00:00.000Z";
const WALKED = "2026-10-02T01:00:00.000Z";

/** A stored `directory-users` file whose two live cells both succeeded at {@link EARLIER}. */
function storedWithPriorSuccesses(): GoogleAdminAtlasKindFile {
  return {
    ...emptyGoogleAdminKindFile({ kind: "directory-users", updatedAt: EARLIER }),
    coverage: [
      googleAdminApiCoverageCell({
        aggregate: false,
        at: EARLIER,
        failures: [],
        kind: "directory-users",
        operations: 1,
        previous: null,
        records: 2,
        truncated: false,
      }),
      googleAdminWalkedCoverageCell({ at: EARLIER, observed: 4, opened: 2, previous: null }),
    ],
  };
}

/** A fill whose only operation reaching `directory-users` was refused. */
const REFUSED_FILL: GoogleAdminFillObservation = {
  excluded: [],
  failed: [{ id: "directory.users.list", kind: "directory-users", message: "forbidden", status: 403 }],
  filledAtIso: AT,
  grantedScopes: [],
  operations: [],
};

describe("filledFor", () => {
  it("is empty when no fill ran", () => {
    expect(filledFor({ fill: null, kind: "directory-users" })).toStrictEqual([]);
  });

  it("selects only the operations that landed on the kind", () => {
    const fill: GoogleAdminFillObservation = {
      ...REFUSED_FILL,
      operations: [
        {
          aggregate: false,
          document: "admin.directory_v1",
          id: "directory.users.list",
          kind: "directory-users",
          records: [],
          truncated: false,
        },
        {
          aggregate: false,
          document: "admin.directory_v1",
          id: "directory.groups.list",
          kind: "directory-groups",
          records: [],
          truncated: false,
        },
      ],
    };
    expect(filledFor({ fill, kind: "directory-users" }).map((operation) => operation.id)).toStrictEqual([
      "directory.users.list",
    ]);
  });
});

describe("storedGoogleAdminCell", () => {
  it("finds nothing when no generation wrote the file", () => {
    expect(storedGoogleAdminCell({ channel: "admin-api", stored: null })).toBe(null);
  });

  it("finds nothing when the file carries no cell for that channel", () => {
    const stored = emptyGoogleAdminKindFile({ kind: "directory-users", updatedAt: EARLIER });
    expect(storedGoogleAdminCell({ channel: "admin-api", stored })).toBe(null);
  });

  it("finds the channel's own cell and not its sibling's", () => {
    const cell = storedGoogleAdminCell({ channel: "admin-console", stored: storedWithPriorSuccesses() })!;
    expect(cell.channel).toBe("admin-console");
    expect(cell.state).toBe("deferred");
  });
});

describe("googleAdminLiveCoverageCells", () => {
  it("carries both prior successes into not-configured cells when this run brought neither channel", () => {
    const [api, consoleCell] = googleAdminLiveCoverageCells({
      at: AT,
      fill: null,
      kind: "directory-users",
      stored: storedWithPriorSuccesses(),
      walk: null,
    });
    expect([api.channel, api.state, api.lastSuccessAt, api.latestAttemptFailed]).toStrictEqual([
      "admin-api",
      "not-configured",
      EARLIER,
      true,
    ]);
    expect([
      consoleCell.channel,
      consoleCell.state,
      consoleCell.lastSuccessAt,
      consoleCell.latestAttemptFailed,
    ]).toStrictEqual(["admin-console", "not-configured", EARLIER, true]);
  });

  it("carries the prior admin-api success into a refusal", () => {
    const [api] = googleAdminLiveCoverageCells({
      at: AT,
      fill: REFUSED_FILL,
      kind: "directory-users",
      stored: storedWithPriorSuccesses(),
      walk: null,
    });
    expect(api.state).toBe("unreadable");
    expect(api.lastSuccessAt).toBe(EARLIER);
    expect(api.latestAttemptFailed).toBe(true);
  });

  it("grades a genuinely empty collection synced and an aggregate deferred, by the read's own shape", () => {
    const answered = ({ aggregate }: { aggregate: boolean }): GoogleAdminFillObservation => ({
      ...REFUSED_FILL,
      failed: [],
      operations: [
        {
          aggregate,
          document: "admin.directory_v1",
          id: "directory.users.list",
          kind: "directory-users",
          records: [],
          truncated: false,
        },
      ],
    });
    const states = [false, true].map(
      (aggregate) =>
        googleAdminLiveCoverageCells({
          at: AT,
          fill: answered({ aggregate }),
          kind: "directory-users",
          stored: null,
          walk: null,
        })[0].state,
    );
    expect(states).toStrictEqual(["synced", "deferred"]);
  });

  it("quotes the fill's exclusions, never 'no fill ran', for a kind a fill ran over but could not call", () => {
    const [api] = googleAdminLiveCoverageCells({
      at: AT,
      fill: {
        ...REFUSED_FILL,
        excluded: [
          {
            detail: "needs userKey",
            exclusion: "path-needs-a-record",
            id: "directory.asps.list",
            kind: "directory-asps",
          },
          { detail: "needs groupKey", exclusion: "path-needs-a-record", id: "directory.members.list", kind: "x" },
        ],
        failed: [],
      },
      kind: "directory-asps",
      stored: null,
      walk: null,
    });
    expect(api.state).toBe("not-configured");
    expect(api.reason).toBe(
      "a fill ran in this sync and called no Admin API method for this kind — it excluded 1: directory.asps.list (path-needs-a-record) — needs userKey",
    );
  });

  it("offers no remedy on the page kind when a fill ran, since no Admin API method reads pages", () => {
    const [api] = googleAdminLiveCoverageCells({
      at: AT,
      fill: { ...REFUSED_FILL, failed: [] },
      kind: "page",
      stored: null,
      walk: null,
    });
    expect(api.state).toBe("not-configured");
    expect(api.unblockedBy).toBe(null);
  });

  it("stamps no success on either channel when nothing is stored", () => {
    const cells = googleAdminLiveCoverageCells({
      at: AT,
      fill: REFUSED_FILL,
      kind: "directory-users",
      stored: null,
      walk: null,
    });
    expect(cells.map((cell) => cell.lastSuccessAt)).toStrictEqual([null, null]);
  });

  it("grades the console from a walk this run brought, stamped with the walk's instant", () => {
    const [, consoleCell] = googleAdminLiveCoverageCells({
      at: AT,
      fill: null,
      kind: "page",
      stored: null,
      walk: {
        observedRoutes: ["/ac/home"],
        pages: [{ reached: true, route: "/ac/home", settledRoute: "/ac/home", title: "Home" }],
        walkedAtIso: WALKED,
      },
    });
    expect(consoleCell.state).toBe("deferred");
    expect(consoleCell.lastSuccessAt).toBe(WALKED);
  });

  it("carries the prior console success through a walk that reached no page", () => {
    const [, consoleCell] = googleAdminLiveCoverageCells({
      at: AT,
      fill: null,
      kind: "directory-users",
      stored: storedWithPriorSuccesses(),
      walk: {
        observedRoutes: [],
        pages: [{ reached: false, route: "/ac/home", settledRoute: "/signin", title: null }],
        walkedAtIso: WALKED,
      },
    });
    expect(consoleCell.state).toBe("unreadable");
    expect(consoleCell.lastSuccessAt).toBe(EARLIER);
    expect(consoleCell.latestAttemptFailed).toBe(true);
  });
});
