/**
 * `slopweaver automation run-due` over a spawn-shaped row a seat claimed: the claim token is the only way the
 * seated session runs the row, and a firing that moved on is given back, carried forward or refused.
 */
import { afterEach, describe, expect, it } from "vitest";

import { productionRecipeClaimDeps } from "../../../../../../cli/commands/automation/claim.js";
import { runRecipeSeat } from "../../../../../../cli/commands/automation/seat.js";
import { dropSpentClaim, seatClaim } from "../../../../../../cli/commands/automation/seatClaims.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import {
  readRecipeDefinitionRuns,
  recordRecipeDefinitionRun,
} from "../../../../../../live/automation/definitionRunStore.js";
import { loadRecipeDefinitions } from "../../../../../../live/automation/definitionStore.js";
import { readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { startSeatedRun } from "../../../../../../live/automation/slotSeatedRun.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { bumpFixRow, NOW_ISO, resyncRow } from "./fixtures.js";
import { holdOnDisk, homeWith, removeHomes, runDueDeps, seatDeps } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("run-due over a spawn-shaped row", () => {
  it("reports SEAT IT and runs nothing when no token is offered", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = runDueDeps();
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.dispatched).toEqual([]);
    expect(deps.out.at(-1)).toContain("SEAT IT");
  });

  it("refuses a token that is not the row's live claim, and stamps nothing", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = runDueDeps();
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", "not-the-token"],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(deps.dispatched).toEqual([]);
    const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
    expect(runs).toEqual({});
  });

  it("threads a stored bump-fix row's kind into the board ask, so the seated session gets its procedure", async () => {
    const home = homeWith({ rows: [bumpFixRow()] });
    const deps = seatDeps();
    const code = await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "1", "--model", "opus", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    const argv = deps.registered[0]!;
    expect(argv[argv.indexOf("--ask") + 1]).toContain("skills/automation/reference/bump-fix.md");
  });

  it("runs a seated bump-fix row as its bump-drive worklist, dry-run and all", async () => {
    const home = homeWith({ rows: [bumpFixRow()] });
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "1", "--model", "opus", "--home", home],
      deps: seatDeps(),
    });
    const token = unwrap(
      readSlotAttempt({ home, recipeId: "bump-fix-slopweaver", slotIso: "2026-09-15T23:00:00.000Z" }),
    )!.holderToken;
    const deps = runDueDeps();
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.dispatched).toEqual([
      ["node", "slopweaver", "github", "bump-drive", "--repo", "lachiejames/slopweaver", "--dry-run"],
    ]);
  });

  it("runs the row, stamps the leased slot and drops the claim when the token matches", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const seat = seatDeps();
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps: seat,
    });
    const claimed = unwrap(
      readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" }),
    );
    const token = claimed!.holderToken;

    const deps = runDueDeps();
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.dispatched).toEqual([["node", "slopweaver", "recipe", "resync", "--atlas", "trelica"]]);
    const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
    // 23:00 rather than the clock's 23:05: the stamp is the SLOT the run covered, which is the row's own
    // latest firing at or before now.
    expect(runs["resync-atlas-trelica"]!.watermarkIso).toBe("2026-09-15T23:00:00.000Z");
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" }))!.outcome!
        .kind,
    ).toBe("succeeded");
  });

  it("runs nothing for a seated row a failure held after the seat, leaving its attempt unstarted", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps: seatDeps(),
    });
    const slot = { home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" };
    const token = unwrap(readSlotAttempt(slot))!.holderToken;
    holdOnDisk({ home, recipeId: "resync-atlas-trelica" });

    const deps = runDueDeps();
    await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps,
    });

    expect(deps.dispatched).toEqual([]);
    expect(deps.out.join("\n")).toContain("HELD");
    const after = unwrap(readSlotAttempt(slot))!;
    expect(after.runStartedAtIso).toBe(null);
    expect(after.outcome).toBe(null);
  });

  describe("a seated firing its row is no longer due for", () => {
    const SLOT = "2026-09-15T23:00:00.000Z";

    /** Stamp the row as having covered `watermarkIso`, exactly as a settled run would. */
    function stamp({ home, watermarkIso }: { home: string; watermarkIso: string }): void {
      unwrap(
        recordRecipeDefinitionRun({
          home,
          nowIso: NOW_ISO,
          path: stateHomePaths({ home }).live.recipe.definitionRunsJson,
          recipeId: "resync-atlas-trelica",
          run: { exitCode: EXIT_OK, lastRunAtIso: watermarkIso, watermarkIso },
        }),
      );
    }

    /** A home whose row last covered 22:00, seated at 23:05 on its 23:00 firing; answers the home and token. */
    async function seatedAfter2200(): Promise<{ home: string; token: string }> {
      const home = homeWith({ rows: [resyncRow()] });
      stamp({ home, watermarkIso: "2026-09-15T22:00:00.000Z" });
      await runRecipeSeat({
        argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
        deps: seatDeps(),
      });
      const token = unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: SLOT }))!.holderToken;
      return { home, token };
    }

    it("gives the attempt back when the firing deferred to its successor, rather than leaving it open to its lease", async () => {
      // MEASURED: a seat's earlier rows ran long, the github and linear resyncs read DEFERRED when the
      // session reached them, exited 0, and both attempts sat open until their lease — read as two mid-run deaths.
      const { home, token } = await seatedAfter2200();

      const deps = runDueDeps({ now: "2026-09-15T23:40:00.000Z" });
      const code = await runDueUnderFake({
        argv: [
          "node",
          "slopweaver",
          "recipe",
          "run-due",
          "--home",
          home,
          "--recipe",
          "resync-atlas-trelica",
          "--claim-id",
          token,
        ],
        deps,
      });

      expect(code).toBe(EXIT_OK);
      expect(deps.dispatched).toEqual([]);
      expect(deps.out[0]).toContain("DEFERRED");
      expect(deps.out.at(-1)).toBe(
        `recipe resync-atlas-trelica · seat given back · its firing ${SLOT} never started under this token and the ` +
          "row is not due now, so the attempt is removed rather than left open to its lease; the row's next due " +
          "firing takes it",
      );
      expect(unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: SLOT }))).toBe(null);
      const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
      expect(runs["resync-atlas-trelica"]!.watermarkIso).toBe("2026-09-15T22:00:00.000Z");
    });

    it("gives the attempt back when another run already covered the firing", async () => {
      const { home, token } = await seatedAfter2200();
      stamp({ home, watermarkIso: SLOT });

      const deps = runDueDeps({ now: "2026-09-15T23:10:00.000Z" });
      const code = await runDueUnderFake({
        argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
        deps,
      });

      expect(code).toBe(EXIT_OK);
      expect(deps.dispatched).toEqual([]);
      expect(deps.out.at(-1)).toContain("seat given back");
      expect(unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: SLOT }))).toBe(null);
    });

    it("leaves a run this token already started to settle, and says so", async () => {
      const { home, token } = await seatedAfter2200();
      unwrap(
        startSeatedRun({
          holderPid: process.pid,
          holderToken: token,
          home,
          nowIso: "2026-09-15T23:06:00.000Z",
          recipeId: "resync-atlas-trelica",
          slotIso: SLOT,
        }),
      );

      const deps = runDueDeps({ now: "2026-09-15T23:40:00.000Z" });
      const code = await runDueUnderFake({
        argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
        deps,
      });

      expect(code).toBe(EXIT_OK);
      expect(deps.dispatched).toEqual([]);
      expect(deps.out.at(-1)).toBe(
        `recipe resync-atlas-trelica · not due · this token's seated run of firing ${SLOT} already started at ` +
          "2026-09-15T23:06:00.000Z, so it is left to settle",
      );
      const still = unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: SLOT }))!;
      expect(still.runStartedAtIso).toBe("2026-09-15T23:06:00.000Z");
      expect(still.outcome).toBe(null);
    });

    it("touches nothing without a token, so an ordinary tick never gives a seat's firing back", async () => {
      const { home, token } = await seatedAfter2200();

      const deps = runDueDeps({ now: "2026-09-15T23:40:00.000Z" });
      await runDueUnderFake({ argv: ["node", "slopweaver", "recipe", "run-due", "--home", home], deps });

      expect(deps.out.at(-1)).toBe("automation run-due · every row is inside its cadence — nothing to run");
      expect(unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: SLOT }))!.holderToken).toBe(
        token,
      );
    });
  });

  /** Seat the hourly row at 23:05 — firing 23:00, lease 00:00 — and hand back the token the session got. */
  async function seatAt2305({ home }: { home: string }): Promise<string> {
    await runRecipeSeat({
      argv: ["node", "slopweaver", "recipe", "seat", "--limit", "4", "--model", "sonnet", "--home", home],
      deps: seatDeps(),
    });
    return unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" }))!
      .holderToken;
  }

  it("runs the firing the row is due for when the seat's attempt was born expired", async () => {
    // MEASURED: a seat at 01:58 took the 22:00 firing under a lease of 02:00, the session ran
    // the row at 02:01, the due judgement chose 02:00, and nothing ran. Here: seat at 23:05 (firing 23:00,
    // lease 00:00), run at 00:01 the next day.
    const home = homeWith({ rows: [resyncRow()] });
    const token = await seatAt2305({ home });

    const deps = runDueDeps({ now: "2026-09-16T00:01:00.000Z" });
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(deps.dispatched).toEqual([["node", "slopweaver", "recipe", "resync", "--atlas", "trelica"]]);
    expect(deps.out.some((line) => line.includes("seat carried forward"))).toBe(true);
    const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
    expect(runs["resync-atlas-trelica"]!.watermarkIso).toBe("2026-09-16T00:00:00.000Z");
    const ran = unwrap(
      readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-16T00:00:00.000Z" }),
    )!;
    expect(ran.outcome!.kind).toBe("succeeded");
    expect(ran.holderToken).toBe(token);
    expect(ran.holder).toBe("automations-seat-token-00");
    // The firing the seat took is GIVEN BACK, not settled: nothing ran under it and no attempt was spent.
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" })),
    ).toBe(null);
  });

  it("refuses to carry a seat onto a firing a later seat already holds, and leaves that seat's attempt alone", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const token = await seatAt2305({ home });
    const paths = stateHomePaths({ home }).live.recipe;
    const later = await seatClaim({
      claimedBy: "a-later-seat",
      definition: loadRecipeDefinitions({ board: null, directory: paths.definitionsDir }).definitions[0]!,
      deps: {
        ...productionRecipeClaimDeps(),
        mintClaimId: () => "the-later-token",
        now: () => "2026-09-16T00:00:30.000Z",
      },
      home,
    });
    expect(unwrap(later).slotIso).toBe("2026-09-16T00:00:00.000Z");

    const deps = runDueDeps({ now: "2026-09-16T00:01:00.000Z" });
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(deps.dispatched).toEqual([]);
    expect(deps.out.at(-1)).toContain("HELD · attempt 1 is running under a-later-seat");
    expect(deps.out.at(-1)).toContain("the seat carried from 2026-09-15T23:00:00.000Z runs nothing");
    const held = unwrap(
      readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-16T00:00:00.000Z" }),
    )!;
    expect(held.holderToken).toBe("the-later-token");
    expect(held.runStartedAtIso).toBe(null);
    const runs = unwrap(readRecipeDefinitionRuns({ path: paths.definitionRunsJson }));
    expect(runs).toEqual({});
  });

  it("does not carry a token whose seated run already started and has not settled", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const token = await seatAt2305({ home });
    // The run of the 23:00 firing began in another pane at 23:06 and is still going — the record says so.
    const begun = unwrap(
      startSeatedRun({
        // This test's own process, so a liveness probe reads the other pane's run as still going.
        holderPid: process.pid,
        holderToken: token,
        home,
        nowIso: "2026-09-15T23:06:00.000Z",
        recipeId: "resync-atlas-trelica",
        slotIso: "2026-09-15T23:00:00.000Z",
      }),
    );
    expect(begun.kind).toBe("taken");

    const again = runDueDeps({ now: "2026-09-16T00:01:00.000Z" });
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps: again,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(again.dispatched).toEqual([]);
    expect(again.out.at(-1)).toContain("already started at 2026-09-15T23:06:00.000Z and has not settled");
    const still = unwrap(
      readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-15T23:00:00.000Z" }),
    )!;
    expect(still.runStartedAtIso).toBe("2026-09-15T23:06:00.000Z");
    expect(
      unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso: "2026-09-16T00:00:00.000Z" })),
    ).toBe(null);
  });

  it("refuses a token whose run already settled, naming that the token holds nothing open", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const token = await seatAt2305({ home });
    const first = runDueDeps({ now: "2026-09-15T23:06:00.000Z" });
    expect(
      await runDueUnderFake({
        argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
        deps: first,
      }),
    ).toBe(EXIT_OK);

    const again = runDueDeps({ now: "2026-09-16T00:01:00.000Z" });
    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "recipe", "run-due", "--home", home, "--claim-id", token],
      deps: again,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(again.dispatched).toEqual([]);
    expect(again.out.at(-1)).toContain("no open attempt on this row carries this token");
    const runs = unwrap(readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson }));
    expect(runs["resync-atlas-trelica"]!.watermarkIso).toBe("2026-09-15T23:00:00.000Z");
  });

  it("never drops a successor's claim: a finish whose own claim has been re-taken is refused", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const paths = stateHomePaths({ home }).live.recipe;
    const successor = await seatClaim({
      claimedBy: "a-later-seat",
      definition: loadRecipeDefinitions({ board: null, directory: paths.definitionsDir }).definitions[0]!,
      deps: { ...productionRecipeClaimDeps(), mintClaimId: () => "the-successor-token", now: () => NOW_ISO },
      home,
    });
    expect(successor.isOk()).toBe(true);
    const slotIso = unwrap(successor).slotIso;

    const dropped = dropSpentClaim({
      claimId: "a-token-that-expired",
      home,
      nowIso: NOW_ISO,
      recipeId: "resync-atlas-trelica",
      slotIso,
    });
    expect(dropped.isErr()).toBe(true);
    expect(dropped._unsafeUnwrapErr()[0]).toContain("under a different token");
    const held = unwrap(readSlotAttempt({ home, recipeId: "resync-atlas-trelica", slotIso }));
    expect(held!.holderToken).toBe("the-successor-token");
  });
});
