import { describe, expect, it } from "vitest";

import { VantaHttpErrors, vantaHttpErrorLines } from "../../../../atlas/vanta/httpErrors.js";
import { emptyVantaKindFile } from "../../../../atlas/vanta/model.js";
import { type VantaSurfaceError, VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import { attemptSurface, attemptSurfaces, roleFor, syncSingleSurface } from "../../../../atlas/vanta/syncKind.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-18T00:00:00.000Z";

/** A fetch seam that counts how often it ran, so a refusal can be proved to have made no provider call. */
function countingFetch({ rows }: { rows: readonly string[] }): {
  readonly calls: () => number;
  readonly fetch: () => Promise<Result<readonly string[], VantaSurfaceError>>;
} {
  let count = 0;
  return {
    calls: () => count,
    fetch: () => {
      count += 1;
      return Promise.resolve(ok(rows));
    },
  };
}

describe("roleFor", () => {
  it("answers the role a manage-api inventory row declares", () => {
    expect(unwrap(roleFor({ kind: "policy", surface: "policies-list" }))).toBe("authoritative");
  });

  it("refuses a surface no row declares instead of grading it authoritative", () => {
    const error = unwrapErr(roleFor({ kind: "policy", surface: "no-such-surface" }));
    expect(error.code).toBe("SURFACE_UNDECLARED");
  });

  it("refuses a browser-only row under the right kind, since only a manage-api row grades this channel", () => {
    const error = unwrapErr(roleFor({ kind: "control", surface: "controls-collection" }));
    expect(error.code).toBe("SURFACE_UNDECLARED");
  });
});

describe("attemptSurface", () => {
  it("refuses an undeclared surface with its one-line reason and never calls the provider", async () => {
    const seam = countingFetch({ rows: ["a"] });
    const attempt = await attemptSurface<string>({
      at: AT,
      fetch: seam.fetch,
      kind: "policy",
      previousCoverage: null,
      surface: "no-such-surface",
    });
    expect(unwrapErr(attempt)).toEqual([
      "Vanta kind policy declares no manage-api surface no-such-surface in the inventory, so its evidence grade is unknown and the read is refused rather than graded authoritative",
    ]);
    expect(seam.calls()).toBe(0);
  });

  it("grades a declared surface with the role its row declares", async () => {
    const seam = countingFetch({ rows: ["a", "b"] });
    const attempt = unwrap(
      await attemptSurface<string>({
        at: AT,
        fetch: seam.fetch,
        kind: "policy",
        previousCoverage: null,
        surface: "policies-list",
      }),
    );
    expect(attempt.coverageCell.role).toBe("authoritative");
    expect(attempt.coverageCell.reason).toBe("2 record(s) read");
    expect(seam.calls()).toBe(1);
  });

  it("keeps a provider failure as an attempt, not a refusal", async () => {
    const attempt = unwrap(
      await attemptSurface<string>({
        at: AT,
        fetch: () => Promise.resolve(err(VantaSurfaceErrors.detailUnreadable({ reasons: ["HTTP 500"] }))),
        kind: "policy",
        previousCoverage: null,
        surface: "policies-list",
      }),
    );
    expect(attempt.items).toBeNull();
    expect(attempt.coverageCell.state).toBe("unreadable");
  });
});

/**
 * The gap a failed read opens is chosen from the failure's typed code. On main it was chosen by searching the
 * joined lines for phrases (`"HTTP 401"`, `"cursor"`, `"credentials are not configured"`), so each case below
 * — a sentence reworded, or a sentence that merely MENTIONS a phrase — opened the wrong gap there.
 */
describe("the gap a failed surface opens", () => {
  /** The condition one failed `policies-list` read opens, and the one its attempt reports. */
  const conditionFor = async ({ error }: { error: VantaSurfaceError }) => {
    const attempt = unwrap(
      await attemptSurface<string>({
        at: AT,
        fetch: () => Promise.resolve(err(error)),
        kind: "policy",
        previousCoverage: null,
        surface: "policies-list",
      }),
    );
    return [attempt.gap!.condition, attempt.condition];
  };

  it("grades a 403 as a scope refusal though its sentence never says HTTP 403", async () => {
    const error = VantaSurfaceErrors.fromTransportFailure({
      failure: VantaHttpErrors.httpStatus({ safePath: "/v1/policies", status: 403 }),
      reasons: ["Vanta said no"],
    });
    expect(await conditionFor({ error })).toEqual(["api-scope-refused", "api-scope-refused"]);
  });

  it("grades absent credentials from the code, whatever the sentence says", async () => {
    const error = VantaSurfaceErrors.apiCredentialNotConfigured({ reasons: ["no Vanta client on this machine"] });
    expect(await conditionFor({ error })).toEqual(["api-credential-not-configured", "api-credential-not-configured"]);
  });

  it("does not grade an unreachable host as a pagination fault because its path says cursor", async () => {
    const failure = VantaHttpErrors.unreachable({
      cause: new Error("ECONNRESET"),
      host: "api.vanta.com",
      safePath: "/v1/cursor-tests",
    });
    const error = VantaSurfaceErrors.fromTransportFailure({
      failure,
      reasons: vantaHttpErrorLines({ error: failure }),
    });
    expect(error.reasons.join(" ")).toContain("cursor");
    expect(await conditionFor({ error })).toEqual(["detail-unreadable", "detail-unreadable"]);
  });

  it("grades a page-limit fault as incomplete pagination though its sentence is reworded", async () => {
    const error = VantaSurfaceErrors.fromTransportFailure({
      failure: VantaHttpErrors.pageLimitExceeded({ maxPages: 3 }),
      reasons: ["too many pages"],
    });
    expect(await conditionFor({ error })).toEqual(["pagination-incomplete", "pagination-incomplete"]);
  });
});

describe("attemptSurfaces", () => {
  it("attempts every surface in order and keeps each one's coverage", async () => {
    const first = countingFetch({ rows: ["a"] });
    const second = countingFetch({ rows: ["b", "c"] });
    const attempts = unwrap(
      await attemptSurfaces<string>({
        at: AT,
        coverage: [],
        kind: "control",
        surfaces: [
          { fetch: first.fetch, surface: "controls-active" },
          { fetch: second.fetch, surface: "controls-deactivated" },
        ],
      }),
    );
    expect(attempts.map((attempt) => attempt.coverageCell.surface)).toEqual([
      "controls-active",
      "controls-deactivated",
    ]);
    expect([first.calls(), second.calls()]).toEqual([1, 1]);
  });

  it("refuses at the first undeclared surface and calls nothing after it", async () => {
    const first = countingFetch({ rows: ["a"] });
    const second = countingFetch({ rows: ["b"] });
    const attempts = await attemptSurfaces<string>({
      at: AT,
      coverage: [],
      kind: "control",
      surfaces: [
        { fetch: first.fetch, surface: "controls-nope" },
        { fetch: second.fetch, surface: "controls-deactivated" },
      ],
    });
    expect(unwrapErr(attempts).length).toBe(1);
    expect([first.calls(), second.calls()]).toEqual([0, 0]);
  });
});

describe("syncSingleSurface", () => {
  it("refuses an undeclared surface without fetching or projecting anything", async () => {
    const seam = countingFetch({ rows: ["a"] });
    let projected = 0;
    const result = await syncSingleSurface<string>({
      at: AT,
      fetch: seam.fetch,
      kind: "policy",
      project: () => {
        projected += 1;
        throw new Error("project must not run for a refused surface");
      },
      stored: emptyVantaKindFile({ kind: "policy", updatedAt: AT }),
      surface: "no-such-surface",
    });
    expect(unwrapErr(result)[0]).toContain("declares no manage-api surface no-such-surface");
    expect([seam.calls(), projected]).toEqual([0, 0]);
  });
});
