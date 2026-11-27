/**
 * Seating a supervisor successor from a written doc: the spawn's arguments spell the driver, model and plan
 * explicitly, and the chair it opened is read back from the session ledger in a throwaway home — the spawn itself a
 * plain fake that counts its calls and writes the ledger row a real one would.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  chairSuccessorSpawnArgv,
  launchChairSuccessor,
  type SuccessorSpawn,
  spawnedSessionId,
  successorModelOf,
} from "../../../../../cli/commands/supervisor/chairSuccessorLaunch.js";
import { CODEX_MODEL } from "../../../../../codex/profiles.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { appendSessionEvent } from "../../../../../sessions/sessionStore.js";

const SLUG = "acme-chair-successor";
const dirs: string[] = [];

/** A throwaway state home this file removes after every test. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "successor-launch-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** Write the open app row a spawn records for a slug. */
function recordOpened({ at, sessionId }: { at: string; sessionId: string }): void {
  appendSessionEvent({
    event: {
      branch: SLUG,
      cwd: at,
      harness: "app",
      kind: "spawned",
      sessionId,
      sessionKey: SLUG,
      slug: SLUG,
      surfaceRef: `app:${sessionId}`,
      tsIso: "2026-11-27T00:00:00.000Z",
      workspaceRef: `app:${sessionId}`,
    },
    home: at,
  });
}

describe("successorModelOf and chairSuccessorSpawnArgv", () => {
  it("boots Fable on a Claude plan and the fleet's Codex pin on a Codex one", () => {
    expect([successorModelOf({ vendor: "claude" }), successorModelOf({ vendor: "codex" })]).toEqual([
      "fable",
      CODEX_MODEL,
    ]);
  });

  it("spells the harness, driver, model, plan and home after the slug", () => {
    expect(chairSuccessorSpawnArgv({ alias: "plan-two", home: "/h", slug: SLUG, vendor: "claude" })).toEqual([
      SLUG,
      "--harness",
      "app",
      "--driver",
      "claude",
      "--model",
      "fable",
      "--plan",
      "plan-two",
      "--home",
      "/h",
    ]);
  });
});

describe("spawnedSessionId", () => {
  it("names nothing in an empty home, and the open app row for the slug once one is written", () => {
    const at = home();
    const before = spawnedSessionId({ home: at, slug: SLUG });
    recordOpened({ at, sessionId: "chair-1" });
    expect([before, spawnedSessionId({ home: at, slug: SLUG }), spawnedSessionId({ home: at, slug: "other" })]).toEqual(
      [undefined, "chair-1", undefined],
    );
  });
});

describe("launchChairSuccessor", () => {
  it("runs the spawn once with the successor's arguments and answers the chair the ledger recorded", async () => {
    const at = home();
    const calls: (readonly string[])[] = [];
    const runSpawn: SuccessorSpawn = async ({ argv }) => {
      calls.push(argv);
      recordOpened({ at, sessionId: "chair-new" });
      return 0;
    };
    const opened = await launchChairSuccessor({ alias: "codex-one", home: at, runSpawn, slug: SLUG, vendor: "codex" });
    expect(unwrap(opened)).toEqual({ sessionId: "chair-new", slug: SLUG });
    expect(calls).toEqual([chairSuccessorSpawnArgv({ alias: "codex-one", home: at, slug: SLUG, vendor: "codex" })]);
  });

  it("refuses with the exit's reason and the spawn's last stderr line when no chair opened", async () => {
    const at = home();
    const runSpawn: SuccessorSpawn = async () => {
      process.stderr.write("preflight\nno plan can take a seat\n");
      return 1;
    };
    const refused = unwrapErr(
      await launchChairSuccessor({ alias: "plan-two", home: at, runSpawn, slug: SLUG, vendor: "claude" }),
    );
    expect(refused).toEqual({
      reason: "the successor did not boot cleanly (exit 1): no plan can take a seat",
      slug: SLUG,
    });
  });
});
