/**
 * `handover claim` and `handover release`: the pure takeover decision across every ownership kind, and both
 * verbs' refusals over a real temp board — each stopping before the append, so no clock and no session
 * registry is read.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimRefusal,
  runHandoverClaim,
  runHandoverRelease,
} from "../../../../../cli/commands/handover/lifecycleRunOwnership.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import type { RunOwnership, RunWriter } from "../../../../../handover/runOwner.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../../../supervisor/session.js";
import {
  clearSessionEnv,
  lifecycleHome,
  restoreSessionEnv,
  STARTED,
  snapshotTree,
  verbArgv,
} from "./lifecycleRunFixture.js";

const SLUG = "ownership-run";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
  restoreSessionEnv();
});

const WRITER: RunWriter = {
  atIso: "2026-10-01T09:01:00.000Z",
  host: "claude-code",
  pid: 4242,
  sessionId: "old-session",
  worktree: "/wt/old",
};

const FOREIGN: RunOwnership = { kind: "elsewhere", thisSession: "new-session", writer: WRITER };

describe("claimRefusal", () => {
  it("admits unowned, mine and released runs whatever the writer's liveness", () => {
    const admitted: readonly RunOwnership[] = [
      { kind: "unowned" },
      { kind: "mine", writer: WRITER },
      { kind: "released", releasedAtIso: "2026-10-01T09:02:00.000Z", why: "handing on", writer: WRITER },
    ];
    const livenesses: readonly Parameters<typeof claimRefusal>[0]["liveness"][] = [
      { kind: "live" },
      { kind: "dead" },
      { kind: "unknown", why: "no registry" },
    ];

    expect(
      admitted.flatMap((ownership) =>
        livenesses.map((liveness) => claimRefusal({ forced: false, liveness, ownership })),
      ),
    ).toEqual(Array.from({ length: 9 }, () => undefined));
  });

  it("admits a foreign writer proven dead, and refuses the same writer while live", () => {
    expect(claimRefusal({ forced: false, liveness: { kind: "dead" }, ownership: FOREIGN })).toBeUndefined();
    expect(claimRefusal({ forced: false, liveness: { kind: "live" }, ownership: FOREIGN })).toBe(
      "session old-session is still live — release it there first, or repeat with --force",
    );
  });

  it("refuses a foreign writer of unknown liveness, quoting why it is unknown", () => {
    expect(claimRefusal({ forced: false, liveness: { kind: "unknown", why: "no registry" }, ownership: FOREIGN })).toBe(
      "the old writer's liveness is unknown (no registry) — release it there first, or repeat with --force",
    );
  });

  it("admits a live foreign writer once --force is given", () => {
    expect(claimRefusal({ forced: true, liveness: { kind: "live" }, ownership: FOREIGN })).toBeUndefined();
  });
});

describe("runHandoverClaim", () => {
  it("answers 2 with no --why and 1 with one but no identifiable session, writing nothing either way", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });

    const missingWhy = await runHandoverClaim(verbArgv({ rest: [SLUG, "--home", home], verb: "claim" }));
    const noSession = await runHandoverClaim(
      verbArgv({ rest: [SLUG, "--home", home, "--why", "taking it over"], verb: "claim" }),
    );

    expect([missingWhy, noSession]).toEqual([2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });

  it("answers 0 without appending when this session already holds the run", async () => {
    clearSessionEnv();
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = "this-session";
    const claimed: RunEvent = {
      atIso: "2026-10-01T09:01:00.000Z",
      host: "claude-code",
      kind: "claimed",
      pid: 4242,
      sessionId: "this-session",
      why: "took it earlier",
      worktree: "/wt/this",
    };
    const { home } = lifecycleHome({ events: [STARTED, claimed], homes, slug: SLUG });
    const before = snapshotTree({ root: home });

    const code = await runHandoverClaim(verbArgv({ rest: [SLUG, "--home", home, "--why", "again"], verb: "claim" }));

    expect(code).toBe(0);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});

describe("runHandoverRelease", () => {
  it("answers 1 for a run no session ever claimed, writing nothing", async () => {
    clearSessionEnv();
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = "this-session";
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });

    const code = await runHandoverRelease(
      verbArgv({ rest: [SLUG, "--home", home, "--why", "handing it on"], verb: "release" }),
    );

    expect(code).toBe(1);
    expect(snapshotTree({ root: home })).toEqual(before);
  });

  it("answers 2 with no --why and 1 with one but no identifiable session, writing nothing either way", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });

    const missingWhy = await runHandoverRelease(verbArgv({ rest: [SLUG, "--home", home], verb: "release" }));
    const noSession = await runHandoverRelease(
      verbArgv({ rest: [SLUG, "--home", home, "--why", "handing it on"], verb: "release" }),
    );

    expect([missingWhy, noSession]).toEqual([2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});
