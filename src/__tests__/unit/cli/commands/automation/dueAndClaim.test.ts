/**
 * `automation due` and `automation claim` over a real throwaway home — the round trip the owner asked for.
 *
 * Filesystem only, which `testing.md` allows for a genuine round trip: every case writes definition files
 * into a `mkdtempSync` home, runs the real verbs against it with an injected clock and sink, and reads back
 * what they produced. No mocks, and nothing touches the ambient `$SLOPWEAVER_HOME`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import {
  productionRecipeClaimDeps,
  type RecipeClaimDeps,
  runClaim,
} from "../../../../../cli/commands/automation/claim.js";
import { parseRecipeClaimArgs } from "../../../../../cli/commands/automation/claimArgs.js";
import { parseRecipeDueArgs, type RecipeDueDeps, reportDueAsks } from "../../../../../cli/commands/automation/due.js";
import { RecipeCommandErrors } from "../../../../../cli/commands/automation/errors.js";
import { EXIT_DEFERRED } from "../../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../../live/automation/definition.js";
import type { ProcessAlive } from "../../../../../live/automation/holderLiveness.js";
import { beginSlotAttempt, readSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { GENERIC_STANDING_ROWS } from "../../../../../live/automation/standingRows.js";
import { writeTeamRepositories } from "../../../../../live/automation/teamRepositoryStore.js";
import { teamStandingRows } from "../../../../../live/automation/teamStandingRows.js";
import { stateHomePaths } from "../../../../../stateHome.js";

let home = "";
let lines: string[] = [];
let diagnostics: string[] = [];

const NOW_ISO = "2026-09-08T12:05:00.000Z";

/** How the report opens on a home declaring no checkout of this repository: every home here. */
const OWN_REPOSITORY_UNRESOLVED = "!! OWN REPOSITORY UNRESOLVED";

/**
 * The MISSING clause every tally here carries, derived rather than written out.
 *
 * Every home in this file is a throwaway holding only the fixture its own case wrote, and no case writes a
 * row this build DECLARES — that is the point of {@link due}. So the clause counts the whole declared set,
 * and a row added to `GENERIC_STANDING_ROWS` moves this and the helper together instead of reddening twelve
 * hand-written tallies one at a time, which is what adding `self-improvement` did.
 */
const ALL_DECLARED_MISSING = `${String(GENERIC_STANDING_ROWS.length)} DECLARED row(s) MISSING`;

/** The declared rows a store holding them counts actionable: a row declared OFF is read but never actionable. */
const ENABLED_GENERIC_ROWS = GENERIC_STANDING_ROWS.filter((row) => row.definition.enabled).length;

/** The tally these homes print when one row is due: every declared row is missing from every one of them. */
const TALLY_ONE_ACTIONABLE = `1 actionable · 0 want a session · 0 claimed · 1 row(s) read · ${ALL_DECLARED_MISSING}`;

/** Every dead-letter board row the verb registered, so a test can assert on one rather than on silence. */
const registered: (readonly string[])[] = [];

/** The injected edges: a frozen clock and two collectors. */
function deps({
  nowIso = NOW_ISO,
  processAlive = () => true,
}: { nowIso?: string; processAlive?: ProcessAlive } = {}): RecipeClaimDeps & RecipeDueDeps {
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    mintClaimId: () => "claim-0001",
    now: () => nowIso,
    // No home here declares a checkout, so no `origin` is ever asked.
    originOf: () => undefined,
    processAlive,
    tickResyncIds: [],
    register: ({ argv }) => {
      registered.push(argv);
      return Promise.resolve(0);
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    // Every home here declares no checkout of this repository, so every report opens on the line saying so; it is the
    // subject of `./dueOwnRepository.test.ts`, and dropped here so each case reads only the rows its home holds.
    writeOut: (line) => lines.push(...[line].filter((entry) => !entry.startsWith(OWN_REPOSITORY_UNRESOLVED))),
  };
}

/** Write one definition file into the throwaway home's store. */
function writeDefinition({
  recipeId,
  kind = "verb-run",
  cadence = "0 * * * *",
  enabled = true,
}: {
  recipeId: string;
  kind?: string;
  cadence?: string;
  enabled?: boolean;
}): void {
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${recipeId}.json`),
    JSON.stringify({
      cadence,
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled,
      kind,
      params: kind === "verb-run" ? { argv: ["atlas", "freshness"] } : {},
      recipeId,
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    }),
    "utf8",
  );
}

/** The line a home with no team repository registered prints above its tally. */
const NO_TEAM_REPOSITORIES = "automation due · no team repositories configured on this install";

/**
 * The `automation due` output minus the banner for every row this install declares and this home does not hold,
 * and minus the one line saying no team repository is registered.
 *
 * Every home in this file is a throwaway holding only what its own case wrote, so `GENERIC_STANDING_ROWS` is absent
 * from all of them and the report opens with one `!!` line each, and none registers a team repository — each
 * the subject of its own case below. Every other case here is about the rows the home DOES hold, and reads the
 * report from under that banner.
 */
function due(): readonly string[] {
  const banners = lines.filter((line) => line.includes("DECLARED by this build and ABSENT"));
  expect(banners.length).toBe(GENERIC_STANDING_ROWS.length);
  expect(lines.filter((line) => line === NO_TEAM_REPOSITORIES).length).toBe(1);
  return lines.slice(banners.length).filter((line) => line !== NO_TEAM_REPOSITORIES);
}

/** Register one synthetic team repository in the throwaway home. */
function registerAcme(): void {
  unwrap(
    writeTeamRepositories({
      home,
      repositories: [{ repository: "acme/acme-admin" }],
    }),
  );
}

/** Write every row in `rows` into the throwaway home's store, exactly as declared. */
function writeDeclared({ rows }: { rows: readonly { readonly definition: { readonly recipeId: string } }[] }): void {
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  for (const row of rows) {
    writeFileSync(join(dir, `${row.definition.recipeId}.json`), JSON.stringify(row.definition), "utf8");
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "recipe-due-"));
  lines = [];
  diagnostics = [];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("recipe due", () => {
  it("says nothing is scheduled on a home with no definitions, and still exits 0", () => {
    const exitCode = reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(exitCode).toBe(0);
    expect(due()[0]).toBe("automation due · no definitions — nothing is scheduled on this install");
  });

  it("opens with the rows this build DECLARES and the store no longer holds, and names how to write them back", () => {
    reportDueAsks({ deps: deps(), options: { home, json: false } });

    // Selected by recipe id rather than by position: the banners are ordered by id, so a row sorting before
    // these two is not a change in behaviour.
    expect(lines.find((line) => line.startsWith("!! self-improvement ·"))).toBe(
      "!! self-improvement · DECLARED by this build and ABSENT from the store — nothing else mines the day's " +
        "friction into a dated report, so without this row `reflect friction-review` has no producer to watch " +
        "and the loop that turns a recurring failure into a board row stops — measured at " +
        "seventeen days silent, seventeen days of which the gauge itself reported `current`. Write it back " +
        "with `slopweaver automation register-standing`",
    );
    expect(lines.find((line) => line.startsWith("!! worktree-prune ·"))).toBe(
      "!! worktree-prune · DECLARED by this build and ABSENT from the store — nothing else removes a " +
        "worktree when its session ends, so without this row every merged, pushed and cold checkout " +
        "accumulates until somebody counts them by hand — measured at 766 registrations on a " +
        "volume 93% full, seventeen days after the row stopped. Write it back with `slopweaver automation " +
        "register-standing`",
    );
  });

  it("says nothing about a declared row once the store holds it, and drops it from the tally too", () => {
    expect(GENERIC_STANDING_ROWS.length).toBeGreaterThan(0);
    writeDeclared({ rows: GENERIC_STANDING_ROWS });

    reportDueAsks({ deps: deps(), options: { home, json: false } });

    expect(lines.filter((line) => line.includes("DECLARED by this build and ABSENT"))).toEqual([]);
    const count = String(GENERIC_STANDING_ROWS.length);
    // `publication-audit-daily` is declared OFF, so it is read but never actionable until the owner turns it on.
    // `hygiene-sweep`, `thread-chase-daily`, `slack-owed-daily`, `linear-briefing-daily` and
    // `alignment-briefing-weekday` are the declared rows SEATED rather than run in the tick.
    expect(lines.slice(-2)).toEqual([
      NO_TEAM_REPOSITORIES,
      `${String(ENABLED_GENERIC_ROWS)} actionable · 5 want a session · 0 claimed · ${count} row(s) read`,
    ]);
  });

  it("declares a registered team repository's rows too, and names the one the store no longer holds", () => {
    registerAcme();
    const acme = teamStandingRows({ repository: "acme/acme-admin" });
    writeDeclared({
      rows: [...GENERIC_STANDING_ROWS, ...acme.filter((row) => !row.definition.recipeId.startsWith("bump-drive-"))],
    });

    reportDueAsks({ deps: deps(), options: { home, json: false } });

    expect(lines.filter((line) => line.startsWith("!! "))).toEqual([
      `!! bump-drive-acme-admin · DECLARED by this build and ABSENT from the store — ${acme[0]!.why}. Write it ` +
        "back with `slopweaver automation register-standing`",
    ]);
    expect(lines).not.toContain(NO_TEAM_REPOSITORIES);
  });

  it("reads a registered team repository's rows, all present, as nothing missing — its held batch tallied UNOWNED", () => {
    registerAcme();
    const acme = teamStandingRows({ repository: "acme/acme-admin" });
    writeDeclared({ rows: [...GENERIC_STANDING_ROWS, ...acme] });

    reportDueAsks({ deps: deps(), options: { home, json: false } });

    const count = String(GENERIC_STANDING_ROWS.length + acme.length);
    // `error-tracking-batch-acme-admin` is declared HELD, so it is read but never actionable until the owner's word
    // lifts it; the hold carries no `placedBy`, so it is tallied UNOWNED: the template placed it, no word of
    // the owner's names the row.
    const actionable = String(ENABLED_GENERIC_ROWS + acme.length - 1);
    expect(lines.filter((line) => line.startsWith("!! "))).toEqual([]);
    expect(lines.at(-1)).toBe(
      `${actionable} actionable · 5 want a session · 0 claimed · ${count} row(s) read · ` +
        "1 UNOWNED, owner hold lacks the owner's naming words",
    );
  });

  it("says at the top that a malformed team registry left the declaration unknown, compares nothing, and exits 0", () => {
    const registry = stateHomePaths({ home }).live.recipe.teamRepositoriesJson;
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    writeFileSync(registry, "{", "utf8");

    const exitCode = reportDueAsks({ deps: deps(), options: { home, json: false } });

    expect(exitCode).toBe(0);
    expect(lines[0]).toContain(`!! team repositories · the team repository registry at ${registry} is malformed: `);
    expect(lines.filter((line) => line.includes("DECLARED by this build and ABSENT"))).toEqual([]);
    expect(lines).not.toContain(NO_TEAM_REPOSITORIES);

    lines = [];
    reportDueAsks({ deps: deps(), options: { home, json: true } });
    const report = JSON.parse(lines[0]!) as {
      readonly missing: readonly unknown[];
      readonly superseded: readonly unknown[];
      readonly teamRepositories: { readonly kind: string };
    };
    expect([report.teamRepositories.kind, report.missing, report.superseded]).toEqual(["unreadable", [], []]);
    expect(Object.keys(report)[0]).toBe("teamRepositories");
  });

  it("reports a never-run row as actionable and runnable in this process", () => {
    writeDefinition({ recipeId: "atlas-freshness" });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(due()[0]).toContain("DUE atlas-freshness");
    expect(due()[0]).toContain("run here, in this process");
    expect(due()[1]).toBe(TALLY_ONE_ACTIONABLE);
  });

  it("writes nothing at all — a tick may call it every time", () => {
    writeDefinition({ recipeId: "atlas-freshness" });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    const paths = stateHomePaths({ home }).live.recipe;
    expect(existsSync(paths.slotAttemptsDir)).toBe(false);
    expect(existsSync(paths.definitionRunsJson)).toBe(false);
  });

  it("emits one JSON document under --json", () => {
    writeDefinition({ recipeId: "atlas-freshness" });
    reportDueAsks({ deps: deps(), options: { home, json: true } });
    const report = JSON.parse(lines[0]!) as { readonly rows: readonly { readonly recipeId: string }[] };
    expect(report.rows[0]!.recipeId).toBe("atlas-freshness");
  });

  it("prints the due row and ONE line for the disabled one under --brief, the tally unchanged", () => {
    writeDefinition({ recipeId: "atlas-freshness" });
    writeDefinition({ enabled: false, recipeId: "parked-row" });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    const full = due();
    lines = [];
    reportDueAsks({ deps: deps(), options: { brief: true, home, json: false } });
    expect(full.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual([
      "DUE atlas-freshness",
      "-- parked-row",
      "1 actionable",
    ]);
    expect(due()).toEqual([
      full[0],
      "automation due · 1 quiet row(s) omitted by --brief — drop --brief to list them",
      full[2],
    ]);
  });

  it("filters the JSON rows the same way under --json --brief and counts what it left out", () => {
    writeDefinition({ recipeId: "atlas-freshness" });
    writeDefinition({ enabled: false, recipeId: "parked-row" });
    reportDueAsks({ deps: deps(), options: { brief: true, home, json: true } });
    const report = JSON.parse(lines[0]!) as {
      readonly rows: readonly { readonly recipeId: string }[];
      readonly omittedQuiet: number;
    };
    expect(report.rows.map((one) => one.recipeId)).toEqual(["atlas-freshness"]);
    expect(report.omittedQuiet).toBe(1);
  });

  it("parses --brief, and reads its absence as the full report", () => {
    expect(unwrap(parseRecipeDueArgs({ defaultHome: "/tmp/example", rest: ["--brief"] })).brief).toBe(true);
    expect(unwrap(parseRecipeDueArgs({ defaultHome: "/tmp/example", rest: [] })).brief).toBe(false);
  });

  it("says on every read that an investigate row's question is over the prompt cap, before its slot fires", () => {
    writeInvestigateDefinition({ question: "Say what changed. ".repeat(28).slice(0, 501) });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    const unaskable = diagnostics.filter((line) => line.startsWith("automation due · UNASKABLE · "));
    expect(unaskable.length).toBe(1);
    expect(unaskable[0]).toContain("recipe 'hunt-daily' cannot ask its question as one automation prompt");
    expect(unaskable[0]).toContain("live/recipe/definitions/hunt-daily.json");
  });

  it("says nothing of an investigate row whose question fits", () => {
    writeInvestigateDefinition({ question: "Say what changed. ".repeat(28).slice(0, 500) });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(diagnostics.filter((line) => line.includes("UNASKABLE"))).toEqual([]);
  });
});

/** Write one enabled `investigate` row asking `question` into the throwaway home's store. */
function writeInvestigateDefinition({ question }: { question: string }): void {
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "hunt-daily.json"),
    JSON.stringify({
      cadence: "30 8 * * *",
      destination: { kind: "slack" },
      effect: "read",
      enabled: true,
      kind: "investigate",
      params: { askedBy: "U0OWNER", channel: "D0PROMPT", question },
      recipeId: "hunt-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    }),
    "utf8",
  );
}

describe("recipe claim", () => {
  it("claims a row's current firing until its own next one, and the due read then reports it held", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    const claimed = await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    expect(claimed).toBe(0);
    expect(lines[0]).toBe(
      "recipe nightly-digest · CLAIMED by supervisor-tick for slot 2026-09-08T12:00:00.000Z until its next " +
        "firing at 2026-09-08T13:00:00.000Z · attempt 1 · claim-id claim-0001",
    );

    lines = [];
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(due()[0]).toContain("CLAIMED by supervisor-tick");
    expect(due()[1]).toBe(`0 actionable · 0 want a session · 1 claimed · 1 row(s) read · ${ALL_DECLARED_MISSING}`);
  });

  it("refuses a second claim while the first attempt is open, naming the holder", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    const second = await runClaim({
      deps: deps(),
      options: { claimedBy: "another-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    expect(second).toBe(1);
    expect(diagnostics[0]).toContain("HELD · attempt 1 is running under supervisor-tick");
  });

  it("keeps a claim held whatever a liveness probe says, because a claim names no process", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    const stored = unwrap(readSlotAttempt({ home, recipeId: "nightly-digest", slotIso: "2026-09-08T12:00:00.000Z" }))!;
    expect(stored.holderPid).toBe(null);

    lines = [];
    reportDueAsks({ deps: deps({ processAlive: () => false }), options: { home, json: false } });
    expect(due()[0]).toContain("CLAIMED by supervisor-tick");
  });

  it("reports a row actionable again when the run-due process holding its firing is gone", () => {
    writeDefinition({ recipeId: "nightly-digest" });
    unwrap(
      beginSlotAttempt({
        holder: "recipe run-due",
        holderPid: 4242,
        holderToken: "tok-killed",
        home,
        leaseExpiresIso: "2026-09-08T13:00:00.000Z",
        nowIso: "2026-09-08T12:01:00.000Z",
        processAlive: () => true,
        recipeId: "nightly-digest",
        slotIso: "2026-09-08T12:00:00.000Z",
      }),
    );
    reportDueAsks({ deps: deps({ processAlive: () => true }), options: { home, json: false } });
    expect(due()[1]).toBe(`0 actionable · 0 want a session · 1 claimed · 1 row(s) read · ${ALL_DECLARED_MISSING}`);

    lines = [];
    reportDueAsks({ deps: deps({ processAlive: () => false }), options: { home, json: false } });
    expect(due()[1]).toBe(TALLY_ONE_ACTIONABLE);
  });

  it("frees the row at the next firing, so a worker that died costs at most one slot", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    lines = [];
    reportDueAsks({ deps: deps({ nowIso: "2026-09-08T13:00:00.000Z" }), options: { home, json: false } });
    expect(due()[1]).toBe(TALLY_ONE_ACTIONABLE);
  });

  it("gives the firing back for a spawn that never happened, spending no attempt", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    lines = [];
    const released = await runClaim({
      deps: deps(),
      options: { claimId: null, exitCode: null, home, kind: "release", recipeId: "nightly-digest" },
    });
    expect(released).toBe(0);
    expect(lines[0]).toBe("recipe nightly-digest · slot 2026-09-08T12:00:00.000Z RELEASED · nothing settled");
    expect(unwrap(readSlotAttempt({ home, recipeId: "nightly-digest", slotIso: "2026-09-08T12:00:00.000Z" }))).toBe(
      null,
    );
  });

  it("settles the firing and stamps it in one write, so it is not immediately due again", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    lines = [];
    const finished = await runClaim({
      deps: deps({ nowIso: "2026-09-08T12:40:00.000Z" }),
      options: { claimId: "claim-0001", exitCode: 0, home, kind: "release", recipeId: "nightly-digest" },
    });
    expect(finished).toBe(0);
    expect(lines[0]).toBe("recipe nightly-digest · slot 2026-09-08T12:00:00.000Z · settled on attempt 1 — stamped");

    lines = [];
    reportDueAsks({ deps: deps({ nowIso: "2026-09-08T12:45:00.000Z" }), options: { home, json: false } });
    expect(due()[1]).toBe(`0 actionable · 0 want a session · 0 claimed · 1 row(s) read · ${ALL_DECLARED_MISSING}`);
  });

  it("stamps the firing the attempt LEASED, so a run that crossed a firing leaves that firing due", async () => {
    // Claimed at 12:05 for the 12:00 firing, finished at 13:00:05. Stamping the finish instant would read
    // 13:00 as covered and never run it; stamping the leased firing leaves 13:00 owed.
    writeDefinition({ kind: "investigate", recipeId: "nightly-digest" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    await runClaim({
      deps: deps({ nowIso: "2026-09-08T13:00:05.000Z" }),
      options: { claimId: "claim-0001", exitCode: 0, home, kind: "release", recipeId: "nightly-digest" },
    });
    const stored = JSON.parse(readFileSync(stateHomePaths({ home }).live.recipe.definitionRunsJson, "utf8")) as {
      readonly runs: Readonly<Record<string, { readonly lastRunAtIso: string; readonly watermarkIso: string }>>;
    };
    expect(stored.runs["nightly-digest"]).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-09-08T13:00:05.000Z",
      lastRunAtIso: "2026-09-08T13:00:05.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });

    lines = [];
    reportDueAsks({ deps: deps({ nowIso: "2026-09-08T13:00:10.000Z" }), options: { home, json: false } });
    expect(due()[0]).toContain("covers slot 2026-09-08T13:00:00.000Z");
    expect(due()[1]).toBe(TALLY_ONE_ACTIONABLE);
  });

  it("leases a disabled row's own watermark, so finishing it cannot step past slots it still owes", async () => {
    writeDefinition({ enabled: false, kind: "investigate", recipeId: "nightly-digest" });
    const paths = stateHomePaths({ home }).live.recipe;
    writeFileSync(
      paths.definitionRunsJson,
      JSON.stringify({
        runs: {
          "nightly-digest": {
            exitCode: 0,
            lastRunAtIso: "2026-09-08T08:00:30.000Z",
            watermarkIso: "2026-09-08T08:00:00.000Z",
          },
        },
        schemaVersion: 1,
      }),
      "utf8",
    );
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    await runClaim({
      deps: deps({ nowIso: "2026-09-08T12:40:00.000Z" }),
      options: { claimId: "claim-0001", exitCode: 0, home, kind: "release", recipeId: "nightly-digest" },
    });
    const stored = JSON.parse(readFileSync(paths.definitionRunsJson, "utf8")) as {
      readonly runs: Readonly<Record<string, { readonly watermarkIso: string }>>;
    };
    expect(stored.runs["nightly-digest"]!.watermarkIso).toBe("2026-09-08T08:00:00.000Z");
  });

  it("refuses a settling release whose token is not the open attempt's, and writes nothing", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    const refused = await runClaim({
      deps: deps(),
      options: { claimId: "a-stale-token", exitCode: 0, home, kind: "release", recipeId: "nightly-digest" },
    });
    expect(refused).toBe(1);
    expect(diagnostics[0]).toContain("under a different token");
    expect(existsSync(stateHomePaths({ home }).live.recipe.definitionRunsJson)).toBe(false);
  });

  it("REFUSES while another dispatcher's transaction holds the ledger, rather than racing its read-modify-write", async () => {
    // The property a Codex review pass returned BROKEN on for the claims store, kept for the ledger that
    // replaced it. `writeFileAtomic` stops a torn read; it does not serialize read-decide-write, so two
    // dispatchers could both read "nothing holds this firing", both pass the check, and both run it.
    // Holding the mutex here is the state a concurrent dispatcher would find. Falsifiable: drop the lock
    // from `beginSlotAttempt` and this goes green while the defect is back.
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    const held = acquireOperationLock({ home, key: "recipe-slot-attempts", nowIso: NOW_ISO });
    expect(held.isOk()).toBe(true);
    try {
      const blocked = await runClaim({
        deps: deps(),
        options: { claimedBy: "second-tick", home, kind: "claim", recipeId: "nightly-digest" },
      });
      expect(blocked).toBe(1);
      expect(diagnostics[0]).toContain("could not be written");
      expect(unwrap(readSlotAttempt({ home, recipeId: "nightly-digest", slotIso: "2026-09-08T12:00:00.000Z" }))).toBe(
        null,
      );
    } finally {
      unwrap(held).release();
    }
  });

  it("opens exactly one attempt on one firing, whatever order two claimants arrive in", async () => {
    writeDefinition({ recipeId: "nightly-digest", kind: "investigate" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "tick-a", home, kind: "claim", recipeId: "nightly-digest" },
    });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "tick-b", home, kind: "claim", recipeId: "nightly-digest" },
    });
    const stored = unwrap(readSlotAttempt({ home, recipeId: "nightly-digest", slotIso: "2026-09-08T12:00:00.000Z" }));
    expect(stored!.holder).toBe("tick-a");
    expect(stored!.attempt).toBe(1);
  });

  it("refuses to claim a row the store does not hold", async () => {
    const exitCode = await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "ghost" },
    });
    expect(exitCode).toBe(1);
    expect(diagnostics[0]).toContain("no such definition");
  });

  it("gives a DEFERRED run's firing back without stamping it, so the same firing is still due", async () => {
    writeDefinition({ kind: "investigate", recipeId: "nightly-digest" });
    await runClaim({
      deps: deps(),
      options: { claimedBy: "supervisor-tick", home, kind: "claim", recipeId: "nightly-digest" },
    });
    lines = [];

    const released = await runClaim({
      deps: deps({ nowIso: "2026-09-08T12:40:00.000Z" }),
      options: {
        claimId: "claim-0001",
        exitCode: EXIT_DEFERRED,
        home,
        kind: "release",
        recipeId: "nightly-digest",
      },
    });

    expect(released).toBe(0);
    expect(lines[0]).toBe(
      "recipe nightly-digest · slot 2026-09-08T12:00:00.000Z RELEASED · DEFERRED, nothing settled, still due",
    );
    lines = [];
    reportDueAsks({ deps: deps({ nowIso: "2026-09-08T12:45:00.000Z" }), options: { home, json: false } });
    expect(due()[1]).toBe(TALLY_ONE_ACTIONABLE);
  });
});

describe("the flag tails", () => {
  it("defaults recipe due to the ambient home and no json", () => {
    const parsed = parseRecipeDueArgs({ defaultHome: "/tmp/example", rest: [] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ brief: false, home: "/tmp/example", json: false });
  });

  it("refuses a stamping release that quotes no claim id", () => {
    const parsed = parseRecipeClaimArgs({
      defaultHome: "/tmp/example",
      rest: ["knock-alerts", "--release", "--exit-code", "0"],
    });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.settlingClaimIdMissing());
    expect(unwrapErr(parsed).message).toBe(
      "a release carrying --exit-code settles the firing, so it must quote the --claim-id it was given " +
        "when the row was claimed — without it a worker whose lease expired would settle its successor's",
    );
  });

  it("refuses a claim with no --by, because a claim nobody holds cannot be chased", () => {
    const parsed = parseRecipeClaimArgs({ defaultHome: "/tmp/example", rest: ["knock-alerts"] });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.claimantMissing());
    expect(unwrapErr(parsed).message).toBe(
      "automation claim needs --by <who> — a claim nobody holds is a row nobody can be chased through",
    );
  });

  it("allows a release with no --by", () => {
    const parsed = parseRecipeClaimArgs({ defaultHome: "/tmp/example", rest: ["knock-alerts", "--release"] });
    expect(parsed.isOk()).toBe(true);
  });

  it("builds production deps whose clock reads a real instant", () => {
    expect(Number.isNaN(Date.parse(productionRecipeClaimDeps().now()))).toBe(false);
  });
});
