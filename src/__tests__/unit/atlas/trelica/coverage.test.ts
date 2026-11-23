import { describe, expect, it } from "vitest";

import {
  failedTrelicaCoverageCell,
  succeededTrelicaCoverageCell,
  trelicaCoverageFreshness,
  withTrelicaCoverageCell,
} from "../../../../atlas/trelica/coverage.js";
import {
  TRELICA_ATLAS_CHANNELS,
  type TrelicaArtifactRef,
  type TrelicaAtlasChannel,
  type TrelicaCoverageCell,
} from "../../../../atlas/trelica/model.js";

const AT = "2026-10-12T10:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Trelica declares the daily window: thirty-six hours. */
const DECLARED_WINDOW_MS = 36 * HOUR_MS;

const SCREENSHOT: TrelicaArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/users.png",
  sha256: "a".repeat(64),
};

const CHANNEL_SCOPES: readonly (readonly [TrelicaAtlasChannel, string])[] = [
  ["published-api", "published-api-client-credentials"],
  ["first-party-api", "signed-in-session-roles"],
  ["browser", "browser-signed-in-roles"],
];

/** A stored cell whose variable parts are its surface, channel, scope, last success and failure flag. */
function storedCell({
  surface,
  channel = "published-api",
  scope = "tenant/users",
  lastSuccessAt = AT,
  latestAttemptFailed = false,
}: {
  surface: string;
  channel?: TrelicaAtlasChannel;
  scope?: string;
  lastSuccessAt?: string | null;
  latestAttemptFailed?: boolean;
}): TrelicaCoverageCell {
  return {
    artifacts: [],
    channel,
    lastSuccessAt,
    latestAttemptFailed,
    reason: `stored ${surface}`,
    role: "authoritative",
    scope,
    state: "synced",
    surface,
    unblockedBy: null,
    visibilityScope: "published-api-client-credentials",
  };
}

describe("succeededTrelicaCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the channel's own scope", () => {
    const cell = succeededTrelicaCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "first-party-api",
      reason: "read 41 user(s)",
      role: "corroborating",
      scope: "tenant/users",
      state: "synced",
      surface: "users",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "first-party-api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read 41 user(s)",
      role: "corroborating",
      scope: "tenant/users",
      state: "synced",
      surface: "users",
      unblockedBy: null,
      visibilityScope: "signed-in-session-roles",
    });
  });

  it("maps every declared channel to its own visibility scope", () => {
    expect(CHANNEL_SCOPES.map(([channel]) => channel)).toStrictEqual([...TRELICA_ATLAS_CHANNELS]);
    const scopes = CHANNEL_SCOPES.map(
      ([channel]) =>
        succeededTrelicaCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "synced",
          surface: "users",
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(CHANNEL_SCOPES.map(([, scope]) => scope));
  });

  it("does not alias the caller's artifact array", () => {
    const artifacts = [SCREENSHOT];
    const cell = succeededTrelicaCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "users",
    });
    artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("failedTrelicaCoverageCell", () => {
  it("keeps the prior success's instant and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeededTrelicaCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "published-api",
      reason: "read 41 user(s)",
      role: "authoritative",
      scope: "tenant/users",
      state: "synced",
      surface: "users",
    });
    const cell = failedTrelicaCoverageCell({
      channel: "browser",
      previous,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "tenant/people",
      state: "unreadable",
      surface: "users",
      unblockedBy: "sign in again",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "tenant/people",
      state: "unreadable",
      surface: "users",
      unblockedBy: "sign in again",
      visibilityScope: "browser-signed-in-roles",
    });
  });

  it("has no success and no artifacts when nothing came before", () => {
    const cell = failedTrelicaCoverageCell({
      channel: "first-party-api",
      previous: null,
      reason: "401 on the session",
      role: "authoritative",
      scope: "tenant/users",
      state: "not-configured",
      surface: "users",
      unblockedBy: null,
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "first-party-api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "401 on the session",
      role: "authoritative",
      scope: "tenant/users",
      state: "not-configured",
      surface: "users",
      unblockedBy: null,
      visibilityScope: "signed-in-session-roles",
    });
  });

  it("does not alias the prior cell's artifact array", () => {
    const previous = succeededTrelicaCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "published-api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "users",
    });
    const cell = failedTrelicaCoverageCell({
      channel: "published-api",
      previous,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "users",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("trelicaCoverageFreshness", () => {
  it("judges against the declared thirty-six hour window, so a five-hour-old success is current", () => {
    const assessment = trelicaCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - 5 * HOUR_MS).toISOString(), surface: "users" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("still calls a success exactly at the window's edge current", () => {
    const assessment = trelicaCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS).toISOString(), surface: "users" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
  });

  it("calls a success one minute past the window historical", () => {
    const assessment = trelicaCoverageFreshness({
      cell: storedCell({
        lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS - MINUTE_MS).toISOString(),
        surface: "users",
      }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("never calls a recent success current when the latest attempt failed", () => {
    const assessment = trelicaCoverageFreshness({
      cell: storedCell({ latestAttemptFailed: true, surface: "users" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
  });

  it("reports a cell that never succeeded as never-synced", () => {
    const assessment = trelicaCoverageFreshness({
      cell: storedCell({ lastSuccessAt: null, latestAttemptFailed: true, surface: "users" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("never-synced");
  });
});

describe("withTrelicaCoverageCell", () => {
  it("replaces the cell on the same surface and leaves the others untouched", () => {
    const users = storedCell({ surface: "users" });
    const apps = storedCell({ surface: "apps" });
    const licences = storedCell({ surface: "licences" });
    const replacement = { ...apps, reason: "apps again" };
    const result = withTrelicaCoverageCell({ cells: [users, apps, licences], replacement });
    expect(result).toStrictEqual([users, licences, replacement]);
  });

  it("appends when the surface is absent", () => {
    const users = storedCell({ surface: "users" });
    const apps = storedCell({ surface: "apps" });
    const result = withTrelicaCoverageCell({ cells: [users], replacement: apps });
    expect(result).toStrictEqual([users, apps]);
  });

  it("installs into an empty list", () => {
    const users = storedCell({ surface: "users" });
    expect(withTrelicaCoverageCell({ cells: [], replacement: users })).toStrictEqual([users]);
  });

  it("replaces by surface even when the replacement's scope differs, never standing beside the old", () => {
    const old = storedCell({ scope: "tenant/users", surface: "users" });
    const other = storedCell({ surface: "apps" });
    const replacement = storedCell({ scope: "tenant/people", surface: "users" });
    const result = withTrelicaCoverageCell({ cells: [old, other], replacement });
    expect(result).toStrictEqual([other, replacement]);
  });

  it("does not mutate the list it was given", () => {
    const users = storedCell({ surface: "users" });
    const cells = [users];
    withTrelicaCoverageCell({ cells, replacement: storedCell({ surface: "apps" }) });
    expect(cells).toStrictEqual([users]);
  });
});
