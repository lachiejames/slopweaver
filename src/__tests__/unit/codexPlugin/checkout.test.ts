import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isDeclaredMain, publishableHead } from "../../../codexPlugin/checkout.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { gitInTemp } from "../../tempGitRepo.js";

let root: string;
let checkout: string;
let head: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-plugin-checkout-"));
  checkout = join(root, "checkout");
  mkdirSync(checkout);
  writeFileSync(join(checkout, "README.md"), "tracked\n");
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: checkout });
  gitInTemp({ args: ["add", "-A"], cwd: checkout });
  gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"], cwd: checkout });
  head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: checkout });
  gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", head], cwd: checkout });
  gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], cwd: checkout });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("publishableHead", () => {
  it("answers HEAD for a checkout on origin's default branch", () => {
    expect(unwrap(publishableHead({ checkout }))).toEqual({ head });
  });

  it("skips a checkout on another branch, naming both", () => {
    gitInTemp({ args: ["checkout", "-qb", "feature"], cwd: checkout });
    expect(unwrap(publishableHead({ checkout }))).toEqual({
      skip: `${checkout} is on feature, not main, and only the default branch publishes`,
    });
  });

  it("fails as an export failure when the directory is not a git repository", () => {
    const bare = join(root, "not-a-repo");
    mkdirSync(bare);
    const error = unwrapErr(publishableHead({ checkout: bare }));
    expect(error.code).toBe("EXPORT_FAILED");
    expect(error.message).toContain("not a git repository");
  });
});

describe("isDeclaredMain", () => {
  it("matches a declared path reached through a symlink", () => {
    const link = join(root, "link");
    symlinkSync(checkout, link);
    expect(isDeclaredMain({ checkout, mainCheckouts: [link] })).toBe(true);
  });

  it("ignores a declared path that no longer exists", () => {
    expect(isDeclaredMain({ checkout, mainCheckouts: [join(root, "gone")] })).toBe(false);
  });
});
