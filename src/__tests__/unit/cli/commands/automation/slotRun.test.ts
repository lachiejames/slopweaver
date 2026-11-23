/**
 * `settleSlot`'s failure arms over a throwaway home: a failure HOLDS the row and files one finding whose
 * settlement lifts it; a death is written, stamped and held only onto the attempt that was judged, and a
 * firing that moved under the caller is left exactly as found.
 *
 * `register` and `writeDiagnostic` are plain functions that record what they were handed, never mocks.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SlotRunDeps, takeSlot } from "../../../../../cli/commands/automation/slotRun.js";
import { settleSlot } from "../../../../../cli/commands/automation/slotSettle.js";
import { heldSinceRead, holdStranded } from "../../../../../cli/commands/automation/slotStranded.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import {
  readRecipeDefinitionRuns,
  recordRecipeDefinitionRun,
} from "../../../../../live/automation/definitionRunStore.js";
import { failureFindingSlug } from "../../../../../live/automation/failureHold.js";
import { placeFailureHold, rowHeldNow } from "../../../../../live/automation/failureHoldStore.js";
import { readFindingDebts } from "../../../../../live/automation/findingDebt.js";
import {
  MAX_ATTEMPTS_PER_SLOT,
  openSlotAttempt,
  type RecipeSlotAttempt,
} from "../../../../../live/automation/slotAttempt.js";
import { beginSlotAttempt, readSlotAttempt, slotAttemptKey } from "../../../../../live/automation/slotLedger.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { writeRegisteredRow } from "../../../../registeredRowFake.js";

const RECIPE = "store-backup-daily";
const SLOT = "2026-09-26T17:00:00.000Z";
const LEASE = "2026-09-27T17:00:00.000Z";
const NOW = "2026-09-26T18:00:00.000Z";

const DEFINITION: RecipeDefinition = {
  cadence: "0 17 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["store", "backup"] },
  recipeId: RECIPE,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

/** The attempt the settling caller believes it holds: the last one this firing gets. */
const HELD = openSlotAttempt({
  attempt: MAX_ATTEMPTS_PER_SLOT,
  holder: "recipe run-due",
  holderPid: 4242,
  holderToken: "tok-a",
  leaseExpiresIso: LEASE,
  nowIso: "2026-09-26T17:05:00.000Z",
  recipeId: RECIPE,
  slotIso: SLOT,
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slot-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Recording edges: every register argv and every diagnostic line. */
function deps(): SlotRunDeps & { readonly registered: (readonly string[])[]; readonly diag: string[] } {
  const registered: (readonly string[])[] = [];
  const diag: string[] = [];
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    diag,
    mintId: () => "tok-minted",
    now: () => NOW,
    processAlive: () => true,
    register: async ({ argv }) => {
      registered.push(argv);
      writeRegisteredRow({ argv });
      return 0;
    },
    registered,
    writeDiagnostic: (line) => {
      diag.push(line);
    },
  };
}

/** Put the caller's own attempt on the ledger, exactly as a take would have written it. */
function writeHeld({ contents = JSON.stringify(HELD) }: { contents?: string } = {}): void {
  const dir = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })}.json`), contents, "utf8");
}

const runsPath = (): string => stateHomePaths({ home }).live.recipe.definitionRunsJson;

/** Put the row's definition on disk, where a failure hold is written. */
function writeDefinition(): void {
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${RECIPE}.json`), JSON.stringify(DEFINITION), "utf8");
}

/** Put a board row for `slug` on disk, settled as given — the full front-matter a real finding carries. */
function boardRow({ slug, settlement }: { slug: string; settlement: "answered" | "declined" }): void {
  const dir = stateHomePaths({ home }).handovers;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${slug}.md`),
    [
      "---",
      `slug: ${slug}`,
      "kind: ask",
      'summary: "a recipe failed"',
      "status: ready",
      "askedIso: 2026-09-26T18:00:00.000Z",
      "origin: finding",
      "observedBy: recipe run-due",
      "evidence: [a log line]",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      `settlement: ${settlement}`,
      "settlementWitness: '#1580'",
      'settlementReason: "their reason"',
      "---",
      "# finding",
      "",
    ].join("\n"),
  );
}

/** The failure hold on disk, or `undefined` when the row carries none. */
function holdOnDisk(): { readonly finding?: string; readonly reason: string } | undefined {
  const path = join(stateHomePaths({ home }).live.recipe.definitionsDir, `${RECIPE}.json`);
  return (JSON.parse(readFileSync(path, "utf8")) as { hold?: { finding?: string; reason: string } }).hold;
}

/** The finding the attempt-`n` failure of SLOT files under. */
const findingOf = ({ attempt }: { attempt: number }): string =>
  failureFindingSlug({ attempt, recipeId: RECIPE, slotIso: SLOT });

/** The caller's own attempt at attempt `n`, on the ledger. */
function heldAt({ attempt }: { attempt: number }): RecipeSlotAttempt {
  const held = { ...HELD, attempt };
  writeHeld({ contents: JSON.stringify(held) });
  return held;
}

describe("settleSlot — a failure HOLDS the row and files one finding", () => {
  it("holds the row on its first failure and registers ONE p0 finding naming the fix that lifts it", async () => {
    writeDefinition();
    const attempt = heldAt({ attempt: 1 });
    const edges = deps();

    const settled = await settleSlot({
      attempt,
      definition: DEFINITION,
      deps: edges,
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    expect(settled).toEqual({
      failed: false,
      line:
        `recipe ${RECIPE} · slot ${SLOT} · attempt 1 of 3 failed — not stamped · HELD on finding ${findingOf({ attempt: 1 })} ` +
        "until its fix lands",
    });
    expect(holdOnDisk()!.finding).toBe(findingOf({ attempt: 1 }));
    expect(edges.registered.length).toBe(1);
    expect(edges.registered[0]).toEqual(
      expect.arrayContaining(["--finding", "--slug", findingOf({ attempt: 1 }), "--priority", "p0"]),
    );
    expect(rowHeldNow({ home, recipeId: RECIPE })).toContain(`its finding ${findingOf({ attempt: 1 })}`);
    expect(unwrap(readRecipeDefinitionRuns({ path: runsPath() }))).toEqual({});
  });

  it("files NO second finding when a held row fails again — the standing hold already names it", async () => {
    writeDefinition();
    await settleSlot({
      attempt: heldAt({ attempt: 1 }),
      definition: DEFINITION,
      deps: deps(),
      detail: "exit 1",
      exitCode: 1,
      home,
    });
    const edges = deps();

    const settled = await settleSlot({
      attempt: heldAt({ attempt: 2 }),
      definition: DEFINITION,
      deps: edges,
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    expect(settled.line).toContain(`already HELD on finding ${findingOf({ attempt: 1 })} — no second finding filed`);
    expect(edges.registered).toEqual([]);
    expect(holdOnDisk()!.finding).toBe(findingOf({ attempt: 1 }));
  });

  it("lifts the hold once the finding is settled answered", async () => {
    writeDefinition();
    await settleSlot({
      attempt: heldAt({ attempt: 1 }),
      definition: DEFINITION,
      deps: deps(),
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    boardRow({ settlement: "answered", slug: findingOf({ attempt: 1 }) });

    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe(null);
  });

  it("keeps the hold when the finding is settled declined", async () => {
    writeDefinition();
    await settleSlot({
      attempt: heldAt({ attempt: 1 }),
      definition: DEFINITION,
      deps: deps(),
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    boardRow({ settlement: "declined", slug: findingOf({ attempt: 1 }) });

    expect(rowHeldNow({ home, recipeId: RECIPE })).toContain("settled declined");
  });

  it("keeps the hold, owes the finding and prints the by-hand argv when it could not be registered", async () => {
    writeDefinition();
    const edges = { ...deps(), register: async (): Promise<number> => 1 };
    const diag: string[] = [];

    const settled = await settleSlot({
      attempt: heldAt({ attempt: 1 }),
      definition: DEFINITION,
      deps: { ...edges, writeDiagnostic: (line) => void diag.push(line) },
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    expect(settled.failed).toBe(true);
    expect(settled.line).toContain(
      `HELD on finding ${findingOf({ attempt: 1 })}, which could not be registered (handover register exited 1) — OWED`,
    );
    expect(holdOnDisk()!.finding).toBe(findingOf({ attempt: 1 }));
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([findingOf({ attempt: 1 })]);
    expect(diag.length).toBe(1);
    expect(diag[0]).toContain(`register it by hand: slopweaver handover register "--ask"`);
    expect(diag[0]).toContain(`"--slug" "${findingOf({ attempt: 1 })}"`);
  });

  it("still files the finding and says NOT held when the row has no definition to hold", async () => {
    const edges = deps();

    const settled = await settleSlot({
      attempt: heldAt({ attempt: 1 }),
      definition: DEFINITION,
      deps: edges,
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    expect(settled.failed).toBe(true);
    expect(settled.line).toContain(
      `NOT held (the hold did not write) — it fires again; finding ${findingOf({ attempt: 1 })} filed`,
    );
    expect(edges.registered.length).toBe(1);
    expect(edges.diag[0]).toContain("could not hold the row");
  });
});

describe("takeSlot — a row held since the roster was read", () => {
  it("refuses the take without failing, naming the hold, and writes nothing to the ledger", async () => {
    writeDefinition();
    await settleSlot({
      attempt: heldAt({ attempt: 1 }),
      definition: DEFINITION,
      deps: deps(),
      detail: "exit 1",
      exitCode: 1,
      home,
    });
    const before = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }));

    const take = await takeSlot({
      definition: DEFINITION,
      deps: deps(),
      holder: "recipe run-due",
      holderPid: 4242,
      home,
      slotIso: SLOT,
    });

    expect(take).toMatchObject({
      died: false,
      failed: false,
      kind: "refused",
      line: expect.stringContaining("HELD since the roster was read") as unknown,
    });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toEqual(before);
  });

  it("answers null for a row with no hold, so the take goes on", () => {
    writeDefinition();

    expect(heldSinceRead({ definition: DEFINITION, home, slotIso: SLOT })).toBe(null);
  });
});

describe("holdStranded", () => {
  it("answers null over an empty ledger, writing no hold", async () => {
    writeDefinition();

    const stranded = await holdStranded({
      definition: DEFINITION,
      deps: deps(),
      holder: "recipe run-due",
      home,
      nowIso: "2026-09-26T18:30:00.000Z",
      slotIso: "2026-09-26T18:00:00.000Z",
    });

    expect(stranded).toBe(null);
    expect(holdOnDisk()).toBe(undefined);
  });
});

describe("takeSlot — an earlier firing's run that started and died unjudged", () => {
  /**
   * An hourly row, so SLOT is one of its firings in any whole-hour timezone — cron reads the process's own
   * zone, and `0 17 * * *` fires at 17:00 LOCAL. It only READS, so a stranded run is `HOLDER_GONE` rather than
   * the keyless write's `OUTCOME_UNKNOWN`, which is judged first.
   */
  const HOURLY: RecipeDefinition = { ...DEFINITION, cadence: "0 * * * *", effect: "read" };
  /** The next firing, taken half an hour after it fired — past the stranded attempt's own lease. */
  const NEXT = "2026-09-26T18:00:00.000Z";
  const LATER = "2026-09-26T18:30:00.000Z";

  /** SLOT's first attempt: it started its run under a pid and leased the firing until NEXT. */
  function strandedOnSlot(): void {
    writeHeld({ contents: JSON.stringify({ ...HELD, attempt: 1, leaseExpiresIso: NEXT }) });
  }

  /** A take of NEXT, with the stranded attempt's holder answering as given. */
  function takeNext({ alive }: { alive: boolean }): ReturnType<typeof takeSlot> {
    return takeSlot({
      definition: HOURLY,
      deps: { ...deps(), now: () => LATER, processAlive: () => alive },
      holder: "recipe run-due",
      holderPid: 5151,
      home,
      slotIso: NEXT,
    });
  }

  it("judges it HOLDER_GONE, holds the row on ITS finding, and takes nothing for the firing it was due for", async () => {
    writeDefinition();
    strandedOnSlot();

    const take = await takeNext({ alive: false });

    expect(take).toMatchObject({ died: true, kind: "refused" });
    const stranded = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    expect(stranded.outcome).toMatchObject({ kind: "dead", reason: "HOLDER_GONE" });
    expect(holdOnDisk()!.finding).toBe(findingOf({ attempt: 1 }));
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: NEXT }))).toBe(null);
  });

  it("passes over a holder that still runs past its lease, and takes the firing it was due for", async () => {
    writeDefinition();
    strandedOnSlot();

    const take = await takeNext({ alive: true });

    expect(take.kind).toBe("taken");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome).toBe(null);
    expect(holdOnDisk()).toBe(undefined);
  });

  it("still finds a run that died AFTER its successor succeeded and stamped the watermark past it", async () => {
    writeDefinition();
    strandedOnSlot();
    // NEXT ran and succeeded while SLOT's run was still going, so the watermark stands past SLOT.
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: LATER,
        path: runsPath(),
        recipeId: RECIPE,
        run: { exitCode: 0, lastRunAtIso: LATER, watermarkIso: NEXT },
      }),
    );

    const take = await takeSlot({
      definition: HOURLY,
      deps: { ...deps(), now: () => "2026-09-26T19:30:00.000Z", processAlive: () => false },
      holder: "recipe run-due",
      holderPid: 5151,
      home,
      slotIso: "2026-09-26T19:00:00.000Z",
    });

    expect(take).toMatchObject({ died: true, kind: "refused" });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome).toMatchObject({
      kind: "dead",
      reason: "HOLDER_GONE",
    });
    expect(holdOnDisk()!.finding).toBe(findingOf({ attempt: 1 }));
  });

  /**
   * The measured sequence on `resync-corpus-github`: one outage stranded two firings, the newer one's
   * death held the row, its finding was answered with the fix — and the next take re-held the row on the OLDER
   * death of the same outage.
   */
  const EARLIER_FINDING = failureFindingSlug({ attempt: 1, recipeId: RECIPE, slotIso: "2026-09-26T16:00:00.000Z" });

  /** The row held on an earlier firing's finding at `atIso`, and that finding settled answered. */
  function liftedHoldPlacedAt({ atIso }: { atIso: string }): void {
    unwrap(
      placeFailureHold({
        finding: EARLIER_FINDING,
        home,
        nowIso: atIso,
        reason: "held by the store",
        recipeId: RECIPE,
      }),
    );
    boardRow({ settlement: "answered", slug: EARLIER_FINDING });
  }

  it("takes the firing it was due for when the stranded run was taken BEFORE a failure hold its fix since lifted", async () => {
    writeDefinition();
    strandedOnSlot();
    // SLOT's run was taken first; the hold its outage earned was placed after it and has been answered.
    liftedHoldPlacedAt({ atIso: "2026-09-26T17:30:00.000Z" });

    const take = await takeNext({ alive: false });

    expect(take.kind).toBe("taken");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome).toBe(null);
    expect(holdOnDisk()!.finding).toBe(EARLIER_FINDING);
    expect(rowHeldNow({ home, recipeId: RECIPE })).toBe(null);
  });

  it("still holds the row on a stranded run taken AFTER the lifted failure hold was placed", async () => {
    writeDefinition();
    liftedHoldPlacedAt({ atIso: "2026-09-26T16:30:00.000Z" });
    strandedOnSlot();

    const take = await takeNext({ alive: false });

    expect(take).toMatchObject({ died: true, kind: "refused" });
    expect(holdOnDisk()!.finding).toBe(findingOf({ attempt: 1 }));
  });

  it("takes the firing when the owner's clearedBy released a DECLINED failure hold placed after the stranded run", async () => {
    // A declined finding lifts only on the owner's word, and that word is to run the row: an older death it covered
    // must not hold the row straight back.
    const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(dir, { recursive: true });
    const hold = {
      askedIso: "2026-09-26T17:30:00.000Z",
      clearedBy: { atIso: "2026-09-26T18:10:00.000Z", runSlug: "run-the-row-anyway" },
      finding: EARLIER_FINDING,
      reason: "held by the store",
    };
    writeFileSync(join(dir, `${RECIPE}.json`), JSON.stringify({ ...DEFINITION, hold }), "utf8");
    boardRow({ settlement: "declined", slug: EARLIER_FINDING });
    strandedOnSlot();

    const take = await takeNext({ alive: false });

    expect(take.kind).toBe("taken");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome).toBe(null);
    expect(holdOnDisk()!.finding).toBe(EARLIER_FINDING);
  });
});

describe("settleSlot — the last attempt failing", () => {
  it("dead-letters the caller's own attempt, stamps past the firing, holds the row and registers its finding", async () => {
    writeHeld();
    writeDefinition();
    const edges = deps();

    const settled = await settleSlot({
      attempt: HELD,
      definition: DEFINITION,
      deps: edges,
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    expect(settled).toEqual({
      failed: true,
      line:
        `recipe ${RECIPE} · slot ${SLOT} · DEAD LETTER · attempt 3 of 3 failed (exit 1) · HELD on finding ` +
        `${findingOf({ attempt: 3 })} until its fix lands`,
    });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome!.kind).toBe("dead");
    expect(unwrap(readRecipeDefinitionRuns({ path: runsPath() }))[RECIPE]!.watermarkIso).toBe(SLOT);
    expect(edges.registered.length).toBe(1);
    expect(holdOnDisk()!.finding).toBe(findingOf({ attempt: 3 }));
  });

  it("retires, stamps and registers NOTHING when another dispatcher has taken the firing since", async () => {
    unwrap(
      beginSlotAttempt({
        holder: "recipe run-due",
        holderPid: 5151,
        holderToken: "tok-b",
        home,
        leaseExpiresIso: LEASE,
        nowIso: "2026-09-26T17:50:00.000Z",
        processAlive: () => true,
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    const before = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    const edges = deps();

    const settled = await settleSlot({
      attempt: HELD,
      definition: DEFINITION,
      deps: edges,
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    expect(settled).toEqual({
      failed: false,
      line:
        `recipe ${RECIPE} · slot ${SLOT} · attempt 3 is no longer the one on the ledger — another dispatcher ` +
        "changed it first, nothing was retired",
    });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toEqual(before);
    expect(unwrap(readRecipeDefinitionRuns({ path: runsPath() }))).toEqual({});
    expect(edges.registered).toEqual([]);
    expect(edges.diag).toEqual([]);
  });

  it("stamps and registers NOTHING when the ledger could not perform the retirement at all", async () => {
    // The comparison never ran, so nothing may act as if it passed: an unreadable row is the reachable
    // stand-in for a lock busy past every wait, which answers the same Err.
    writeHeld({ contents: "{ nope" });
    const edges = deps();

    const settled = await settleSlot({
      attempt: HELD,
      definition: DEFINITION,
      deps: edges,
      detail: "exit 1",
      exitCode: 1,
      home,
    });

    expect(settled).toEqual({
      failed: true,
      line:
        `recipe ${RECIPE} · slot ${SLOT} · attempt 3 could not be retired — the diagnostic above says why; ` +
        "nothing was stamped or held, and the next tick judges it again",
    });
    expect(unwrap(readRecipeDefinitionRuns({ path: runsPath() }))).toEqual({});
    expect(edges.registered).toEqual([]);
    expect(edges.diag.length).toBe(1);
    expect(edges.diag[0]).toContain(RECIPE);
  });
});
