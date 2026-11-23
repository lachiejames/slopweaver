/**
 * The two post-ingest hydration steps over a plain `RefreshDeps` fake: the order they reach each source in,
 * the before/after progress around each one, and the warning-only summary they fold the results into. The
 * `production*` pair reads real credentials and is never called here.
 */
import { describe, expect, it } from "vitest";
import { parseRefreshOptions, type RefreshOptions } from "../../../../../cli/commands/refresh/core.js";
import type { RefreshDeps } from "../../../../../cli/commands/refresh/deps.js";
import { hydrateMembersStep, hydrateStructuresStep } from "../../../../../cli/commands/refresh/hydration.js";
import type { CorpusSource } from "../../../../../corpus/types.js";
import { ok, unwrap } from "../../../../../lib/result.js";

/** The run's observation instant, stamped on every hydrated row. */
const FETCHED_AT = "2026-07-20T00:00:00.000Z";

/** `--github-org` is given, so the member lane's org resolution never falls back to reading a git remote. */
const OPTIONS: RefreshOptions = unwrap(parseRefreshOptions({ rest: ["--github-org", "acme"] }));

/** What one step did, per channel. */
interface Recorded {
  readonly progress: unknown[];
  readonly out: string[];
  readonly warn: string[];
  readonly errors: string[];
}

/** A full `RefreshDeps` fake whose activity seams are never reached, and whose two lanes are optional. */
function fakeDeps({
  hydrateMember,
  hydrateStructure,
}: {
  hydrateMember?: RefreshDeps["hydrateMember"];
  hydrateStructure?: RefreshDeps["hydrateStructure"];
}): { deps: RefreshDeps; recorded: Recorded } {
  const recorded: Recorded = { errors: [], out: [], progress: [], warn: [] };
  const deps: RefreshDeps = {
    buildGithubJob: () => {
      throw new Error("a hydration step must not build an ingest job");
    },
    buildSourceJob: () => {
      throw new Error("a hydration step must not build an ingest job");
    },
    home: () => "/home",
    ingestSources: async () => ok([]),
    logger: {
      error: ({ msg }) => recorded.errors.push(msg),
      info: () => {},
      out: ({ line }) => recorded.out.push(line),
      warn: ({ msg }) => recorded.warn.push(msg),
    },
    nowDate: () => new Date(FETCHED_AT),
    onProgress: (event) => recorded.progress.push(event),
    readWatermark: () => undefined,
    resolveTokens: () => ({}),
    slackReadToken: () => ({}),
    ...(hydrateMember !== undefined ? { hydrateMember } : {}),
    ...(hydrateStructure !== undefined ? { hydrateStructure } : {}),
  };
  return { deps, recorded };
}

const SOURCES: readonly CorpusSource[] = ["slack", "linear"];

describe("hydrateMembersStep", () => {
  it("is a no-op with no member seam — no progress and no summary line", async () => {
    const { deps, recorded } = fakeDeps({});

    await hydrateMembersStep({ deps, fetchedAtIso: FETCHED_AT, home: "/home", options: OPTIONS, sources: SOURCES });

    expect(recorded).toEqual({ errors: [], out: [], progress: [], warn: [] });
  });

  it("hydrates each source in order, brackets each with progress, and summarises only the defined results", async () => {
    const calls: unknown[] = [];
    const hydrateMember: NonNullable<RefreshDeps["hydrateMember"]> = async (args) => {
      calls.push(args);
      if (args.source === "linear") {
        return undefined;
      }
      return {
        deduped: 1,
        errors: [],
        hydrated: 4,
        ok: true,
        source: "slack",
        warnings: ["one bot skipped"],
        written: 3,
      };
    };
    const { deps, recorded } = fakeDeps({ hydrateMember });

    await hydrateMembersStep({ deps, fetchedAtIso: FETCHED_AT, home: "/home", options: OPTIONS, sources: SOURCES });

    expect(calls).toEqual([
      { fetchedAtIso: FETCHED_AT, githubOrg: "acme", home: "/home", source: "slack" },
      { fetchedAtIso: FETCHED_AT, githubOrg: "acme", home: "/home", source: "linear" },
    ]);
    expect(recorded.progress).toEqual([
      { done: 0, label: "slack", phase: "members", total: 2 },
      { done: 1, label: "slack", phase: "members", total: 2, written: 3 },
      { done: 1, label: "linear", phase: "members", total: 2 },
      { done: 2, label: "linear", phase: "members", total: 2 },
    ]);
    expect(recorded.warn).toEqual(["  members slack: one bot skipped"]);
    expect(recorded.out).toEqual(["members slack: hydrated 4 (wrote 3 new, deduped 1)"]);
    expect(recorded.errors).toEqual([]);
  });

  it("reports a failed hydration's errors as warnings, never on the error stream", async () => {
    const hydrateMember: NonNullable<RefreshDeps["hydrateMember"]> = async () => ({
      deduped: 0,
      errors: ["users.list: missing_scope"],
      hydrated: 0,
      ok: false,
      source: "slack",
      warnings: [],
      written: 0,
    });
    const { deps, recorded } = fakeDeps({ hydrateMember });

    await hydrateMembersStep({ deps, fetchedAtIso: FETCHED_AT, home: "/home", options: OPTIONS, sources: ["slack"] });

    expect(recorded.warn).toEqual(["  members slack: users.list: missing_scope"]);
    expect(recorded.out).toEqual([]);
    expect(recorded.errors).toEqual([]);
  });
});

describe("hydrateStructuresStep", () => {
  it("is a no-op with no structure seam — no progress and no summary line", async () => {
    const { deps, recorded } = fakeDeps({});

    await hydrateStructuresStep({ deps, fetchedAtIso: FETCHED_AT, home: "/home", options: OPTIONS, sources: SOURCES });

    expect(recorded).toEqual({ errors: [], out: [], progress: [], warn: [] });
  });

  it("hydrates each source in order with the run's options, brackets each with progress, and summarises", async () => {
    const calls: unknown[] = [];
    const hydrateStructure: NonNullable<RefreshDeps["hydrateStructure"]> = async (args) => {
      calls.push(args);
      if (args.source === "slack") {
        return undefined;
      }
      return { deduped: 0, errors: [], hydrated: 2, ok: true, source: "linear", warnings: [], written: 2 };
    };
    const { deps, recorded } = fakeDeps({ hydrateStructure });

    await hydrateStructuresStep({ deps, fetchedAtIso: FETCHED_AT, home: "/home", options: OPTIONS, sources: SOURCES });

    expect(calls).toEqual([
      { fetchedAtIso: FETCHED_AT, home: "/home", options: OPTIONS, source: "slack" },
      { fetchedAtIso: FETCHED_AT, home: "/home", options: OPTIONS, source: "linear" },
    ]);
    expect(recorded.progress).toEqual([
      { done: 0, label: "slack", phase: "structures", total: 2 },
      { done: 1, label: "slack", phase: "structures", total: 2 },
      { done: 1, label: "linear", phase: "structures", total: 2 },
      { done: 2, label: "linear", phase: "structures", total: 2, written: 2 },
    ]);
    expect(recorded.out).toEqual(["structures linear: hydrated 2 (wrote 2 new, deduped 0)"]);
    expect(recorded.warn).toEqual([]);
    expect(recorded.errors).toEqual([]);
  });
});
