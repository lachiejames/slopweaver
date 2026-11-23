/**
 * `slopweaver automation run-due` killed by a signal while its effect runs: the attempt is retired
 * KILLED_BY_SIGNAL, a first kill holding nothing and a second in a row registered once, a normal completion settles as
 * it always has, and a dry run traps nothing.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RUN_DUE_NO_DEADLINE_RULE } from "../../../../../../cli/commands/automation/runDueSignal.js";
import { EXIT_DEFERRED } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import {
  readRecipeDefinitionRuns,
  recordRecipeDefinitionRun,
} from "../../../../../../live/automation/definitionRunStore.js";
import { failureFindingSlug } from "../../../../../../live/automation/failureHold.js";
import { readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { fakeRunDueSignalProcess, runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor, firingAt, row } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due killed by a signal while its effect runs", () => {
  /** The real `store-backup-daily` row's fields: a keyless write whose unknown outcome can never be retried. */
  const backup = row({ effect: "read-write", params: { argv: ["store", "backup"] }, recipeId: "store-backup-daily" });

  /**
   * Edges whose verb dispatch is HELD on a promise the case releases, and a way to wait until the effect started —
   * so a signal lands while the effect is genuinely running, as `timeout 900` delivered one.
   */
  function heldEffect(): {
    readonly edges: ReturnType<typeof deps>;
    readonly started: Promise<void>;
    readonly release: (input: { readonly code: number }) => void;
  } {
    const injected = deps();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finish: (code: number) => void = () => undefined;
    const held = new Promise<number>((resolve) => {
      finish = resolve;
    });
    return {
      edges: {
        ...injected,
        runVerbKeepingDiagnostics: async (argv) => {
          injected.dispatched.push(argv);
          markStarted();
          return { diagnostics: "", exitCode: await held };
        },
      },
      release: ({ code }) => {
        finish(code);
      },
      started,
    };
  }

  const detail =
    "attempt 1 under recipe run-due received SIGTERM while its effect ran and was killed before it could " +
    "record an outcome; no verb child was running, so the effect ran in this process — a caller deadline or " +
    `interruption caused this; ${RUN_DUE_NO_DEADLINE_RULE}`;

  /** Run the backup row's firing at 12:05, SIGTERM it mid-effect, and answer its exit code and edges. */
  async function killedFiring({ home }: { home: string }): Promise<{
    readonly code: number;
    readonly edges: ReturnType<typeof deps>;
    readonly exits: readonly number[];
  }> {
    const { edges, release, started } = heldEffect();
    const fake = fakeRunDueSignalProcess();
    const running = runDueUnderFake({ argv: argvFor({ home }), deps: edges, signalProcess: fake.edge });
    await started;
    fake.fire({ signal: "SIGTERM" });
    // The killed effect then returns CLEAN — the settlement it would have written must not replace the death.
    release({ code: 0 });
    const code = await running;
    return { code, edges, exits: fake.exits };
  }

  it("retires a first kill KILLED_BY_SIGNAL, requests exit 143, files nothing and leaves the next slot to fire", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });

    const { code, edges, exits } = await killedFiring({ home });

    expect(code).toBe(1);
    expect(exits).toEqual([143]);
    expect(edges.registered.length).toBe(0);
    const line =
      `recipe store-backup-daily · slot ${slotIso} · DEAD LETTER · KILLED BY SIGTERM · attempt 1 was retired as ` +
      `its process exits 143 — ${RUN_DUE_NO_DEADLINE_RULE} · NOT held: a first signal kill is not the row ` +
      "failing, so the next slot fires — a second kill in a row holds it";
    expect(edges.diag).toContain(line);
    const definitions = unwrap(
      readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }),
    );
    expect(definitions["store-backup-daily"]!.watermarkIso).toBe(slotIso);
  });

  it("holds a second kill on consecutive firings, registers it once, and never settles over it", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    // The 11:00 firing died the same way, so this kill is no longer one outside event.
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: "2026-09-08T11:05:00.000Z",
        path: join(home, "live", "recipe", "definition-runs.json"),
        recipeId: "store-backup-daily",
        run: {
          exitCode: 1,
          failureCause: "KILLED_BY_SIGNAL: the 11:00 firing received SIGTERM",
          failureSlotIso: "2026-09-08T11:00:00.000Z",
          lastRunAtIso: "2026-09-08T11:05:00.000Z",
          watermarkIso: "2026-09-08T11:00:00.000Z",
        },
      }),
    );

    const { code, edges, exits } = await killedFiring({ home });

    expect(code).toBe(1);
    expect(exits).toEqual([143]);
    const stored = unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))!;
    expect(stored.outcome).toEqual({
      detail,
      kind: "dead",
      reason: "KILLED_BY_SIGNAL",
      settledAtIso: "2026-09-08T12:05:00.000Z",
    });
    expect(edges.registered.length).toBe(1);
    expect(edges.registered[0]![1]).toBe(
      `A scheduled recipe failed its ${slotIso} firing on attempt 1 (KILLED_BY_SIGNAL) and is held until this is fixed; take it with slopweaver automation repair store-backup-daily --row ${failureFindingSlug({ attempt: 1, recipeId: "store-backup-daily", slotIso })} --home ${home}, which prints how to explain it — ${detail}`,
    );
    const line =
      `recipe store-backup-daily · slot ${slotIso} · DEAD LETTER · KILLED BY SIGTERM · attempt 1 was retired as ` +
      `its process exits 143 — ${RUN_DUE_NO_DEADLINE_RULE} · HELD on finding ` +
      `${failureFindingSlug({ attempt: 1, recipeId: "store-backup-daily", slotIso })} until its fix lands`;
    expect(edges.diag).toContain(line);
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    // The death's cause rides the run stamp too, so the Automations page still has it once the ledger row is gone.
    expect(runs["store-backup-daily"]).toEqual({
      exitCode: 1,
      failureCause: `KILLED_BY_SIGNAL: ${detail}`,
      failureSlotIso: slotIso,
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: slotIso,
    });
  });

  it("installs the trap once and requests no exit on a normal completion and settles exactly as it always has", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    const injected = deps();
    const fake = fakeRunDueSignalProcess();

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected, signalProcess: fake.edge });

    expect(code).toBe(0);
    expect(fake.installed).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    expect(fake.exits).toEqual([]);
    expect(injected.registered).toEqual([]);
    const stored = unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))!;
    expect(stored.outcome).toEqual({ exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-08T12:05:00.000Z" });
  });

  it("keeps a failed completion's ordinary failed outcome", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    const fake = fakeRunDueSignalProcess();

    const code = await runDueUnderFake({
      argv: argvFor({ home }),
      deps: deps({ exitCode: 1 }),
      signalProcess: fake.edge,
    });

    expect(code).toBe(1);
    expect(fake.exits).toEqual([]);
    expect(unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))!.outcome!.kind).toBe("failed");
  });

  it("keeps the verb's own closing stderr on a failed firing's record, so the reason outlives the run", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    const verbDiagnostics =
      "store backup: dumping the database\n\u001b[31mstore backup: pg_dump exited 1\u001b[0m\n" +
      "store backup: connection refused on 127.0.0.1:55322\n";

    const code = await runDueUnderFake({
      argv: argvFor({ home }),
      deps: deps({ exitCode: 1, verbDiagnostics }),
      signalProcess: fakeRunDueSignalProcess().edge,
    });

    expect(code).toBe(1);
    const stored = unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))!;
    expect(stored.outcome).toMatchObject({
      detail:
        "recipe store-backup-daily · ran · slopweaver store backup · exit 1 · why: store backup: dumping the " +
        "database / store backup: pg_dump exited 1 / store backup: connection refused on 127.0.0.1:55322",
      kind: "failed",
    });
  });

  it("keeps a DEFERRED firing's closing stderr on its record too, so what it waited on is not lost", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    const verbDiagnostics =
      "store backup: deferring --apply, nothing removed: cmux workspace.list failed (timeout): no reply\n";

    const code = await runDueUnderFake({
      argv: argvFor({ home }),
      deps: deps({ exitCode: EXIT_DEFERRED, verbDiagnostics }),
      signalProcess: fakeRunDueSignalProcess().edge,
    });

    expect(code).toBe(0);
    const stored = unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))!;
    expect(stored.outcome).toMatchObject({
      detail:
        "recipe store-backup-daily · DEFERRED · slopweaver store backup · not stamped, still due · why: store " +
        "backup: deferring --apply, nothing removed: cmux workspace.list failed (timeout): no reply",
      kind: "deferred",
    });
  });

  it("prints a SUCCEEDED firing's line without a why, whatever the verb wrote on the way", async () => {
    const home = homeWith({ rows: [backup] });
    const injected = deps({ verbDiagnostics: "store backup: uploaded 3 objects\n" });

    const code = await runDueUnderFake({
      argv: argvFor({ home }),
      deps: injected,
      signalProcess: fakeRunDueSignalProcess().edge,
    });

    expect(code).toBe(0);
    expect(injected.out).toContain("recipe store-backup-daily · ran · slopweaver store backup · exit 0");
  });

  it("settles a signal that lands after the effect resolved with the REAL outcome, then exits with it", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    const injected = deps();
    const fake = fakeRunDueSignalProcess();
    // The first clock read after the effect returns is the settlement's: the signal lands while it is written,
    // as one queued behind a `spawnSync` is dispatched once the loop turns.
    let effectRan = false;
    const edges: typeof injected = {
      ...injected,
      now: () => {
        if (effectRan) {
          effectRan = false;
          fake.fire({ signal: "SIGTERM" });
        }
        return injected.now();
      },
      runVerbKeepingDiagnostics: async (argv) => {
        const ran = await injected.runVerbKeepingDiagnostics(argv);
        effectRan = true;
        return ran;
      },
    };

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: edges, signalProcess: fake.edge });

    expect(code).toBe(0);
    expect(fake.exits).toEqual([143]);
    expect(fake.diag).toEqual([
      "automation run-due · SIGTERM arrived with no run-here effect running · every settlement this process wrote stands · " +
        `exiting 143 — ${RUN_DUE_NO_DEADLINE_RULE}`,
    ]);
    expect(injected.registered).toEqual([]);
    const stored = unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))!;
    expect(stored.outcome).toEqual({ exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-08T12:05:00.000Z" });
  });

  it("traps nothing and takes no attempt under --dry-run", async () => {
    const home = homeWith({ rows: [backup] });
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    const fake = fakeRunDueSignalProcess();

    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--dry-run"] }),
      deps: deps(),
      signalProcess: fake.edge,
    });

    expect(code).toBe(0);
    expect(fake.installed).toEqual([]);
    expect(unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))).toBe(null);
  });
});
