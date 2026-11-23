/**
 * The pure rules of `automation enable`/`disable` (`live/automation/rowSwitch.ts`): which file a switch writes, what
 * it changes, and that the owner's words are checked byte for byte.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import { planSwitch, switchFromWords, switchTarget } from "../../../../live/automation/rowSwitch.js";

const ROW = "publication-audit-daily";

const DEFINITION: RecipeDefinition = {
  cadence: "45 5 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: false,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["publication", "audit"] },
  recipeId: ROW,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

const HOLD = {
  askedIso: "2026-11-21T05:45:00.000Z",
  clearedBy: null,
  finding: "recipe-failing-publication-audit-daily-a1",
  reason: "held by the store: a firing failed",
};

const WORDS_ARGS = {
  anchor: "talk-call:acme#typed-owner-1",
  enabled: true,
  recipeId: ROW,
  recordText: "Yes, turn the publication audit on.",
  switchedAtIso: "2026-11-21T10:30:00.000Z",
  why: "asked for the daily audit",
  words: "turn the publication audit on",
};

/** A target read with nothing retired or refused, the row's files as given. */
function target({ files, ids }: { files: readonly string[]; ids: readonly string[] }): ReturnType<typeof switchTarget> {
  return switchTarget({ definitionFiles: files, definitionIds: ids, recipeId: ROW, rejected: [], retired: false });
}

describe("switchTarget", () => {
  it("names the canonical file when the row stands only there", () => {
    expect(unwrap(target({ files: [`${ROW}.json`, "other.json"], ids: [ROW, "other"] }))).toBe(`${ROW}.json`);
  });

  it("refuses an absent row, a copy in another file, and a retired row", () => {
    expect(target({ files: ["other.json"], ids: ["other"] })._unsafeUnwrapErr().code).toBe("SWITCH_DEFINITION_ABSENT");
    expect(target({ files: [`${ROW}.json`, "copy.json"], ids: [ROW, ROW] })._unsafeUnwrapErr().code).toBe(
      "SWITCH_DEFINITION_AMBIGUOUS",
    );
    expect(
      switchTarget({
        definitionFiles: [`${ROW}.json`],
        definitionIds: [ROW],
        recipeId: ROW,
        rejected: [],
        retired: true,
      })._unsafeUnwrapErr().code,
    ).toBe("SWITCH_RETIRED");
  });

  it("refuses a canonical file the store could not parse, quoting why", () => {
    const refused = switchTarget({
      definitionFiles: [],
      definitionIds: [],
      recipeId: ROW,
      rejected: [{ file: `${ROW}.json`, why: "cadence is not a cron" }],
      retired: false,
    });
    expect(refused._unsafeUnwrapErr().message).toBe(
      `${ROW}.json does not parse (cadence is not a cron), so it is not written over unread; nothing changed`,
    );
  });
});

describe("planSwitch", () => {
  it("switches each way, and reads a row already in that state as already", () => {
    expect(unwrap(planSwitch({ definition: DEFINITION, direction: "enable" }))).toEqual({
      from: false,
      kind: "switch",
      to: true,
    });
    expect(unwrap(planSwitch({ definition: { ...DEFINITION, enabled: true }, direction: "disable" }))).toEqual({
      from: true,
      kind: "switch",
      to: false,
    });
    expect(unwrap(planSwitch({ definition: DEFINITION, direction: "disable" }))).toEqual({
      enabled: false,
      kind: "already",
    });
  });

  it("refuses to enable a held row before it can read as already enabled, and disables one", () => {
    const held = { ...DEFINITION, enabled: true, hold: HOLD };
    expect(planSwitch({ definition: held, direction: "enable" })._unsafeUnwrapErr().code).toBe("SWITCH_HELD");
    expect(unwrap(planSwitch({ definition: held, direction: "disable" }))).toEqual({
      from: true,
      kind: "switch",
      to: false,
    });
  });

  it("enables a row whose hold is cleared", () => {
    const cleared = {
      ...DEFINITION,
      hold: { ...HOLD, clearedBy: { atIso: "2026-11-21T09:00:00.000Z", runSlug: "lift-the-audit-hold" } },
    };
    expect(unwrap(planSwitch({ definition: cleared, direction: "enable" })).kind).toBe("switch");
  });
});

describe("switchFromWords", () => {
  it("composes the entry when the words stand in the record", () => {
    expect(unwrap(switchFromWords(WORDS_ARGS))).toEqual({
      anchor: WORDS_ARGS.anchor,
      enabled: true,
      recipeId: ROW,
      switchedAtIso: WORDS_ARGS.switchedAtIso,
      why: WORDS_ARGS.why,
      words: WORDS_ARGS.words,
    });
  });

  it("refuses words differing only in case, and blank words or why", () => {
    expect(switchFromWords({ ...WORDS_ARGS, words: "Turn the publication audit on" })._unsafeUnwrapErr().code).toBe(
      "SWITCH_WORDS_NOT_IN_RECORD",
    );
    expect(switchFromWords({ ...WORDS_ARGS, words: "  " })._unsafeUnwrapErr().message).toBe(
      "--words is blank — a switch must carry something a reader can check",
    );
    expect(switchFromWords({ ...WORDS_ARGS, why: "\t" })._unsafeUnwrapErr().code).toBe("SWITCH_FIELD_BLANK");
  });
});
