/*
 * `slopweaver automation repair` — the one way a stop becomes taken. It refuses a take that could not hold, since
 * a take naming a dead seat or an undefined recipe would read to the owner as fixed while nothing is.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRecipeExplain } from "../../../../../cli/commands/automation/explain.js";
import { runRecipeRepair } from "../../../../../cli/commands/automation/repair.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { readFailureExplanations } from "../../../../../live/automation/failureExplanation.js";
import { failureFindingSlug } from "../../../../../live/automation/failureHold.js";
import { readRepairTakes } from "../../../../../live/automation/repairTake.js";
import { beginSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { dailyRow, writeRecipeDefinitions } from "../../../live/automation/recipeHome.js";

const NOW_ISO = "2026-09-27T15:00:00.000Z";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "recipe-repair-"));
  out = [];
  diagnostics = [];
  writeRecipeDefinitions({ home, rows: [dailyRow()] });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Run the verb over the temp home with this tail. */
function run({ tail }: { tail: readonly string[] }): number {
  return runRecipeRepair({
    argv: ["node", "slopweaver", "recipe", "repair", ...tail, "--home", home],
    deps: {
      now: () => NOW_ISO,
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
  });
}

/** A doc for `slug` at `ready`, whose run a seat started unless `started` is false. */
function repairRow({ slug, started = true }: { slug: string; started?: boolean }): void {
  const paths = stateHomePaths({ home });
  mkdirSync(paths.handovers, { recursive: true });
  writeFileSync(join(paths.handovers, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n# repair\n`);
  if (started) {
    mkdirSync(paths.runs, { recursive: true });
    writeFileSync(
      join(paths.runs, `${slug}.jsonl`),
      `${JSON.stringify({ atIso: NOW_ISO, branch: "b", docHash: "h", kind: "started" })}\n`,
    );
  }
}

const RECIPE = "vulnfix-digest-acme-admin";
const FAILED_SLOT = "2026-09-27T02:00:00.000Z";
const FINDING = failureFindingSlug({ attempt: 1, recipeId: RECIPE, slotIso: FAILED_SLOT });

/** Take and settle one failed firing of the row, as `run-due` would have, at the slot a test names. */
function seedFailure({ slotIso = FAILED_SLOT }: { slotIso?: string } = {}): void {
  const slot = { home, nowIso: NOW_ISO, recipeId: RECIPE, slotIso };
  unwrap(
    beginSlotAttempt({
      ...slot,
      holder: "recipe run-due",
      holderPid: null,
      holderToken: "token-failed",
      leaseExpiresIso: "2026-09-28T02:00:00.000Z",
      processAlive: () => true,
    }),
  );
  unwrap(
    settleSlotAttempt({
      ...slot,
      holderToken: "token-failed",
      outcome: {
        detail: "linear read: HTTP 401 Unauthorized",
        exitCode: 1,
        kind: "failed",
        retryNotBeforeIso: "2026-09-27T03:00:00.000Z",
        settledAtIso: "2026-09-27T02:05:00.000Z",
      },
    }),
  );
}

describe("recipe repair", () => {
  it("records the take and says the owner gets a note, not a card", () => {
    repairRow({ slug: "fix-the-digest" });

    expect(run({ tail: ["vulnfix-digest-acme-admin", "--row", "fix-the-digest"] })).toBe(EXIT_OK);
    expect(out).toEqual([
      "automation repair · vulnfix-digest-acme-admin · taken by fix-the-digest — the owner sees a note, not a card, until that row is done",
      "automation repair · vulnfix-digest-acme-admin · no failed firing in the slot ledger is the one fix-the-digest names, so there is none to explain here",
    ]);
    expect(unwrap(readRepairTakes({ home })).takes).toEqual([
      { recipeId: "vulnfix-digest-acme-admin", row: "fix-the-digest", takenIso: NOW_ISO },
    ]);
  });

  it("folds a home carrying a newline onto one line when the take cannot be written", () => {
    rmSync(home, { force: true, recursive: true });
    home = mkdtempSync(join(tmpdir(), "r3\nFORGED-"));
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    repairRow({ slug: "fix-the-digest" });
    mkdirSync(stateHomePaths({ home }).live.recipe.repairsJsonl, { recursive: true });

    expect(run({ tail: [RECIPE, "--row", "fix-the-digest"] })).toBe(EXIT_ERROR);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.filter((line) => line.includes("\n"))).toEqual([]);
    expect(diagnostics[0]).toContain("cannot append to the repairs register");
  });

  it("takes nothing for a recipe id carrying a newline, since no definition with one loads", () => {
    writeRecipeDefinitions({ home, rows: [dailyRow({ recipeId: "acme\ndigest" })] });
    repairRow({ slug: "fix-the-digest" });

    expect(run({ tail: ["acme\ndigest", "--row", "fix-the-digest"] })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
  });

  it("prints the finding's unexplained failure and a command that, its --why placeholder filled in, files the sentence in this home", () => {
    repairRow({ slug: FINDING });
    seedFailure();

    expect(run({ tail: [RECIPE, "--row", FINDING] })).toBe(EXIT_OK);
    const command = `slopweaver automation explain ${RECIPE} --slot ${FAILED_SLOT} --attempt 1 --home ${home}`;
    expect(out).toEqual([
      `automation repair · ${RECIPE} · taken by ${FINDING} — the owner sees a note, not a card, until that row is done`,
      `automation repair · ${RECIPE} · the failure ${FINDING} names, firing ${FAILED_SLOT} attempt 1, has no plain sentence — no session explained it, so this one does, once it has read why:`,
      "  what it recorded: linear read: HTTP 401 Unauthorized",
      `  ${command} --why "<what broke, so what fixes it.>"`,
    ]);
    expect(diagnostics).toEqual([]);

    const why = "The sign-in expired, so reconnecting it in Setup fixes it.";
    const explained = runRecipeExplain({
      argv: ["node", ...command.split(" "), "--why", why],
      deps: { now: () => NOW_ISO, writeDiagnostic: (line) => diagnostics.push(line), writeOut: () => undefined },
    });
    expect(explained).toBe(EXIT_OK);
    expect(unwrap(readFailureExplanations({ home })).explanations).toEqual([
      { attempt: 1, recipeId: RECIPE, recordedIso: NOW_ISO, slotIso: FAILED_SLOT, why },
    ]);
    out = [];

    expect(run({ tail: [RECIPE, "--row", FINDING] })).toBe(EXIT_OK);
    expect(out).toEqual([
      `automation repair · ${RECIPE} · taken by ${FINDING} — the owner sees a note, not a card, until that row is done`,
      `automation repair · ${RECIPE} · the failure ${FINDING} names, firing ${FAILED_SLOT} attempt 1, already reads in plain words`,
    ]);
  });

  it("names no failure as unexplained while the explanations register reads only in part", () => {
    repairRow({ slug: "fix-the-digest" });
    seedFailure();
    const register = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
    mkdirSync(dirname(register), { recursive: true });
    writeFileSync(register, "{torn\n");

    expect(run({ tail: [RECIPE, "--row", "fix-the-digest"] })).toBe(EXIT_OK);
    expect(out).toEqual([
      `automation repair · ${RECIPE} · taken by fix-the-digest — the owner sees a note, not a card, until that row is done`,
      `automation repair · ${RECIPE} · the failure explanations register has unreadable line(s) 1, so no failure is named here — read it and explain the one that broke`,
    ]);
    expect(unwrap(readRepairTakes({ home })).takes).toHaveLength(1);
  });

  it("names no failure, rather than hanging, when the slot ledger holds a FIFO", () => {
    repairRow({ slug: FINDING });
    seedFailure();
    const ledger = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
    // A FIFO opened for reading blocks until a writer comes, so a reader that opened it would never return.
    expect(spawnSync("mkfifo", [join(ledger, "blocking.json")]).status).toBe(0);

    expect(run({ tail: [RECIPE, "--row", FINDING] })).toBe(EXIT_OK);
    expect(out[1]).toBe(
      `automation repair · ${RECIPE} · 1 slot ledger file(s) under ${ledger} did not decode, so the firings they record are missing from every card, so no failure is named here — read it and explain the one that broke`,
    );
    expect(out).toHaveLength(2);
  });

  it("names no failure when the finding's firing sits under a name its recipe and slot do not derive", () => {
    repairRow({ slug: FINDING });
    seedFailure();
    const ledger = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
    const [stored] = readdirSync(ledger);
    renameSync(join(ledger, stored!), join(ledger, "misnamed.json"));

    expect(run({ tail: [RECIPE, "--row", FINDING] })).toBe(EXIT_OK);
    expect(out[1]).toBe(
      `automation repair · ${RECIPE} · 1 slot ledger file(s) under ${ledger} did not decode, so the firings they record are missing from every card, so no failure is named here — read it and explain the one that broke`,
    );
  });

  it("names no failure when the finding's firing has a slot the scheduler never writes, so no command reads as help", () => {
    const forged = failureFindingSlug({ attempt: 1, recipeId: RECIPE, slotIso: "--help" });
    repairRow({ slug: forged });
    seedFailure({ slotIso: "--help" });
    const ledger = stateHomePaths({ home }).live.recipe.slotAttemptsDir;

    expect(run({ tail: [RECIPE, "--row", forged] })).toBe(EXIT_OK);
    expect(out[1]).toBe(
      `automation repair · ${RECIPE} · 1 slot ledger file(s) under ${ledger} did not decode, so the firings they record are missing from every card, so no failure is named here — read it and explain the one that broke`,
    );
  });

  it("names no failure when the finding's firing has an attempt the scheduler never writes, so no command is refused", () => {
    const forged = failureFindingSlug({ attempt: 0, recipeId: RECIPE, slotIso: FAILED_SLOT });
    repairRow({ slug: forged });
    seedFailure();
    const ledger = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
    const path = join(ledger, readdirSync(ledger)[0]!);
    writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, "utf8")) as object), attempt: 0 }));

    expect(run({ tail: [RECIPE, "--row", forged] })).toBe(EXIT_OK);
    expect(out[1]).toBe(
      `automation repair · ${RECIPE} · 1 slot ledger file(s) under ${ledger} did not decode, so the firings they record are missing from every card, so no failure is named here — read it and explain the one that broke`,
    );
  });

  it("keeps a recorded take at exit 0 when stdout closes after its own line", () => {
    repairRow({ slug: "fix-the-digest" });
    const written: string[] = [];

    const code = runRecipeRepair({
      argv: ["node", "slopweaver", "recipe", "repair", RECIPE, "--row", "fix-the-digest", "--home", home],
      deps: {
        now: () => NOW_ISO,
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: (line) => {
          if (written.length > 0) {
            throw new Error("write EPIPE");
          }
          written.push(line);
        },
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(written).toEqual([
      `automation repair · ${RECIPE} · taken by fix-the-digest — the owner sees a note, not a card, until that row is done`,
    ]);
    expect(diagnostics).toEqual([
      "automation repair · the take is recorded, but stdout failed before everything printed (write EPIPE)",
    ]);
    expect(unwrap(readRepairTakes({ home })).takes).toHaveLength(1);
  });

  it("says on stderr, still at exit 0, when stdout fails while the finding's pickup lines print", () => {
    repairRow({ slug: FINDING });
    seedFailure();
    const written: string[] = [];

    const code = runRecipeRepair({
      argv: ["node", "slopweaver", "recipe", "repair", RECIPE, "--row", FINDING, "--home", home],
      deps: {
        now: () => NOW_ISO,
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: (line) => {
          if (written.length > 1) {
            throw new Error("write ENOSPC");
          }
          written.push(line);
        },
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(written).toHaveLength(2);
    expect(diagnostics).toEqual([
      "automation repair · the take is recorded, but stdout failed before everything printed (write ENOSPC)",
    ]);
    expect(unwrap(readRepairTakes({ home })).takes).toHaveLength(1);
  });

  it("keeps a recorded take at exit 0 when stdout and stderr are both closed", () => {
    repairRow({ slug: "fix-the-digest" });

    const code = runRecipeRepair({
      argv: ["node", "slopweaver", "recipe", "repair", RECIPE, "--row", "fix-the-digest", "--home", home],
      deps: {
        now: () => NOW_ISO,
        writeDiagnostic: () => {
          throw new Error("write EPIPE");
        },
        writeOut: () => {
          throw new Error("write EPIPE");
        },
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(unwrap(readRepairTakes({ home })).takes).toHaveLength(1);
  });

  it("keeps a recorded take at exit 0 when stdout is already closed", () => {
    repairRow({ slug: "fix-the-digest" });

    const code = runRecipeRepair({
      argv: ["node", "slopweaver", "recipe", "repair", RECIPE, "--row", "fix-the-digest", "--home", home],
      deps: {
        now: () => NOW_ISO,
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: () => {
          throw new Error("write EPIPE");
        },
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(unwrap(readRepairTakes({ home })).takes).toHaveLength(1);
  });

  it("prints nothing about failures when the take itself is refused", () => {
    repairRow({ slug: "fix-the-digest", started: false });
    seedFailure();

    expect(run({ tail: [RECIPE, "--row", "fix-the-digest"] })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
  });

  it("refuses a recipe id no definition carries, and writes nothing", () => {
    repairRow({ slug: "fix-the-digest" });

    expect(run({ tail: ["no-such-recipe", "--row", "fix-the-digest"] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      "automation repair · no-such-recipe was not taken by fix-the-digest: no recipe definition carries that id",
    ]);
    expect(unwrap(readRepairTakes({ home })).takes).toEqual([]);
  });

  it("refuses a row no seat has started, naming the verb that starts it", () => {
    repairRow({ slug: "fix-the-digest", started: false });

    expect(run({ tail: ["vulnfix-digest-acme-admin", "--row", "fix-the-digest"] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      "automation repair · vulnfix-digest-acme-admin was not taken by fix-the-digest: no seat has started the row — `handover start` it from the seat doing the repair",
    ]);
  });

  it("refuses a missing --row as a usage mistake", () => {
    expect(run({ tail: ["vulnfix-digest-acme-admin"] })).toBe(EXIT_USAGE);
    expect(unwrap(readRepairTakes({ home })).takes).toEqual([]);
  });

  it("refuses a missing recipe id as a usage mistake", () => {
    expect(run({ tail: ["--row", "fix-the-digest"] })).toBe(EXIT_USAGE);
  });
});
