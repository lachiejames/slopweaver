/**
 * `scripts/tsc-owner.sh`'s Go soft memory limit over REAL processes: the `GOMEMLIMIT` its command runs under — 70% of
 * the RSS ceiling by default, lowered by `--go-memory-limit-mib`, never raised past that default — set over whatever
 * the caller's environment held. Split from `tscOwner.test.ts` by subject; that file keeps the pinned launch line and
 * the 70% default.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { repoRootOf } from "#lib/gitRepo.js";

const ROOT = repoRootOf({ importMetaUrl: import.meta.url });
const OWNER = join(ROOT, "scripts", "tsc-owner.sh");

/** A command that prints the soft limit it was handed. */
const PRINT_LIMIT = ["sh", "-c", 'echo "limit=$GOMEMLIMIT" >&2'];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Run the owner over a command, the caller's own `GOMEMLIMIT` set to `off` so only the owner's value can reach it.
 *
 * @param limit the owner's `--go-memory-limit-mib` values, none to take its default
 */
function runOwner({
  ceiling,
  limit = [],
  command = PRINT_LIMIT,
}: {
  ceiling: number;
  limit?: readonly string[];
  command?: readonly string[];
}): {
  readonly status: number | null;
  readonly stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "sw-go-limit-"));
  dirs.push(dir);
  const args = [OWNER, "--timeout-seconds", "30", "--grace-seconds", "1", "--rss-ceiling-mib", String(ceiling)];
  const result = spawnSync(
    "bash",
    [...args, ...limit.flatMap((value) => ["--go-memory-limit-mib", value]), "--", ...command],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GOMEMLIMIT: "off" },
      timeout: 60_000,
    },
  );
  return { status: result.status, stderr: result.stderr };
}

/** The owner's records of one kind on stderr. */
function records({ stderr, kind }: { stderr: string; kind: "START" | "RESULT" }): readonly string[] {
  return stderr.split("\n").filter((line) => line.startsWith(`TSC_OWNER_${kind} `));
}

describe("tsc-owner's Go soft memory limit", () => {
  it("lowers the soft memory limit to --go-memory-limit-mib, still over whatever the caller's environment set", () => {
    const run = runOwner({ ceiling: 16_384, limit: ["4096"] });
    expect(run.status).toBe(0);
    expect(run.stderr.split("\n")).toContain("limit=4096MiB");
  });

  it("accepts a soft memory limit equal to 70% of the ceiling, the default it may not exceed", () => {
    const run = runOwner({ ceiling: 10_240, limit: ["7168"] });
    expect(run.status).toBe(0);
    expect(run.stderr.split("\n")).toContain("limit=7168MiB");
  });

  it.each([
    { ceiling: 10_240, limit: ["7169"], why: "a soft memory limit above 70% of the ceiling, which it may only lower" },
    { ceiling: 1024, limit: ["100", "200"], why: "a repeated soft memory limit" },
    { ceiling: 1024, limit: ["0"], why: "a zero soft memory limit" },
  ])("refuses $why as owner-error 125, before running anything", ({ ceiling, limit }) => {
    const run = runOwner({ ceiling, command: ["true"], limit });
    expect(run.status).toBe(125);
    expect(records({ kind: "START", stderr: run.stderr })).toEqual([]);
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]).toContain("outcome=owner-error");
  });
});
