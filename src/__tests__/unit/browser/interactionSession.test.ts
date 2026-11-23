import { describe, expect, it } from "vitest";

import {
  INTERACTION_SESSION_TTL_MS,
  runSlugOfCwd,
  sessionCoversUrl,
  sessionIsLive,
  sessionObservationIsCurrent,
  sessionOwnerOf,
} from "../../../browser/interactionSession.js";

const session = {
  clientSession: "slopweaver-abc",
  id: "abc",
  openedAtIso: "2026-09-12T04:00:00.000Z",
  origins: ["https://app.datadoghq.com"],
  owner: null,
  ownerSessionId: "session-1",
  placement: "background" as const,
  touchedAtIso: "2026-09-12T04:00:00.000Z",
  workspace: "/tmp/ws",
};

describe("who opened a session", () => {
  it("reads the Claude pid, the cmux workspace and the run slug off the opener's environment", () => {
    const owner = sessionOwnerOf({
      cwd: "/Users/x/dev/slopweaver/.claude/worktrees.noindex/some-run-28-sep/src/cli",
      env: { CLAUDE_PID: "76112", CMUX_WORKSPACE_ID: "9EF3777A" },
    });
    expect(owner).toEqual({ cmuxWorkspace: "9EF3777A", pid: 76112, runSlug: "some-run-28-sep" });
  });

  it("records null for every field a host does not carry, rather than guessing one", () => {
    expect(sessionOwnerOf({ cwd: "/Users/x/dev/slopweaver", env: {} })).toEqual({
      cmuxWorkspace: null,
      pid: null,
      runSlug: null,
    });
  });

  it("refuses a pid that is not a positive integer", () => {
    expect(sessionOwnerOf({ cwd: "/", env: { CLAUDE_PID: "0" } }).pid).toBe(null);
    expect(sessionOwnerOf({ cwd: "/", env: { CLAUDE_PID: "12abc" } }).pid).toBe(null);
  });

  it("names the run for the worktree root itself, and for the older non-noindex directory", () => {
    expect(runSlugOfCwd({ cwd: "/r/.claude/worktrees.noindex/a-run" })).toBe("a-run");
    expect(runSlugOfCwd({ cwd: "/r/.claude/worktrees/b-run/docs" })).toBe("b-run");
  });
});

describe("how long a session may be acted through", () => {
  it("is live a minute after it was touched", () => {
    expect(sessionIsLive({ nowIso: "2026-09-12T04:01:00.000Z", session })).toBe(true);
  });

  it("is not live once the idle window has passed", () => {
    expect(sessionIsLive({ nowIso: "2026-09-12T04:16:00.000Z", session })).toBe(false);
  });

  it("refuses an unreadable instant rather than treating it as fresh", () => {
    expect(sessionIsLive({ nowIso: "not a time", session })).toBe(false);
  });

  it("outlives one observation's own window, which is much tighter", () => {
    expect(INTERACTION_SESSION_TTL_MS).toBe(900000);
  });
});

describe("whether an observation still describes the page", () => {
  const observation = {
    id: "obs-1",
    observedAtIso: "2026-09-12T04:00:00.000Z",
    screenshotPath: "/tmp/ws/look-obs-1.png",
    snapshotPath: "/tmp/ws/.playwright-cli/page.yml",
    title: "Monitors",
    url: "https://app.datadoghq.com/monitors",
  };

  it("is current when the page has not moved", () => {
    expect(sessionObservationIsCurrent({ currentUrl: "https://app.datadoghq.com/monitors", observation })).toBe(true);
  });

  it("is stale on a different page of the same site, not just a different host", () => {
    expect(
      sessionObservationIsCurrent({ currentUrl: "https://app.datadoghq.com/organization-settings", observation }),
    ).toBe(false);
  });
});

describe("the origins a session declared", () => {
  it("covers a page on its own origin", () => {
    expect(sessionCoversUrl({ session, url: "https://app.datadoghq.com/monitors/1" })).toBe(true);
  });

  it("does not cover a sign-in redirect somewhere else", () => {
    expect(sessionCoversUrl({ session, url: "https://accounts.google.com/signin" })).toBe(false);
  });

  it("does not cover an address that will not parse", () => {
    expect(sessionCoversUrl({ session, url: "not a url" })).toBe(false);
  });
});
