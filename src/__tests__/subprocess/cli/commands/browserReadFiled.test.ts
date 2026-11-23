/**
 * The witness that `browser read --under|--find` never reaches a browser: the shipped binary, over a home that
 * holds a session and its filed look but NO extension token and NO recorded profile — either of which a real look
 * needs first — prints the part asked for, names the SAME observation id, and leaves the session record byte for
 * byte as it was. The positive half is the printed lines; the negative half is the unchanged record.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { interactionSessionDir, writeInteractionSession } from "../../../../browser/interactionSessionStore.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const SNAPSHOT = [
  "- banner [ref=e1]:",
  '  - link "Pulls" [ref=e2]',
  "- main [ref=e3]:",
  '  - heading "Fix the parser" [level=1] [ref=e4]',
  '  - button "Merge pull request" [ref=e5] [cursor=pointer]',
].join("\n");

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home holding one live session whose latest look is filed, and nothing a browser needs. */
function seededHome(): { home: string; sessionId: string; record: string } {
  const home = mkdtempSync(join(tmpdir(), "sw-read-filed-"));
  made.push(home);
  const sessionId = "a0000073-0000-4000-8000-000000000079";
  const workspace = join(interactionSessionDir({ home, id: sessionId }), "client");
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
        id: sessionId,
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
  const dir = interactionSessionDir({ home, id: sessionId });
  const file = readdirSync(dir).find((name) => name.endsWith(".json"))!;
  return { home, record: join(dir, file), sessionId };
}

/** Run the shipped binary against the home. */
function read({ home, args }: { home: string; args: readonly string[] }): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const ran = spawnSync(BIN, ["browser", "read", ...args, "--home", home], {
    encoding: "utf8",
    env: { ...process.env, SLOPWEAVER_HOME: home },
    timeout: 60_000,
  });
  return { status: ran.status, stderr: ran.stderr, stdout: ran.stdout };
}

describe("browser read --under | --find", () => {
  it("searches the latest look with no browser to reach, and leaves the session record untouched", () => {
    const { home, sessionId, record } = seededHome();
    const before = readFileSync(record, "utf8");
    const ran = read({ args: ["--session", sessionId, "--find", "merge"], home });
    expect(ran.stderr).not.toContain("extension token");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("  observation: look-1");
    expect(ran.stdout).toContain('      - button "Merge pull request" [ref=e5] [cursor=pointer]');
    expect(ran.stdout).not.toContain('link "Pulls"');
    expect(readFileSync(record, "utf8")).toBe(before);
  });

  it("opens one ref's part of the latest look", () => {
    const { home, sessionId } = seededHome();
    const ran = read({ args: ["--session", sessionId, "--under", "e1"], home });
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain('      - link "Pulls" [ref=e2]');
    expect(ran.stdout).not.toContain("Merge pull request");
  });

  it("refuses a ref the look does not carry, naming it", () => {
    const { home, sessionId } = seededHome();
    const ran = read({ args: ["--session", sessionId, "--under", "e99"], home });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("ref e99 is no element of this session's latest read");
  });
});
