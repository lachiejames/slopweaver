/**
 * One checkout install's two effectful steps, with no `yarn` process and no ambient home: the immutable install
 * runs `yarn install --immutable` in the checkout on the git-safe environment with its fifteen-minute timeout,
 * answering undefined on success and its own failure text otherwise (the last five stderr lines, else the
 * thrown message); and unsharing exec inodes reports what it moved into the named home's exec store.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../cacheHome.js";
import { type ImmutableInstallCommand, runImmutableInstall, unshareExecInodes } from "../../../checkouts/install.js";

let dir: string;
let savedGitDir: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "checkout-install-"));
  savedGitDir = process.env["GIT_DIR"];
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
  if (savedGitDir === undefined) {
    delete process.env["GIT_DIR"];
  } else {
    process.env["GIT_DIR"] = savedGitDir;
  }
});

/** A command that throws what `execFileSync` throws on a non-zero exit: an Error carrying the captured stderr. */
function failingWith({ stderr }: { stderr: string }): ImmutableInstallCommand {
  return () => {
    throw Object.assign(new Error("Command failed: yarn install --immutable"), { status: 1, stderr });
  };
}

describe("runImmutableInstall", () => {
  it("runs yarn install --immutable in the checkout, on the git-safe env with a 15-minute timeout, and answers undefined", () => {
    process.env["GIT_DIR"] = "/elsewhere/.git";
    const calls: Parameters<ImmutableInstallCommand>[0][] = [];
    const runCommand: ImmutableInstallCommand = (input) => {
      calls.push(input);
      return "";
    };

    expect(runImmutableInstall({ cwd: dir, runCommand })).toBe(undefined);
    expect(
      calls.map(({ args, file, options }) => ({
        args,
        cwd: options.cwd,
        encoding: options.encoding,
        file,
        stdio: options.stdio,
        timeout: options.timeout,
      })),
    ).toEqual([
      { args: ["install", "--immutable"], cwd: dir, encoding: "utf8", file: "yarn", stdio: "pipe", timeout: 900000 },
    ]);
    expect(calls[0]!.options.env!["GIT_DIR"]).toBe(undefined);
  });

  it("answers stderr joined with ' · ', keeping five lines whole and dropping the first of six", () => {
    const five = ["one", "two", "three", "four", "five"].join("\n");
    const six = ["zero", "one", "two", "three", "four", "five"].join("\n");

    expect(runImmutableInstall({ cwd: dir, runCommand: failingWith({ stderr: five }) })).toBe(
      "one · two · three · four · five",
    );
    expect(runImmutableInstall({ cwd: dir, runCommand: failingWith({ stderr: six }) })).toBe(
      "one · two · three · four · five",
    );
  });

  it("answers the thrown message when the failure carried no stderr", () => {
    const runCommand: ImmutableInstallCommand = () => {
      throw new Error("spawnSync yarn ETIMEDOUT");
    };

    expect(runImmutableInstall({ cwd: dir, runCommand })).toBe("spawnSync yarn ETIMEDOUT");
  });

  // A killed install that had already written stderr read like an ordinary failure.
  it("opens with the bound when the child was killed at it, ahead of the stderr it wrote first", () => {
    const runCommand: ImmutableInstallCommand = () => {
      throw Object.assign(new Error("spawnSync yarn ETIMEDOUT"), {
        code: "ETIMEDOUT",
        signal: "SIGKILL",
        status: null,
        stderr: "ordinary-looking failure\n",
      });
    };

    expect(runImmutableInstall({ cwd: dir, runCommand })).toBe(
      "yarn install was still running after 15 minutes, so it was stopped · ordinary-looking failure",
    );
  });

  it("answers the thrown message when the captured stderr is only whitespace", () => {
    expect(runImmutableInstall({ cwd: dir, runCommand: failingWith({ stderr: "  \n " }) })).toBe(
      "Command failed: yarn install --immutable",
    );
  });
});

describe("unshareExecInodes", () => {
  it("reports nothing moved for a checkout with no native images, creating the named cache's exec store", () => {
    const root = join(dir, "checkout");
    const cacheRoot = join(dir, "cache");
    mkdirSync(join(root, "node_modules"), { recursive: true });

    expect(unshareExecInodes({ cacheRoot, root })).toBe(
      "exec inodes: 0 native binary(ies) relinked off yarn's shared store, 0 already private",
    );
    expect(existsSync(cachePaths({ root: cacheRoot }).execStore)).toBe(true);
  });
});
