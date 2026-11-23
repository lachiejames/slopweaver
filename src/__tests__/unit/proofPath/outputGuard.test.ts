/**
 * The proof-output guard: the pure decision over literal locations, then the effectful inspection over real
 * throwaway git work trees, where symlinks and not-yet-created parents are only provable on disk.
 *
 * deleted-with-code: repositoryIsSlopweaver
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { repoRootOf } from "../../../lib/gitRepo.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type ProofOutputLocation, proofOutputRefusal } from "../../../proofPath/outputGuard.js";
import { inspectProofOutputLocation, refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { gitInTemp } from "../../tempGitRepo.js";

const OUTSIDE: ProofOutputLocation = {
  absolutePath: "/scratch/shot.png",
  containingGitRoot: undefined,
  stateHomeRoot: "/home/.slopweaver",
};

describe("proofOutputRefusal", () => {
  it("allows a path outside every work tree", () => {
    expect(proofOutputRefusal({ location: OUTSIDE })).toBe(undefined);
  });

  it("refuses a path inside a checkout, naming both", () => {
    const location = { ...OUTSIDE, absolutePath: "/repo/packages/x/proof/a.gif", containingGitRoot: "/repo" };
    expect(proofOutputRefusal({ location })).toBe(
      "/repo/packages/x/proof/a.gif is inside the git checkout /repo, where a commit can carry it into a pull request",
    );
  });

  it("refuses a checkout path whatever the file is called", () => {
    const location = { ...OUTSIDE, absolutePath: "/repo/out.txt", containingGitRoot: "/repo" };
    expect(proofOutputRefusal({ location })).toContain("inside the git checkout /repo");
  });

  it("refuses a site captures folder like any other path in the checkout", () => {
    const location = { ...OUTSIDE, absolutePath: "/sw/site/public/captures/card-fold.png", containingGitRoot: "/sw" };
    expect(proofOutputRefusal({ location })).toBe(
      "/sw/site/public/captures/card-fold.png is inside the git checkout /sw, where a commit can carry it into a pull request",
    );
  });

  it("refuses the captures path in any other repository", () => {
    const location = { ...OUTSIDE, absolutePath: "/other/site/public/captures/a.png", containingGitRoot: "/other" };
    expect(proofOutputRefusal({ location })).toBe(
      "/other/site/public/captures/a.png is inside the git checkout /other, where a commit can carry it into a pull request",
    );
  });

  it("allows the state home, which is itself a work tree", () => {
    const location = {
      ...OUTSIDE,
      absolutePath: "/home/.slopweaver/proof/x/a.gif",
      containingGitRoot: "/home/.slopweaver",
    };
    expect(proofOutputRefusal({ location })).toBe(undefined);
  });

  it("allows the state home when it sits inside a work tree", () => {
    const location = { ...OUTSIDE, absolutePath: "/home/.slopweaver/proof/a.gif", containingGitRoot: "/home" };
    expect(proofOutputRefusal({ location })).toBe(undefined);
  });

  it("refuses a checkout nested inside the state home", () => {
    const location = {
      ...OUTSIDE,
      absolutePath: "/home/.slopweaver/checkouts/r/proof/a.gif",
      containingGitRoot: "/home/.slopweaver/checkouts/r",
    };
    expect(proofOutputRefusal({ location })).toContain("inside the git checkout /home/.slopweaver/checkouts/r");
  });
});

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh canonical scratch root holding a git work tree `repo/` and a plain directory `plain/`. */
function world(): { root: string; repo: string; plain: string; home: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "proof-output-guard-")));
  fixtureDirs.push(root);
  const repo = join(root, "repo");
  const plain = join(root, "plain");
  const home = join(root, "home");
  mkdirSync(repo);
  mkdirSync(plain);
  gitInTemp({ args: ["init", "-q"], cwd: repo });
  return { home, plain, repo, root };
}

describe("inspectProofOutputLocation", () => {
  it("resolves a relative output against the invocation's cwd and finds its work tree", () => {
    const { repo, home } = world();
    const location = unwrap(inspectProofOutputLocation({ cwd: repo, home, output: "proof/not-yet/a.gif" }));
    expect(location.absolutePath).toBe(join(repo, "proof", "not-yet", "a.gif"));
    expect(location.containingGitRoot).toBe(repo);
  });

  it("sees through a symlink that leads a harmless-looking path into a checkout", () => {
    const { repo, plain, home } = world();
    symlinkSync(repo, join(plain, "link"));
    const location = unwrap(inspectProofOutputLocation({ cwd: plain, home, output: "link/shot.png" }));
    expect(location.absolutePath).toBe(join(repo, "shot.png"));
    expect(location.containingGitRoot).toBe(repo);
  });

  it("follows a symlink BEFORE a `..` after it, as the kernel will when it writes", () => {
    const { repo, plain, home } = world();
    mkdirSync(join(repo, "sub"));
    symlinkSync(join(repo, "sub"), join(plain, "link"));
    const location = unwrap(inspectProofOutputLocation({ cwd: plain, home, output: "link/../shot.png" }));
    expect(location.absolutePath).toBe(join(repo, "shot.png"));
    expect(location.containingGitRoot).toBe(repo);
  });

  it("follows a relative symlink met partway through a path that does not exist yet", () => {
    const { repo, plain, home } = world();
    symlinkSync("../repo", join(plain, "rel"));
    const location = unwrap(inspectProofOutputLocation({ cwd: plain, home, output: "rel/new/../shot.png" }));
    expect(location.absolutePath).toBe(join(repo, "shot.png"));
    expect(location.containingGitRoot).toBe(repo);
  });

  it("finds the checkout even when an ambient GIT_CEILING_DIRECTORIES would hide it", () => {
    const { repo, home } = world();
    mkdirSync(join(repo, "sub"));
    const before = process.env["GIT_CEILING_DIRECTORIES"];
    process.env["GIT_CEILING_DIRECTORIES"] = repo;
    try {
      const location = unwrap(inspectProofOutputLocation({ cwd: join(repo, "sub"), home, output: "shot.png" }));
      expect(location.containingGitRoot).toBe(repo);
    } finally {
      if (before === undefined) {
        delete process.env["GIT_CEILING_DIRECTORIES"];
      } else {
        process.env["GIT_CEILING_DIRECTORIES"] = before;
      }
    }
  });

  it("keeps a checkout named with only a space distinct from the state home it sits in", () => {
    const { home } = world();
    const nested = join(home, " ");
    mkdirSync(nested, { recursive: true });
    gitInTemp({ args: ["init", "-q"], cwd: nested });
    const location = unwrap(inspectProofOutputLocation({ cwd: home, home, output: join(nested, "out.png") }));
    expect(location.containingGitRoot).toBe(nested);
    expect(location.stateHomeRoot).toBe(home);
  });

  it("reports no work tree outside one", () => {
    const { plain, home } = world();
    const location = unwrap(inspectProofOutputLocation({ cwd: plain, home, output: "a/b/shot.png" }));
    expect(location.containingGitRoot).toBe(undefined);
  });

  it("finds the Slopweaver checkout this code runs from as the work tree of a captures path in it", () => {
    const { home } = world();
    const own = realpathSync(repoRootOf({ importMetaUrl: import.meta.url }));
    const location = unwrap(inspectProofOutputLocation({ cwd: own, home, output: "site/public/captures/a.png" }));
    expect(location.absolutePath).toBe(join(own, "site", "public", "captures", "a.png"));
    expect(location.containingGitRoot).toBe(own);
  });
});

describe("refuseProofOutputInTree", () => {
  it("refuses the captures path of the Slopweaver checkout this code runs from", () => {
    const { home } = world();
    const own = realpathSync(repoRootOf({ importMetaUrl: import.meta.url }));
    const lines = unwrapErr(
      refuseProofOutputInTree({ cwd: own, env: {}, home, output: "site/public/captures/card-fold.png" }),
    );
    expect(lines[0]).toBe(
      `${join(own, "site", "public", "captures", "card-fold.png")} is inside the git checkout ${own}, where a commit can carry it into a pull request; nothing was captured`,
    );
  });

  it("refuses the captures path in a repository that calls itself Slopweaver", () => {
    const { repo, home } = world();
    writeFileSync(join(repo, "package.json"), '{"name":"slopweaver"}');
    const lines = unwrapErr(
      refuseProofOutputInTree({ cwd: repo, env: {}, home, output: "site/public/captures/a.png" }),
    );
    expect(lines[0]).toBe(
      `${join(repo, "site", "public", "captures", "a.png")} is inside the git checkout ${repo}, where a commit can carry it into a pull request; nothing was captured`,
    );
  });

  it("refuses a checkout in the state home however the caller cases the home, wherever the volume folds case", () => {
    const { root } = world();
    const home = join(root, "ProofHome");
    const nested = join(home, "checkouts", "r");
    mkdirSync(nested, { recursive: true });
    gitInTemp({ args: ["init", "-q"], cwd: nested });
    const lower = join(root, "proofhome");
    const result = refuseProofOutputInTree({
      cwd: root,
      env: {},
      home: lower,
      output: join(lower, "checkouts", "r", "proof.png"),
    });
    // Refused exactly when the mis-cased path reaches the checkout: on a case-folding volume it does, and on a
    // case-sensitive one it names a directory that does not exist, so nothing lands in the checkout either way.
    expect(result.isErr()).toBe(existsSync(join(lower, "checkouts", "r")));
  });

  it("refuses a checkout path in the four-line shape, naming the hatch, and creates nothing", () => {
    const { repo, home } = world();
    const lines = unwrapErr(refuseProofOutputInTree({ cwd: repo, env: {}, home, output: "proof/a.gif" }));
    expect(lines[0]).toBe(
      `${join(repo, "proof", "a.gif")} is inside the git checkout ${repo}, where a commit can carry it into a pull request; nothing was captured`,
    );
    expect(lines.some((line) => line.includes("SLOPWEAVER_ALLOW_PROOF_OUTPUT_IN_TREE=1"))).toBe(true);
    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: repo })).toBe("");
  });

  it("allows a path outside every checkout", () => {
    const { plain, home } = world();
    const result = refuseProofOutputInTree({ cwd: plain, env: {}, home, output: "a.gif" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(undefined);
  });

  it("opens only on the named hatch", () => {
    const { repo, home } = world();
    const env = { SLOPWEAVER_ALLOW_PROOF_OUTPUT_IN_TREE: "1" };
    expect(unwrap(refuseProofOutputInTree({ cwd: repo, env, home, output: "a.gif" }))).toBe(undefined);
  });
});
