/**
 * {@link evaluateMainCheckoutEditGuard}. `checkMainWorktree` is a real filesystem round-trip against a real
 * repo + a real linked worktree for the resolution cases; the block/allow/override decision is exercised
 * with an injected checker, matching `mainCheckoutBranchGuard.test.ts`'s own split.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MAIN_CHECKOUT_WRITE_OVERRIDE_ENV } from "../../../admit/mainCheckoutDirtyGuard.js";
import { evaluateMainCheckoutEditGuard } from "../../../admit/mainCheckoutEditGuard.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real repo (its own `.git` directory) plus one real linked worktree, in a fresh temp dir. */
function realRepoWithWorktree(): { main: string; linked: string } {
  const main = mkdtempSync(join(tmpdir(), "slopweaver-edit-guard-main-"));
  fixtureDirs.push(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  writeFileSync(join(main, "package.json"), '{"name":"slopweaver"}\n');
  gitInTemp({ args: ["add", "package.json"], cwd: main });
  gitInTemp({ args: ["commit", "-q", "-m", "root"], cwd: main });
  const linkedRoot = mkdtempSync(join(tmpdir(), "slopweaver-edit-guard-linked-"));
  fixtureDirs.push(linkedRoot);
  const linked = join(linkedRoot, "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "feature", linked], cwd: main });
  return { linked, main };
}

describe("evaluateMainCheckoutEditGuard", () => {
  const checkMainWorktree = (): boolean => true;

  it("blocks editing a file in the main checkout", () => {
    const decision = evaluateMainCheckoutEditGuard({
      allowOverride: false,
      checkMainWorktree,
      cwd: "/anywhere",
      filePath: "src/index.ts",
    });
    if (!decision.block) {
      throw new Error("expected blocked");
    }
    expect(decision.message).toContain(MAIN_CHECKOUT_WRITE_OVERRIDE_ENV);
  });

  it("allows editing the same file when it is not the main worktree", () => {
    expect(
      evaluateMainCheckoutEditGuard({
        allowOverride: false,
        checkMainWorktree: () => false,
        cwd: "/anywhere",
        filePath: "src/index.ts",
      }),
    ).toEqual({ block: false });
  });

  it("allows under the override", () => {
    expect(
      evaluateMainCheckoutEditGuard({
        allowOverride: true,
        checkMainWorktree,
        cwd: "/anywhere",
        filePath: "src/index.ts",
      }),
    ).toEqual({ block: false });
  });

  it("blocks a real edit target resolved inside a real main checkout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { main } = realRepoWithWorktree();
    expect(evaluateMainCheckoutEditGuard({ allowOverride: false, cwd: main, filePath: "index.ts" }).block).toBe(true);
  });

  it("allows a real edit target resolved inside a real linked worktree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { linked } = realRepoWithWorktree();
    expect(evaluateMainCheckoutEditGuard({ allowOverride: false, cwd: linked, filePath: "index.ts" })).toEqual({
      block: false,
    });
  });

  it(
    "allows an absolute edit target in a separate repository's main checkout",
    {
      timeout: REAL_GIT_TIMEOUT_MS,
    },
    () => {
      const sessionRepository = realRepoWithWorktree();
      const targetRepository = realRepoWithWorktree();
      expect(
        evaluateMainCheckoutEditGuard({
          allowOverride: false,
          cwd: sessionRepository.main,
          filePath: join(targetRepository.main, "index.ts"),
        }),
      ).toEqual({ block: false });
    },
  );

  it(
    "blocks an absolute edit target in the same repository's main checkout from its linked worktree",
    {
      timeout: REAL_GIT_TIMEOUT_MS,
    },
    () => {
      const repository = realRepoWithWorktree();
      expect(
        evaluateMainCheckoutEditGuard({
          allowOverride: false,
          cwd: repository.linked,
          filePath: join(repository.main, "index.ts"),
        }).block,
      ).toBe(true);
    },
  );

  it("allows an absolute file path resolved outside any git repository", () => {
    expect(
      evaluateMainCheckoutEditGuard({ allowOverride: false, cwd: "/anywhere", filePath: "/not/a/repo/file.ts" }),
    ).toEqual({ block: false });
  });

  it(
    "blocks a target whose own directory does not exist yet in the main checkout",
    {
      timeout: REAL_GIT_TIMEOUT_MS,
    },
    () => {
      const { main } = realRepoWithWorktree();
      expect(
        evaluateMainCheckoutEditGuard({ allowOverride: false, cwd: main, filePath: "src/brand-new/index.ts" }).block,
      ).toBe(true);
    },
  );
});
