/**
 * `src/admit/profileLoadGate.ts` — an external write from a session the owner's profile never reached is refused loudly,
 * on positive evidence only. The evidence half reads a real ledger and a real transcript in a temp home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { admitDoor } from "../../../admit/door.js";
import { profileLoadFindings, readProfileLoadEvidence } from "../../../admit/profileLoadGate.js";
import type { DoorEffect, DoorRequest } from "../../../admit/types.js";
import { appendProfileLoad } from "../../../context/loadLedgerStore.js";
import { unwrap } from "../../../lib/result.js";

let home = "";
let projectsDir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "profile-gate-home-"));
  projectsDir = mkdtempSync(join(tmpdir(), "profile-gate-projects-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(projectsDir, { force: true, recursive: true });
});

/** A door request with the effect named. */
function request({ effect }: { effect: DoorEffect }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "post" },
    artifact: {},
    meta: { createsWorkItem: false, effect, home: null, requiresApproval: false },
  };
}

/** A transcript for `sessionId` whose boot recorded the profile hook as never having run. */
function writeFailedBoot({ sessionId }: { sessionId: string }): void {
  const dir = join(projectsDir, "-repo-stale-wt");
  mkdirSync(dir, { recursive: true });
  const attachment = {
    command:
      '"/d/mirror/by-root/repo/stale-wt/current/scripts/hook.sh" 10 profile-context "…/hooks/profile-context.sh"',
    durationMs: 12,
    exitCode: 127,
    hookEvent: "SessionStart",
    hookName: "SessionStart:startup",
    stderr:
      "Failed with non-blocking status code: /bin/sh: /d/mirror/by-root/repo/stale-wt/current/scripts/hook.sh: No such file or directory",
    type: "hook_non_blocking_error",
  };
  const line = {
    attachment,
    cwd: "/repo/stale-wt",
    sessionId,
    timestamp: "2026-10-05T10:23:58.000Z",
    type: "attachment",
  };
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(line)}\n`);
}

/** The evidence for a Claude session with this id. */
function evidenceFor({ sessionId }: { sessionId: string }): ReturnType<typeof readProfileLoadEvidence> {
  return readProfileLoadEvidence({
    env: { CLAUDE_CODE_SESSION_ID: sessionId },
    home,
    firstBootSeen: () => false,
    neverConfigured: () => false,
    projectsDir,
  });
}

describe("profileLoadFindings", () => {
  const unloaded = {
    kind: "read" as const,
    verdict: {
      kind: "unloaded" as const,
      latest: {
        atIso: "2026-10-05T10:23:58.000Z",
        cwd: "",
        event: "SessionStart:startup",
        outcome: "failed" as const,
        sessionId: "s-9",
        why: "w",
      },
    },
  };

  it("holds, naming the repair, an external write from an unloaded session", () => {
    const [finding] = profileLoadFindings({ evidence: unloaded, request: request({ effect: "external-write" }) });
    expect(finding!.code).toBe("PROFILE_NOT_LOADED");
    expect(finding!.severity).toBe("hold");
    expect(finding!.correction).toContain("`slopweaver profile context`");
    expect(finding!.summary).toContain("s-9");
  });

  it("says nothing of a local write, or of a call no session made", () => {
    expect(profileLoadFindings({ evidence: unloaded, request: request({ effect: "local-state" }) })).toEqual([]);
    expect(
      profileLoadFindings({ evidence: { kind: "no-session" }, request: request({ effect: "external-write" }) }),
    ).toEqual([]);
  });

  it("passes an external write from a first boot, where there is no profile to hold for", () => {
    expect(
      profileLoadFindings({ evidence: { kind: "first-boot" }, request: request({ effect: "external-write" }) }),
    ).toEqual([]);
  });

  it("holds a session a first boot let through once the machine is configured, naming the repair", () => {
    const [finding] = profileLoadFindings({
      evidence: { kind: "configured-after-first-boot" },
      request: request({ effect: "external-write" }),
    });
    expect([
      finding!.code,
      finding!.severity,
      finding!.summary.startsWith("this session began on a first boot"),
    ]).toEqual(["PROFILE_NOT_LOADED", "hold", true]);
    expect(finding!.correction).toContain("`slopweaver profile context`");
  });

  it("holds too when the evidence could not be read", () => {
    const [finding] = profileLoadFindings({
      evidence: { kind: "unreadable", problems: ["ledger unreadable"] },
      request: request({ effect: "external-write" }),
    });
    expect([finding!.code, finding!.severity, finding!.summary.endsWith("ledger unreadable")]).toEqual([
      "PROFILE_LOAD_UNREADABLE",
      "hold",
      true,
    ]);
  });

  it("holds the write through the door even under the override token it once carried", () => {
    const gate = (): ReturnType<typeof profileLoadFindings> =>
      profileLoadFindings({ evidence: unloaded, request: request({ effect: "external-write" }) });
    const refused = admitDoor({ env: {}, gates: [gate], request: request({ effect: "external-write" }) });
    const retired = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "profile.loaded:v1" },
      gates: [gate],
      request: request({ effect: "external-write" }),
    });
    expect([refused.status, retired.status]).toEqual(["hold", "hold"]);
  });
});

describe("readProfileLoadEvidence", () => {
  it("is no-session when the environment names none", () => {
    expect(
      readProfileLoadEvidence({ env: {}, firstBootSeen: () => false, home, neverConfigured: () => false, projectsDir }),
    ).toEqual({
      kind: "no-session",
    });
  });

  it("is unobserved for a session with no transcript and no row — absence passes", () => {
    expect(evidenceFor({ sessionId: "fresh" })).toEqual({ kind: "read", verdict: { kind: "unobserved" } });
  });

  it("is unloaded off the session's own transcript when its profile hook never ran", () => {
    writeFailedBoot({ sessionId: "stale" });
    expect(evidenceFor({ sessionId: "stale" })).toMatchObject({
      kind: "read",
      verdict: {
        kind: "unloaded",
        latest: { sessionId: "stale", why: "the SessionStart:startup profile hook never ran (exit-127)" },
      },
    });
  });

  it("is first-boot for an unloaded session on a never-configured machine, and asks nothing of any other", () => {
    writeFailedBoot({ sessionId: "stale" });
    const asked: string[] = [];
    const read = ({ sessionId, fresh }: { sessionId: string; fresh: boolean }): string =>
      readProfileLoadEvidence({
        env: { CLAUDE_CODE_SESSION_ID: sessionId },
        home,
        firstBootSeen: () => false,
        neverConfigured: () => {
          asked.push(sessionId);
          return fresh;
        },
        projectsDir,
      }).kind;
    expect([
      read({ fresh: true, sessionId: "stale" }),
      read({ fresh: false, sessionId: "stale" }),
      read({ fresh: true, sessionId: "fresh" }),
    ]).toEqual(["first-boot", "read", "read"]);
    expect(asked).toEqual(["stale", "stale"]);
  });

  it("is first-boot, not unreadable, when the session's records cannot be read on a never-configured machine", () => {
    // An unreadable transcript held a first boot's write for a profile it never had.
    mkdirSync(join(home, "profile", "loads.jsonl"), { recursive: true });
    const read = ({ fresh }: { fresh: boolean }): string =>
      readProfileLoadEvidence({
        env: { CLAUDE_CODE_SESSION_ID: "s-x" },
        home,
        firstBootSeen: () => false,
        neverConfigured: () => fresh,
        projectsDir,
      }).kind;
    expect([read({ fresh: true }), read({ fresh: false })]).toEqual(["first-boot", "unreadable"]);
  });

  it("is configured-after-first-boot for an unobserved session a first boot let through, once a profile exists", () => {
    // One admitted compound call could configure the machine, write the owner's profile and then write
    // outward, and the door passed the session as unobserved.
    const read = ({ seen, fresh }: { seen: boolean; fresh: boolean }): string =>
      readProfileLoadEvidence({
        env: { CLAUDE_CODE_SESSION_ID: "booted" },
        firstBootSeen: ({ sessionIds }) => seen && sessionIds.includes("booted"),
        home,
        neverConfigured: () => fresh,
        projectsDir,
      }).kind;
    expect([
      read({ fresh: false, seen: true }),
      read({ fresh: true, seen: true }),
      read({ fresh: false, seen: false }),
    ]).toEqual(["configured-after-first-boot", "read", "read"]);
  });

  it("is loaded once a by-hand reload is recorded after the failure", () => {
    writeFailedBoot({ sessionId: "stale" });
    unwrap(
      appendProfileLoad({
        home,
        row: {
          atIso: "2026-10-05T10:30:00.000Z",
          cwd: "/repo/stale-wt",
          event: "by-hand",
          origin: "live",
          reason: "",
          sessionId: "stale",
          source: "by-hand",
        },
      }),
    );
    expect(evidenceFor({ sessionId: "stale" })).toMatchObject({ kind: "read", verdict: { kind: "loaded" } });
  });

  it("is unloaded off a hook row that found no profile at all", () => {
    unwrap(
      appendProfileLoad({
        home,
        row: {
          atIso: "2026-10-05T10:30:00.000Z",
          cwd: "",
          event: "SessionStart",
          origin: "none",
          reason: "store down",
          sessionId: "codex-thread",
          source: "hook",
        },
      }),
    );
    expect(evidenceFor({ sessionId: "codex-thread" })).toMatchObject({ kind: "read", verdict: { kind: "unloaded" } });
  });

  it("is unreadable, naming the ledger, when the ledger path is not a file", () => {
    mkdirSync(join(home, "profile", "loads.jsonl"), { recursive: true });
    const evidence = evidenceFor({ sessionId: "fresh" });
    expect(evidence.kind).toBe("unreadable");
  });
});
