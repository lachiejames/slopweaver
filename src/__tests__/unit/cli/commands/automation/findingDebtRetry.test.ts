/**
 * `retryOwedFindings` over a throwaway home: an owed finding is retried every tick and cleared only once the
 * board holds its row — live or archived, whatever the registrar's exit code — and one still owed is a FAILED
 * outcome. A failure hold on a finding no row carries and no debt owes is a FAILED outcome too.
 *
 * `register` is a plain function that records its argv and may write the row, never a mock.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activeFindingDebts, retryOwedFindings } from "../../../../../cli/commands/automation/findingDebtRetry.js";
import { unwrap } from "../../../../../lib/result.js";
import type { RecipeDefinition } from "../../../../../live/automation/definition.js";
import { failureFindingSlug } from "../../../../../live/automation/failureHold.js";
import {
  type FindingDebt,
  findingDebtDir,
  readFindingDebts,
  recordFindingDebt,
} from "../../../../../live/automation/findingDebt.js";
import { writeAutomationRetirements } from "../../../../../live/automation/retirementStore.js";
import { beginSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const FINDING = "recipe-failing-vanta-a1";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "debt-retry-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The debt every case owes. */
function owe(): FindingDebt {
  const debt: FindingDebt = {
    argv: ["--slug", FINDING, "--home", home],
    finding: FINDING,
    recipeId: "vanta",
    recordedIso: "2026-10-13T03:00:00.000Z",
  };
  recordFindingDebt({ debt, home });
  return debt;
}

/** Put the finding's row on the board, live or in the archive. */
function writeRow({ archived = false }: { archived?: boolean } = {}): void {
  const paths = stateHomePaths({ home });
  const dir = archived ? paths.handoverArchive : paths.handovers;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${FINDING}.md`), `---\nslug: ${FINDING}\nstatus: ready\n---\n# finding\n`, "utf8");
}

/** The vanta row, held on {@link FINDING} by a failure unless `cleared`. */
function heldRow({ cleared = false }: { cleared?: boolean } = {}): RecipeDefinition {
  const clearedBy = cleared ? { atIso: "2026-10-13T04:00:00.000Z", runSlug: "owner-answer" } : null;
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    hold: { askedIso: "2026-10-13T03:00:00.000Z", clearedBy, finding: FINDING, reason: "failed" },
    kind: "resync-corpus",
    onMissed: "skip",
    params: {},
    recipeId: "vanta",
    schemaVersion: 1,
  };
}

/** A registrar answering `exit`, writing the row first when `writes`. */
function registrar({ exit, writes }: { exit: number; writes: boolean }): {
  readonly calls: (readonly string[])[];
  readonly register: (args: { readonly argv: readonly string[] }) => Promise<number>;
} {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    register: ({ argv }) => {
      calls.push(argv);
      if (writes) {
        writeRow();
      }
      return Promise.resolve(exit);
    },
  };
}

describe("retryOwedFindings", () => {
  it("registers an owed finding, clears it, and passes", async () => {
    const debt = owe();
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [], deps: edge, dryRun: false, home });

    expect(outcomes.map(({ failed, line }) => ({ failed, line }))).toEqual([
      { failed: false, line: `recipe vanta · owed finding ${FINDING} registered on retry` },
    ]);
    expect(edge.calls).toEqual([debt.argv]);
    expect(readFindingDebts({ home }).debts).toEqual([]);
  });

  it("clears a finding whose row landed though the registrar exited non-zero — a mirror failure", async () => {
    owe();
    const edge = registrar({ exit: 1, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [], deps: edge, dryRun: false, home });

    expect(outcomes.map((outcome) => outcome.failed)).toEqual([false]);
    expect(readFindingDebts({ home }).debts).toEqual([]);
  });

  it("clears a debt whose row is already on the board without registering again", async () => {
    owe();
    writeRow();
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [], deps: edge, dryRun: false, home });

    expect(outcomes.map(({ failed, line }) => ({ failed, line }))).toEqual([
      { failed: false, line: `recipe vanta · owed finding ${FINDING} is on the board — paid` },
    ]);
    expect(edge.calls).toEqual([]);
  });

  it("pays a debt whose row was archived, never re-registering finished work", async () => {
    owe();
    writeRow({ archived: true });
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [heldRow()], deps: edge, dryRun: false, home });

    expect(outcomes.map(({ failed, line }) => ({ failed, line }))).toEqual([
      { failed: false, line: `recipe vanta · owed finding ${FINDING} is on the board — paid` },
    ]);
    expect(edge.calls).toEqual([]);
    expect(readFindingDebts({ home }).debts).toEqual([]);
  });

  it("fails a finding still not on the board, and keeps it owed for the next tick", async () => {
    owe();
    const edge = registrar({ exit: 1, writes: false });

    const outcomes = await retryOwedFindings({ definitions: [heldRow()], deps: edge, dryRun: false, home });

    expect(outcomes.map(({ failed, line }) => ({ failed, line }))).toEqual([
      {
        failed: true,
        line:
          `recipe vanta · owed finding ${FINDING} still could not be registered (handover register exited 1) — ` +
          "the next run-due retries it",
      },
    ]);
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("fails a registrar that exits 0 and writes no row, keeping the debt", async () => {
    owe();

    const outcomes = await retryOwedFindings({
      definitions: [],
      deps: registrar({ exit: 0, writes: false }),
      dryRun: false,
      home,
    });

    expect(outcomes.map(({ failed, line }) => ({ failed, line }))).toEqual([
      {
        failed: true,
        line:
          `recipe vanta · owed finding ${FINDING} still could not be registered (handover register exited 0 and ` +
          "still no row by that slug is on the board) — the next run-due retries it",
      },
    ]);
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("fails a failure hold whose finding is on no row and owed no retry — the debt never wrote", async () => {
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [heldRow()], deps: edge, dryRun: false, home });

    expect(outcomes.map(({ failed, line, recipeId }) => ({ failed, line, recipeId }))).toEqual([
      {
        failed: true,
        line:
          `recipe vanta · HELD on finding ${FINDING}, which is on no board row and owed no retry — register ` +
          `a row by that slug by hand (slopweaver handover register ${FINDING} …) and the hold reads it`,
        recipeId: "vanta",
      },
    ]);
    expect(edge.calls).toEqual([]);
  });

  it("passes a failure hold whose finding is on the board, live or archived, or whose hold the owner cleared", async () => {
    const edge = registrar({ exit: 0, writes: true });
    const cleared = await retryOwedFindings({
      definitions: [heldRow({ cleared: true })],
      deps: edge,
      dryRun: false,
      home,
    });
    writeRow({ archived: true });
    const archived = await retryOwedFindings({ definitions: [heldRow()], deps: edge, dryRun: false, home });

    expect({ archived, cleared }).toEqual({ archived: [], cleared: [] });
  });

  it("does not report a hold orphaned while its debt file is there but unreadable", async () => {
    mkdirSync(findingDebtDir({ home }), { recursive: true });
    writeFileSync(join(findingDebtDir({ home }), `${FINDING}.json`), "{", "utf8");

    const outcomes = await retryOwedFindings({
      definitions: [heldRow()],
      deps: registrar({ exit: 0, writes: true }),
      dryRun: false,
      home,
    });

    expect(outcomes.map(({ failed, recipeId }) => ({ failed, recipeId }))).toEqual([
      { failed: true, recipeId: `${FINDING}.json` },
    ]);
  });

  it("fails on a debt directory that will not list, and still reports the hold it left orphaned", async () => {
    // The next tick after `slotFailureHold.test.ts`'s debt-write failure: a FILE where the directory goes.
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    writeFileSync(findingDebtDir({ home }), "", "utf8");

    const outcomes = await retryOwedFindings({
      definitions: [heldRow()],
      deps: registrar({ exit: 0, writes: true }),
      dryRun: false,
      home,
    });

    expect(outcomes.map(({ failed, recipeId }) => ({ failed, recipeId }))).toEqual([
      { failed: true, recipeId: "finding-debt" },
      { failed: true, recipeId: "vanta" },
    ]);
    expect(outcomes[0]!.line).toContain("automation run-due · owed findings unknown — ");
    expect(outcomes[1]!.line).toContain(`HELD on finding ${FINDING}, which is on no board row and owed no retry`);
  });

  it("keeps a debt owed while the path holds something that is not its row", async () => {
    owe();
    mkdirSync(join(stateHomePaths({ home }).handovers, `${FINDING}.md`), { recursive: true });

    const outcomes = await retryOwedFindings({
      definitions: [],
      deps: registrar({ exit: 1, writes: false }),
      dryRun: false,
      home,
    });

    expect(outcomes.map((outcome) => outcome.failed)).toEqual([true]);
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("fails, on a later healthy tick, a failure beneath the owner's hold that neither registered nor recorded as owed", async () => {
    const slotIso = "2026-10-13T02:00:00.000Z";
    unwrap(
      beginSlotAttempt({
        holder: "recipe run-due",
        holderPid: null,
        holderToken: "tok",
        home,
        leaseExpiresIso: "2026-10-14T00:00:00.000Z",
        nowIso: slotIso,
        processAlive: () => true,
        recipeId: "vanta",
        slotIso,
      }),
    );
    const outcome = {
      detail: "exit 1",
      kind: "dead",
      reason: "ATTEMPTS_EXHAUSTED",
      settledAtIso: "2026-10-13T03:05:00.000Z",
    } as const;
    unwrap(
      settleSlotAttempt({
        holderToken: "tok",
        home,
        nowIso: outcome.settledAtIso,
        outcome,
        recipeId: "vanta",
        slotIso,
      }),
    );
    const ownerHeld = {
      ...heldRow(),
      hold: { askedIso: "2026-10-13T03:00:00.000Z", clearedBy: null, reason: "owner" },
    };
    const finding = failureFindingSlug({ attempt: 1, recipeId: "vanta", slotIso });

    const lost = await retryOwedFindings({
      definitions: [ownerHeld],
      deps: registrar({ exit: 0, writes: true }),
      dryRun: false,
      home,
    });
    mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
    writeFileSync(
      join(stateHomePaths({ home }).handovers, `${finding}.md`),
      `---\nslug: ${finding}\nstatus: ready\n---\n`,
      "utf8",
    );
    const filed = await retryOwedFindings({
      definitions: [ownerHeld],
      deps: registrar({ exit: 0, writes: true }),
      dryRun: false,
      home,
    });

    expect(lost.map(({ failed, line }) => ({ failed, line }))).toEqual([
      {
        failed: true,
        line:
          `recipe vanta · slot ${slotIso} attempt 1 failed beneath the owner's hold, and its finding ${finding} is on ` +
          `no board row and owed no retry — register a row by that slug by hand (slopweaver handover register ${finding} …)`,
      },
    ]);
    expect(filed).toEqual([]);
  });

  it("fails on a debt file that does not read, naming it", async () => {
    mkdirSync(findingDebtDir({ home }), { recursive: true });
    writeFileSync(join(findingDebtDir({ home }), "broken.json"), "{", "utf8");

    const outcomes = await retryOwedFindings({
      definitions: [],
      deps: registrar({ exit: 0, writes: true }),
      dryRun: false,
      home,
    });

    expect(outcomes.map(({ failed, recipeId }) => ({ failed, recipeId }))).toEqual([
      { failed: true, recipeId: "broken.json" },
    ]);
  });

  it("retries nothing on a dry run, but fails it on a debt still owed", async () => {
    owe();
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [heldRow()], deps: edge, dryRun: true, home });

    expect(outcomes.map(({ failed, line }) => ({ failed, line }))).toEqual([
      { failed: true, line: `recipe vanta · owed finding ${FINDING} is owed — would be retried` },
    ]);
    expect(edge.calls).toEqual([]);
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("clears nothing on a dry run, passing a debt whose row is on the board", async () => {
    owe();
    writeRow();

    const outcomes = await retryOwedFindings({
      definitions: [heldRow()],
      deps: registrar({ exit: 0, writes: true }),
      dryRun: true,
      home,
    });

    expect(outcomes.map(({ failed, line }) => ({ failed, line }))).toEqual([
      { failed: false, line: `recipe vanta · owed finding ${FINDING} is on the board — would be paid` },
    ]);
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("fails a dry run on a failure hold whose finding neither registered nor recorded as owed", async () => {
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [heldRow()], deps: edge, dryRun: true, home });

    expect(outcomes.map(({ failed, recipeId }) => ({ failed, recipeId }))).toEqual([
      { failed: true, recipeId: "vanta" },
    ]);
    expect(outcomes[0]!.line).toContain(`HELD on finding ${FINDING}, which is on no board row and owed no retry`);
    expect(edge.calls).toEqual([]);
  });
});

/** Retire the vanta row in the home's registry. */
function retireVanta(): void {
  unwrap(
    writeAutomationRetirements({
      home,
      retirements: [
        {
          anchor: "talk:acme-turn",
          recipeId: "vanta",
          retiredAtIso: "2026-11-03T08:00:00.000Z",
          why: "not this install's",
          words: "turn it off",
        },
      ],
    }),
  );
}

describe("retryOwedFindings over a retired row", () => {
  it("leaves a retired row's debt unretried and unregistered", async () => {
    owe();
    retireVanta();
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [], deps: edge, dryRun: false, home });

    expect(outcomes).toEqual([]);
    expect(edge.calls).toEqual([]);
  });

  it("retries nothing and fails the tick when the registry will not read", async () => {
    owe();
    const path = stateHomePaths({ home }).live.recipe.retirementsJson;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{not json", "utf8");
    const edge = registrar({ exit: 0, writes: true });

    const outcomes = await retryOwedFindings({ definitions: [], deps: edge, dryRun: false, home });

    expect(outcomes.map(({ failed, recipeId }) => ({ failed, recipeId }))).toEqual([
      { failed: true, recipeId: "retirements" },
    ]);
    expect(outcomes[0]!.line).toContain("automation run-due · owed findings not retried — ");
    expect(edge.calls).toEqual([]);
  });
});

describe("activeFindingDebts", () => {
  const debt = ({ recipeId }: { recipeId: string }): FindingDebt => ({
    argv: [],
    finding: `recipe-failing-${recipeId}-a1`,
    recipeId,
    recordedIso: "2026-10-13T03:00:00.000Z",
  });

  it("drops only the retired rows' debts, in read order", () => {
    const debts = [debt({ recipeId: "a" }), debt({ recipeId: "b" }), debt({ recipeId: "c" })];
    expect(activeFindingDebts({ debts, retiredIds: new Set(["b"]) }).map((d) => d.recipeId)).toEqual(["a", "c"]);
  });

  it("keeps every debt with nothing retired", () => {
    const debts = [debt({ recipeId: "a" })];
    expect(activeFindingDebts({ debts, retiredIds: new Set() })).toEqual(debts);
  });
});
