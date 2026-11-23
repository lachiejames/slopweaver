/**
 * One due row's real sequence, called directly — which attempts `automation run-due` traps signals for, and the
 * per-row throw isolation. The whole tick is driven end to end in `runDue/` (`tickBasics.test.ts` and
 * `signal.test.ts` among them); these cases pin the two properties those files can only reach indirectly: a SEATED row's attempt is never this process's to retire,
 * and a row that throws is that row's own failure.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { ok, unwrap } from "#lib/result.js";
import type { CollectedLeg } from "../../../../../cli/commands/automation/collectLeg.js";
import type { RecipeRunDueDeps } from "../../../../../cli/commands/automation/rowRunners.js";
import { admitRunAndSettle, runOneRowSafely } from "../../../../../cli/commands/automation/runDueAttempt.js";
import { lateSignalLine, openRunDueSignalTrap } from "../../../../../cli/commands/automation/runDueSignal.js";
import type { SlotRunDeps } from "../../../../../cli/commands/automation/slotRun.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import { RESYNC_KIND } from "../../../../../live/automation/kinds.js";
import { beginSlotAttempt, readSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { UNREACHED_FLEET_CEILING_SEAMS } from "../../../../fleetCeilingSeamsFake.js";
import { fakeRunDueSignalProcess } from "../../../../runDueSignalFake.js";

const SLOT = "2026-09-27T07:00:00.000Z";
const NOW = "2026-09-27T07:05:00.000Z";

/** A run-here `verb-run` row, as `store-backup-daily` is. */
const BACKUP: RecipeDefinition = {
  cadence: "0 7 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["store", "backup"] },
  recipeId: "store-backup-daily",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

/** A spawn-shaped `resync` row, whose attempt belongs to the seat that opened the session running it. */
const RESYNC: RecipeDefinition = {
  ...BACKUP,
  effect: "read",
  kind: RESYNC_KIND,
  params: { atlas: "linear" },
  recipeId: "resync-atlas-linear",
};

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A fresh throwaway home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "rda-"));
  homes.push(home);
  return home;
}

/** Row edges whose verb dispatch answers `runVerb`; every other leg would be a dispatch bug, answered as a failure. */
function rowDeps({
  runVerb,
}: {
  runVerb: (argv: readonly string[]) => Promise<number>;
}): RecipeRunDueDeps & { readonly out: string[] } {
  const out: string[] = [];
  const failedLeg = (): Promise<CollectedLeg> => Promise.resolve({ diagnostics: "", exitCode: 1, lines: [] });
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    doorEnv: () => ({}),
    mintId: () => "tok-minted",
    now: () => NOW,
    out,
    processAlive: () => true,
    promptChannel: () => undefined,
    register: () => Promise.resolve(0),
    runAlertDigestRead: failedLeg,
    runAlertSummaryRead: failedLeg,
    ...UNREACHED_FLEET_CEILING_SEAMS,
    runGithubLandingRead: failedLeg,
    runSlackPost: failedLeg,
    runVerbKeepingDiagnostics: async (argv) => ({ diagnostics: "", exitCode: await runVerb(argv) }),
    writeDiagnostic: (line) => out.push(line),
    writeOut: (line) => out.push(line),
  };
}

/** The take/settle projection of a row's edges. */
function slotDepsOf({ deps }: { deps: RecipeRunDueDeps }): SlotRunDeps {
  return {
    checkoutFor: deps.checkoutFor,
    mintId: deps.mintId,
    now: deps.now,
    processAlive: deps.processAlive,
    register: deps.register,
    writeDiagnostic: deps.writeDiagnostic,
  };
}

describe("admitRunAndSettle", () => {
  it("arms the trap around a run-here row's effect and settles it ordinarily, requesting no exit", async () => {
    const home = freshHome();
    const deps = rowDeps({ runVerb: () => Promise.resolve(0) });
    const fake = fakeRunDueSignalProcess();

    const ran = await admitRunAndSettle({
      claimId: null,
      definition: BACKUP,
      deps,
      home,
      media: [],
      signalTrap: openRunDueSignalTrap({ signalProcess: fake.edge }),
      slotDeps: slotDepsOf({ deps }),
      slotIso: SLOT,
    });

    expect(ran.started).toBe(true);
    expect(fake.installed).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    expect(fake.exits).toEqual([]);
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome).toEqual({
      exitCode: 0,
      kind: "succeeded",
      settledAtIso: NOW,
    });
  });

  it("takes no firing once a signal retirement is under way anywhere in the process", async () => {
    const outerHome = freshHome();
    const outer = unwrap(
      beginSlotAttempt({
        holder: "recipe run-due",
        holderPid: 4242,
        holderToken: "tok-outer",
        home: outerHome,
        leaseExpiresIso: "2026-09-28T07:00:00.000Z",
        nowIso: "2026-09-27T07:00:05.000Z",
        processAlive: () => true,
        recipeId: BACKUP.recipeId,
        slotIso: SLOT,
      }),
    );
    if (outer.kind !== "taken") {
      throw new Error(`the fixture expected to take the firing, got ${outer.kind}`);
    }
    const fake = fakeRunDueSignalProcess();
    const signalTrap = openRunDueSignalTrap({ signalProcess: fake.edge });
    const deps = rowDeps({ runVerb: () => Promise.resolve(0) });
    signalTrap.arm({ attempt: outer.attempt, definition: BACKUP, deps: slotDepsOf({ deps }), home: outerHome });
    fake.fire({ signal: "SIGTERM" });
    const home = freshHome();

    const ran = await admitRunAndSettle({
      claimId: null,
      definition: BACKUP,
      deps,
      home,
      media: [],
      signalTrap,
      slotDeps: slotDepsOf({ deps }),
      slotIso: SLOT,
    });

    expect(ran).toEqual({ outcomes: [], stampFailed: false, started: false });
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))).toBe(null);
    expect(fake.exits).toEqual([143]);
  });

  it("traps nothing for a SEATED row, whose attempt belongs to the seat rather than to this effect", async () => {
    const home = freshHome();
    unwrap(
      beginSlotAttempt({
        holder: "recipe seat",
        holderPid: null,
        holderToken: "seat-tok",
        home,
        leaseExpiresIso: "2026-09-28T07:00:00.000Z",
        nowIso: "2026-09-27T07:00:05.000Z",
        processAlive: () => true,
        recipeId: RESYNC.recipeId,
        slotIso: SLOT,
      }),
    );
    const deps = rowDeps({ runVerb: () => Promise.resolve(0) });
    const fake = fakeRunDueSignalProcess();

    const ran = await admitRunAndSettle({
      claimId: "seat-tok",
      definition: RESYNC,
      deps,
      home,
      media: [],
      signalTrap: openRunDueSignalTrap({ signalProcess: fake.edge }),
      slotDeps: slotDepsOf({ deps }),
      slotIso: SLOT,
    });

    // Admitted through the SEAT's token — its run stamp is this call's — and still nothing was trapped.
    expect(ran.started).toBe(true);
    const stored = unwrap(readSlotAttempt({ home, recipeId: RESYNC.recipeId, slotIso: SLOT }))!;
    expect(stored.holderToken).toBe("seat-tok");
    expect(stored.runStartedAtIso).toBe(NOW);
    expect(fake.installed).toEqual([]);
  });

  it("never retires a SEATED row's attempt on a signal, even once a run-here row installed the handlers", async () => {
    const home = freshHome();
    unwrap(
      beginSlotAttempt({
        holder: "recipe seat",
        holderPid: null,
        holderToken: "seat-tok",
        home,
        leaseExpiresIso: "2026-09-28T07:00:00.000Z",
        nowIso: "2026-09-27T07:00:05.000Z",
        processAlive: () => true,
        recipeId: RESYNC.recipeId,
        slotIso: SLOT,
      }),
    );
    const fake = fakeRunDueSignalProcess();
    const signalTrap = openRunDueSignalTrap({ signalProcess: fake.edge });
    const quiet = rowDeps({ runVerb: () => Promise.resolve(0) });
    await admitRunAndSettle({
      claimId: "seat-tok",
      definition: BACKUP,
      deps: quiet,
      home,
      media: [],
      signalTrap,
      slotDeps: slotDepsOf({ deps: quiet }),
      slotIso: SLOT,
    });
    // The signal lands on the seated row's first clock read — its admission stamp, after the run-here row disarmed.
    let fired = false;
    const signalled: ReturnType<typeof rowDeps> = {
      ...quiet,
      now: () => {
        if (!fired) {
          fired = true;
          fake.fire({ signal: "SIGTERM" });
        }
        return NOW;
      },
    };

    await admitRunAndSettle({
      claimId: "seat-tok",
      definition: RESYNC,
      deps: signalled,
      home,
      media: [],
      signalTrap,
      slotDeps: slotDepsOf({ deps: signalled }),
      slotIso: SLOT,
    });

    // The seat's attempt is left to its seat and its lease, as a default signal death left it; the line says
    // no run-here effect was running rather than claiming nothing was.
    expect(fake.installed).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    expect(fake.exits).toEqual([143]);
    expect(fake.diag).toEqual([lateSignalLine({ signal: "SIGTERM" })]);
    expect(unwrap(readSlotAttempt({ home, recipeId: RESYNC.recipeId, slotIso: SLOT }))!.holderToken).toBe("seat-tok");
    expect(fired).toBe(true);
  });
});

describe("runOneRowSafely", () => {
  it("turns a row that THROWS into that row's own failure rather than a rejected tick", async () => {
    const outcome = await runOneRowSafely({
      definition: BACKUP,
      deps: rowDeps({ runVerb: () => Promise.reject(new Error("disk vanished")) }),
      dryRun: false,
      home: freshHome(),
      media: [],
      slotIso: SLOT,
    });

    expect(outcome).toEqual({
      detail: [],
      exitCode: null,
      failed: true,
      line: "recipe store-backup-daily · THREW · disk vanished",
      ran: false,
      recipeId: "store-backup-daily",
    });
  });
});
