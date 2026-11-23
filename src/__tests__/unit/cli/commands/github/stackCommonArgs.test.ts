import { describe, expect, it } from "vitest";

import {
  parseStackCommonArgs,
  remoteFlag,
  STACK_COMMON_FLAG_NAMES,
  STACK_COMMON_FLAGS,
} from "../../../../../cli/commands/github/stackCommonArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("STACK_COMMON_FLAGS", () => {
  it("declares the dry-run switch and the cwd, remote and home value flags", () => {
    expect(STACK_COMMON_FLAGS).toEqual({ boolean: ["dry-run"], string: ["cwd", "remote", "home"] });
  });

  it("lists every flag with its dashes, value flags first", () => {
    expect(STACK_COMMON_FLAG_NAMES).toEqual(["--cwd", "--remote", "--home", "--dry-run"]);
  });
});

describe("parseStackCommonArgs", () => {
  // A home WITHOUT dry-run here, against the next case's home with it, so dry-run is never read off home.
  it("reads cwd, remote and home and leaves dry-run off", () => {
    const result = parseStackCommonArgs({
      argv: ["--cwd", "/repo-alpha", "--remote", "mirror-bravo", "--home", "/home-alpha"],
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      args: { cwd: "/repo-alpha", dryRun: false, home: "/home-alpha", remote: "mirror-bravo" },
      values: { cwd: "/repo-alpha", home: "/home-alpha", remote: "mirror-bravo" },
    });
  });

  // The only dry run with an explicit remote, so dry-run is never read off the remote falling back to origin.
  it("reads a named remote under dry-run with no cwd or home", () => {
    const result = parseStackCommonArgs({ argv: ["--dry-run", "--remote", "mirror-hotel"] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      args: { cwd: undefined, dryRun: true, home: undefined, remote: "mirror-hotel" },
      values: { "dry-run": true, remote: "mirror-hotel" },
    });
  });

  it("reads home and dry-run, defaults the remote to origin and leaves cwd absent", () => {
    const result = parseStackCommonArgs({ argv: ["--home", "/home-charlie", "--dry-run"] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      args: { cwd: undefined, dryRun: true, home: "/home-charlie", remote: "origin" },
      values: { "dry-run": true, home: "/home-charlie" },
    });
  });

  it("keeps a verb's own extra flag in the raw values without leaking it into the common args", () => {
    const result = parseStackCommonArgs({
      argv: ["--branch", "branch-delta", "--cwd", "/repo-echo", "--dry-run"],
      spec: { boolean: ["dry-run"], string: ["cwd", "remote", "home", "branch"] },
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      args: { cwd: "/repo-echo", dryRun: true, home: undefined, remote: "origin" },
      values: { branch: "branch-delta", cwd: "/repo-echo", "dry-run": true },
    });
  });

  it("parses an empty argv to every default", () => {
    const result = parseStackCommonArgs({ argv: [] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      args: { cwd: undefined, dryRun: false, home: undefined, remote: "origin" },
      values: {},
    });
  });

  it("refuses a blank remote, reporting the whitespace it was given", () => {
    const result = parseStackCommonArgs({ argv: ["--cwd", "/repo-foxtrot", "--remote", "   "] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "INVALID_FLAG_VALUE",
      flag: "--remote",
      got: "   ",
      message: "--remote must not be blank",
    });
  });

  // The opposite of the case above on every other flag, so the refusal is conjoined with none of them.
  it("refuses a blank remote with no cwd, under dry-run and a home", () => {
    const result = parseStackCommonArgs({ argv: ["--dry-run", "--home", "/home-india", "--remote", "\t"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "INVALID_FLAG_VALUE",
      flag: "--remote",
      got: "\t",
      message: "--remote must not be blank",
    });
  });

  it("refuses an unknown flag with the parser's own reason", () => {
    const result = parseStackCommonArgs({ argv: ["--cwd", "/repo-golf", "--unknown"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "FLAGS_REFUSED",
      message: "unknown flag: --unknown",
      reasons: ["unknown flag: --unknown"],
    });
  });

  it("refuses a value flag given no value", () => {
    const result = parseStackCommonArgs({ argv: ["--dry-run", "--home"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "FLAGS_REFUSED",
      message: "--home requires a value",
      reasons: ["--home requires a value"],
    });
  });
});

describe("remoteFlag", () => {
  it("is origin when --remote was not passed", () => {
    expect(remoteFlag({ values: { cwd: "/repo" } })).toBe("origin");
  });

  it("returns a blank remote as typed, for the caller's own blank-remote refusal", () => {
    expect(remoteFlag({ values: { remote: "" } })).toBe("");
  });

  it("returns a named remote", () => {
    expect(remoteFlag({ values: { remote: "mirror-bravo" } })).toBe("mirror-bravo");
  });
});
