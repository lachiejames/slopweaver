import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { RecipeCommandErrors } from "../../../../../cli/commands/automation/errors.js";
import {
  corpusSyncToPropagate,
  parseRecipeResyncArgs,
  type RecipeResyncDeps,
  resyncRosterLine,
  runRecipeResync,
} from "../../../../../cli/commands/automation/resync.js";
import { EXIT_DEFERRED } from "../../../../../cli/exitCodes.js";
import type { ChatgptArchiveDeps } from "../../../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ResyncDemandRead } from "../../../../../live/resync/demand.js";
import { readResyncState } from "../../../../../live/resync/outcomeStore.js";
import { buildResyncPolicies } from "../../../../../live/resync/policy.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { FUTURE, syntheticExportAt } from "../../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../../noProtection.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

const HOME = "/tmp/home";
const HOUR = 60 * 60 * 1000;
const CHATGPT_FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

/** Archive edges that are never reached: the fixture is a directory, not a zip. */
const NO_ZIP: ChatgptArchiveDeps = {
  extractZipMember: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
  listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
};

const sink = (): { out: string[]; diagnostics: string[] } => ({ diagnostics: [], out: [] });

const dirs: string[] = [];

/**
 * A throwaway state home whose `profile.json` declares one real git checkout with the given `origin` — or
 * none at all when `slug` is null. Never the ambient home; every caller passes `--home`.
 */
const declaredHome = ({ slug }: { readonly slug: string | null }): string => {
  const home = mkdtempSync(join(tmpdir(), "resync-home-"));
  dirs.push(home);
  const paths: string[] = [];
  if (slug !== null) {
    const checkout = mkdtempSync(join(tmpdir(), "resync-co-"));
    dirs.push(checkout);
    gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
    gitInTemp({ args: ["remote", "add", "origin", `git@github.com:${slug}.git`], cwd: checkout });
    paths.push(checkout);
  }
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "",
      gitNamespace: "",
      id: "me",
      mainCheckouts: paths.map((path) => ({ path })),
      schemaVersion: 1,
      sources: [],
    }),
    "utf8",
  );
  return home;
};

/** The verb's edges, with both sinks collected — the types are INHERITED from the contract, never restated. */
const deps = ({ out, diagnostics }: { out: string[]; diagnostics: string[] }): RecipeResyncDeps => ({
  now: () => "2026-09-12T04:00:00.000Z",
  propagateCorpus: () => Promise.resolve(),
  readDemand: () => Promise.resolve({ kind: "ungated" }),
  runVerb: () => Promise.resolve(0),
  writeDiagnostic: (line) => diagnostics.push(line),
  writeOut: (line) => out.push(line),
});

describe("parseRecipeResyncArgs", () => {
  it("resolves an atlas target", () => {
    expect(unwrap(parseRecipeResyncArgs({ defaultHome: HOME, rest: ["--atlas", "trelica"] })).target).toEqual({
      kind: "atlas",
      platform: "trelica",
    });
  });

  it("resolves a corpus target", () => {
    expect(unwrap(parseRecipeResyncArgs({ defaultHome: HOME, rest: ["--source", "notion"] })).target).toEqual({
      kind: "corpus",
      source: "notion",
    });
  });

  it("resolves --list as the roster listing, with no target", () => {
    const parsed = unwrap(parseRecipeResyncArgs({ defaultHome: HOME, rest: ["--list", "--json"] }));
    expect(parsed.list).toBe(true);
    expect(parsed.target).toBe(null);
  });

  it("refuses --list beside a target, because the listing is the whole roster", () => {
    const parsed = parseRecipeResyncArgs({ defaultHome: HOME, rest: ["--list", "--atlas", "trelica"] });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.listWithTarget());
    expect(unwrapErr(parsed).message).toBe("--list prints the whole roster, so it takes neither --atlas nor --source");
  });

  it("refuses both target kinds at once", () => {
    const parsed = parseRecipeResyncArgs({ defaultHome: HOME, rest: ["--atlas", "a", "--source", "notion"] });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.targetsAmbiguous());
    expect(unwrapErr(parsed).message).toBe("--atlas and --source name two different targets — pass exactly one");
  });

  it("refuses an invocation naming no target at all", () => {
    const parsed = parseRecipeResyncArgs({ defaultHome: HOME, rest: [] });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.targetMissing());
    expect(unwrapErr(parsed).message).toBe("name a target: --atlas <platform>, or --source <corpus source>");
  });

  it("refuses a corpus source this build does not have", () => {
    const parsed = parseRecipeResyncArgs({ defaultHome: HOME, rest: ["--source", "nowhere"] });
    expect(unwrapErr(parsed).code).toBe("CORPUS_SOURCE_UNKNOWN");
    expect(unwrapErr(parsed).message).toContain("`nowhere` is not a corpus source");
  });

  it("takes the home the caller named", () => {
    expect(
      unwrap(parseRecipeResyncArgs({ defaultHome: HOME, rest: ["--atlas", "a", "--home", "/elsewhere"] })).home,
    ).toBe("/elsewhere");
  });
});

describe("resyncRosterLine", () => {
  it("names the row, its cadence and every step it runs", () => {
    const policy = buildResyncPolicies({
      atlases: [
        {
          platform: "clerk",
          resyncCommand: "slopweaver atlas clerk sync && slopweaver atlas clerk walk",
          seated: true,
          windowMs: 4 * HOUR,
        },
      ],
      corpus: [],
    }).policies[0]!;
    expect(resyncRosterLine({ policy })).toBe(
      "resync-atlas-clerk · 0 */4 * * * · slopweaver atlas clerk sync && slopweaver atlas clerk walk",
    );
  });

  it("appends the note when a cadence does not match its window", () => {
    const policy = buildResyncPolicies({
      atlases: [
        { platform: "cloudflare", resyncCommand: "slopweaver cloudflare sync", seated: true, windowMs: 48 * HOUR },
      ],
      corpus: [],
    }).policies[0]!;
    expect(resyncRosterLine({ policy })).toContain("scheduled daily");
  });
});

describe("runRecipeResync", () => {
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  it("prints its usage and runs nothing for --help", async () => {
    const sinks = sink();
    const code = await runRecipeResync({
      argv: ["node", "slopweaver", "recipe", "resync", "--help"],
      deps: deps(sinks),
    });
    expect(code).toBe(0);
    expect(sinks.out[0]).toContain("usage: slopweaver automation resync");
  });

  it("refuses an unknown flag with the usage exit code, running nothing", async () => {
    const sinks = sink();
    const code = await runRecipeResync({
      argv: ["node", "slopweaver", "recipe", "resync", "--nope"],
      deps: deps(sinks),
    });
    expect(code).toBe(2);
    expect(sinks.out).toEqual([]);
  });

  it("lists every target it schedules, naming the organisation the github step crawls", async () => {
    // ONE --list run asserts both the roster size and the github line. Each run loads every atlas
    // descriptor, so a second one doubled that cost to re-assert what this already covers.
    const sinks = sink();
    const home = declaredHome({ slug: "acme/acme-admin" });
    // The chatgpt row is seated only once an export is held, so this home takes the fixture's in first.
    unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: CHATGPT_FIXTURE,
        nowIso: "2026-10-17T01:00:00.000Z",
        root: stateHomePaths({ home }).corpus.chatgptExports,
      }),
    );
    const code = await runRecipeResync({
      argv: ["node", "slopweaver", "recipe", "resync", "--list", "--home", home],
      deps: deps(sinks),
    });
    expect(code).toBe(0);
    expect(sinks.out.at(-1)).toBe("42 target(s) scheduled");
    expect(sinks.out.find((out) => out.startsWith("resync-corpus-github ·"))!).toBe(
      "resync-corpus-github · 0 */4 * * * · slopweaver refresh --source github --store --all-repos --github-org acme",
    );
    // An export-fed source's pass is its own sync, which takes a newer export in before it refreshes.
    expect(sinks.out.find((out) => out.startsWith("resync-corpus-chatgpt ·"))!).toBe(
      "resync-corpus-chatgpt · 0 0 * * * · slopweaver chatgpt sync",
    );
    // The Outlook diary is a corpus source with its own history sync, so it is a target of its own.
    expect(sinks.out.find((out) => out.startsWith("resync-corpus-outlook-calendar ·"))!).toBe(
      "resync-corpus-outlook-calendar · 0 0 * * * · slopweaver refresh --source outlook-calendar --store",
    );
  });
  it("reports the github row as a PROBLEM, and drops it, when no main checkout is declared", async () => {
    // The finding: an install declaring nothing would otherwise register a row whose step
    // `refresh --source github --store` refuses its own cwd on every scheduled tick. Reproduce that refusal:
    //   cd "$SLOPWEAVER_HOME/.claude/worktrees.noindex/recipe-scheduler-"* && slopweaver refresh --source github --store
    const sinks = sink();
    const home = declaredHome({ slug: null });
    const code = await runRecipeResync({
      argv: ["node", "slopweaver", "recipe", "resync", "--list", "--home", home],
      deps: deps(sinks),
    });
    expect(code).toBe(1);
    // No export held either, so the chatgpt row is absent too, silently: that is not a problem line.
    expect(sinks.out.at(-1)).toBe("40 target(s) scheduled");
    expect(sinks.out.filter((out) => out.startsWith("resync-corpus-chatgpt ·"))).toEqual([]);
    expect(sinks.out.filter((out) => out.startsWith("resync-corpus-github ·"))).toEqual([]);
    const problem = sinks.diagnostics.find((line) => line.includes("corpus github"))!;
    expect(problem).toContain("no declared main checkout names an organisation");
    expect(problem).toContain("mainCheckouts");
  });
  it("refuses a target this build schedules nothing for, without running a step", async () => {
    const sinks = sink();
    const code = await runRecipeResync({
      argv: ["node", "slopweaver", "recipe", "resync", "--atlas", "nowhere"],
      deps: deps(sinks),
    });
    expect(code).toBe(2);
    expect(sinks.diagnostics.at(-1)).toContain("this build schedules no atlas nowhere");
  });
});

describe("corpusSyncToPropagate", () => {
  const attempt = {
    finishedAtIso: "2026-09-27T14:20:00.000Z",
    outcome: "succeeded" as const,
    recipeId: "resync-corpus-github",
  };

  it("hands a SUCCESSFUL corpus sync to propagation, stamped with when it finished", () => {
    expect(
      corpusSyncToPropagate({ attempt, home: HOME, recorded: true, target: { kind: "corpus", source: "github" } }),
    ).toEqual({
      home: HOME,
      recipeId: "resync-corpus-github",
      source: "github",
      syncFinishedAtIso: "2026-09-27T14:20:00.000Z",
    });
  });

  it("hands over nothing for a failed corpus sync, an unrecorded one, nor any atlas", () => {
    expect([
      corpusSyncToPropagate({
        attempt: { ...attempt, outcome: "failed" },
        home: HOME,
        recorded: true,
        target: { kind: "corpus", source: "github" },
      }),
      corpusSyncToPropagate({ attempt, home: HOME, recorded: true, target: { kind: "atlas", platform: "trelica" } }),
      corpusSyncToPropagate({ attempt, home: HOME, recorded: false, target: { kind: "corpus", source: "github" } }),
    ]).toEqual([null, null, null]);
  });
});

describe("runRecipeResync — the demand gate", () => {
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  const AETHER = ["node", "slopweaver", "recipe", "resync", "--atlas", "aether"];
  const TOBIAS = {
    author: "Tobias Wren",
    occurredAt: "2026-10-06T22:03:01Z",
    source: "slack",
    url: "https://acme.slack.com/archives/C0SYN000019/p1791324181655509",
  };

  /** Run Aether with one demand answer, recording every step argv and every question the gate was asked. */
  const runAether = async ({
    demand,
  }: {
    readonly demand: ResyncDemandRead;
  }): Promise<{ code: number; home: string; ran: string[]; asked: (string | null)[]; out: string[] }> => {
    const sinks = sink();
    const home = declaredHome({ slug: "lachiejames/slopweaver" });
    const ran: string[] = [];
    const asked: (string | null)[] = [];
    const code = await runRecipeResync({
      argv: [...AETHER, "--home", home],
      deps: {
        ...deps(sinks),
        readDemand: ({ sinceIso }) => {
          asked.push(sinceIso);
          return Promise.resolve(demand);
        },
        runVerb: (argv) => {
          ran.push(argv.slice(2).join(" "));
          return Promise.resolve(0);
        },
      },
    });
    return { asked, code, home, out: sinks.out, ran };
  };

  it("walks nothing, writes no record and exits 3 when no person asked", async () => {
    const run = await runAether({ demand: { kind: "unwanted", sinceIso: null, terms: ["aether", "dvuln"] } });
    expect(run.code).toBe(3);
    expect(run.ran).toEqual([]);
    expect(run.asked).toEqual([null]);
    expect(run.out.at(-1)).toContain("atlas aether · NOTHING TO DO · no person has named aether or dvuln");
    const stateDir = stateHomePaths({ home: run.home }).live.recipe.resyncStateDir;
    expect(unwrap(readResyncState({ recipeId: "resync-atlas-aether", stateDir }))).toBe(null);
  });

  it("walks nothing and gives the slot back when the check could not read", async () => {
    const run = await runAether({ demand: { kind: "unreadable", why: "no corpus store is selected to search" } });
    expect(run.code).toBe(4);
    expect(run.ran).toEqual([]);
    expect(run.out.at(-1)).toContain("DEFERRED · the demand check could not run, so nothing walked");
  });

  it("walks when a person asked, and the stored attempt carries who", async () => {
    const run = await runAether({ demand: { kind: "wanted", record: TOBIAS } });
    expect(run.ran).toEqual([`atlas aether walk --home ${run.home}`]);
    expect(run.out).toContain(
      `automation resync · atlas aether · WANTED by Tobias Wren in slack at 2026-10-06T22:03:01Z — ${TOBIAS.url}`,
    );
    const stateDir = stateHomePaths({ home: run.home }).live.recipe.resyncStateDir;
    const stored = unwrap(readResyncState({ recipeId: "resync-atlas-aether", stateDir }))!;
    expect(stored.lastAttempt!.demand).toEqual(TOBIAS);
  });
});

describe("runRecipeResync — propagation", () => {
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  it("propagates nothing when the corpus sync failed, and exits on the sync's own verdict", async () => {
    // An empty store fails the corpus postcondition whatever the step exited, so this is the failed path.
    const sinks = sink();
    const propagated: string[] = [];
    const home = declaredHome({ slug: "lachiejames/slopweaver" });
    const code = await runRecipeResync({
      argv: ["node", "slopweaver", "recipe", "resync", "--source", "linear", "--home", home],
      deps: {
        ...deps(sinks),
        propagateCorpus: (sync) => {
          propagated.push(sync.recipeId);
          return Promise.resolve();
        },
      },
    });
    expect(code).toBe(1);
    expect(sinks.out.at(-1)).toContain("automation resync · corpus linear · failed");
    expect(propagated).toEqual([]);
  });

  // MEASURED: `resync-corpus-slack` exited 1 and was held while another process refreshed slack.
  it("gives the slot back when the refresh found its source's slot held, recording the step and propagating nothing", async () => {
    const sinks = sink();
    const propagated: string[] = [];
    const home = declaredHome({ slug: null });
    const code = await runRecipeResync({
      argv: ["node", "slopweaver", "recipe", "resync", "--source", "slack", "--home", home],
      deps: {
        ...deps(sinks),
        propagateCorpus: (sync) => {
          propagated.push(sync.recipeId);
          return Promise.resolve();
        },
        runVerb: () => Promise.resolve(EXIT_DEFERRED),
      },
    });
    expect(code).toBe(EXIT_DEFERRED);
    expect(sinks.out.at(-1)).toBe(
      "automation resync · corpus slack · DEFERRED · `slopweaver refresh --source slack --store` exited 4: " +
        "another process holds the source's refresh slot — the slot is given back for the next pass, not cooled",
    );
    const stored = unwrap(
      readResyncState({
        recipeId: "resync-corpus-slack",
        stateDir: stateHomePaths({ home }).live.recipe.resyncStateDir,
      }),
    );
    expect(stored!.lastAttempt!.stepDeferred).toBe("slopweaver refresh --source slack --store");
    expect(propagated).toEqual([]);
  });
});
