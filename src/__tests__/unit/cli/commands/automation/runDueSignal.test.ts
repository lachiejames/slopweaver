/**
 * `openRunDueSignalTrap` over a real slot ledger in a throwaway home, with a plain fake process edge.
 *
 * The incident: a caller's `timeout 900` SIGTERMed `automation run-due` mid-`store backup`, and the
 * firing was only read abandoned a tick later, as an `OUTCOME_UNKNOWN` naming no cause. These cases pin the
 * replacement: the first catchable signal retires that exact attempt `KILLED_BY_SIGNAL`, says so on stderr
 * and requests `128 + n`; a second signal during it exits at once and never retires twice; and one arriving after the ordinary settlement was
 * chosen, or after disarm, ends the process without touching the ledger — never dropped.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "#lib/result.js";

import {
  insistedSignalLine,
  lateSignalLine,
  openRunDueSignalTrap,
  RUN_DUE_NO_DEADLINE_RULE,
  runDueSignalExitCode,
  signalDeath,
} from "../../../../../cli/commands/automation/runDueSignal.js";
import type { RunDueVerbTermination } from "../../../../../cli/commands/automation/runDueVerbProcessPure.js";
import type { DeadLetterDeps } from "../../../../../cli/commands/automation/slotDeadLetter.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import {
  readRecipeDefinitionRuns,
  recordRecipeDefinitionRun,
} from "../../../../../live/automation/definitionRunStore.js";
import { failureFindingSlug } from "../../../../../live/automation/failureHold.js";
import type { RecipeSlotAttempt } from "../../../../../live/automation/slotAttempt.js";
import { beginSlotAttempt, readSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { writeRegisteredRow } from "../../../../registeredRowFake.js";
import { fakeRunDueSignalProcess } from "../../../../runDueSignalFake.js";

const SLOT = "2026-09-27T07:00:00.000Z";
const NOW = "2026-09-27T07:14:00.000Z";

/** The real `store-backup-daily` row's shape: a keyless write, so an unknown outcome could never be retried. */
const BACKUP: RecipeDefinition = {
  cadence: "0 17 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["store", "backup"] },
  recipeId: "store-backup-daily",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/**
 * A throwaway home holding one open attempt at the backup's firing, as `automation run-due` takes it — its previous
 * day's firing already killed the same way, so a kill here is the second in a row and HOLDS the row: a first kill
 * holds nothing (`live/automation/signalKillGrace.ts`, `./runDue/signal.test.ts`), and these cases are about the
 * retirement and its one finding.
 */
function heldAttempt(): { readonly home: string; readonly attempt: RecipeSlotAttempt } {
  const home = mkdtempSync(join(tmpdir(), "rds-"));
  homes.push(home);
  const definitions = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(definitions, { recursive: true });
  writeFileSync(join(definitions, `${BACKUP.recipeId}.json`), JSON.stringify(BACKUP), "utf8");
  unwrap(
    recordRecipeDefinitionRun({
      home,
      nowIso: "2026-09-26T07:14:00.000Z",
      path: stateHomePaths({ home }).live.recipe.definitionRunsJson,
      recipeId: BACKUP.recipeId,
      run: {
        exitCode: 1,
        failureCause: "KILLED_BY_SIGNAL: the previous day's firing received SIGTERM",
        failureSlotIso: "2026-09-26T07:00:00.000Z",
        lastRunAtIso: "2026-09-26T07:14:00.000Z",
        watermarkIso: "2026-09-26T07:00:00.000Z",
      },
    }),
  );
  const taken = unwrap(
    beginSlotAttempt({
      holder: "recipe run-due",
      holderPid: 4242,
      holderToken: "tok-held",
      home,
      leaseExpiresIso: "2026-09-28T07:00:00.000Z",
      nowIso: "2026-09-27T07:00:05.000Z",
      processAlive: () => true,
      recipeId: BACKUP.recipeId,
      slotIso: SLOT,
    }),
  );
  if (taken.kind !== "taken") {
    throw new Error(`the fixture expected to take the firing, got ${taken.kind}`);
  }
  return { attempt: taken.attempt, home };
}

/** Recording dead-letter edges. */
function recordingDeps(): DeadLetterDeps & {
  readonly diag: string[];
  readonly registered: (readonly string[])[];
} {
  const diag: string[] = [];
  const registered: (readonly string[])[] = [];
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    diag,
    now: () => NOW,
    register: ({ argv }) => {
      registered.push(argv);
      writeRegisteredRow({ argv });
      return Promise.resolve(0);
    },
    registered,
    writeDiagnostic: (line) => diag.push(line),
  };
}

/** The detail the SIGTERM death carries onto the record, spelled out once so every case asserts the same bytes. */
const SIGTERM_DETAIL =
  "attempt 1 under recipe run-due received SIGTERM while its effect ran and was killed before it could record " +
  "an outcome; no verb child was running, so the effect ran in this process — a caller deadline or interruption " +
  "caused this; automation run-due must never be wrapped in a deadline — run it in the background with the Bash " +
  "tool's timeout at its 7200000 maximum";

/** The finding the SIGTERM death files under. */
const FINDING = failureFindingSlug({ attempt: 1, recipeId: "store-backup-daily", slotIso: SLOT });

/** The summary the SIGTERM death registers its finding under, its take naming the home it ran against. */
function sigtermSummary({ home }: { home: string }): string {
  return (
    `A scheduled recipe failed its ${SLOT} firing on attempt 1 (KILLED_BY_SIGNAL) and is held until ` +
    `this is fixed; take it with slopweaver automation repair store-backup-daily --row ${FINDING} --home ${home}, ` +
    `which prints how to explain it — ${SIGTERM_DETAIL}`
  );
}

describe("runDueSignalExitCode", () => {
  it("answers 128 plus the signal's number, as a shell reports the same death", () => {
    expect(runDueSignalExitCode({ signal: "SIGHUP" })).toBe(129);
    expect(runDueSignalExitCode({ signal: "SIGINT" })).toBe(130);
    expect(runDueSignalExitCode({ signal: "SIGTERM" })).toBe(143);
  });
});

describe("signalDeath", () => {
  it("names the signal, the attempt and the no-deadline rule", () => {
    const { attempt } = heldAttempt();
    expect(signalDeath({ attempt, signal: "SIGTERM", termination: { kind: "none-running" } })).toEqual({
      detail: SIGTERM_DETAIL,
      what: `KILLED BY SIGTERM · attempt 1 was retired as its process exits 143 — ${RUN_DUE_NO_DEADLINE_RULE}`,
    });
  });

  it("says on the record whether the verb child was killed, had already exited, or could not be confirmed dead", () => {
    const { attempt } = heldAttempt();
    const detailFor = ({ termination }: { termination: RunDueVerbTermination }): string =>
      signalDeath({ attempt, signal: "SIGTERM", termination }).detail;
    expect(detailFor({ termination: { kind: "killed", pid: 4242, scope: "group" } })).toContain(
      "was killed before it could record an outcome; its verb child (pid 4242) and that child's process group were " +
        "sent SIGKILL — a caller deadline",
    );
    expect(detailFor({ termination: { kind: "killed", pid: 4242, scope: "process" } })).toContain(
      "; its verb child (pid 4242), which shares its caller's process group, was sent SIGKILL — ",
    );
    expect(detailFor({ termination: { kind: "already-finished", pid: 4242, scope: "group" } })).toContain(
      "; its verb child (pid 4242) had already exited — ",
    );
    expect(detailFor({ termination: { kind: "kill-failed", message: "EPERM", pid: 4242, scope: "group" } })).toContain(
      "; sending SIGKILL to its verb child's process group (pid 4242) failed (EPERM), so that child's death is NOT confirmed — ",
    );
    expect(
      detailFor({ termination: { kind: "kill-failed", message: "EPERM", pid: 4242, scope: "process" } }),
    ).toContain(
      "; sending SIGKILL to its verb child (pid 4242) failed (EPERM), so that child's death is NOT confirmed — ",
    );
  });
});

describe("openRunDueSignalTrap", () => {
  it("installs nothing until the first arm, then one handler per signal that no later arm or disarm adds to or removes", () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const trap = openRunDueSignalTrap({ signalProcess: fake.edge });
    expect(fake.installed).toEqual([]);

    const first = trap.arm({ attempt, definition: BACKUP, deps: recordingDeps(), home });
    expect(first.chooseSettlement()).toBe(null);
    first.disarm();
    trap.arm({ attempt, definition: BACKUP, deps: recordingDeps(), home }).disarm();

    expect(fake.installed).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    expect(fake.exits).toEqual([]);
  });

  it("retires the held attempt KILLED_BY_SIGNAL on the first SIGTERM, says so on stderr, then exits 143", async () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const deps = recordingDeps();
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({ attempt, definition: BACKUP, deps, home });

    fake.fire({ signal: "SIGTERM" });
    const settlement = await guard.chooseSettlement()!;

    const line =
      `recipe store-backup-daily · slot ${SLOT} · DEAD LETTER · KILLED BY SIGTERM · attempt 1 was retired as its ` +
      `process exits 143 — ${RUN_DUE_NO_DEADLINE_RULE} · HELD on finding ${FINDING} until its fix lands`;
    expect(settlement).toEqual({ failed: true, line });
    expect(deps.diag).toEqual([line]);
    expect(fake.exits).toEqual([143]);
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome).toEqual({
      detail: SIGTERM_DETAIL,
      kind: "dead",
      reason: "KILLED_BY_SIGNAL",
      settledAtIso: NOW,
    });
    expect(deps.registered.length).toBe(1);
    expect(deps.registered[0]![1]).toBe(sigtermSummary({ home }));
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs[BACKUP.recipeId]).toEqual({
      exitCode: 1,
      failureCause: `KILLED_BY_SIGNAL: ${SIGTERM_DETAIL}`,
      failureSlotIso: SLOT,
      lastRunAtIso: NOW,
      watermarkIso: SLOT,
    });
  });

  it("still retires, names the by-hand row and exits 143 when registering the board row THROWS", async () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const deps = { ...recordingDeps(), register: () => Promise.reject(new Error("board unavailable")) };
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({ attempt, definition: BACKUP, deps, home });

    fake.fire({ signal: "SIGTERM" });
    const settlement = await guard.chooseSettlement()!;

    const line =
      `recipe store-backup-daily · slot ${SLOT} · DEAD LETTER · KILLED BY SIGTERM · attempt 1 was retired as its ` +
      `process exits 143 — ${RUN_DUE_NO_DEADLINE_RULE} · HELD on finding ${FINDING}, which could not be ` +
      "registered (handover register threw: board unavailable) — OWED: every automation run-due retries it until " +
      "it lands";
    expect(settlement).toEqual({ failed: true, line });
    expect(deps.diag.length).toBe(2);
    expect(deps.diag[0]).toContain(
      `recipe store-backup-daily · slot ${SLOT} failed and its finding could not be registered (handover ` +
        `register threw: board unavailable) — register it by hand: slopweaver handover register "--ask" ` +
        JSON.stringify(sigtermSummary({ home })),
    );
    expect(deps.diag[1]).toBe(line);
    expect(fake.exits).toEqual([143]);
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome!.kind).toBe("dead");
  });

  it("gives a NESTED arm an inert guard, so one signal retires only the outermost attempt and exits once", async () => {
    const outer = heldAttempt();
    const inner = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const deps = recordingDeps();
    const trap = openRunDueSignalTrap({ signalProcess: fake.edge });
    const outerGuard = trap.arm({ attempt: outer.attempt, definition: BACKUP, deps, home: outer.home });
    const innerGuard = trap.arm({ attempt: inner.attempt, definition: BACKUP, deps, home: inner.home });

    expect(innerGuard.chooseSettlement()).toBe(null);
    fake.fire({ signal: "SIGTERM" });
    // Once the outer retirement started, the nested tick is handed THAT promise to wait on, never a go-ahead.
    const retiring = outerGuard.chooseSettlement();
    expect(innerGuard.chooseSettlement()).toBe(retiring);
    innerGuard.disarm();
    await retiring;

    expect(fake.exits).toEqual([143]);
    expect(deps.registered.length).toBe(1);
    expect(unwrap(readSlotAttempt({ home: outer.home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome!.kind).toBe(
      "dead",
    );
    expect(unwrap(readSlotAttempt({ home: inner.home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome).toBe(null);
  });

  it("maps SIGINT to exit 130 and names it on the record", async () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({
      attempt,
      definition: BACKUP,
      deps: recordingDeps(),
      home,
    });

    fake.fire({ signal: "SIGINT" });
    await guard.chooseSettlement();

    expect(fake.exits).toEqual([130]);
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome).toEqual({
      detail: SIGTERM_DETAIL.replace("received SIGTERM", "received SIGINT"),
      kind: "dead",
      reason: "KILLED_BY_SIGNAL",
      settledAtIso: NOW,
    });
  });

  it("exits at once on a second signal while a board registration that never settles holds the retirement, retiring and registering once", () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const registered: (readonly string[])[] = [];
    const deps: DeadLetterDeps = {
      ...recordingDeps(),
      register: ({ argv }) => {
        registered.push(argv);
        return new Promise<number>(() => undefined);
      },
    };
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({ attempt, definition: BACKUP, deps, home });

    fake.fire({ signal: "SIGTERM" });
    const first = guard.chooseSettlement();
    fake.fire({ signal: "SIGINT" });
    guard.disarm();
    fake.fire({ signal: "SIGTERM" });

    expect(guard.chooseSettlement()).toBe(first);
    expect(registered.length).toBe(1);
    expect(fake.exits).toEqual([130]);
    expect(fake.diag).toEqual([insistedSignalLine({ signal: "SIGINT" })]);
    // The ledger half of the first retirement is synchronous, so the insisted exit leaves it already written.
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome!.kind).toBe("dead");
  });

  it("requests no second exit when a retirement finishes after an insisted exit", async () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const deps = recordingDeps();
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({ attempt, definition: BACKUP, deps, home });

    fake.fire({ signal: "SIGTERM" });
    fake.fire({ signal: "SIGHUP" });
    await guard.chooseSettlement();

    expect(fake.exits).toEqual([129]);
    expect(deps.registered.length).toBe(1);
  });

  it("keeps a signal that arrives once the ordinary settlement is chosen, and exits with it at disarm", () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const deps = recordingDeps();
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({ attempt, definition: BACKUP, deps, home });
    expect(guard.chooseSettlement()).toBe(null);

    fake.fire({ signal: "SIGTERM" });
    // The ordinary settlement is still being written: nothing may exit or retire underneath it.
    expect(fake.exits).toEqual([]);

    guard.disarm();

    expect(fake.exits).toEqual([143]);
    expect(fake.diag).toEqual([lateSignalLine({ signal: "SIGTERM" })]);
    expect(deps.registered).toEqual([]);
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome).toBe(null);
  });

  it("exits at once on a SECOND signal while an ordinary settlement is still writing, never touching the ledger", () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const deps = recordingDeps();
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({ attempt, definition: BACKUP, deps, home });
    expect(guard.chooseSettlement()).toBe(null);

    // A settlement whose dead-letter registration hangs never reaches disarm; the caller's second signal ends it.
    fake.fire({ signal: "SIGTERM" });
    fake.fire({ signal: "SIGHUP" });
    guard.disarm();

    expect(fake.exits).toEqual([129]);
    expect(fake.diag).toEqual([insistedSignalLine({ signal: "SIGHUP" })]);
    expect(deps.registered).toEqual([]);
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome).toBe(null);
  });

  it("SIGKILLs the verb child before the retirement is written, once, however many signals follow", async () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess({ child: { kind: "killed", pid: 4242, scope: "group" } });
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({
      attempt,
      definition: BACKUP,
      deps: recordingDeps(),
      home,
    });

    fake.fire({ signal: "SIGTERM" });
    fake.fire({ signal: "SIGINT" });
    await guard.chooseSettlement();

    expect(fake.childEnds).toEqual([{ kind: "killed", pid: 4242, scope: "group" }]);
    expect(fake.exits).toEqual([130]);
    expect(unwrap(readSlotAttempt({ home, recipeId: BACKUP.recipeId, slotIso: SLOT }))!.outcome).toEqual({
      detail: SIGTERM_DETAIL.replace(
        "no verb child was running, so the effect ran in this process",
        "its verb child (pid 4242) and that child's process group were sent SIGKILL",
      ),
      kind: "dead",
      reason: "KILLED_BY_SIGNAL",
      settledAtIso: NOW,
    });
  });

  it("installs on install() with no arm, so a seated row's unarmed child is killed by a signal and named", () => {
    const fake = fakeRunDueSignalProcess({ child: { kind: "killed", pid: 4242, scope: "group" } });
    const trap = openRunDueSignalTrap({ signalProcess: fake.edge });
    trap.install();
    trap.install();
    expect(fake.installed).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);

    fake.fire({ signal: "SIGTERM" });

    expect(fake.childEnds).toEqual([{ kind: "killed", pid: 4242, scope: "group" }]);
    expect(fake.exits).toEqual([143]);
    expect(fake.diag).toEqual([
      `${lateSignalLine({ signal: "SIGTERM" })} · its verb child (pid 4242) and that child's process group were sent SIGKILL`,
    ]);
  });

  it("exits at once on a signal dispatched after disarm, rather than dropping it", () => {
    const { attempt, home } = heldAttempt();
    const fake = fakeRunDueSignalProcess();
    const guard = openRunDueSignalTrap({ signalProcess: fake.edge }).arm({
      attempt,
      definition: BACKUP,
      deps: recordingDeps(),
      home,
    });
    expect(guard.chooseSettlement()).toBe(null);
    guard.disarm();
    expect(fake.exits).toEqual([]);

    fake.fire({ signal: "SIGHUP" });

    expect(fake.exits).toEqual([129]);
    expect(fake.diag).toEqual([
      "automation run-due · SIGHUP arrived with no run-here effect running · every settlement this process wrote stands · " +
        `exiting 129 — ${RUN_DUE_NO_DEADLINE_RULE}`,
    ]);
  });
});
