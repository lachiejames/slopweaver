/**
 * `holdOnFailure` over a throwaway home: a failure holds the row and files ONE p0 finding, a second failure
 * while that hold stands files nothing, a finding that did not reach the board is recorded OWED under the
 * hold, and each half that does not persist says so in the line.
 *
 * `register` and `writeDiagnostic` are plain functions that record what they were handed, never mocks.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type FailureHoldDeps,
  failureFindingAsk,
  holdOnFailure,
} from "../../../../../cli/commands/automation/slotFailureHold.js";
import { MAX_SUMMARY_BYTES, summaryWrittenFit } from "../../../../../handover/summaryCap.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import { failureFindingSlug } from "../../../../../live/automation/failureHold.js";
import { readFindingDebts } from "../../../../../live/automation/findingDebt.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const RECIPE = "vanta-sync";
const SLOT = "2026-09-29T16:00:00.000Z";
const FINDING = failureFindingSlug({ attempt: 1, recipeId: RECIPE, slotIso: SLOT });

const DEFINITION: RecipeDefinition = {
  cadence: "0 * * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["atlas", "vanta", "sync"] },
  recipeId: RECIPE,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "failure-hold-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The declared main checkout the fake resolver answers. */
const CHECKOUT = "/checkouts/slopweaver";

/** Put a board row by this slug on disk — what a `handover register` that wrote its row leaves behind. */
function writeBoardRow({ slug }: { slug: string }): void {
  const dir = stateHomePaths({ home }).handovers;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n# finding\n`, "utf8");
}

/**
 * Recording edges, with `register` answering the given exit code and `checkoutFor` the given resolution. A
 * register that `writesRow` puts the row on the board whatever it exits — the real verb exits non-zero when its
 * mirror fails AFTER the row is written.
 */
function deps({
  registerExit = 0,
  checkout = ok(CHECKOUT),
  writesRow = registerExit === 0,
}: { registerExit?: number; checkout?: Result<string>; writesRow?: boolean } = {}): FailureHoldDeps & {
  readonly registered: (readonly string[])[];
  readonly diag: string[];
} {
  const registered: (readonly string[])[] = [];
  const diag: string[] = [];
  return {
    checkoutFor: () => checkout,
    diag,
    now: () => "2026-09-29T16:10:00.000Z",
    register: ({ argv }) => {
      registered.push(argv);
      if (writesRow) {
        writeBoardRow({ slug: argv[argv.indexOf("--slug") + 1]! });
      }
      return Promise.resolve(registerExit);
    },
    registered,
    writeDiagnostic: (line) => {
      diag.push(line);
    },
  };
}

/** Put the row's definition on disk, where the hold is written, carrying `hold` when one already stands. */
function writeDefinition({ hold }: { hold?: Record<string, unknown> } = {}): void {
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  const stored = hold === undefined ? DEFINITION : { ...DEFINITION, hold };
  writeFileSync(join(dir, `${RECIPE}.json`), JSON.stringify(stored), "utf8");
}

/** The definition file as it stands on disk, raw. */
function storedDefinition(): Record<string, unknown> {
  const path = join(stateHomePaths({ home }).live.recipe.definitionsDir, `${RECIPE}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** The `hold` key on disk, or `undefined` when the file carries none. */
function storedHold(): unknown {
  return storedDefinition()["hold"];
}

/** The hold's finding on disk. */
function heldOn(): string {
  return (storedHold() as { finding: string }).finding;
}

/** One failure of SLOT's first attempt. */
function fail({ edges }: { edges: FailureHoldDeps }): ReturnType<typeof holdOnFailure> {
  return holdOnFailure({
    attempt: 1,
    definition: DEFINITION,
    deps: edges,
    detail: "atlas vanta sync exited 1",
    home,
    observedBy: "recipe run-due",
    slotIso: SLOT,
    what: "exit 1",
  });
}

describe("holdOnFailure", () => {
  it("holds the row and registers ONE p0 finding under the slug the hold names", async () => {
    writeDefinition();
    const edges = deps();

    const held = await fail({ edges });

    expect(held).toEqual({ failed: false, line: `HELD on finding ${FINDING} until its fix lands` });
    expect(heldOn()).toBe(FINDING);
    expect(edges.registered).toHaveLength(1);
    const argv = edges.registered[0]!;
    expect(argv[argv.indexOf("--priority") + 1]).toBe("p0");
    expect(argv[argv.indexOf("--slug") + 1]).toBe(FINDING);
    expect(argv.includes("--finding")).toBe(true);
    // A held recipe may be the team's work, and no recipe carries a workspace, so the finding states none.
    expect(edges.registered[0]!.includes("--workspace")).toBe(false);
  });

  it("names the resolved main checkout as the finding's repo, so a seat can open on it", async () => {
    writeDefinition();
    const edges = deps();

    await fail({ edges });

    const argv = edges.registered[0]!;
    expect(argv[argv.indexOf("--repo") + 1]).toBe(CHECKOUT);
    expect(edges.diag).toEqual([]);
  });

  it("still files the finding when no checkout resolves, reports it failed and prints the set-repo fix", async () => {
    writeDefinition();
    const edges = deps({ checkout: err(["automation run-due: no declared main checkout is this repository"]) });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line: `HELD on finding ${FINDING}, which names no repo so no seat can open on it — the diagnostic above has the fix`,
    });
    expect(edges.registered).toHaveLength(1);
    expect(edges.registered[0]!.includes("--repo")).toBe(false);
    expect(edges.diag).toEqual([
      `recipe ${RECIPE} · slot ${SLOT} failed and its finding names no repo, so no seat can open on it ` +
        "(automation run-due: no declared main checkout is this repository) — give it one: " +
        `slopweaver handover set-repo ${FINDING} --repo <main checkout>`,
    ]);
  });

  it("files nothing for a second failure while the first hold stands", async () => {
    writeDefinition();
    const edges = deps();

    await fail({ edges });
    const again = await fail({ edges });

    expect(again).toEqual({ failed: false, line: `already HELD on finding ${FINDING} — no second finding filed` });
    expect(edges.registered).toHaveLength(1);
  });

  it("keeps the hold and records the finding OWED, argv and all, when no row landed", async () => {
    writeDefinition();
    const edges = deps({ registerExit: 1 });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        `HELD on finding ${FINDING}, which could not be registered (handover register exited 1) — OWED: every ` +
        "automation run-due retries it until it lands",
    });
    expect(heldOn()).toBe(FINDING);
    const owed = readFindingDebts({ home });
    expect(owed.unread).toEqual([]);
    expect(owed.debts).toEqual([
      { argv: edges.registered[0], finding: FINDING, recipeId: RECIPE, recordedIso: "2026-09-29T16:10:00.000Z" },
    ]);
    expect(edges.diag).toHaveLength(1);
    expect(edges.diag[0]).toContain("register it by hand: slopweaver handover register");
  });

  it("reads a row the registrar WROTE before exiting non-zero as filed, owing nothing", async () => {
    writeDefinition();
    const edges = deps({ registerExit: 1, writesRow: true });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line: `HELD on finding ${FINDING} until its fix lands (on the board, though handover register exited 1)`,
    });
    expect(heldOn()).toBe(FINDING);
    expect(readFindingDebts({ home }).debts).toEqual([]);
    expect(edges.diag).toEqual([]);
  });

  it("owes the finding when the registrar exits 0 and no row is on the board — the board decides, not the exit", async () => {
    writeDefinition();
    const edges = deps({ registerExit: 0, writesRow: false });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        `HELD on finding ${FINDING}, which could not be registered (handover register exited 0 and still no row ` +
        "by that slug is on the board) — OWED: every automation run-due retries it until it lands",
    });
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("keeps the hold naming the finding when the debt will not write either, so run-due reads it orphaned", async () => {
    writeDefinition();
    // A FILE where the debt directory goes, so creating the directory fails while the definition still writes.
    writeFileSync(join(stateHomePaths({ home }).live.recipe.root, "finding-debt"), "", "utf8");
    const edges = deps({ registerExit: 1 });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        `HELD on finding ${FINDING}, which could not be registered (handover register exited 1) — and its retry ` +
        "did not record either (diagnostics above); every automation run-due reports its hold orphaned until a row " +
        "by that slug is on the board",
    });
    expect(heldOn()).toBe(FINDING);
    expect(edges.diag).toHaveLength(2);
    expect(edges.diag[1]).toContain("could not write the owed finding at");
  });

  it("files the finding beneath an owner hold, which names none and outranks a failure hold", async () => {
    const ownerHold = { askedIso: "2026-09-29T15:00:00.000Z", clearedBy: null, reason: "paused while they look" };
    writeDefinition({ hold: ownerHold });
    const edges = deps();

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: false,
      line: `already HELD by the owner's own hold; finding ${FINDING} filed, so the breakage is seated while they hold it`,
    });
    expect(storedHold()).toEqual(ownerHold);
    expect(edges.registered).toHaveLength(1);
    expect(edges.registered[0]![edges.registered[0]!.indexOf("--slug") + 1]).toBe(FINDING);
  });

  it("owes the finding of a failure beneath the owner's hold that did not register, leaving that hold alone", async () => {
    const ownerHold = { askedIso: "2026-09-29T15:00:00.000Z", clearedBy: null, reason: "paused while they look" };
    writeDefinition({ hold: ownerHold });
    const edges = deps({ registerExit: 1 });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        `already HELD by the owner's own hold; finding ${FINDING} could not be registered (handover register ` +
        "exited 1) — OWED: every automation run-due retries it until it lands",
    });
    expect(storedHold()).toEqual(ownerHold);
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("still owes the finding when the hold did not write either — a dry run or a healed firing files nothing", async () => {
    const edges = deps({ registerExit: 1 });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        "NOT held (the hold did not write) — it fires again; NO finding filed either (handover register exited 1) " +
        "— OWED: every automation run-due retries it until it lands",
    });
    expect(readFindingDebts({ home }).debts.map((debt) => debt.finding)).toEqual([FINDING]);
  });

  it("says nothing durable names the finding when neither the hold, the row nor the debt wrote", async () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).live.recipe.root, "finding-debt"), "", "utf8");
    const edges = deps({ registerExit: 1 });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        "NOT held (the hold did not write) — it fires again; NO finding filed either (handover register exited 1) " +
        "— and its retry did not record either (diagnostics above); nothing durable names it now, so register it by hand",
    });
  });

  it("still files the finding when the hold cannot be written, and says the row is NOT held", async () => {
    const edges = deps();

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line: `NOT held (the hold did not write) — it fires again; finding ${FINDING} filed`,
    });
    expect(edges.registered).toHaveLength(1);
  });

  it("names the missing repo on the NOT-held line too, when neither the hold nor the checkout resolved", async () => {
    const edges = deps({ checkout: err(["no declared main checkout is this repository"]) });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        `NOT held (the hold did not write) — it fires again; finding ${FINDING} filed, naming no repo so no seat ` +
        "can open on it until it has one",
    });
  });

  it("prints both by-hand commands and owes the finding when it neither registered nor resolved a repo", async () => {
    writeDefinition();
    const edges = deps({ checkout: err(["no declared main checkout is this repository"]), registerExit: 1 });

    const held = await fail({ edges });

    expect(held).toEqual({
      failed: true,
      line:
        `HELD on finding ${FINDING}, which could not be registered, naming no repo so no seat can open on it until ` +
        "it has one (handover register exited 1) — OWED: every automation run-due retries it until it lands",
    });
    expect(edges.diag).toHaveLength(2);
    expect(edges.diag[0]).toContain(`slopweaver handover set-repo ${FINDING} --repo <main checkout>`);
    expect(edges.diag[1]).toContain("register it by hand: slopweaver handover register");
  });
});

describe("failureFindingAsk", () => {
  const base = { attempt: 1, finding: FINDING, home: "/home/acme/.slopweaver", recipeId: RECIPE, slotIso: SLOT };
  const take = `take it with slopweaver automation repair ${RECIPE} --row ${FINDING} --home /home/acme/.slopweaver, which prints how to explain it — `;

  it("writes the failure, the whole take command and the detail as they are when they fit", () => {
    expect(failureFindingAsk({ ...base, detail: "linear read: HTTP 401", what: "exit 1" })).toBe(
      `A scheduled recipe failed its ${SLOT} firing on attempt 1 (exit 1) and is held until this is fixed; ${take}linear read: HTTP 401`,
    );
  });

  it("cuts only the detail, to the most the cap holds, when the whole would be a row no seat can start", () => {
    const ask = failureFindingAsk({ ...base, detail: "x".repeat(20_000), what: "exit 1" });

    expect(summaryWrittenFit({ summary: ask }).bytes).toBe(MAX_SUMMARY_BYTES);
    expect(ask.includes(take)).toBe(true);
    expect(ask.endsWith("x…")).toBe(true);
  });

  it("still fits when the detail is multibyte and full of characters the written scalar escapes", () => {
    const ask = failureFindingAsk({ ...base, detail: '🔑"\\'.repeat(5_000), what: "exit 1" });

    expect(summaryWrittenFit({ summary: ask }).fits).toBe(true);
    expect(summaryWrittenFit({ summary: ask }).bytes).toBeGreaterThan(MAX_SUMMARY_BYTES - 8);
    expect(ask.includes(take)).toBe(true);
  });

  it("says the take in prose naming its row and home, the id cut, when the id is too long for the take to fit", () => {
    // A space makes the finding slug a digest, so only the take, never the row, is too long to print.
    const recipeId = "a b".repeat(3_000);
    const finding = failureFindingSlug({ attempt: 1, recipeId, slotIso: SLOT });

    const ask = failureFindingAsk({ ...base, detail: "linear read: HTTP 401", finding, recipeId, what: "exit 1" });

    expect(summaryWrittenFit({ summary: ask }).fits).toBe(true);
    expect(ask).toBe(
      `A scheduled recipe failed its ${SLOT} firing on attempt 1 (exit 1) and is held until this is fixed; run ` +
        `automation repair naming this recipe (its id is too long to print; it opens ${recipeId.slice(0, 199)}…), row ` +
        `${finding} and home /home/acme/.slopweaver, which prints how to explain it — linear read: HTTP 401`,
    );
    expect(ask.includes("take it with")).toBe(false);
  });

  it("prints a prose recipe id only inside the quoted take, so the command opens at one fixed place", () => {
    const recipeId = "acme; take it with rm, x";

    expect(failureFindingAsk({ ...base, detail: "d", recipeId, what: "exit 1" })).toBe(
      `A scheduled recipe failed its ${SLOT} firing on attempt 1 (exit 1) and is held until this is fixed; take it ` +
        `with slopweaver automation repair 'acme; take it with rm, x' --row ${FINDING} --home /home/acme/.slopweaver, ` +
        "which prints how to explain it — d",
    );
  });

  it("names a relative home absolute in the take, so one reading as a flag is still the store the hold wrote", () => {
    expect(failureFindingAsk({ ...base, detail: "d", home: "--state", what: "exit 1" })).toBe(
      `A scheduled recipe failed its ${SLOT} firing on attempt 1 (exit 1) and is held until this is fixed; take ` +
        `it with slopweaver automation repair ${RECIPE} --row ${FINDING} --home ${join(process.cwd(), "--state")}, ` +
        "which prints how to explain it — d",
    );
  });

  it("still fits when even the compact take cannot, by cutting the whole line", () => {
    const ask = failureFindingAsk({ ...base, detail: "d", home: `/${"h".repeat(9_000)}`, what: "exit 1" });

    expect(summaryWrittenFit({ summary: ask }).bytes).toBe(MAX_SUMMARY_BYTES);
    expect(ask.startsWith(`A scheduled recipe failed its ${SLOT} firing`)).toBe(true);
  });
});
