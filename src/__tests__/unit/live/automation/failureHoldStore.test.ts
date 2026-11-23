/**
 * The effectful half of a FAILURE HOLD over a throwaway home: placing one, never replacing a standing one,
 * writing only the `hold` key, keeping a hold through a whole-definition write, and reading whether a row is
 * held NOW off its file and the board.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import { loadRecipeDefinitions } from "../../../../live/automation/definitionStore.js";
import {
  placeFailureHold,
  recipeBoardOf,
  rowHeldNow,
  writeDefinitionKeepingHold,
} from "../../../../live/automation/failureHoldStore.js";
import { writeAutomationRetirements } from "../../../../live/automation/retirementStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const RECIPE = "resync-atlas-vanta";
const FINDING = "recipe-failing-resync-atlas-vanta-a1";
const NOW = "2026-09-29T02:05:00.000Z";

const DEFINITION: RecipeDefinition = {
  cadence: "0 2 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["atlas", "vanta", "sync"] },
  recipeId: RECIPE,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "failure-hold-"));
  mkdirSync(definitionsDir(), { recursive: true });
  mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
  mkdirSync(stateHomePaths({ home }).runs, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function definitionsDir(): string {
  return stateHomePaths({ home }).live.recipe.definitionsDir;
}

function definitionPath(): string {
  return join(definitionsDir(), `${RECIPE}.json`);
}

/** Write the row's file exactly as given — raw, so a key this build does not know can ride along. */
function writeDefinition({ value }: { value: Record<string, unknown> }): void {
  writeFileSync(definitionPath(), `${JSON.stringify(value)}\n`, "utf8");
}

function readDefinition(): Record<string, unknown> {
  return JSON.parse(readFileSync(definitionPath(), "utf8")) as Record<string, unknown>;
}

/** A board row for a finding, settled as given — the full front-matter a real finding carries. */
function findingRow({ slug, settlement, witness }: { slug: string; settlement?: string; witness?: string }): void {
  // A decline carries the owner's reason, or the row does not read at all — and an unread row is held for THAT.
  const settled =
    settlement === undefined
      ? []
      : [`settlement: ${settlement}`, `settlementWitness: ${witness!}`, 'settlementReason: "declined by the owner"'];
  writeFileSync(
    join(stateHomePaths({ home }).handovers, `${slug}.md`),
    [
      "---",
      `slug: ${slug}`,
      "kind: ask",
      'summary: "a recipe failed"',
      "status: ready",
      "askedIso: 2026-09-29T02:05:00.000Z",
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

/** A plain board row at the given status — what a `filed` settlement's witness is. */
function plainRow({ slug, status }: { slug: string; status: string }): void {
  writeFileSync(
    join(stateHomePaths({ home }).handovers, `${slug}.md`),
    `---\nslug: ${slug}\nstatus: ${status}\n---\n# doc\n`,
  );
}

function place(): ReturnType<typeof placeFailureHold> {
  return placeFailureHold({ finding: FINDING, home, nowIso: NOW, reason: "held by the store", recipeId: RECIPE });
}

describe("placeFailureHold", () => {
  it("holds a row nothing holds, naming the finding", () => {
    writeDefinition({ value: { ...DEFINITION } });

    expect(unwrap(place())).toEqual({ kind: "placed" });
    expect(readDefinition()["hold"]).toEqual({
      askedIso: NOW,
      clearedBy: null,
      finding: FINDING,
      reason: "held by the store",
    });
  });

  it("writes ONLY the hold key — a field this build does not know survives, and no default is written back", () => {
    const { onMissed: _onMissed, params: _params, ...bare } = DEFINITION;
    writeDefinition({ value: { ...bare, fromANewerBuild: "kept" } });

    unwrap(place());
    const after = readDefinition();
    expect(after["fromANewerBuild"]).toBe("kept");
    expect(Object.keys(after).toSorted()).toEqual([...Object.keys(bare), "fromANewerBuild", "hold"].toSorted());
  });

  it("never replaces a standing failure hold, answering the finding it already names", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());

    const second = placeFailureHold({
      finding: "recipe-failing-resync-atlas-vanta-a2",
      home,
      nowIso: "2026-09-30T02:05:00.000Z",
      reason: "a second failure",
      recipeId: RECIPE,
    });

    expect(unwrap(second)).toEqual({ finding: FINDING, kind: "already" });
    expect((readDefinition()["hold"] as { finding: string }).finding).toBe(FINDING);
  });

  it("never replaces the owner's own hold, and says so", () => {
    const owner = { askedIso: "2026-09-28T00:00:00.000Z", clearedBy: null, reason: "the owner's hold" };
    writeDefinition({ value: { ...DEFINITION, hold: owner } });

    expect(unwrap(place())).toEqual({ kind: "owner-held" });
    expect(readDefinition()["hold"]).toEqual(owner);
  });

  it("replaces a failure hold whose finding says the fix landed — a fresh failure is a fresh finding", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());
    findingRow({ settlement: "answered", slug: FINDING, witness: "#1580" });

    const second = placeFailureHold({
      finding: "recipe-failing-resync-atlas-vanta-a9",
      home,
      nowIso: "2026-09-30T02:05:00.000Z",
      reason: "failed again after the fix",
      recipeId: RECIPE,
    });

    expect(unwrap(second)).toEqual({ kind: "placed" });
    expect((readDefinition()["hold"] as { finding: string }).finding).toBe("recipe-failing-resync-atlas-vanta-a9");
  });

  it("refuses HOLD_NOT_PLACED, naming the file, when the row has no definition", () => {
    const refused = unwrapErr(place());
    expect(refused.code).toBe("HOLD_NOT_PLACED");
    expect(refused.message).toContain(definitionPath());
  });
});

describe("rowHeldNow", () => {
  it("answers null for a row nothing holds", () => {
    writeDefinition({ value: { ...DEFINITION } });
    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe(null);
  });

  it("answers null when the file is gone — the take's own roster already parsed it", () => {
    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe(null);
  });

  it("answers the owner's own hold's reason", () => {
    writeDefinition({
      value: { ...DEFINITION, hold: { askedIso: NOW, clearedBy: null, reason: "the owner's hold" } },
    });
    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe("the owner's hold");
  });

  it("answers the finding's line while the finding is unsettled", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());
    findingRow({ slug: FINDING });
    expect(rowHeldNow({ home, recipeId: RECIPE })).toContain(`its finding ${FINDING} is ready and unsettled`);
  });

  it("answers null once the finding is settled answered", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());
    findingRow({ settlement: "answered", slug: FINDING, witness: "#1580" });
    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe(null);
  });

  it("keeps holding a finding settled declined", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());
    findingRow({ settlement: "declined", slug: FINDING, witness: "not worth fixing" });
    expect(rowHeldNow({ home, recipeId: RECIPE })).toContain("settled declined");
  });

  it("holds a finding filed as another row until that row is done", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());
    findingRow({ settlement: "filed", slug: FINDING, witness: "the-fix" });
    plainRow({ slug: "the-fix", status: "in-progress" });
    expect(rowHeldNow({ home, recipeId: RECIPE })).toContain("which is in-progress — held until that row is done");

    plainRow({ slug: "the-fix", status: "done" });
    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe(null);
  });

  it("holds a row retired after a dispatcher loaded it, though its file is gone", () => {
    unwrap(
      writeAutomationRetirements({
        home,
        retirements: [
          {
            anchor: "talk:acme-turn",
            recipeId: RECIPE,
            retiredAtIso: NOW,
            why: "not this install's",
            words: "turn it off",
          },
        ],
      }),
    );
    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe(
      `${RECIPE} is retired on this install (\`slopweaver automation retire ${RECIPE} --undo\` restores it)`,
    );
  });

  it("holds every row while the retirement registry will not read", () => {
    writeDefinition({ value: { ...DEFINITION } });
    const path = stateHomePaths({ home }).live.recipe.retirementsJson;
    writeFileSync(path, "{not json", "utf8");
    expect(rowHeldNow({ home, recipeId: RECIPE })).toContain("not taken — the automation retirement registry at");
  });
});

describe("loadRecipeDefinitions — the lifted and the stored view", () => {
  it("derives findingState only when handed the board, and never stores it", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());
    findingRow({ settlement: "answered", slug: FINDING, witness: "#1580" });

    const lifted = loadRecipeDefinitions({ board: recipeBoardOf({ home }), directory: definitionsDir() });
    const stored = loadRecipeDefinitions({ board: null, directory: definitionsDir() });

    expect(lifted.definitions[0]!.hold!.findingState).toEqual({
      held: false,
      line: `its finding ${FINDING} was settled answered (#1580)`,
      stage: { kind: "landed" },
    });
    expect(stored.definitions[0]!.hold!.findingState).toBe(undefined);
    expect(readDefinition()["hold"]).toEqual({
      askedIso: NOW,
      clearedBy: null,
      finding: FINDING,
      reason: "held by the store",
    });
  });
});

describe("writeDefinitionKeepingHold", () => {
  it("writes a new row whole, reporting nothing replaced", () => {
    const written = unwrap(
      writeDefinitionKeepingHold({ definition: DEFINITION, home, nowIso: NOW, path: definitionPath() }),
    );
    expect(written.replaced).toBe(false);
    expect(readDefinition()["recipeId"]).toBe(RECIPE);
    expect(readDefinition()["hold"]).toBe(undefined);
  });

  it("carries the hold already on disk through a re-derived row", () => {
    writeDefinition({ value: { ...DEFINITION } });
    unwrap(place());

    const written = unwrap(
      writeDefinitionKeepingHold({
        definition: { ...DEFINITION, cadence: "0 3 * * *" },
        home,
        nowIso: NOW,
        path: definitionPath(),
      }),
    );

    expect(written.replaced).toBe(true);
    expect(readDefinition()["cadence"]).toBe("0 3 * * *");
    expect((readDefinition()["hold"] as { finding: string }).finding).toBe(FINDING);
  });

  it("carries a disabled row's `enabled: false` through a re-derived row that declares it on", () => {
    writeDefinition({ value: { ...DEFINITION, enabled: false } });

    const written = unwrap(
      writeDefinitionKeepingHold({
        definition: { ...DEFINITION, cadence: "0 3 * * *" },
        home,
        nowIso: NOW,
        path: definitionPath(),
      }),
    );

    expect(written.written.enabled).toBe(false);
    expect(readDefinition()["enabled"]).toBe(false);
    expect(readDefinition()["cadence"]).toBe("0 3 * * *");
  });
});
