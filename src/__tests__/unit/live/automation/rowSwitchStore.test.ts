/**
 * The effectful half of `automation enable`/`disable` (`live/automation/rowSwitchStore.ts`) over a throwaway home: a
 * definition read as both its raw object and its parsed row, `enabled` written onto that raw object with every other
 * key carried, and the switch journal appended one line at a time.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import {
  appendAutomationSwitch,
  readDefinitionForSwitch,
  writeDefinitionEnabled,
} from "../../../../live/automation/rowSwitchStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const ROW = "publication-audit-daily";

/** A definition file's object, carrying one key this build does not know. */
const RAW = {
  cadence: "45 5 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: false,
  kind: "verb-run",
  laterBuildKey: "kept",
  onMissed: "skip",
  params: { argv: ["publication", "audit"] },
  recipeId: ROW,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

const ENTRY = {
  anchor: "talk-call:acme#typed-owner-1",
  enabled: true,
  recipeId: ROW,
  switchedAtIso: "2026-11-21T10:30:00.000Z",
  why: "asked for the daily audit",
  words: "turn the publication audit on",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "switch-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write one definition file under the test home and answer its path. */
function definitionFile({ text }: { text: string }): string {
  const path = join(home, `${ROW}.json`);
  writeFileSync(path, text);
  return path;
}

describe("readDefinitionForSwitch", () => {
  it("answers the raw object, unknown key and all, and the row it parses to", () => {
    const path = definitionFile({ text: JSON.stringify(RAW) });

    const read = unwrap(readDefinitionForSwitch({ path, recipeId: ROW }));

    expect(read.raw).toEqual(RAW);
    expect([read.definition.recipeId, read.definition.enabled, read.definition.cadence]).toEqual([
      ROW,
      false,
      "45 5 * * *",
    ]);
  });

  it("refuses a file that is not JSON, not an object, or another recipe's row", () => {
    const notJson = readDefinitionForSwitch({ path: definitionFile({ text: "{" }), recipeId: ROW });
    const notObject = readDefinitionForSwitch({ path: definitionFile({ text: "[1]" }), recipeId: ROW });
    const other = readDefinitionForSwitch({
      path: definitionFile({ text: JSON.stringify({ ...RAW, recipeId: "worktree-prune" }) }),
      recipeId: ROW,
    });

    expect(notJson._unsafeUnwrapErr().code).toBe("SWITCH_DEFINITION_NOT_WRITTEN");
    expect(notJson._unsafeUnwrapErr().message).toContain("the file did not read as JSON");
    expect(notObject._unsafeUnwrapErr().detail).toBe("the file is not a JSON object");
    expect(other._unsafeUnwrapErr().detail).toBe(`the file carries recipe 'worktree-prune', not '${ROW}'`);
  });
});

describe("writeDefinitionEnabled", () => {
  it("writes only `enabled`, carrying every other key as it parsed", () => {
    const path = definitionFile({ text: JSON.stringify(RAW) });

    unwrap(writeDefinitionEnabled({ enabled: true, path, raw: RAW }));

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ...RAW, enabled: true });
    expect(readFileSync(path, "utf8").endsWith("}\n")).toBe(true);
  });

  it("refuses a value JSON cannot write back as it parsed, leaving the file byte for byte", () => {
    const text = JSON.stringify(RAW).replace('"laterBuildKey":"kept"', '"negativeZero":-0,"pastDouble":1e400');
    const path = definitionFile({ text });
    const read = unwrap(readDefinitionForSwitch({ path, recipeId: ROW }));

    const written = writeDefinitionEnabled({ enabled: true, path, raw: read.raw });

    expect(Object.is(read.raw["negativeZero"], -0)).toBe(true);
    expect(read.raw["pastDouble"]).toBe(Number.POSITIVE_INFINITY);
    expect(written._unsafeUnwrapErr().code).toBe("SWITCH_DEFINITION_NOT_WRITTEN");
    expect(written._unsafeUnwrapErr().detail).toBe(
      "a value in the file would not survive being written back (`-0`, or a number past double range)",
    );
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  it("refuses a path that cannot be written, naming it", () => {
    const path = join(definitionFile({ text: "{}" }), "nested.json");

    const written = writeDefinitionEnabled({ enabled: true, path, raw: RAW });

    expect(written._unsafeUnwrapErr().code).toBe("SWITCH_DEFINITION_NOT_WRITTEN");
    expect(written._unsafeUnwrapErr().path).toBe(path);
  });
});

describe("appendAutomationSwitch", () => {
  it("creates the journal and appends one line per switch, in order", () => {
    unwrap(appendAutomationSwitch({ entry: ENTRY, home }));
    unwrap(appendAutomationSwitch({ entry: { ...ENTRY, enabled: false }, home }));

    const lines = readFileSync(stateHomePaths({ home }).live.recipe.switchesJsonl, "utf8").split("\n");

    expect(lines.length).toBe(3);
    expect(lines[2]).toBe("");
    expect([JSON.parse(lines[0]!), JSON.parse(lines[1]!)]).toEqual([ENTRY, { ...ENTRY, enabled: false }]);
  });

  it("refuses a journal path it cannot append to", () => {
    const path = stateHomePaths({ home }).live.recipe.switchesJsonl;
    mkdirSync(path, { recursive: true });

    const appended = appendAutomationSwitch({ entry: ENTRY, home });

    expect(appended._unsafeUnwrapErr().code).toBe("SWITCH_JOURNAL_UNWRITABLE");
    expect(appended._unsafeUnwrapErr().path).toBe(path);
  });
});
