import { describe, expect, it } from "vitest";
import { devBuildDecision, renderDevBuildOutcome } from "../../../worktree/devBuild.js";

const PATH = "/repo/.claude/worktrees.noindex/a-slug";

describe("devBuildDecision", () => {
  it("emits for the ordinary case: asked for, dependencies installed, target can emit", () => {
    expect(devBuildDecision({ deps: "installed", enabled: true, supported: true })).toEqual({ emit: true });
  });

  it("emits for a worktree that linked the shared tree, because the emit writes outside node_modules", () => {
    expect(devBuildDecision({ deps: "linked-shared", enabled: true, supported: true })).toEqual({ emit: true });
  });

  it("reads explicit intent BEFORE capability, so an opt-out is never reported as an incapable target", () => {
    expect(devBuildDecision({ deps: "skipped", enabled: false, supported: false })).toEqual({
      emit: false,
      why: "--no-dev-build",
    });
  });

  it("skips a tree whose dependencies were skipped, naming the tsx that is not there", () => {
    expect(devBuildDecision({ deps: "skipped", enabled: true, supported: true })).toEqual({
      emit: false,
      why: "--no-install, so there is no tsx here to emit with",
    });
  });

  it("skips a repository that carries no emitter, which `--repo` and a foreign spawn target both reach", () => {
    expect(devBuildDecision({ deps: "installed", enabled: true, supported: false })).toEqual({
      emit: false,
      why: "this repository has no `slopweaver dev build` to emit with",
    });
  });
});

describe("renderDevBuildOutcome", () => {
  it("says only that it emitted, when it did", () => {
    expect(renderDevBuildOutcome({ outcome: { did: "emitted" }, path: PATH })).toBe("dist-cli emitted");
  });

  it("carries the skip reason, so the line never reads as an unexplained absence", () => {
    expect(renderDevBuildOutcome({ outcome: { did: "skipped", why: "--no-dev-build" }, path: PATH })).toBe(
      "dist-cli skipped (--no-dev-build)",
    );
  });

  it("names the detail, the consequence and the repair command on a failure", () => {
    expect(
      renderDevBuildOutcome({ outcome: { detail: "esbuild: EACCES", did: "failed", left: "removed" }, path: PATH }),
    ).toBe(
      "dist-cli FAILED: esbuild: EACCES — this worktree runs from source; repair it with " +
        "`slopweaver dev build` in /repo/.claude/worktrees.noindex/a-slug",
    );
  });

  it("says the same thing about an emit that found nothing to discard", () => {
    expect(
      renderDevBuildOutcome({ outcome: { detail: "spawn ENOENT", did: "failed", left: "absent" }, path: PATH }),
    ).toBe(
      "dist-cli FAILED: spawn ENOENT — this worktree runs from source; repair it with " +
        "`slopweaver dev build` in /repo/.claude/worktrees.noindex/a-slug",
    );
  });

  it("claims neither answer when the stamp could not be read, and says that is what happened", () => {
    expect(
      renderDevBuildOutcome({
        outcome: { detail: "spawnSync tsx EACCES", did: "failed", left: "unreadable" },
        path: PATH,
      }),
    ).toBe(
      "dist-cli FAILED: spawnSync tsx EACCES — and whether " +
        "/repo/.claude/worktrees.noindex/a-slug/dist-cli is still a stamped build could not be read at all, " +
        "so it was left exactly as it stands; look at it before trusting either answer",
    );
  });

  it("never claims source-only over a build it left STANDING, and names what covers it instead", () => {
    expect(
      renderDevBuildOutcome({
        outcome: { detail: "spawnSync tsx EACCES", did: "failed", left: "guarded" },
        path: PATH,
      }),
    ).toBe(
      "dist-cli FAILED: spawnSync tsx EACCES — the /repo/.claude/worktrees.noindex/a-slug/dist-cli already " +
        "there is still stamped, so this emit left it untouched; refresh it with `slopweaver dev build`",
    );
  });

  it("never claims source-only when the unstamped build is STILL there, and names the hand fix", () => {
    expect(
      renderDevBuildOutcome({ outcome: { detail: "esbuild: EACCES", did: "failed", left: "kept" }, path: PATH }),
    ).toBe(
      "dist-cli FAILED: esbuild: EACCES — and its unstamped dist-cli could NOT be removed, so " +
        "/repo/.claude/worktrees.noindex/a-slug/dist-cli still holds JavaScript nothing guards; " +
        "delete it by hand, then `slopweaver dev build`",
    );
  });
});
