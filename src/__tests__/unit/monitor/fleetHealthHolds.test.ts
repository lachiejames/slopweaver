/**
 * Which rows the fleet note calls paused on a failure finding, read over a throwaway home. The
 * note must not say linear and github are "paused on its failure finding until a fix lands" once both findings are
 * settled and both rows have run clean since; reading the STORED view would, because a failure hold never lifts there.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../live/automation/definition.js";
import { placeFailureHold } from "../../../live/automation/failureHoldStore.js";
import { failureHolds } from "../../../monitor/fleetHealthSource.js";
import { stateHomePaths } from "../../../stateHome.js";

const RECIPE = "resync-corpus-linear";
const FINDING = "recipe-failing-resync-corpus-linear-a1";

const DEFINITION: RecipeDefinition = {
  cadence: "0 */4 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["corpus", "resync", "linear"] },
  recipeId: RECIPE,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fleet-holds-"));
  const paths = stateHomePaths({ home });
  mkdirSync(paths.live.recipe.definitionsDir, { recursive: true });
  mkdirSync(paths.handovers, { recursive: true });
  mkdirSync(paths.runs, { recursive: true });
  writeFileSync(join(paths.live.recipe.definitionsDir, `${RECIPE}.json`), `${JSON.stringify(DEFINITION)}\n`, "utf8");
  unwrap(
    placeFailureHold({
      finding: FINDING,
      home,
      nowIso: "2026-10-05T05:40:00.000Z",
      reason: "held by the test",
      recipeId: RECIPE,
    }),
  );
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The hold's finding on the board, settled as given — the front-matter a real finding carries. */
function findingRow({ settlement }: { settlement: "answered" | null }): void {
  const settled =
    settlement === null
      ? []
      : [`settlement: ${settlement}`, "settlementWitness: '#1906'", 'settlementReason: "the fix landed"'];
  writeFileSync(
    join(stateHomePaths({ home }).handovers, `${FINDING}.md`),
    [
      "---",
      `slug: ${FINDING}`,
      "kind: ask",
      'summary: "a recipe failed"',
      "status: ready",
      "askedIso: 2026-10-05T05:40:00.000Z",
      "origin: finding",
      "observedBy: recipe run-due",
      "evidence: [a log line]",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      ...settled,
      "---",
      "# finding",
      "",
    ].join("\n"),
  );
}

describe("failureHolds", () => {
  it("names the row and its finding while the finding is unsettled", () => {
    findingRow({ settlement: null });

    expect([...failureHolds({ home })]).toEqual([[RECIPE, FINDING]]);
  });

  it("pauses nothing once the finding is settled answered, though the hold is still on the file", () => {
    findingRow({ settlement: "answered" });

    expect([...failureHolds({ home })]).toEqual([]);
  });
});
