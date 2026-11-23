/**
 * The retirement registry over a throwaway home: absence retires nothing, a round trip reads back exactly what was
 * written, and every way the file can be broken is a typed error rather than "nothing retired".
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  type AutomationRetirement,
  addAutomationRetirement,
  readAutomationRetirements,
  removeAutomationRetirement,
  retiredRecipeIds,
  writeAutomationRetirements,
} from "../../../../live/automation/retirementStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "retirements-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One retirement, overridable field by field. */
function entry(over: Partial<AutomationRetirement> = {}): AutomationRetirement {
  return {
    anchor: "talk:acme-turn",
    recipeId: "inbox-triage-daily",
    retiredAtIso: "2026-11-03T08:00:00.000Z",
    why: "reads a mailbox this install no longer serves",
    words: "turn them off",
    ...over,
  };
}

/** The registry's path under the test home, its directory made. */
function registryPath(): string {
  const path = stateHomePaths({ home }).live.recipe.retirementsJson;
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

describe("readAutomationRetirements", () => {
  it("reads a home with no file as absent, retiring nothing", () => {
    expect(unwrap(readAutomationRetirements({ home }))).toEqual({ kind: "absent", retirements: [] });
  });

  it("reads back exactly what was written", () => {
    const written = [entry(), entry({ recipeId: "thread-chase-daily" })];
    unwrap(writeAutomationRetirements({ home, retirements: written }));
    expect(unwrap(readAutomationRetirements({ home }))).toEqual({ kind: "present", retirements: written });
  });

  it("refuses a body that is not JSON", () => {
    writeFileSync(registryPath(), "{not json", "utf8");
    expect(readAutomationRetirements({ home })._unsafeUnwrapErr().code).toBe("RETIREMENTS_MALFORMED");
  });

  it("refuses bytes that are not UTF-8 rather than reading them lossily", () => {
    writeFileSync(registryPath(), Buffer.from([0x7b, 0xff, 0x7d]));
    expect(readAutomationRetirements({ home })._unsafeUnwrapErr().code).toBe("RETIREMENTS_MALFORMED");
  });

  it("refuses a recipe retired twice", () => {
    const body = { retirements: [entry(), entry()], schemaVersion: 1 };
    writeFileSync(registryPath(), JSON.stringify(body), "utf8");
    const error = readAutomationRetirements({ home })._unsafeUnwrapErr();
    expect(error.code).toBe("RETIREMENTS_MALFORMED");
    expect(error.message).toContain("inbox-triage-daily is retired twice");
  });

  it("refuses an entry with a blank why", () => {
    const body = { retirements: [entry({ why: "  " })], schemaVersion: 1 };
    writeFileSync(registryPath(), JSON.stringify(body), "utf8");
    expect(readAutomationRetirements({ home })._unsafeUnwrapErr().message).toContain(
      "retirements.0.why: must carry a non-whitespace character",
    );
  });

  it("refuses an unknown key, since the schema is strict", () => {
    const body = { extra: true, retirements: [], schemaVersion: 1 };
    writeFileSync(registryPath(), JSON.stringify(body), "utf8");
    expect(readAutomationRetirements({ home })._unsafeUnwrapErr().code).toBe("RETIREMENTS_MALFORMED");
  });

  it("refuses a directory where the file should be", () => {
    mkdirSync(registryPath());
    expect(readAutomationRetirements({ home })._unsafeUnwrapErr().code).toBe("RETIREMENTS_UNREADABLE");
  });

  it("refuses a dangling symlink rather than reading it as absent", () => {
    symlinkSync(join(home, "nowhere.json"), registryPath());
    expect(readAutomationRetirements({ home })._unsafeUnwrapErr().code).toBe("RETIREMENTS_UNREADABLE");
  });
});

describe("addAutomationRetirement", () => {
  it("adds an entry, sorted by recipe id", () => {
    const added = addAutomationRetirement({
      current: [entry({ recipeId: "thread-chase-daily" })],
      retirement: entry(),
    });
    expect(added.added).toBe(true);
    expect(added.retirements.map((r) => r.recipeId)).toEqual(["inbox-triage-daily", "thread-chase-daily"]);
  });

  it("keeps the first entry when the recipe is already retired", () => {
    const first = entry();
    const added = addAutomationRetirement({ current: [first], retirement: entry({ why: "a second reason" }) });
    expect(added).toEqual({ added: false, retirements: [first] });
  });
});

describe("removeAutomationRetirement", () => {
  it("removes the named entry and answers it", () => {
    const kept = entry({ recipeId: "thread-chase-daily" });
    const removed = removeAutomationRetirement({ current: [entry(), kept], recipeId: "inbox-triage-daily" });
    expect(removed).toEqual({ removed: entry(), retirements: [kept] });
  });

  it("answers null for a recipe not retired", () => {
    const removed = removeAutomationRetirement({ current: [entry()], recipeId: "worktree-prune" });
    expect(removed).toEqual({ removed: null, retirements: [entry()] });
  });
});

describe("retiredRecipeIds", () => {
  it("is every retired id", () => {
    const ids = retiredRecipeIds({ retirements: [entry(), entry({ recipeId: "thread-chase-daily" })] });
    expect([...ids]).toEqual(["inbox-triage-daily", "thread-chase-daily"]);
  });
});
