/**
 * {@link buildSpawnPlan} over a real throwaway git repository — the resolved launch template reaches the plan
 * the boot line reads, beside the doc's model pin.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildSpawnPlan } from "../../../../../cli/commands/cmux/spawnPlanBuild.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh git repository with one commit, so `git worktree list` has a main checkout to report. */
function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "spawn-plan-"));
  dirs.push(dir);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: dir });
  gitInTemp({
    args: ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"],
    cwd: dir,
  });
  return dir;
}

const DOC_TEXT = "---\nslug: a-doc\nstatus: ready\n---\n\n# A doc\n";

describe("buildSpawnPlan", () => {
  it("carries the resolved launch template and the --model pin onto the plan", async () => {
    const repoRoot = gitRepo();
    const doc = parseHandoverDoc({ path: join(repoRoot, "a-doc.md"), text: DOC_TEXT });

    const plan = unwrap(
      await buildSpawnPlan({
        codexSeat: undefined,
        doc,
        namedStore: undefined,
        parsed: { positionals: ["a-doc"], values: { model: "sonnet" } },
        pins: { driver: "claude" },
        port: memoryPlanRegisterPort(),
        preflight: { repo: repoRoot, runEvents: [] },
        template: "research",
      }),
    );

    expect(plan.template).toBe("research");
    expect(plan.model).toBe("sonnet");
    expect(plan.slug).toBe("a-doc");
  });

  it("boots a --plan-named seat against that plan's store, so the gate judges it rather than routing it", async () => {
    const repoRoot = gitRepo();
    const doc = parseHandoverDoc({ path: join(repoRoot, "a-doc.md"), text: DOC_TEXT });

    // The outage port is never read: a named plan outranks the role's pin, so the register is not asked.
    const plan = unwrap(
      await buildSpawnPlan({
        codexSeat: undefined,
        doc,
        namedStore: "/stores/plan-three",
        parsed: { positionals: ["a-doc"], values: { model: "opus", plan: "plan-three" } },
        pins: { driver: "claude" },
        port: unavailablePlanRegisterPort(),
        preflight: { repo: repoRoot, runEvents: [] },
        template: "research",
      }),
    );

    expect(plan.credentialStoreDir).toBe("/stores/plan-three");
  });

  it("builds NO plan when the role's pin cannot be read, so nothing is launched", async () => {
    const repoRoot = gitRepo();
    const doc = parseHandoverDoc({ path: join(repoRoot, "a-doc.md"), text: DOC_TEXT });

    const error = unwrapErr(
      await buildSpawnPlan({
        codexSeat: undefined,
        doc,
        namedStore: undefined,
        parsed: { positionals: ["a-doc"], values: { model: "sonnet" } },
        pins: { driver: "claude" },
        port: unavailablePlanRegisterPort(),
        preflight: { repo: repoRoot, runEvents: [] },
        template: "research",
      }),
    );

    expect(error.code).toBe("ACCOUNT_CONFIG_STORE_UNAVAILABLE");
    expect(error.message).toContain("ECONNREFUSED");
  });
});
