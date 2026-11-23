/*
 * How the Linear browser channel projects a browser that never ran: every kind reads unreadable, carrying
 * forward only that kind's own prior browser success, one browser-unreadable gap is raised on page, and no
 * entity is projected.
 */
import { describe, expect, it } from "vitest";

import type { AtlasArtifactRef } from "../../../../../atlas/kit/contract.js";
import type { LinearCoverageCell } from "../../../../../atlas/linear/model.js";
import { projectBrowserChannel } from "../../../../../atlas/linear/projectBrowser.js";

import { AT, art, browserGap } from "./harness.js";

const UNBLOCKED_BY = "a Playwright Extension relay that attaches to the owner's own Chrome";

describe("projectBrowserChannel — a browser that never ran", () => {
  const reason = "no Playwright relay was attached (unavailable-sentinel)";

  /**
   * A stored cell, unique in channel, time and artifact.
   *
   * @param channel which channel stored it
   * @param lastSuccessAt when it last succeeded
   * @param sha the digest character of its one artifact
   * @returns the stored cell
   */
  function stored({
    channel,
    lastSuccessAt,
    sha,
  }: {
    channel: "api" | "browser";
    lastSuccessAt: string;
    sha: string;
  }): LinearCoverageCell {
    return {
      artifacts: [art({ byteLength: sha.charCodeAt(0), name: `stored-${sha}`, sha })],
      channel,
      lastSuccessAt,
      latestAttemptFailed: false,
      reason: `stored ${channel} ${sha}`,
      role: "authoritative",
      scope: "settings-walk",
      state: "synced",
      surface: channel === "api" ? "graphql-api" : "settings-browser",
      unblockedBy: null,
      visibilityScope: "one-member-session",
    };
  }

  const API_OPERATION = stored({ channel: "api", lastSuccessAt: "2026-06-01T00:00:00.000Z", sha: "a" });
  const BROWSER_OPERATION = stored({ channel: "browser", lastSuccessAt: "2026-07-02T00:00:00.000Z", sha: "b" });
  const BROWSER_PAGE = stored({ channel: "browser", lastSuccessAt: "2026-08-03T00:00:00.000Z", sha: "c" });
  const API_SETTING = stored({ channel: "api", lastSuccessAt: "2026-09-04T00:00:00.000Z", sha: "d" });
  const BROWSER_TYPE = stored({ channel: "browser", lastSuccessAt: "2026-10-05T00:00:00.000Z", sha: "e" });

  const projection = projectBrowserChannel({
    at: AT,
    plannedCount: 11,
    previous: {
      operation: [API_OPERATION, BROWSER_OPERATION],
      page: [BROWSER_PAGE],
      setting: [API_SETTING],
      type: [BROWSER_TYPE],
    },
    reading: {
      limited: false,
      observations: { graphqlResponses: 0, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
      pages: [],
      unavailableBecause: reason,
    },
  });

  /**
   * The unreadable cell one kind must carry.
   *
   * @param artifacts the prior browser success's screenshots, carried forward
   * @param lastSuccessAt the prior browser success's time, or `null` when there was none
   * @returns the expected cell
   */
  function unreadable({
    artifacts,
    lastSuccessAt,
  }: {
    artifacts: readonly AtlasArtifactRef[];
    lastSuccessAt: string | null;
  }): LinearCoverageCell[] {
    return [
      {
        artifacts: [...artifacts],
        channel: "browser",
        lastSuccessAt,
        latestAttemptFailed: true,
        reason,
        role: "authoritative",
        scope: "settings-walk",
        state: "unreadable",
        surface: "settings-browser",
        unblockedBy: UNBLOCKED_BY,
        visibilityScope: "one-member-session",
      },
    ];
  }

  it("marks every kind unreadable, carrying forward that kind's own prior BROWSER success", () => {
    expect(projection.coverage).toEqual({
      operation: unreadable({ artifacts: BROWSER_OPERATION.artifacts, lastSuccessAt: "2026-07-02T00:00:00.000Z" }),
      page: unreadable({ artifacts: BROWSER_PAGE.artifacts, lastSuccessAt: "2026-08-03T00:00:00.000Z" }),
      setting: unreadable({ artifacts: [], lastSuccessAt: null }),
      type: unreadable({ artifacts: BROWSER_TYPE.artifacts, lastSuccessAt: "2026-10-05T00:00:00.000Z" }),
    });
  });

  it("raises one browser-unreadable gap on page and projects no entity", () => {
    expect(projection.gaps).toEqual({
      operation: [],
      page: [
        browserGap({
          condition: "browser-surface-unreadable",
          fields: [],
          kind: "page",
          reason,
          scope: "settings-walk",
        }),
      ],
      setting: [],
      type: [],
    });
    expect(projection.entities).toEqual({ operation: [], page: [], setting: [], type: [] });
  });
});
