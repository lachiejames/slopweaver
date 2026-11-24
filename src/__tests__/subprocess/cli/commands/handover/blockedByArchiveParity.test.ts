/**
 * `handover check` and `handover list` must agree about which `blockedBy` slugs are real.
 *
 * Measured (handover-list-omits-a-fresh-doc): `handover check`'s `blockedBy` validation asked only about
 * LIVE docs, while `handover list`'s dependency resolution (`composeBoardModels`'s `resolutionDocs`) also
 * consults `archive/` for an already-shipped prerequisite. A dependent doc naming a real, archived
 * prerequisite therefore showed as `RUN NOW` on the board while `check` on the exact same doc reported
 * `blockedBy names X, which no doc on the board claims` — the false-positive a typo produces, on a
 * reference that was never a typo. `knownDependencySlugs` (src/cli/commands/handover/checkRun.ts) is the
 * fix: it asks `archivedDependencies` the same question the board asks, so the two verbs answer alike.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { absentAsNumber } from "#lib/absent.js";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A handovers dir holding one archived `done` leaf and one live doc `blockedBy` the leaf's slug. */
function boardWithArchivedDependency(): { handoverDir: string; dependentDoc: string } {
  const handoverDir = mkdtempSync(join(tmpdir(), "handover-blockedby-archive-"));
  fixtureDirs.push(handoverDir);
  mkdirSync(join(handoverDir, "archive"));
  writeFileSync(
    join(handoverDir, "archive", "leaf-doc.md"),
    "---\nslug: leaf-doc\nstatus: done\nstatusSummary: done leaf\nblockedBy: []\n" +
      "artifact: https://example.invalid/leaf\ndoneWhen: []\n---\n\nleaf\n",
    "utf8",
  );
  const dependentDoc = join(handoverDir, "dependent-doc.md");
  writeFileSync(
    dependentDoc,
    "---\nslug: dependent-doc\nstatus: ready\nstatusSummary: waits on leaf\nblockedBy: [leaf-doc]\n" +
      "artifact: https://example.invalid/dependent\ndoneWhen: []\n---\n\ndependent\n",
    "utf8",
  );
  return { dependentDoc, handoverDir };
}

function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: { ...accountSandboxChildEnv(), HOME: process.env["HOME"]!, PATH: process.env["PATH"]! },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("handover check / handover list agree on an archived blockedBy dependency", () => {
  it("list resolves the archived leaf and shows the dependent as runnable", () => {
    const { handoverDir } = boardWithArchivedDependency();
    const result = run({ args: ["handover", "list", "--all", "--dir", handoverDir] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dependent-doc");
    expect(result.stdout).not.toContain("no doc on the board claims");
  });

  it("check resolves the SAME archived leaf, rather than reporting it as an unknown slug", () => {
    const { dependentDoc, handoverDir } = boardWithArchivedDependency();
    const result = run({ args: ["handover", "check", "--doc", dependentDoc, "--dir", handoverDir, "--repo", "/tmp"] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dependent-doc is sound");
    expect(result.stderr).not.toContain("no doc on the board claims");
  });
});
