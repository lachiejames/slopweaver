/*
 * The profile verbs' shared shell: a payload file is read into a value or refused with the reason, and a
 * refusal always answers the usage exit code, so a bad invocation reads as the caller's to fix.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readJsonFile, refuse } from "../../../../../cli/commands/profile/verbShell.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slopweaver-profile-shell-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readJsonFile", () => {
  it("parses a real JSON object into its value", () => {
    const path = join(dir, "owner.json");
    writeFileSync(path, JSON.stringify({ displayName: "Acme Owner", revision: 2 }));
    expect(readJsonFile({ path })).toEqual({ value: { displayName: "Acme Owner", revision: 2 } });
  });

  it("refuses a file that is not there, naming the path", () => {
    const path = join(dir, "absent.json");
    expect(readJsonFile({ path })).toEqual({ errors: [expect.stringContaining(`could not read ${path}: `)] });
  });

  it("refuses a file that is not JSON, naming the path", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ not json");
    expect(readJsonFile({ path })).toEqual({ errors: [expect.stringContaining(`${path} is not readable JSON: `)] });
  });
});

describe("refuse", () => {
  it("answers the usage exit code", () => {
    expect(refuse({ lines: ["--file needs a value"], usage: "usage: slopweaver profile set" })).toBe(EXIT_USAGE);
  });

  it("answers the usage exit code with no refusal lines at all", () => {
    expect(refuse({ lines: [], usage: "usage: slopweaver profile set" })).toBe(EXIT_USAGE);
  });
});
