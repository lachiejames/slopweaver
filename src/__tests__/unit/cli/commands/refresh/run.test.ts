import { describe, expect, it } from "vitest";
import type { RefreshDeps } from "../../../../../cli/commands/refresh/deps.js";
import { RefreshErrors } from "../../../../../cli/commands/refresh/errors.js";
import {
  githubItemProgress,
  githubRepoProgress,
  hydrationHeartbeat,
} from "../../../../../cli/commands/refresh/progressAdapters.js";
import { runRefreshWithDeps } from "../../../../../cli/commands/refresh/run.js";
import { EXIT_DEFERRED } from "../../../../../cli/exitCodes.js";
import type { SourceProgressEvent } from "../../../../../corpus/progress.js";
import type { CorpusRecord, CorpusSource } from "../../../../../corpus/types.js";
import { err, ok } from "../../../../../lib/result.js";
import { argv, fakeDeps, stubJob } from "./runFakes.js";

describe("runRefreshWithDeps — member hydration step (PR4.1)", () => {
  it("aims the member lane at --github-org, the same org the structural lane gets", async () => {
    const cap = fakeDeps({ withHydration: true });

    await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "github", "--all-repos", "--github-org", "some-org"] }),
      deps: cap.deps,
    });

    // The defect this pins: both lanes read ONE options object, and used to answer differently — the
    // structural lane honoured --github-org while the member lane re-derived an org from the CWD's git
    // remote. Run from a checkout of any other repository, that silently wrote the wrong org's roster and
    // reported success, because member hydration is warning-only and never fails the run.
    expect(cap.memberOrgs).toEqual(["some-org"]);
    expect(cap.memberOrgs).toEqual(cap.structureOrgs);
  });

  it("aims the member lane at --repo's owner when no --github-org is given", async () => {
    const cap = fakeDeps({ withHydration: true });

    await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "github", "--repo", "some-owner/some-repo"] }),
      deps: cap.deps,
    });

    expect(cap.memberOrgs).toEqual(["some-owner"]);
  });

  it("hydrates each selected source, emits non-blocking members:<source> progress, and folds the summary in", async () => {
    const cap = fakeDeps({ withHydration: true });
    await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });
    expect(cap.hydrated).toEqual(["github"]);
    expect(cap.progress.filter((p) => p.phase === "members").map((p) => p.label)).toEqual(["github", "github"]);
    expect(cap.out).toContain("members github: hydrated 5 (wrote 5 new, deduped 0)");
  });

  it("is a clean no-op when the member seam is absent (pre-PR4.1 back-compat)", async () => {
    const cap = fakeDeps({ withHydration: false });
    await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });
    expect(cap.progress.some((p) => p.phase === "members")).toBe(false);
    expect(cap.out.some((line) => line.startsWith("members "))).toBe(false);
  });
});

describe("runRefreshWithDeps — GitHub job routing (PR4.2 org mode)", () => {
  it("builds the SINGLE-REPO job by default (no org fan-out)", async () => {
    const cap = fakeDeps({ withHydration: false });
    await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });
    expect(cap.builtJobs).toEqual(["single-repo"]);
  });

  it("builds the ORG-MODE job when --all-repos is set", async () => {
    const cap = fakeDeps({ withHydration: false });
    await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "github", "--all-repos", "--github-org", "acme"] }),
      deps: cap.deps,
    });
    expect(cap.builtJobs).toEqual(["org"]);
  });
});

describe("runRefreshWithDeps — structural hydration step (PR4.2)", () => {
  it("hydrates each selected source's structure + emits structures:<source> progress", async () => {
    const cap = fakeDeps({ withHydration: true });
    await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });
    expect(cap.structured).toEqual(["github"]);
    expect(cap.progress.filter((p) => p.phase === "structures").map((p) => p.label)).toEqual(["github", "github"]);
    expect(cap.out).toContain("structures github: hydrated 3 (wrote 3 new, deduped 0)");
  });

  it("is a clean no-op when the structure seam is absent (back-compat)", async () => {
    const cap = fakeDeps({ withHydration: false });
    await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });
    expect(cap.progress.some((p) => p.phase === "structures")).toBe(false);
  });
});

describe("refresh progress adapters (pure)", () => {
  it("hydrationHeartbeat maps a members/structures event to a rich heartbeat with the source as the item", () => {
    expect(hydrationHeartbeat({ done: 1, label: "slack", phase: "members", total: 4, written: 12 })).toEqual({
      currentItem: { title: "slack" },
      done: 1,
      lane: "heartbeat",
      metrics: { written: 12 },
      phase: "members",
      total: 4,
    });
  });

  it("githubItemProgress adapts a per-item hook into a github.items source heartbeat", () => {
    const events: SourceProgressEvent[] = [];
    githubItemProgress({ sourceProgress: (e) => events.push(e) })({ index: 3, number: 42, total: 10 });
    expect(events).toEqual([
      { currentItem: { title: "#42" }, done: 3, lane: "heartbeat", phase: "items", source: "github", total: 10 },
    ]);
  });

  it("githubRepoProgress adapts a per-repo hook into a github.repos source heartbeat naming the repo", () => {
    const events: SourceProgressEvent[] = [];
    githubRepoProgress({ sourceProgress: (e) => events.push(e) })({
      done: 2,
      recordCount: 18,
      repo: "example/api",
      total: 5,
    });
    expect(events).toEqual([
      {
        currentItem: { title: "example/api" },
        done: 2,
        lane: "heartbeat",
        metrics: { records: 18 },
        phase: "repos",
        source: "github",
        total: 5,
      },
    ]);
  });
});

describe("runRefreshWithDeps — the --numbers-only summary is sanitised through the split log channels", () => {
  // This path has behavioural content from BOTH sides of the rebase: main's `--numbers-only` sanitisation and
  // the object-taking logger. It had no test, so a green suite proved nothing about whether the merge kept the
  // sanitisation wired up. Asserted here through the real verb, on the `out` channel it actually writes to.
  it("withholds the bronze path from the summary when --numbers-only is on", async () => {
    const cap = fakeDeps({ withHydration: false });
    await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "github", "--numbers-only"] }),
      deps: cap.deps,
    });
    expect(cap.out.some((line) => line.includes("/home"))).toBe(false);
  });

  it("emits the bronze path verbatim when it is off — so the sanitiser is doing the withholding, not the shape", async () => {
    const cap = fakeDeps({ withHydration: false });
    await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });
    expect(cap.out.some((line) => line.includes("/home"))).toBe(true);
  });
});

describe("runRefreshWithDeps — --coverage", () => {
  it("refuses a non-Slack source, because no other connector has a membership boundary", async () => {
    const cap = fakeDeps({ withHydration: false });
    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--coverage", "--source", "github"] }),
      deps: cap.deps,
    });
    expect(code).toBe(2);
    expect(cap.errors[0]).toBe("refresh --coverage: Slack only — pass --source slack");
    expect(cap.builtJobs).toEqual([]);
  });

  it("still refuses with no Slack token, at the shared gate, rather than reporting an empty workspace", async () => {
    const cap = fakeDeps({ withHydration: true });
    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--coverage", "--source", "slack"] }),
      deps: cap.deps,
    });
    expect(code).toBe(2);
    expect(cap.errors[0]).toContain("slack requested but no token");
    // And nothing downstream ran: the report REPLACES the fetch, it does not follow it.
    expect(cap.hydrated).toEqual([]);
    expect(cap.structured).toEqual([]);
  });
});

describe("runRefreshWithDeps — refresh derives by default (the freshness contract, rule 4)", () => {
  it("runs derive over the ingested home and reports what it did", async () => {
    const cap = fakeDeps({ deriveOk: true, withHydration: true });

    const code = await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });

    expect(cap.derived).toEqual(["/home"]);
    expect(cap.out).toContain("derive: rebuilt silver");
    // 3 is EXIT_EXPECTED_EMPTY — the fake ingests nothing; what matters here is that derive did not fail it.
    expect(code).toBe(3);
  });

  it("skips derive under --no-derive, and SAYS the roster is now behind bronze", async () => {
    const cap = fakeDeps({ deriveOk: true, withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "github", "--no-derive"] }),
      deps: cap.deps,
    });

    expect(cap.derived).toEqual([]);
    expect(cap.warn).toContain(
      "--no-derive: silver was NOT rebuilt, so the identity roster is now behind bronze — run `slopweaver derive`",
    );
    expect(code).toBe(3);
  });

  it("FAILS the verb when derive fails, because silver no longer matches bronze", async () => {
    const cap = fakeDeps({ deriveOk: false, withHydration: true });

    const code = await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });

    expect(cap.derived).toEqual(["/home"]);
    expect(code).toBe(1);
    expect(cap.stderr.slice(-2)).toEqual(["derive: corpus unreadable", "refresh failed: derive: corpus unreadable"]);
  });

  it("is a no-op when the derive seam is absent, so a pre-contract test deck still runs", async () => {
    const cap = fakeDeps({ withHydration: true });

    const code = await runRefreshWithDeps({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });

    expect(cap.derived).toEqual([]);
    expect(code).toBe(3);
  });
});

describe("runRefreshWithDeps — every refresh takes each selected source's slot", () => {
  const HOLDER = { ceilingMib: 4096, pid: 99, startedAtIso: "2026-07-20T00:00:00.000Z" };

  /** A slot seam that refuses `held`, cannot take `unavailable`, and admits the rest, recording what it was asked. */
  function slotSeam({ held, unavailable = [] }: { held: readonly string[]; unavailable?: readonly string[] }): {
    asked: string[];
    take: NonNullable<RefreshDeps["acquireRefreshSlot"]>;
  } {
    const asked: string[] = [];
    const take: NonNullable<RefreshDeps["acquireRefreshSlot"]> = ({ source }) => {
      asked.push(source);
      if (unavailable.includes(source)) {
        return { admitted: false, holders: [], limit: 1, obstacles: ["/slots/slack will not list (EACCES)"] };
      }
      if (held.includes(source)) {
        return { admitted: false, holders: [HOLDER], limit: 1, obstacles: [] };
      }
      return { admitted: true, inFlight: 1, limit: 1 };
    };
    return { asked, take };
  }

  it("drops a source whose slot could not be taken at all, naming the obstacle, never fetching it", async () => {
    const cap = fakeDeps({ withHydration: true });
    const seam = slotSeam({ held: [], unavailable: ["slack"] });

    await runRefreshWithDeps({
      argv: argv({ tail: ["--jit", "--source", "slack", "--source", "github"] }),
      deps: { ...cap.deps, acquireRefreshSlot: seam.take, resolveTokens: () => ({ slack: "t" }) },
    });

    expect(cap.hydrated).toEqual(["github"]);
    expect(cap.errors[0]).toBe(
      "refresh slack · slack's slot could not be taken: /slots/slack will not list (EACCES) — skipping slack rather than writing it beside a refresh or compaction this run could not count.",
    );
  });

  it("drops a source whose slot another live process holds, and names the holder", async () => {
    const cap = fakeDeps({ withHydration: true });
    const seam = slotSeam({ held: ["slack"] });

    await runRefreshWithDeps({
      argv: argv({ tail: ["--jit", "--source", "slack", "--source", "github"] }),
      deps: { ...cap.deps, acquireRefreshSlot: seam.take, resolveTokens: () => ({ slack: "t" }) },
    });

    expect(seam.asked).toEqual(["slack", "github"]);
    expect(cap.hydrated).toEqual(["github"]);
    expect(cap.errors[0]).toBe(
      "refresh slack · a refresh or compaction of slack is already running (pid 99, since " +
        "2026-07-20T00:00:00.000Z) — not starting a refresh beside it, which would race it on slack's resume cursor or window files.",
    );
    expect(cap.errors[1]).toBe(
      "  to answer: let that run finish, then re-run the gate — nothing is queued, so re-asking is the whole remedy.",
    );
  });

  it("keeps every source when no slot is held", async () => {
    const cap = fakeDeps({ withHydration: true });
    const seam = slotSeam({ held: [] });

    await runRefreshWithDeps({
      argv: argv({ tail: ["--jit", "--source", "slack", "--source", "github"] }),
      deps: { ...cap.deps, acquireRefreshSlot: seam.take, resolveTokens: () => ({ slack: "t" }) },
    });

    expect(cap.hydrated).toEqual(["slack", "github"]);
    expect(cap.errors).toEqual([]);
  });

  it("takes the slot WITHOUT --jit too, per the owner's ruling that the lock is general", async () => {
    const cap = fakeDeps({ withHydration: true });
    const seam = slotSeam({ held: [] });

    await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack"] }),
      deps: { ...cap.deps, acquireRefreshSlot: seam.take, resolveTokens: () => ({ slack: "t" }) },
    });

    expect(seam.asked).toEqual(["slack"]);
    expect(cap.hydrated).toEqual(["slack"]);
  });

  it("names the operator remedy, not the re-ask one, when --jit was not passed", async () => {
    const cap = fakeDeps({ withHydration: true });
    const seam = slotSeam({ held: ["slack"] });

    await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--source", "github"] }),
      deps: { ...cap.deps, acquireRefreshSlot: seam.take, resolveTokens: () => ({ slack: "t" }) },
    });

    expect(cap.errors[1]).toBe(
      "  let that run finish and run this again — nothing is queued, and there is no flag that waives the slot.",
    );
  });

  it("exits 4 (NOT YET) when EVERY selected source was dropped, neither a success nor a fault", async () => {
    const cap = fakeDeps({ withHydration: true });
    const seam = slotSeam({ held: ["slack"] });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack"] }),
      deps: { ...cap.deps, acquireRefreshSlot: seam.take, resolveTokens: () => ({ slack: "t" }) },
    });

    expect(code).toBe(EXIT_DEFERRED);
    expect(cap.hydrated).toEqual([]);
    expect(cap.errors.at(-1)).toBe(
      "refresh: every selected source was dropped — each is already being refreshed by another process, or its slot could not be taken as said above — nothing to do here",
    );
  });
});

describe("refresh --store", () => {
  /** One source's successful bronze write, so the store leg has a file to name. */
  const wrote = ({ source }: { source: CorpusRecord["source"] }) => ({
    deduped: 0,
    errors: [],
    excluded: 0,
    gaps: [],
    notes: [],
    ok: true,
    projected: 2,
    source,
    warnings: [],
    written: 2,
  });

  it("replays the SOURCE's window files rather than only the file this run wrote, and prints what landed", async () => {
    const cap = fakeDeps({ withHydration: true });
    const asked: { home: string; source: CorpusSource }[] = [];

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store", "--since", "2026-07-01"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async ({ home, source }) => {
          asked.push({ home, source });
          return ok({
            files: 5,
            kind: "ingested",
            linesRead: 2,
            omittedBytes: 0,
            omittedFiles: 0,
            refused: 0,
            stored: 2,
          });
        },
      },
    });

    expect(code).toBe(0);
    expect(asked).toEqual([{ home: "/home", source: "slack" }]);
    expect(cap.out).toContain("--store: slack: 2 row(s) stored from 2 line(s) across 5 window file(s)");
  });

  it("FAILS the verb when the store refuses the file, because a store that did not take what bronze took is behind it", async () => {
    const cap = fakeDeps({ withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async () => err(["no store is selected — set SLOPWEAVER_STORE_URL"]),
      },
    });

    expect(code).toBe(1);
    expect(cap.errors).toContain("--store: slack: no store is selected — set SLOPWEAVER_STORE_URL");
  });

  it("ENDS stderr on the store's reason, after the hydration lanes that used to bury it", async () => {
    const cap = fakeDeps({ deriveOk: true, withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async () => err(["connect ECONNREFUSED 127.0.0.1:54322"]),
      },
    });

    // A resync-corpus-slack firing: a store failure, then structures progress, then exit 1,
    // and the slot record kept only that progress line.
    const storeLine = cap.stderr.indexOf("--store: slack: connect ECONNREFUSED 127.0.0.1:54322");
    expect(storeLine).toBeGreaterThan(-1);
    expect(cap.stderr.indexOf("progress: structures")).toBeGreaterThan(storeLine);
    expect(cap.stderr.at(-1)).toBe("refresh failed: store: slack: connect ECONNREFUSED 127.0.0.1:54322");
    expect(code).toBe(1);
  });

  it("withholds the store's reason from the closing line under --numbers-only", async () => {
    const cap = fakeDeps({ withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store", "--numbers-only"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async () => err(["password authentication failed for user someone"]),
      },
    });

    expect(cap.stderr.at(-1)).toBe("refresh failed: store: slack: [withheld]");
    expect(code).toBe(1);
  });

  it("ends on the closing line when the store and derive seams THROW, withheld under --numbers-only", async () => {
    const cap = fakeDeps({ withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store", "--numbers-only"] }),
      deps: {
        ...cap.deps,
        derive: () => {
          throw new Error("EEXIST: file already exists, mkdir '/srv/sentinel-derive/silver/index'");
        },
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async () => {
          throw new Error("invalid_auth for tenant Acme");
        },
      },
    });

    expect(cap.stderr.at(-1)).toBe("refresh failed: store: slack: [withheld]; derive: [withheld]");
    expect(cap.stderr.join("\n")).not.toContain("Acme");
    expect(cap.stderr.join("\n")).not.toContain("sentinel-derive");
    expect(code).toBe(1);
  });

  it("ends on the closing line when a hydration lane THROWS after a store failure, and still runs derive", async () => {
    const cap = fakeDeps({ deriveOk: true, withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store", "--numbers-only"] }),
      deps: {
        ...cap.deps,
        hydrateMember: async () => {
          throw new Error("hydration crashed reading workspace T0SYNSENTINEL");
        },
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async () => err(["connect ECONNREFUSED 127.0.0.1:54322"]),
      },
    });

    expect(cap.stderr.at(-1)).toBe("refresh failed: store: slack: [withheld]; members: [withheld]");
    expect(cap.stderr.join("\n")).not.toContain("T0SYNSENTINEL");
    expect(cap.derived).toEqual(["/home"]);
    expect(code).toBe(1);
  });

  it("ends on the closing line when the ingest seam THROWS, instead of escaping before it", async () => {
    const cap = fakeDeps({ deriveOk: true, withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => {
          throw new Error("ingest blew up");
        },
        resolveTokens: () => ({ slack: "t" }),
      },
    });

    expect(cap.stderr.at(-1)).toBe("refresh failed: ingest: slack: ingest blew up");
    expect(code).toBe(1);
  });

  it("adds no closing line to a refresh that succeeded", async () => {
    const cap = fakeDeps({ deriveOk: true, withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async () => ok({ kind: "absent" }),
      },
    });

    expect(code).toBe(0);
    expect(cap.stderr.filter((line) => line.startsWith("refresh failed:"))).toEqual([]);
  });

  it("FAILS the verb when --store was asked for and no seam is wired, never silently skipping the store", async () => {
    const cap = fakeDeps({ withHydration: true });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack", "--store"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
      },
    });

    expect(code).toBe(1);
    expect(cap.errors).toContain("--store: this run has no store seam wired, so nothing can reach the store");
  });

  it("never touches the store without --store, whatever seam is wired", async () => {
    const cap = fakeDeps({ withHydration: true });
    let asked = 0;

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "slack"] }),
      deps: {
        ...cap.deps,
        ingestSources: async () => ok([wrote({ source: "slack" })]),
        resolveTokens: () => ({ slack: "t" }),
        storeIngest: async () => {
          asked += 1;
          return ok({ kind: "absent" });
        },
      },
    });

    expect(code).toBe(0);
    expect(asked).toBe(0);
  });
});

describe("refresh --self on its own", () => {
  it("builds and runs the self job when no fetchable source is selected", async () => {
    // `--self` selects NO fetchable source, and the run used to exit 0 on that empty selection before the self
    // jobs were ever built — printing nothing, scanning nothing (measured on a bronze `self` 12 days old).
    const cap = fakeDeps({ withHydration: false });
    const ingested: string[] = [];
    const deps: RefreshDeps = {
      ...cap.deps,
      buildSelfJob: ({ roots, window }) => stubJob({ source: "self", window: { ...window, since: roots[0]! } }),
      ingestSources: async ({ jobs }) => {
        ingested.push(...jobs.map((job) => `${job.source}:${job.window.since}`));
        return ok([]);
      },
    };

    const code = await runRefreshWithDeps({ argv: argv({ tail: ["--self", "--self-root", "/notes"] }), deps });

    // 3 is EXIT_EXPECTED_EMPTY: the stub wrote nothing, and the run reached that verdict by RUNNING the job.
    expect(code).toBe(3);
    expect(ingested).toEqual(["self:/notes"]);
  });
});

describe("runRefreshWithDeps — a job that cannot be built", () => {
  it("refuses a lane this build did not wire, naming the lane by what it ingests", async () => {
    const cap = fakeDeps({ withHydration: false });

    const code = await runRefreshWithDeps({ argv: argv({ tail: ["--source", "fathom"] }), deps: cap.deps });

    expect(code).toBe(2);
    expect(cap.errors).toEqual([RefreshErrors.laneNotWired({ source: "fathom" }).message]);
    expect(cap.errors).toEqual(["refresh: fathom was requested but this build has no recorded-call ingest lane wired"]);
  });

  it("prints a GitHub builder refusal one line per line, exactly as the builder wrote it", async () => {
    const cap = fakeDeps({ withHydration: false });

    const code = await runRefreshWithDeps({
      argv: argv({ tail: ["--source", "github"] }),
      deps: { ...cap.deps, buildGithubJob: () => err(["expected owner/repo, got: nope", "second line"]) },
    });

    expect(code).toBe(2);
    expect(cap.errors).toEqual(["expected owner/repo, got: nope", "second line"]);
  });
});
