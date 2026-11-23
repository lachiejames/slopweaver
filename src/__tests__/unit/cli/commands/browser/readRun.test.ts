/**
 * `browser read --under|--find` over a home holding one session and its filed look, with a profile door that
 * refuses every read — so a run that reached for the browser could not succeed. The negative half is the session
 * record, byte for byte as it was.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { interactionSessionDir, writeInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import { runBrowserRead } from "../../../../../cli/commands/browser/readRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unavailableRecordedProfilePort } from "../../../../recordedProfileFixture.js";

const SNAPSHOT = ["- main [ref=e1]:", '  - button "Merge pull request" [ref=e2]'].join("\n");
const SESSION_ID = "a0000073-0000-4000-8000-000000000079";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home holding one live session whose latest look is filed. */
function seededHome(): { home: string; record: string } {
  const home = mkdtempSync(join(tmpdir(), "sw-read-run-"));
  made.push(home);
  const workspace = join(interactionSessionDir({ home, id: SESSION_ID }), "client");
  mkdirSync(workspace, { recursive: true });
  const snapshotPath = join(workspace, "observation-look-1.yml");
  writeFileSync(snapshotPath, SNAPSHOT, "utf8");
  const nowIso = new Date().toISOString();
  writeInteractionSession({
    home,
    stored: {
      observation: {
        id: "look-1",
        observedAtIso: nowIso,
        screenshotPath: null,
        snapshotPath,
        title: "PR",
        url: "https://github.com/acme/app/pull/1",
      },
      session: {
        clientSession: "slopweaver-0f0f0f0f",
        id: SESSION_ID,
        openedAtIso: nowIso,
        origins: ["https://github.com"],
        owner: { cmuxWorkspace: null, pid: process.pid, runSlug: null },
        ownerSessionId: "unknown-session",
        placement: "background",
        touchedAtIso: nowIso,
        workspace,
      },
    },
  });
  const dir = interactionSessionDir({ home, id: SESSION_ID });
  return {
    home,
    record: join(
      dir,
      readdirSync(dir).find((name) => name.endsWith(".json"))!,
    ),
  };
}

/** Read the seeded session with the given flags and a profile door no look can pass. */
function read({ home, under, find }: { home: string; under?: string; find?: string }): Promise<number> {
  return runBrowserRead({
    find,
    home,
    json: false,
    profiles: unavailableRecordedProfilePort(),
    sessionId: SESSION_ID,
    under,
  });
}

describe("runBrowserRead over the latest look", () => {
  it("searches it without reaching the browser, and leaves the session record untouched", async () => {
    const { home, record } = seededHome();
    const before = readFileSync(record, "utf8");
    expect(await read({ find: "merge", home })).toBe(EXIT_OK);
    expect(readFileSync(record, "utf8")).toBe(before);
  });

  it("opens one ref of it", async () => {
    const { home } = seededHome();
    expect(await read({ home, under: "e1" })).toBe(EXIT_OK);
  });

  it("fails on a ref the look does not carry", async () => {
    const { home } = seededHome();
    expect(await read({ home, under: "e99" })).toBe(EXIT_ERROR);
  });

  it("refuses --under and --find together as usage, before reading anything", async () => {
    const { home } = seededHome();
    expect(await read({ find: "merge", home, under: "e1" })).toBe(EXIT_USAGE);
  });
});
