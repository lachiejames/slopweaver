import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  activeReachGrant,
  parseReachGrantJournal,
  parseReachGrantLine,
  REACH_GRANT_WINDOW_MS,
  type ReachGrant,
  reachGrantRefusal,
  reachGrantsTaken,
} from "../../../admit/reachGrant.js";
import { appendReachGrant, buildReachGrant, readReachGrants } from "../../../admit/reachGrantStore.js";

const SESSION = "session-a";
const OTHER_SESSION = "session-b";

/** One grant, with every field overridable, so a test states only what it is about. */
function grant(over: Partial<ReachGrant> = {}): ReachGrant {
  return {
    claudeSessionId: SESSION,
    expiresAtIso: "2026-09-07T10:30:00.000Z",
    issuedAtIso: "2026-09-07T10:00:00.000Z",
    reason: "verifying the number the atlas walk found",
    tool: "twilio",
    ...over,
  };
}

describe("parseReachGrantLine", () => {
  it("parses a complete line", () => {
    const parsed = parseReachGrantLine({ line: JSON.stringify(grant()) })!;
    expect(parsed.tool).toBe("twilio");
    expect(parsed.claudeSessionId).toBe(SESSION);
    expect(parsed.expiresAtIso).toBe("2026-09-07T10:30:00.000Z");
  });

  it("returns undefined for a blank line, unparseable JSON, a non-object, and a missing field", () => {
    expect(parseReachGrantLine({ line: "   " })).toBe(undefined);
    expect(parseReachGrantLine({ line: "{not json" })).toBe(undefined);
    expect(parseReachGrantLine({ line: '"a string"' })).toBe(undefined);
    const { tool: _dropped, ...withoutTool } = grant();
    expect(parseReachGrantLine({ line: JSON.stringify(withoutTool) })).toBe(undefined);
  });
});

describe("parseReachGrantJournal", () => {
  it("keeps the valid grants around a torn final write", () => {
    // Append-only journal: a half-written last line must not hide an earlier, valid grant.
    const text = `${JSON.stringify(grant())}\n${JSON.stringify(grant({ tool: "stripe" }))}\n{"claudeSessi`;
    const parsed = parseReachGrantJournal({ text });
    expect(parsed.length).toBe(2);
    expect(parsed[1]!.tool).toBe("stripe");
  });
});

describe("activeReachGrant", () => {
  const grants = [grant(), grant({ tool: "stripe" })];

  it("finds a live grant for the matching session and tool", () => {
    const found = activeReachGrant({
      claudeSessionId: SESSION,
      grants,
      nowIso: "2026-09-07T10:15:00.000Z",
      tool: "twilio",
    })!;
    expect(found.tool).toBe("twilio");
  });

  it("is TOOL-scoped — a twilio grant does not open stripe", () => {
    // The property that stops one grant becoming a standing permission across the whole class.
    const onlyTwilio = [grant()];
    expect(
      activeReachGrant({
        claudeSessionId: SESSION,
        grants: onlyTwilio,
        nowIso: "2026-09-07T10:15:00.000Z",
        tool: "stripe",
      }),
    ).toBe(undefined);
  });

  it("is SESSION-scoped — a grant is never transferable", () => {
    expect(
      activeReachGrant({
        claudeSessionId: OTHER_SESSION,
        grants,
        nowIso: "2026-09-07T10:15:00.000Z",
        tool: "twilio",
      }),
    ).toBe(undefined);
  });

  it("expires exactly at its own expiry instant, not after it", () => {
    expect(
      activeReachGrant({ claudeSessionId: SESSION, grants, nowIso: "2026-09-07T10:30:00.000Z", tool: "twilio" }),
    ).toBe(undefined);
    expect(
      activeReachGrant({ claudeSessionId: SESSION, grants, nowIso: "2026-09-07T10:29:59.999Z", tool: "twilio" })!.tool,
    ).toBe("twilio");
  });

  it("returns undefined for an unparseable clock rather than treating it as live", () => {
    expect(activeReachGrant({ claudeSessionId: SESSION, grants, nowIso: "not-a-time", tool: "twilio" })).toBe(
      undefined,
    );
  });

  it("takes the NEWEST live grant when a session took several", () => {
    const older = grant({ reason: "first", expiresAtIso: "2026-09-07T10:20:00.000Z" });
    const newer = grant({ reason: "second", expiresAtIso: "2026-09-07T10:40:00.000Z" });
    const found = activeReachGrant({
      claudeSessionId: SESSION,
      grants: [older, newer],
      nowIso: "2026-09-07T10:15:00.000Z",
      tool: "twilio",
    })!;
    expect(found.reason).toBe("second");
  });
});

describe("reachGrantsTaken", () => {
  it("counts expired grants too, so a repeat is visible", () => {
    const grants = [grant({ expiresAtIso: "2026-09-07T09:00:00.000Z" }), grant(), grant({ tool: "stripe" })];
    expect(reachGrantsTaken({ claudeSessionId: SESSION, grants, tool: "twilio" })).toBe(2);
    expect(reachGrantsTaken({ claudeSessionId: OTHER_SESSION, grants, tool: "twilio" })).toBe(0);
  });
});

describe("reachGrantRefusal", () => {
  it("names the tool, the verb that opens it, and that the env var does NOT apply", () => {
    const message = reachGrantRefusal({ grantsTaken: 0, tool: "twilio" });
    expect(message).toContain("slopweaver session reach-grant --tool twilio");
    expect(message).toContain("DOES NOT TAKE SLOPWEAVER_ALLOW_RAW");
  });

  it("quotes prior grants back once the session has taken any", () => {
    expect(reachGrantRefusal({ grantsTaken: 0, tool: "stripe" })).not.toContain("already taken");
    expect(reachGrantRefusal({ grantsTaken: 3, tool: "stripe" })).toContain("already taken 3 grant(s)");
  });
});

describe("buildReachGrant", () => {
  it("expires one window after it is issued", () => {
    const built = buildReachGrant({
      claudeSessionId: SESSION,
      issuedAtIso: "2026-09-07T10:00:00.000Z",
      reason: "why",
      tool: "twilio",
    });
    expect(Date.parse(built.expiresAtIso) - Date.parse(built.issuedAtIso)).toBe(REACH_GRANT_WINDOW_MS);
    expect(built.expiresAtIso).toBe("2026-09-07T10:30:00.000Z");
  });
});

describe("the reach-grant journal on disk", () => {
  const homes: string[] = [];

  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });

  /** A throwaway state home this test owns — never the ambient one. */
  function scratchHome(): string {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-reach-grant-"));
    homes.push(home);
    return home;
  }

  it("round-trips an appended grant", () => {
    const home = scratchHome();
    const built = buildReachGrant({
      claudeSessionId: SESSION,
      issuedAtIso: "2026-09-07T10:00:00.000Z",
      reason: "verifying a number",
      tool: "twilio",
    });
    appendReachGrant({ grant: built, home });
    const read = readReachGrants({ home });
    expect(read.length).toBe(1);
    expect(read[0]!.tool).toBe("twilio");
    expect(read[0]!.reason).toBe("verifying a number");
  });

  it("reads an absent journal as no grants — the refusing side", () => {
    expect(readReachGrants({ home: scratchHome() }).length).toBe(0);
  });
});
