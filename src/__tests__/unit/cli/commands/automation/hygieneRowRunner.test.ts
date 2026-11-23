/**
 * `runHygieneSweepRow` called directly over a throwaway home — the branches a seated run reaches only rarely:
 * a dry run, a refused row, a skipped tick and a publish that cannot land. `seat/hygieneSweep.test.ts` drives the
 * kind end to end through `automation seat` and `automation run-due --claim-id`, where the stamp is decided.
 *
 * The landing read is a plain recording function, not a mock: what is under test is what it is asked for and
 * what this runner does with its answer.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { CollectedLeg } from "../../../../../cli/commands/automation/collectLeg.js";
import { runHygieneSweepRow } from "../../../../../cli/commands/automation/hygieneRowRunner.js";
import type { RecipeRunDueDeps, RowOutcome } from "../../../../../cli/commands/automation/rowRunners.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import { HYGIENE_SWEEP_KIND } from "../../../../../live/automation/kinds.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { UNREACHED_FLEET_CEILING_SEAMS } from "../../../../fleetCeilingSeamsFake.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A fresh home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "hyg-row-"));
  homes.push(home);
  return home;
}

const READ = '{"kind":"read","rows":[],"dispatchable":[]}';

/** The not-yet-run outcome fields `runOneRow` spreads over every arm. */
const BASE: Omit<RowOutcome, "line"> = {
  detail: [],
  exitCode: null,
  failed: false,
  ran: false,
  recipeId: "hygiene-sweep",
};

/** The parsed standing row, overridable field by field. */
function definition(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "15 7 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: HYGIENE_SWEEP_KIND,
    onMissed: "skip",
    params: {},
    recipeId: "hygiene-sweep",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * Edges whose landing read exits `exitCode`, answers `lines` and wrote `diagnostics` to stderr, recording every
 * read and every transcript line.
 */
function deps({
  diagnostics = "",
  exitCode = 0,
  lines = [READ],
}: { diagnostics?: string; exitCode?: number; lines?: readonly string[] } = {}): RecipeRunDueDeps & {
  readonly reads: (readonly string[])[];
  readonly out: string[];
  readonly dispatched: (readonly string[])[];
} {
  const reads: (readonly string[])[] = [];
  const out: string[] = [];
  const dispatched: (readonly string[])[] = [];
  const unused = (): Promise<CollectedLeg> => Promise.resolve({ diagnostics: "", exitCode: EXIT_ERROR, lines: [] });
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    dispatched,
    doorEnv: () => ({}),
    mintId: () => "tok",
    now: () => "2026-09-26T07:15:00.000Z",
    out,
    promptChannel: () => "D0PROMPT",
    processAlive: () => true,
    reads,
    register: () => Promise.resolve(EXIT_ERROR),
    runAlertDigestRead: unused,
    runAlertSummaryRead: unused,
    ...UNREACHED_FLEET_CEILING_SEAMS,
    runGithubLandingRead: ({ rest }) => {
      reads.push(rest);
      return Promise.resolve({ diagnostics, exitCode, lines });
    },
    runSlackPost: unused,
    runVerbKeepingDiagnostics: (argv) => {
      dispatched.push(argv);
      return Promise.resolve({ diagnostics: "", exitCode: EXIT_ERROR });
    },
    writeDiagnostic: () => undefined,
    writeOut: (line) => out.push(line),
  };
}

describe("runHygieneSweepRow", () => {
  it("reads nothing and writes nothing under --dry-run, printing the exact read it would make", async () => {
    const home = freshHome();
    const edges = deps();
    const outcome = await runHygieneSweepRow({ base: BASE, definition: definition(), deps: edges, dryRun: true, home });
    expect(outcome.line).toBe(
      "recipe hygiene-sweep · would run · slopweaver github landing " +
        `--author @me --include-drafts --slack-live --json --record-reading recipe:hygiene-sweep --home ${home}`,
    );
    expect(outcome.ran).toBe(false);
    expect(edges.reads).toEqual([]);
    expect(existsSync(stateHomePaths({ home }).live.hygiene.root)).toBe(false);
  });

  it("refuses a row carrying params before any read", async () => {
    const home = freshHome();
    const edges = deps();
    const outcome = await runHygieneSweepRow({
      base: BASE,
      definition: definition({ params: { repo: "acme/other" } }),
      deps: edges,
      dryRun: false,
      home,
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.ran).toBe(false);
    expect(outcome.line).toContain(
      "recipe hygiene-sweep · REFUSED · recipe hygiene-sweep: a hygiene-sweep row takes no params",
    );
    expect(edges.reads).toEqual([]);
  });

  it("publishes nothing for a skipped tick, grading the run failed so the firing is not stamped", async () => {
    const home = freshHome();
    const edges = deps({ lines: ['{"kind":"skipped","rows":[],"dispatchable":[]}'] });
    const outcome = await runHygieneSweepRow({
      base: BASE,
      definition: definition(),
      deps: edges,
      dryRun: false,
      home,
    });
    const path = stateHomePaths({ home }).live.hygiene.githubLanding;
    expect(outcome).toEqual({
      ...BASE,
      exitCode: EXIT_ERROR,
      failed: true,
      line:
        "recipe hygiene-sweep · NO PACKET · recipe hygiene-sweep: github landing's document is not a read " +
        `(kind "read" with rows and dispatchable) · ${path} is unchanged`,
      ran: true,
    });
    expect(existsSync(path)).toBe(false);
    expect(edges.out).toEqual([]);
  });

  it("grades a read that exited 3 as a failure, never passing through the code the slot stamps as done", async () => {
    const home = freshHome();
    const edges = deps({ exitCode: 3 });
    const outcome = await runHygieneSweepRow({
      base: BASE,
      definition: definition(),
      deps: edges,
      dryRun: false,
      home,
    });
    const path = stateHomePaths({ home }).live.hygiene.githubLanding;
    expect(outcome.exitCode).toBe(EXIT_ERROR);
    expect(outcome.failed).toBe(true);
    expect(outcome.line).toContain("recipe hygiene-sweep · READ FAILED · slopweaver github landing ");
    expect(outcome.line).toContain(` · exit 3 · ${path} is unchanged`);
    expect(existsSync(path)).toBe(false);
    expect(edges.out).toEqual([]);
  });

  it("carries what the failed landing read wrote to stderr on its line, so the finding says why", async () => {
    const home = freshHome();
    const edges = deps({ diagnostics: "github landing: GitHub answered 502 Bad Gateway\n", exitCode: 1 });
    const outcome = await runHygieneSweepRow({
      base: BASE,
      definition: definition(),
      deps: edges,
      dryRun: false,
      home,
    });
    const path = stateHomePaths({ home }).live.hygiene.githubLanding;
    expect(outcome.failed).toBe(true);
    expect(outcome.line).toBe(
      "recipe hygiene-sweep · READ FAILED · slopweaver github landing --author @me --include-drafts --slack-live " +
        `--json --record-reading recipe:hygiene-sweep --home ${home} · exit 1 · ${path} is unchanged` +
        " · why: github landing: GitHub answered 502 Bad Gateway",
    );
  });

  it("carries what a landing read that exited zero with no packet wrote to stderr", async () => {
    const home = freshHome();
    const edges = deps({ diagnostics: "github landing: tick skipped, lease held\n", lines: [] });
    const outcome = await runHygieneSweepRow({
      base: BASE,
      definition: definition(),
      deps: edges,
      dryRun: false,
      home,
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.line.startsWith("recipe hygiene-sweep · NO PACKET · ")).toBe(true);
    expect(outcome.line.endsWith(" is unchanged · why: github landing: tick skipped, lease held")).toBe(true);
  });

  it("prints nothing for the session when the packet cannot be published, and leaves what stood there", async () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.hygiene.githubLanding;
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "kept"), "kept", "utf8");
    const edges = deps();
    const outcome = await runHygieneSweepRow({
      base: BASE,
      definition: definition(),
      deps: edges,
      dryRun: false,
      home,
    });
    expect(outcome.exitCode).toBe(EXIT_ERROR);
    expect(outcome.failed).toBe(true);
    expect(outcome.line).toContain(`recipe hygiene-sweep · NOT PUBLISHED · hygiene document ${path} was not replaced`);
    expect(edges.out).toEqual([]);
    expect(readFileSync(join(path, "kept"), "utf8")).toBe("kept");
  });

  it("launches nothing through the dispatcher — the read is the one edge it touches", async () => {
    const home = freshHome();
    const edges = deps();
    const outcome = await runHygieneSweepRow({
      base: BASE,
      definition: definition(),
      deps: edges,
      dryRun: false,
      home,
    });
    expect(outcome.failed).toBe(false);
    expect(edges.dispatched).toEqual([]);
    expect(edges.reads.length).toBe(1);
    expect(edges.out).toEqual([READ]);
  });
});
