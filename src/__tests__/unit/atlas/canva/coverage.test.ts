import { describe, expect, it } from "vitest";

import { canvaPublishedCoverageCell, canvaUnconfiguredCoverageCell } from "../../../../atlas/canva/coverage.js";
import { CANVA_ATLAS_CHANNELS, type CanvaCoverageCell } from "../../../../atlas/canva/model.js";

const AT = "2026-10-01T00:00:00.000Z";
const PRIOR_AT = "2026-09-20T08:30:00.000Z";

const ARTIFACT = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/web-app/design.png",
  sha256: "a".repeat(64),
} as const;

/** A web-app or connect-api cell that once SUCCEEDED, as a stored generation would carry it. */
function priorSuccess({ channel }: { channel: "connect-api" | "web-app" }): CanvaCoverageCell {
  return {
    artifacts: [ARTIFACT],
    channel,
    lastSuccessAt: PRIOR_AT,
    latestAttemptFailed: false,
    reason: "walked the designs page",
    role: "corroborating",
    scope: "canva",
    state: "synced",
    surface: channel,
    unblockedBy: null,
    visibilityScope: "web-app-signed-in-account",
  };
}

describe("canvaPublishedCoverageCell", () => {
  it("stamps a nonzero kind as a fresh authoritative success quoting both counts", () => {
    const cell = canvaPublishedCoverageCell({ at: AT, kind: "design", operations: 7, scopes: 3 });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "published-api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason:
        "Canva's published description declares 7 operation(s) and 3 OAuth scope(s) for design, with each operation's own stability and entitlement read from the vendor's prose; this grades the MAP, never anybody's designs",
      role: "authoritative",
      scope: "canva",
      state: "synced",
      surface: "published-api",
      unblockedBy: null,
      visibilityScope: "published-description",
    });
  });

  it("grades a kind with neither operations nor scopes synced, with the zero-kind reason", () => {
    const cell = canvaPublishedCoverageCell({ at: AT, kind: "merge", operations: 0, scopes: 0 });
    expect(cell.state).toBe("synced");
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.reason).toBe(
      "Canva's published description declares no operation and no scope for merge — it is declared so a channel that finds one has somewhere to land it",
    );
  });

  it("uses the counted reason when only operations are zero", () => {
    const cell = canvaPublishedCoverageCell({ at: AT, kind: "oidc", operations: 0, scopes: 2 });
    expect(cell.reason).toBe(
      "Canva's published description declares 0 operation(s) and 2 OAuth scope(s) for oidc, with each operation's own stability and entitlement read from the vendor's prose; this grades the MAP, never anybody's designs",
    );
  });

  it("uses the counted reason when only scopes are zero", () => {
    const cell = canvaPublishedCoverageCell({ at: AT, kind: "export", operations: 4, scopes: 0 });
    expect(cell.reason).toBe(
      "Canva's published description declares 4 operation(s) and 0 OAuth scope(s) for export, with each operation's own stability and entitlement read from the vendor's prose; this grades the MAP, never anybody's designs",
    );
  });

  it("gives a fresh artifacts array on every call", () => {
    const first = canvaPublishedCoverageCell({ at: AT, kind: "page", operations: 1, scopes: 1 });
    const second = canvaPublishedCoverageCell({ at: AT, kind: "page", operations: 1, scopes: 1 });
    expect(first.artifacts).not.toBe(second.artifacts);
  });
});

describe("canvaUnconfiguredCoverageCell", () => {
  it("grades connect-api not-configured with the integration remedy and no prior success", () => {
    const cell = canvaUnconfiguredCoverageCell({ at: AT, channel: "connect-api", previous: null });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "connect-api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason:
        "no Canva integration or access token is configured on this installation, so no operation has been called",
      role: "authoritative",
      scope: "canva",
      state: "not-configured",
      surface: "connect-api",
      unblockedBy:
        "register a Canva integration at canva.com/developers, complete its authorisation-code grant as the acting user, and store the result: slopweaver secrets set canva-access-token — 53 of the 59 published operations declare oauthAuthCode and this installation holds no Canva credential of any kind",
      visibilityScope: "integration-scopes-and-entitlements",
    });
  });

  it("grades web-app not-configured with the walk remedy and no prior success", () => {
    const cell = canvaUnconfiguredCoverageCell({ at: AT, channel: "web-app", previous: null });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "web-app",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason:
        "no walk of canva.com has been run, so no page has been opened — the session exists and the walk does not",
      role: "corroborating",
      scope: "canva",
      state: "not-configured",
      surface: "web-app",
      unblockedBy:
        "build and run the web-app walk — this one is NOT blocked on the owner: `slopweaver browser cookies --origin https://www.canva.com` already reports the cookies the owner's own Chrome profile holds for that origin, so a signed-in session exists and what is missing is the walk itself",
      visibilityScope: "web-app-signed-in-account",
    });
  });

  it("gives the two unconfigured channels different reasons and remedies", () => {
    const connect = canvaUnconfiguredCoverageCell({ at: AT, channel: "connect-api", previous: null });
    const web = canvaUnconfiguredCoverageCell({ at: AT, channel: "web-app", previous: null });
    expect(connect.reason).not.toBe(web.reason);
    expect(connect.unblockedBy).not.toBe(web.unblockedBy);
  });

  it("keeps a connect-api prior success's instant and artifacts through a failure", () => {
    const previous = priorSuccess({ channel: "connect-api" });
    const cell = canvaUnconfiguredCoverageCell({ at: AT, channel: "connect-api", previous });
    expect(cell.lastSuccessAt).toBe(PRIOR_AT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.state).toBe("not-configured");
    expect(cell.visibilityScope).toBe("integration-scopes-and-entitlements");
  });

  it("keeps a web-app prior success's instant and artifacts through a failure", () => {
    const previous = priorSuccess({ channel: "web-app" });
    const cell = canvaUnconfiguredCoverageCell({ at: AT, channel: "web-app", previous });
    expect(cell.lastSuccessAt).toBe(PRIOR_AT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.reason).toBe(
      "no walk of canva.com has been run, so no page has been opened — the session exists and the walk does not",
    );
  });

  it("does not stamp this run's instant on a failure", () => {
    const cell = canvaUnconfiguredCoverageCell({ at: AT, channel: "web-app", previous: null });
    expect(cell.lastSuccessAt).toBe(null);
  });

  it("stores each channel's own name as both channel and surface", () => {
    const channels = CANVA_ATLAS_CHANNELS.filter((channel) => channel !== "published-api");
    expect(channels.length).toBeGreaterThan(0);
    expect(
      channels.map((channel) => {
        const cell = canvaUnconfiguredCoverageCell({ at: AT, channel, previous: null });
        return [cell.channel, cell.surface];
      }),
    ).toStrictEqual([
      ["connect-api", "connect-api"],
      ["web-app", "web-app"],
    ]);
  });
});
