import { describe, expect, it } from "vitest";

import { jumpcloudKindCoverageCells } from "../../../../atlas/jumpcloud/coverage.js";
import { JumpcloudReadErrors } from "../../../../atlas/jumpcloud/errors.js";
import { projectJumpcloudValue } from "../../../../atlas/jumpcloud/projection.js";
import type { AtlasCoverageCell } from "../../../../atlas/kit/coverage.js";
import type { AtlasProjection } from "../../../../atlas/kit/projection.js";

/** An endpoint with no endpoint-scoped denial of its own, so these tests exercise the name rules alone. */
const ANY_ENDPOINT = "/api/systems";

const AT = "2026-09-04T13:00:00.000Z";

/**
 * Two real application records, projected the way the sync would project them.
 *
 * Built through `projectJumpcloudValue` rather than hand-written, because the whole point of the shape
 * under test is that the drops cannot be separated from the documents they came from.
 */
const APPLICATIONS: readonly AtlasProjection[] = [
  projectJumpcloudValue({
    endpoint: ANY_ENDPOINT,
    value: { _id: "a", displayName: "Okta", idpPrivateKey: "-----BEGIN PRIVATE KEY-----" },
  }),
  projectJumpcloudValue({
    endpoint: ANY_ENDPOINT,
    value: { _id: "b", displayName: "Jira", idpPrivateKey: "-----BEGIN PRIVATE KEY-----" },
  }),
];

/** A record deep enough that the projection gives up on it — the one drop that denies a family `synced`. */
const TRUNCATED: AtlasProjection = (() => {
  let deep: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 40; i += 1) {
    deep = { nested: deep };
  }
  return projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: deep });
})();

/** A record with nothing denied at any depth. */
const CLEAN: AtlasProjection = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: { _id: "c", hostname: "host" } });

/** The single cell an ordinary read produces. A non-null assertion rather than a conditional, per testing.md. */
const only = ({ cells }: { cells: readonly AtlasCoverageCell[] }): AtlasCoverageCell => cells[0]!;

const cell = ({ projections }: { projections: readonly AtlasProjection[] }): AtlasCoverageCell =>
  only({
    cells: jumpcloudKindCoverageCells({
      at: AT,
      kind: "applications",
      outcome: { answered: [], status: "complete" },
      previous: null,
      projections,
      role: "authoritative",
      surface: "directory-api",
    }),
  });

describe("jumpcloudKindCoverageCells on a read that finished on the provider's own answers", () => {
  it("is synced and names every operation that answered it holds nothing, so the answer is never silent", () => {
    const result = only({
      cells: jumpcloudKindCoverageCells({
        at: AT,
        kind: "passwordmanager",
        outcome: { answered: ["v2-backup-service-list-backups: answered 404"], status: "complete" },
        previous: null,
        projections: [CLEAN],
        role: "authoritative",
        surface: "directory-api",
      }),
    });
    expect(result.state).toBe("synced");
    expect(result.reason).toContain(
      "1 operation(s) answered that this organisation holds nothing there: v2-backup-service-list-backups: answered 404",
    );
  });
});

describe("jumpcloudKindCoverageCells on a read that finished", () => {
  it("publishes a kind whose every removal was designed as synced", () => {
    const result = cell({ projections: APPLICATIONS });
    expect(result.state).toBe("synced");
    expect(result.latestAttemptFailed).toBe(false);
    expect(result.lastSuccessAt).toBe(AT);
  });

  it("publishes exactly one cell, so a kind is never counted twice", () => {
    const cells = jumpcloudKindCoverageCells({
      at: AT,
      kind: "applications",
      outcome: { answered: [], status: "complete" },
      previous: null,
      projections: APPLICATIONS,
      role: "authoritative",
      surface: "directory-api",
    });
    expect(cells.length).toBe(1);
  });

  it("states the withholding in the reason, so a reader is not left to infer the field was never returned", () => {
    expect(cell({ projections: APPLICATIONS }).reason).toBe(
      "read 2 applications record(s); withheld 2 secret-material position(s) at the boundary, across the field(s) idpPrivateKey",
    );
  });

  it("says plainly that nothing was withheld, rather than staying silent about it", () => {
    expect(cell({ projections: [CLEAN, CLEAN] }).reason).toBe(
      "read 2 applications record(s); nothing was withheld at the boundary",
    );
  });

  it("refuses to call a truncated family synced", () => {
    const result = cell({ projections: [...APPLICATIONS, TRUNCATED] });
    expect(result.state).toBe("unreadable");
    expect(result.latestAttemptFailed).toBe(true);
  });

  it("names the truncated pointer, so the document is findable again", () => {
    const result = cell({ projections: [...APPLICATIONS, TRUNCATED] });
    expect(result.reason).toContain("TRUNCATED 1 document position(s) at the depth bound");
    expect(result.unblockedBy).toContain("the projection's bound needs raising");
  });

  it("carries a prior success forward when this attempt truncated", () => {
    const previous = cell({ projections: APPLICATIONS });
    const result = only({
      cells: jumpcloudKindCoverageCells({
        at: "2026-09-05T13:00:00.000Z",
        kind: "applications",
        outcome: { answered: [], status: "complete" },
        previous,
        projections: [...APPLICATIONS, TRUNCATED],
        role: "authoritative",
        surface: "directory-api",
      }),
    });
    expect(result.lastSuccessAt).toBe(AT);
    expect(result.latestAttemptFailed).toBe(true);
  });

  it("takes its count and its drops from the same projections, so metadata cannot contradict the data", () => {
    // The earlier shape took a record COUNT and a drop list as separate arguments, so a caller could hand
    // in a truncated projection alongside `dropped: []` and be told `synced`. There is no such pairing to
    // get wrong now: the truncation travels inside the record it truncated.
    const result = cell({ projections: [CLEAN, TRUNCATED] });
    expect(result.reason).toContain("read 2 applications record(s)");
    expect(result.state).toBe("unreadable");
  });

  it("scopes the cell to the kind and keeps the platform's own claim boundary on it", () => {
    const result = cell({ projections: [CLEAN] });
    expect(result.scope).toBe("applications");
    expect(result.surface).toBe("directory-api");
    expect(result.visibilityScope).toContain("read-only is enforced by a closed surface registry");
  });
});

describe("jumpcloudKindCoverageCells on a read that did not finish", () => {
  const incomplete = ({
    outcome,
  }: {
    outcome: Parameters<typeof jumpcloudKindCoverageCells>[0]["outcome"];
  }): readonly AtlasCoverageCell[] =>
    jumpcloudKindCoverageCells({
      at: AT,
      kind: "applications",
      outcome,
      previous: null,
      projections: [CLEAN, CLEAN],
      role: "authoritative",
      surface: "directory-api",
    });

  const stopped = ({ surface }: { surface: string }): Parameters<typeof incomplete>[0]["outcome"] => ({
    error: JumpcloudReadErrors.transportFailed({ cause: new Error("socket hang up"), surface }),
    status: "incomplete",
  });

  it("refuses synced when page two threw, however many records page one returned", () => {
    const result = only({ cells: incomplete({ outcome: stopped({ surface: "v1-applications-list" }) }) });
    expect(result.state).toBe("unreadable");
    expect(result.latestAttemptFailed).toBe(true);
  });

  it("carries the provider's own message into the reason, alongside what was read before it stopped", () => {
    const result = only({ cells: incomplete({ outcome: stopped({ surface: "v1-applications-list" }) }) });
    expect(result.reason).toBe(
      "read 2 applications record(s) before the read stopped: v1-applications-list did not complete: socket hang up",
    );
  });

  it("calls a permission boundary unreadable and says whose decision widening it is", () => {
    const result = only({
      cells: incomplete({
        outcome: {
          error: JumpcloudReadErrors.permissionRefused({ status: 403, surface: "v1-applications-get" }),
          status: "incomplete",
        },
      }),
    });
    expect(result.state).toBe("unreadable");
    expect(result.unblockedBy).toContain("permission boundary");
  });

  it("calls a surface the registry does not admit a configuration defect rather than a provider condition", () => {
    const result = only({
      cells: incomplete({
        outcome: {
          error: JumpcloudReadErrors.surfaceRefused({ surface: "v1-applications-list" }),
          status: "incomplete",
        },
      }),
    });
    expect(result.state).toBe("invalid-configuration");
  });

  it("calls a refused redirect unreadable and says why the boundary would not follow it", () => {
    const result = only({
      cells: incomplete({
        outcome: {
          error: JumpcloudReadErrors.redirectRefused({ status: 302, surface: "v1-applications-list" }),
          status: "incomplete",
        },
      }),
    });
    expect(result.state).toBe("unreadable");
    expect(result.unblockedBy).toContain("allowlist checked the request that was sent");
  });

  it("calls an answer its strict boundary refused unreadable, carrying the drifted field into the reason", () => {
    const result = only({
      cells: incomplete({
        outcome: {
          error: JumpcloudReadErrors.bodyShapeChanged({
            drift: [{ detail: 'new field "[0].owner"', kind: "new", path: "[0].owner" }],
            surface: "v1-applications-list",
          }),
          status: "incomplete",
        },
      }),
    });
    expect(result.state).toBe("unreadable");
    expect(result.reason).toBe(
      'read 2 applications record(s) before the read stopped: v1-applications-list answered a shape this version does not read, so nothing it answered is held: new field "[0].owner"',
    );
    expect(result.unblockedBy).toContain("declare the change in the surface's boundary");
  });
});

describe("a failure filed against the wrong kind", () => {
  /** `v1-systems-list` belongs to `systems` in the generated registry, never to `applications`. */
  const misfiled = jumpcloudKindCoverageCells({
    at: AT,
    kind: "applications",
    outcome: {
      error: JumpcloudReadErrors.unexpectedShape({ detail: "not an array", surface: "v1-systems-list" }),
      status: "incomplete",
    },
    previous: null,
    projections: [CLEAN, CLEAN],
    role: "authoritative",
    surface: "directory-api",
  });

  it("publishes a cell for BOTH kinds, so neither the mislabelled one nor the broken one vanishes", () => {
    expect(misfiled.map((c) => c.scope)).toStrictEqual(["applications", "systems"]);
  });

  it("says the named kind's fate is unknown rather than reporting it broken", () => {
    expect(misfiled[0].state).toBe("invalid-configuration");
    expect(misfiled[0].reason).toContain("what actually became of applications is unknown");
  });

  it("publishes the kind that actually failed as unreadable, under its own scope", () => {
    expect(misfiled[1]!.state).toBe("unreadable");
    expect(misfiled[1]!.reason).toContain("v1-systems-list");
  });

  it("treats a surface the registry does not hold at all as a mis-attribution with no second kind to name", () => {
    const cells = jumpcloudKindCoverageCells({
      at: AT,
      kind: "applications",
      outcome: { error: JumpcloudReadErrors.surfaceRefused({ surface: "v1-invented" }), status: "incomplete" },
      previous: null,
      projections: [],
      role: "authoritative",
      surface: "directory-api",
    });
    expect(cells.length).toBe(1);
    expect(cells[0].state).toBe("invalid-configuration");
    expect(cells[0].reason).toContain("no kind at all");
  });

  it("reads the projections by index, so an array that hides its own drops cannot buy a synced cell", () => {
    const projections: AtlasProjection[] = [TRUNCATED];
    Object.defineProperty(projections, "flatMap", { value: () => [] });
    const cells = jumpcloudKindCoverageCells({
      at: AT,
      kind: "applications",
      outcome: { answered: [], status: "complete" },
      previous: null,
      projections,
      role: "authoritative",
      surface: "directory-api",
    });
    expect(cells[0].state).toBe("unreadable");
  });
});
