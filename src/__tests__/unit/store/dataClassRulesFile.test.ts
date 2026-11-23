/**
 * Loading an installation's data-class rules: an absent file is the defaults alone, and a file that exists but
 * cannot be used refuses whole, never falling back to the defaults.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { loadDataClassRules } from "../../../store/dataClassRulesFile.js";

const homes: string[] = [];

/** A throwaway home, removed after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "dcr-"));
  homes.push(home);
  return home;
}

/** Write a rules file into a home's judgement folder. */
function writeRules({ home, text }: { home: string; text: string }): void {
  mkdirSync(join(home, "judgement"), { recursive: true });
  writeFileSync(join(home, "judgement", "data-class-rules.json"), text);
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("loadDataClassRules", () => {
  it("returns the defaults alone when the home has no rules file", () => {
    const result = loadDataClassRules({ home: freshHome() });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).map((rule) => rule.id)).toEqual(["default:owner-captured-speech", "default:private-lane"]);
  });

  it("puts a valid file's rules before the defaults", () => {
    const home = freshHome();
    writeRules({
      home,
      text: JSON.stringify({
        rules: [{ action: "public", id: "install:eng", match: { container: ["slack/C0FIXTURE"] } }],
        version: 1,
      }),
    });
    expect(unwrap(loadDataClassRules({ home })).map((rule) => rule.id)).toEqual([
      "install:eng",
      "default:owner-captured-speech",
      "default:private-lane",
    ]);
  });

  it("refuses a file that is not JSON rather than falling back to the defaults", () => {
    const home = freshHome();
    writeRules({ home, text: "{ not json" });
    expect(unwrapErr(loadDataClassRules({ home })).code).toBe("DATA_CLASS_RULES_NOT_JSON");
  });

  it("refuses a file that is not a valid rule set", () => {
    const home = freshHome();
    writeRules({ home, text: JSON.stringify({ rules: [], version: 9 }) });
    expect(unwrapErr(loadDataClassRules({ home })).code).toBe("DATA_CLASS_RULES_INVALID");
  });

  it("refuses a file that exists but cannot be read", () => {
    const result = loadDataClassRules({
      home: freshHome(),
      readText: () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });
    const error = unwrapErr(result);
    expect(error.code).toBe("DATA_CLASS_RULES_UNREADABLE");
    expect(error.message).toContain("EACCES: permission denied");
  });
});
