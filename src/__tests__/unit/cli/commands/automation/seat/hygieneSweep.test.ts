/**
 * A `hygiene-sweep` row end to end: seated as one visible session, then run under its claim, which reads the
 * landing packet, publishes it byte for byte and stamps the firing, or stamps nothing when the read fails.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { runRecipeSeat } from "../../../../../../cli/commands/automation/seat.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../../../live/automation/definition.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { runShapeForKind } from "../../../../../../live/automation/definitionShape.js";
import { HYGIENE_SWEEP_KIND } from "../../../../../../live/automation/kinds.js";
import { readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { LANDING_PACKET } from "./fixtures.js";
import { homeWith, removeHomes, runDueDeps, seatDeps } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("a hygiene-sweep row, seated and run under its claim", () => {
  /** The `hygiene-sweep` standing row's shape, hourly for the timezone reason {@link resyncRow} gives. */
  function hygieneRow(): Record<string, unknown> {
    return {
      cadence: "0 * * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      kind: HYGIENE_SWEEP_KIND,
      onMissed: "skip",
      params: {},
      recipeId: "hygiene-sweep",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    };
  }

  /** Seat the row the way a supervisor pass does, and hand back the token the one session got. */
  async function seated({ home }: { home: string }): Promise<{ token: string; opened: (readonly string[])[] }> {
    const seat = seatDeps();
    await runRecipeSeat({
      argv: [
        "node",
        "slopweaver",
        "recipe",
        "seat",
        "--recipe",
        "hygiene-sweep",
        "--limit",
        "1",
        "--model",
        "opus",
        "--home",
        home,
      ],
      deps: seat,
    });
    const held = unwrap(readSlotAttempt({ home, recipeId: "hygiene-sweep", slotIso: "2026-09-15T23:00:00.000Z" }));
    return { opened: seat.opened, token: held!.holderToken };
  }

  /** Run the seated row with the token, as the seated session's first command does. */
  async function runSeated({
    home,
    token,
    deps,
  }: {
    home: string;
    token: string;
    deps: ReturnType<typeof runDueDeps>;
  }): Promise<number> {
    return runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps,
    });
  }

  it("answers spawn, so no tick ever runs it in its own process", () => {
    expect(runShapeForKind({ kind: HYGIENE_SWEEP_KIND })).toBe("spawn");
  });

  it("is seated as ONE visible session holding the row's claim", async () => {
    const home = homeWith({ rows: [hygieneRow()] });
    const { opened, token } = await seated({ home });
    expect(opened).toEqual([["automations-seat-token-00", "--model", "opus", "--home", home]]);
    // 0001 names the seat (its board row); 0002 is the claim the session runs the row under.
    expect(token).toBe("token-0002-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("reads the packet, publishes it byte for byte, prints it for the session, and stamps the firing", async () => {
    const home = homeWith({ rows: [hygieneRow()] });
    const { token } = await seated({ home });
    const deps = runDueDeps();
    const code = await runSeated({ deps, home, token });
    expect(code).toBe(EXIT_OK);
    expect(deps.landingReads).toEqual([
      [
        "--author",
        "@me",
        "--include-drafts",
        "--slack-live",
        "--json",
        "--record-reading",
        "recipe:hygiene-sweep",
        "--home",
        home,
      ],
    ]);
    expect(deps.dispatched).toEqual([]);
    const path = stateHomePaths({ home }).live.hygiene.githubLanding;
    expect(readFileSync(path, "utf8")).toBe(`${LANDING_PACKET}\n`);
    expect(deps.out).toContain(LANDING_PACKET);
    expect(deps.out).toContain(
      `recipe hygiene-sweep · ran · landing packet published to ${path} · ` +
        "work it by skills/automation/SKILL.md § A hygiene-sweep row",
    );
    const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
    expect(runs["hygiene-sweep"]!.watermarkIso).toBe("2026-09-15T23:00:00.000Z");
  });

  it("stamps nothing and leaves yesterday's packet standing when the landing read fails", async () => {
    const home = homeWith({ rows: [hygieneRow()] });
    const path = stateHomePaths({ home }).live.hygiene.githubLanding;
    mkdirSync(stateHomePaths({ home }).live.hygiene.root, { recursive: true });
    writeFileSync(path, "yesterday\n", "utf8");
    const { token } = await seated({ home });
    const deps = runDueDeps({ landingExitCode: EXIT_ERROR, landingLines: [] });
    const code = await runSeated({ deps, home, token });
    expect(code).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe("yesterday\n");
    expect(deps.out.some((line) => line.includes("recipe hygiene-sweep · READ FAILED ·"))).toBe(true);
    const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
    expect(runs).toEqual({});
  });

  it("stamps nothing and publishes nothing when the read exits zero with two documents", async () => {
    const home = homeWith({ rows: [hygieneRow()] });
    const { token } = await seated({ home });
    const deps = runDueDeps({ landingLines: [LANDING_PACKET, LANDING_PACKET] });
    const code = await runSeated({ deps, home, token });
    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(stateHomePaths({ home }).live.hygiene.githubLanding)).toBe(false);
    expect(deps.out).not.toContain(LANDING_PACKET);
    const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
    expect(runs).toEqual({});
  });
});
