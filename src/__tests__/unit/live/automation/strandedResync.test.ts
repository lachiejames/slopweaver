import { describe, expect, it } from "vitest";

import type { RecipeDefinition } from "../../../../live/automation/definition.js";
import {
  isStrandedResyncRow,
  strandedResyncIds,
  strandedResyncLine,
} from "../../../../live/automation/strandedResync.js";

const row = (over: Partial<RecipeDefinition> = {}): RecipeDefinition => ({
  cadence: "0 */4 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "resync",
  onMissed: "backfill",
  params: { argv: ["recipe", "resync", "--atlas", "jumpcloud"] },
  recipeId: "resync-atlas-jumpcloud",
  schemaVersion: 1,
  ...over,
});

/** The ids a build writes for the tick — one compile-only atlas, as the roster derives it. */
const TICK = ["resync-atlas-airtable"] as const;

const airtable = (over: Partial<RecipeDefinition> = {}): RecipeDefinition =>
  row({ params: { argv: ["recipe", "resync", "--atlas", "airtable"] }, recipeId: "resync-atlas-airtable", ...over });

describe("isStrandedResyncRow", () => {
  it("answers false for a resync row on the seated kind, which a seat can reach", () => {
    expect(isStrandedResyncRow({ definition: row(), tickResyncIds: TICK })).toBe(false);
  });

  // The question is "can a seat reach it", so a second seated kind is reachable too — asking for RESYNC_KIND by name
  // would have called this row stranded the day bump-fix joined the seated set.
  it("answers false for a resync argv on any seated kind, bump-fix included", () => {
    expect(isStrandedResyncRow({ definition: row({ kind: "bump-fix" }), tickResyncIds: TICK })).toBe(false);
  });

  // The repaired-on-verb-run state: the argv still names the resync, the kind no longer lets a seat take it, and this
  // build SEATS that target.
  it("answers true for a seated target's resync row a repair left on verb-run", () => {
    expect(isStrandedResyncRow({ definition: row({ kind: "verb-run" }), tickResyncIds: TICK })).toBe(true);
  });

  // A compile-only atlas is written on verb-run on purpose, and the chair runs it in its tick.
  it("answers false for a compile-only atlas on verb-run, which the tick runs", () => {
    expect(isStrandedResyncRow({ definition: airtable({ kind: "verb-run" }), tickResyncIds: TICK })).toBe(false);
  });

  // The same row on the seated kind is reachable too: a seat runs it, it just costs a seat.
  it("answers false for a compile-only atlas still on the seated kind", () => {
    expect(isStrandedResyncRow({ definition: airtable(), tickResyncIds: TICK })).toBe(false);
  });

  // With no tick set supplied, that criterion holds unchanged — nothing is exempted by omission.
  it("answers true for a verb-run resync the build does not name for the tick", () => {
    expect(isStrandedResyncRow({ definition: airtable({ kind: "verb-run" }), tickResyncIds: [] })).toBe(true);
  });

  it("answers true for a corpus resync as well as an atlas one", () => {
    const corpus = row({
      kind: "verb-run",
      params: { argv: ["recipe", "resync", "--source", "slack"] },
      recipeId: "resync-corpus-slack",
    });
    expect(isStrandedResyncRow({ definition: corpus, tickResyncIds: TICK })).toBe(true);
  });

  // The persisted argv says `recipe`; a hand-written row may say the noun's current name, and both run the verb.
  it("answers true for a stranded row whose argv spells the noun `automation`", () => {
    const current = row({ kind: "verb-run", params: { argv: ["automation", "resync", "--atlas", "jumpcloud"] } });
    expect(isStrandedResyncRow({ definition: current, tickResyncIds: TICK })).toBe(true);
  });

  it("answers false for a tick row whose argv spells the noun `automation`", () => {
    const current = airtable({ kind: "verb-run", params: { argv: ["automation", "resync", "--atlas", "airtable"] } });
    expect(isStrandedResyncRow({ definition: current, tickResyncIds: TICK })).toBe(false);
  });

  it("answers false for a verb-run row that runs some other verb", () => {
    const prune = row({
      kind: "verb-run",
      params: { argv: ["worktree", "prune"] },
      recipeId: "worktree-prune",
    });
    expect(isStrandedResyncRow({ definition: prune, tickResyncIds: TICK })).toBe(false);
  });

  it("answers false for a row whose argv only starts to look like one", () => {
    const other = row({ kind: "verb-run", params: { argv: ["recipe", "due"] }, recipeId: "recipe-due" });
    expect(isStrandedResyncRow({ definition: other, tickResyncIds: TICK })).toBe(false);
  });

  // The planner already reports an unparseable row with the field and the reason; a second verdict here
  // would have two lines of one report disagree about the same row.
  it("answers false for a row whose params refuse to parse, leaving that to the planner", () => {
    expect(isStrandedResyncRow({ definition: row({ kind: "verb-run", params: {} }), tickResyncIds: TICK })).toBe(false);
  });

  // A hand-edited kind is stranded on the same criterion and deliberately not a special case: the row still
  // runs a resync and still cannot be seated. `register-resyncs` then REPORTS it as a conflict rather than
  // rewriting somebody's edit, which is the right next step for a reader and not a contradiction of the line.
  it("answers true for a hand-edited kind, which is unreachable for the same reason", () => {
    expect(isStrandedResyncRow({ definition: row({ kind: "investigate" }), tickResyncIds: TICK })).toBe(true);
  });

  // Only the kind the registrar writes for the tick is exempt, so a tick id hand-edited onto `investigate` is not.
  it("answers true for a tick-run id hand-edited onto another run-here kind", () => {
    expect(isStrandedResyncRow({ definition: airtable({ kind: "investigate" }), tickResyncIds: TICK })).toBe(true);
  });

  // The exemption keyed on the id alone, so airtable's row edited to run clerk
  // would carry clerk's browser walk into the tick under airtable's name and never print.
  it("answers true for a tick id whose argv was hand-edited to run a SEATED atlas", () => {
    const edited = airtable({ kind: "verb-run", params: { argv: ["recipe", "resync", "--atlas", "clerk"] } });
    expect(isStrandedResyncRow({ definition: edited, tickResyncIds: TICK })).toBe(true);
  });

  it("answers true for a tick id whose argv carries an extra word past its atlas", () => {
    const edited = airtable({
      kind: "verb-run",
      params: { argv: ["recipe", "resync", "--atlas", "airtable", "--source", "slack"] },
    });
    expect(isStrandedResyncRow({ definition: edited, tickResyncIds: TICK })).toBe(true);
  });
});

describe("strandedResyncIds", () => {
  it("is empty on a store whose resync rows are all seated or tick-run", () => {
    const definitions = [row(), row({ recipeId: "resync-atlas-braze" }), airtable({ kind: "verb-run" })];
    expect(strandedResyncIds({ definitions, tickResyncIds: TICK })).toEqual([]);
  });

  it("names only the stranded rows, in the order they were read", () => {
    const definitions = [
      row({ kind: "verb-run" }),
      airtable({ kind: "verb-run" }),
      row({ recipeId: "resync-atlas-braze" }),
      row({
        kind: "verb-run",
        params: { argv: ["recipe", "resync", "--source", "slack"] },
        recipeId: "resync-corpus-slack",
      }),
    ];
    expect(strandedResyncIds({ definitions, tickResyncIds: TICK })).toEqual([
      "resync-atlas-jumpcloud",
      "resync-corpus-slack",
    ]);
  });

  it("is empty on an empty store", () => {
    expect(strandedResyncIds({ definitions: [], tickResyncIds: TICK })).toEqual([]);
  });
});

describe("strandedResyncLine", () => {
  it("names the count, one example to go and look at, and the verb that repairs it", () => {
    const line = strandedResyncLine({ recipeIds: ["resync-atlas-airtable", "resync-corpus-slack"] });
    expect(line).toBe(
      "!! 2 row(s) run `automation resync` on a kind no seat picks up (e.g. resync-atlas-airtable), " +
        "so `automation seat` can never reach them however late they get — " +
        "repair with `slopweaver automation register-resyncs`",
    );
  });
});
