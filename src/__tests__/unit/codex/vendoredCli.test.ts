/**
 * `codex/vendoredCli.ts`: the SDK's own vendored Codex CLI resolves to a real binary on this machine, under
 * the platform package's `vendor/<triple>/bin/codex` — the path a pass's browser door and its SDK client share.
 */
import { existsSync } from "node:fs";
import { delimiter } from "node:path";

import { describe, expect, it } from "vitest";

import { vendoredCodexCli, withCodexPathDirs } from "../../../codex/vendoredCli.js";

describe("vendoredCodexCli", () => {
  it("resolves the installed platform package's binary, never a bare name for PATH to pick", () => {
    const cli = vendoredCodexCli() as { readonly path: string };

    expect(cli.path).toMatch(/\/@openai\/codex-(darwin|linux)-(arm64|x64)\/vendor\/[a-z0-9_-]+\/bin\/codex$/);
    expect(existsSync(cli.path)).toBe(true);
  });
});

// Pinning the binary makes the SDK skip its own PATH prepend, so the client restores it (Codex review r16).
describe("withCodexPathDirs", () => {
  it("puts the CLI's directories first, once each, and leaves the input untouched", () => {
    const env = { HOME: "/h", PATH: "/vendor/codex-path:/usr/bin::/bin" };

    expect(withCodexPathDirs({ env, pathDirs: ["/vendor/codex-path"], platform: "darwin" })).toEqual({
      HOME: "/h",
      PATH: "/vendor/codex-path:/usr/bin:/bin",
    });
    expect(env.PATH).toBe("/vendor/codex-path:/usr/bin::/bin");
  });

  it("changes nothing when the CLI brings no directories", () => {
    expect(withCodexPathDirs({ env: { PATH: "/usr/bin::/bin" }, pathDirs: [], platform: "darwin" })).toEqual({
      PATH: "/usr/bin::/bin",
    });
  });

  it("writes a PATH when the environment had none", () => {
    expect(withCodexPathDirs({ env: {}, pathDirs: ["/vendor/codex-path"], platform: "linux" })).toEqual({
      PATH: "/vendor/codex-path",
    });
  });

  it("on Windows keeps the one PATH key the SDK picks, Path first, and drops every other spelling", () => {
    const pathDirs = ["/vendor/codex-path"];

    expect(withCodexPathDirs({ env: { PATH: "/a", Path: "/b" }, pathDirs, platform: "win32" })).toEqual({
      Path: `/vendor/codex-path${delimiter}/b`,
    });
    expect(withCodexPathDirs({ env: { PATH: "/a", path: "/c" }, pathDirs, platform: "win32" })).toEqual({
      path: `/vendor/codex-path${delimiter}/c`,
    });
  });
});
