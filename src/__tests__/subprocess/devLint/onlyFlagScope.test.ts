/**
 * `dev lint --only <gate>` spawns exactly the gates it names — proved by running the real verb, not by
 * restating the plan it composes.
 *
 * FLEET FINDING: `--only` was not read at all. The tail parser knew `--lane` and nothing else, so
 * the flag looked accepted, exited 0, and charged the caller the entire bar. Every session that budgeted a
 * targeted re-check after fixing one gate's finding paid a whole lap instead, and nothing said so.
 *
 * `planLintRun`'s unit tests pin the SELECTION, which is the pure half. What they cannot see is the half the
 * defect lived in: whether the verb's shell actually spawns what the plan resolved to. So this file runs the
 * shipped verb through a real process and reads its stdout — the same surface a session reads.
 *
 * **The witness is the per-gate header, and it is falsifiable.** `runDevLint` writes `dev lint: <name>` once
 * per gate that actually ran — since the gates became concurrent, when the gate FINISHES and its buffered
 * bytes are replayed rather than before it starts, which moves when the line appears and not whether it
 * does. So the set of those lines IS the set of gates that ran. Under the defect this file fails loudly
 * rather than subtly: the run prints every gate's header instead of one. The second case proves the witness
 * can fire at all, by asking for two gates and finding two.
 *
 * `git-in-tests` and `control-bytes` are chosen only for being the cheapest real gates in the plan; nothing
 * here depends on what either one checks.
 */
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintChecks } from "../../../devLint/devLint.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CLI = join(repoRoot, "src", "cli", "index.ts");

/** The line `runDevLint` writes as each gate's output is replayed — one per gate that actually ran. */
const HEADER = /^dev lint: ([a-z][a-z0-9-]*)$/;

/** How many gates the whole plan holds — DERIVED, so registering a gate never turns this file red. */
const TOTAL = String(lintChecks({ cwd: repoRoot }).length);

/** Run the real verb and return its stdout, plus the gates whose headers appeared in it. */
function lintRun({ args }: { args: readonly string[] }): { out: string; ran: readonly string[] } {
  const out = execFileSync(TSX, [CLI, "dev", "lint", ...args], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
  const ran: string[] = [];
  for (const line of out.split("\n")) {
    const match = HEADER.exec(line);
    if (match !== null) {
      ran.push(match[1]!);
    }
  }
  return { out, ran };
}

describe("dev lint --only", () => {
  it("spawns the one gate it names and no other", () => {
    const { out, ran } = lintRun({ args: ["--only", "git-in-tests"] });
    expect(ran).toEqual(["git-in-tests"]);
    expect(out).toContain("  ✓ git-in-tests");
    expect(out).toContain(`dev lint: --only ran 1 of ${TOTAL} gates, NOT the whole bar: git-in-tests`);
    expect(out).toContain("dev lint: PASS");
  });

  it("spawns exactly the two gates a comma-separated selection names, in plan order", () => {
    const { out, ran } = lintRun({ args: ["--only", "git-in-tests,control-bytes"] });
    expect(ran).toEqual(["control-bytes", "git-in-tests"]);
    expect(out).toContain(`dev lint: --only ran 2 of ${TOTAL} gates, NOT the whole bar: control-bytes, git-in-tests`);
  });
});
