/**
 * The `RefreshDeps` fake every `runRefreshWithDeps` test file drives the verb through — plain functions recording
 * what they were asked, no mocks. Shared rather than copied because the run tests are split by scenario across
 * sibling files, and two copies of one fake drift.
 */
import type { RefreshOptions } from "../../../../../cli/commands/refresh/core.js";
import type { RefreshDeps } from "../../../../../cli/commands/refresh/deps.js";
import type { MemberHydrationResult } from "../../../../../cli/commands/refresh/members.js";
import type { StructureHydrationResult } from "../../../../../cli/commands/refresh/structures.js";
import type { SourceIngestJob } from "../../../../../corpus/ingestJob.js";
import type { CorpusRecord, ExportWindow } from "../../../../../corpus/types.js";
import { ok } from "../../../../../lib/result.js";

/**
 * A no-op source job (its `run` is never reached — `ingestSources` is faked).
 *
 * @returns the job
 */
export function stubJob({ source, window }: { source: CorpusRecord["source"]; window: ExportWindow }): SourceIngestJob {
  return { label: "stub", run: async () => ok({ records: [], warnings: [] }), source, window };
}

/** What a {@link fakeDeps} run recorded. */
export interface Captured {
  readonly deps: RefreshDeps;
  readonly hydrated: string[];
  /** The org the MEMBER lane was aimed at, per hydrated source. */
  readonly memberOrgs: (string | undefined)[];
  /** The org the STRUCTURAL lane was aimed at, per hydrated source. */
  readonly structureOrgs: (string | undefined)[];
  readonly structured: string[];
  readonly builtJobs: string[];
  readonly progress: { phase: string; label: string }[];
  readonly out: string[];
  readonly errors: string[];
  readonly warn: string[];
  readonly derived: string[];
  /** Everything production puts on stderr, in order: warn and error lines, and each progress event's phase. */
  readonly stderr: string[];
}

/** Every array a {@link fakeDeps} run records into — {@link Captured} without the deps. */
type Recorded = Omit<Captured, "deps">;

/** The member and structural hydration seams, recording each source they were asked to hydrate. */
function hydrationSeams({ rec }: { rec: Recorded }): Pick<RefreshDeps, "hydrateMember" | "hydrateStructure"> {
  const hydrateMember = async ({
    source,
    githubOrg,
  }: {
    source: CorpusRecord["source"];
    githubOrg?: string;
  }): Promise<MemberHydrationResult | undefined> => {
    if (source === "gold") {
      return undefined; // mirrors production: the synthetic source is never hydrated
    }
    rec.hydrated.push(source);
    rec.memberOrgs.push(githubOrg);
    return { deduped: 0, errors: [], hydrated: 5, ok: true, source, warnings: [], written: 5 };
  };
  const hydrateStructure = async ({
    source,
    options,
  }: {
    source: CorpusRecord["source"];
    options: RefreshOptions;
  }): Promise<StructureHydrationResult | undefined> => {
    if (source === "gold") {
      return undefined;
    }
    rec.structured.push(source);
    rec.structureOrgs.push(options.githubOrg);
    return { deduped: 0, errors: [], hydrated: 3, ok: true, source, warnings: [], written: 3 };
  };
  return { hydrateMember, hydrateStructure };
}

/** The post-ingest derive seam, succeeding or failing as `deriveOk` says. */
function deriveSeam({ deriveOk, rec }: { deriveOk: boolean; rec: Recorded }): Pick<RefreshDeps, "derive"> {
  return {
    derive: async ({ home }: { home: string }) => {
      rec.derived.push(home);
      if (deriveOk) {
        return { lines: [{ level: "out" as const, text: "derive: rebuilt silver" }], ok: true };
      }
      return { lines: [{ level: "error" as const, text: "derive: corpus unreadable" }], ok: false };
    },
  };
}

/** The logger and progress sink, splitting each line onto the channel production writes it to. */
function channelSeams({ rec }: { rec: Recorded }): Pick<RefreshDeps, "logger" | "onProgress"> {
  return {
    logger: {
      error: ({ msg }) => {
        rec.errors.push(msg);
        rec.stderr.push(msg);
      },
      info: () => {},
      out: ({ line }) => rec.out.push(line),
      warn: ({ msg }) => {
        rec.warn.push(msg);
        rec.stderr.push(msg);
      },
    },
    onProgress: (p) => {
      rec.progress.push({ label: p.label, phase: p.phase });
      rec.stderr.push(`progress: ${p.phase}`);
    },
  };
}

/**
 * A full RefreshDeps fake (plain functions, no mocks). `withHydration` toggles the PR4.1/4.2 seams;
 * `deriveOk` toggles the post-ingest derive seam and whether it succeeds.
 *
 * @returns the deps and every array they record into
 */
export function fakeDeps({ withHydration, deriveOk }: { withHydration: boolean; deriveOk?: boolean }): Captured {
  const rec: Recorded = {
    builtJobs: [],
    derived: [],
    errors: [],
    hydrated: [],
    memberOrgs: [],
    out: [],
    progress: [],
    stderr: [],
    structureOrgs: [],
    structured: [],
    warn: [],
  };
  const deps: RefreshDeps = {
    buildGithubJob: ({ window }) => {
      rec.builtJobs.push("single-repo");
      return ok(stubJob({ source: "github", window: window }));
    },
    buildGithubOrgJob: ({ window }) => {
      rec.builtJobs.push("org");
      return ok(stubJob({ source: "github", window: window }));
    },
    buildSourceJob: ({ window }) => stubJob({ source: "slack", window: window }),
    home: () => "/home",
    ingestSources: async () => ok([]),
    nowDate: () => new Date("2026-07-20T00:00:00.000Z"),
    readWatermark: () => undefined,
    resolveTokens: () => ({}),
    slackReadToken: () => ({}),
    ...channelSeams({ rec }),
    ...(withHydration ? hydrationSeams({ rec }) : {}),
    ...(deriveOk === undefined ? {} : deriveSeam({ deriveOk, rec })),
  };
  return { ...rec, deps };
}

/**
 * A `refresh` argv with this tail.
 *
 * @returns the argv
 */
export const argv = ({ tail }: { tail: readonly string[] }): readonly string[] => ["node", "cli", "refresh", ...tail];
