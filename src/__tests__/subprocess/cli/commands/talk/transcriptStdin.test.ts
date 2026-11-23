/**
 * The SHIPPED binary, `talk transcript --entries-file -`, exactly as the console's route runs it: the batch piped on
 * stdin, never staged in a file, and every secret in it masked before the call file is written — the seam the unit
 * lane cannot reach, since the verb reads the real process stdin. The same batch piped twice, as a page retrying a
 * post that got no answer does, leaves one line per write id.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const CALL = "a0000041-0000-4000-8000-000000000044";

/** A GitHub token shape, built at run time so this file never carries one. */
const TOKEN = "ghp_" + "Z".repeat(30);

const BATCH = [
  {
    atIso: "2026-11-03T01:00:00.000Z",
    kind: "open",
    model: "m",
    sessionId: "s",
    voice: "v",
    writeId: "a0000080-0000-4000-8000-000000000087",
  },
  {
    answer: `the thread said: token ${TOKEN} for AcmeSecretWord`,
    atIso: "2026-11-03T01:00:01.000Z",
    detail: "read a thread",
    kind: "tool",
    name: "read_slack_thread",
    refused: false,
    writeId: "2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  },
]
  .map((line) => `${JSON.stringify(line)}\n`)
  .join("");

let scratch: string;
let home: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "slop-transcript-stdin-"));
  home = join(scratch, "home");
  mkdirSync(home);
  writeFileSync(join(home, "hygiene-denylist.txt"), "acmesecretword\n");
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/**
 * Pipe the batch into the real verb once.
 *
 * @returns its exit status, spawn error and stdout
 */
const pipeBatch = (): { status: number | null; error: Error | undefined; stdout: string } => {
  const ran = spawnSync(BIN, ["talk", "transcript", "--call", CALL, "--entries-file", "-", "--home", home, "--json"], {
    cwd: scratch,
    encoding: "utf8",
    env: { HOME: scratch, PATH: process.env["PATH"]! },
    input: BATCH,
  });
  return { error: ran.error, status: ran.status, stdout: ran.stdout };
};

describe("bin/slopweaver talk transcript --entries-file -", () => {
  it("appends a piped batch with every secret masked, and a second pipe of it appends nothing more", () => {
    expect(BATCH).toContain(TOKEN);
    const first = pipeBatch();
    expect([first.status, first.error]).toEqual([0, undefined]);
    expect(JSON.parse(first.stdout.trim())).toEqual({
      appended: 2,
      landed: 0,
      landingFailed: [],
      ok: true,
      redactions: [
        { count: 1, label: "github-oauth-token" },
        { count: 1, label: "denylist" },
      ],
      toolAnswersDropped: 0,
    });
    const second = pipeBatch();
    expect([second.status, JSON.parse(second.stdout.trim()).appended]).toEqual([0, 0]);

    const file = join(home, "talk", "calls", `${CALL}.jsonl`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const stored = readFileSync(file, "utf8");
    expect(stored.trim().split("\n").length).toBe(2);
    expect([stored.includes(TOKEN), stored.toLowerCase().includes("acmesecretword")]).toEqual([false, false]);
    expect(stored).toContain('"answer":"the thread said: token [REDACTED:github-oauth-token] for [REDACTED:denylist]"');
  });
});
