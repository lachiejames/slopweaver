/** Why an unclaimed tab is handed over rather than typed into, a pure cold-seat guard driven directly. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unclaimedTabReason } from "../../../../../../cli/commands/fleet/resumeCold.js";
import { makeHome } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("unclaimedTabReason", () => {
  const SESSION = "3d2c1b0a-0000-4000-8000-000000000001";

  it("names a resumable bare shell, never typing into it", () => {
    const verdict = { argv: "", cwd: "/w/repo", kind: "cold", mismatch: undefined, sessionId: SESSION } as const;
    expect(unclaimedTabReason({ verdict })).toBe(
      "it is in an open ledger row's worktree but no open row paired to it, so which seat it is is unknown",
    );
  });

  it("names a bare shell whose transcript is gone", () => {
    const verdict = { cwd: "/w/repo", kind: "unresumable", sessionId: SESSION } as const;
    expect(unclaimedTabReason({ verdict })).toBe(
      "it is in an open ledger row's worktree but no open row paired to it, so which seat it is is unknown",
    );
  });

  it("names a bare shell whose saved session is already live in another tab", () => {
    expect(unclaimedTabReason({ verdict: { kind: "not-cold", why: "live-elsewhere" } })).toBe(
      "no open row paired to it and its saved session is already live in another tab, so it may be a stale duplicate",
    );
  });

  it("names a bare shell nothing saved a session for", () => {
    expect(unclaimedTabReason({ verdict: { kind: "not-cold", why: "no-saved-session" } })).toBe(
      "a bare shell in an open ledger row's worktree with no saved session and no open row paired to it, so nothing resumes it",
    );
  });

  it("passes over a running tab", () => {
    const reasons = (["live-session", "not-a-bare-shell"] as const).map((why) =>
      unclaimedTabReason({ verdict: { kind: "not-cold", why } }),
    );
    expect(reasons).toEqual([undefined, undefined]);
  });
});
