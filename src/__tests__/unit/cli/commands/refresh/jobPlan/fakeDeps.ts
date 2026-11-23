/**
 * The shared fixture for `refresh`'s job-planning tests: a plain capturing {@link RefreshDeps} fake whose unused
 * seams throw, so a call the plan should never make fails the test rather than passing quietly, plus the stable
 * job identities and parsed options every case is built from.
 */
import { parseRefreshOptions, type RefreshOptions } from "../../../../../../cli/commands/refresh/core.js";
import type { RefreshDeps } from "../../../../../../cli/commands/refresh/deps.js";
import type { SourceIngestJob } from "../../../../../../corpus/ingestJob.js";
import type { SourceProgress } from "../../../../../../corpus/progress.js";
import type { CorpusSource, ExportWindow } from "../../../../../../corpus/types.js";
import { err, ok, unwrap } from "../../../../../../lib/result.js";

export type GithubArgs = Parameters<RefreshDeps["buildGithubJob"]>[0];
export type OrgArgs = Parameters<NonNullable<RefreshDeps["buildGithubOrgJob"]>>[0];
export type TokenedArgs = Parameters<RefreshDeps["buildSourceJob"]>[0];
export type GmailArgs = Parameters<NonNullable<RefreshDeps["buildGmailJob"]>>[0];
export type CalendarArgs = Parameters<NonNullable<RefreshDeps["buildCalendarJob"]>>[0];
export type FathomArgs = Parameters<NonNullable<RefreshDeps["buildFathomJob"]>>[0];
type ChatgptArgs = Parameters<NonNullable<RefreshDeps["buildChatgptJob"]>>[0];
type SelfArgs = Parameters<NonNullable<RefreshDeps["buildSelfJob"]>>[0];
/** A captured request whose `nowIso` clock callback was normalised by INVOKING it, never by deleting it. */
export type ClockRead<T> = Omit<T, "nowIso"> & { readonly nowIso: string };

export const HOME = "/home-lima";
export const TODAY = "2026-03-15";
export const NOW_ISO = "2026-03-14T09:26:53.000Z";

/**
 * A stable job identity; its `run` throws because job planning must never run what it plans.
 *
 * @returns the staged source-ingest job, carrying the given label and window
 */
export function job({
  source,
  label,
  window,
}: {
  source: CorpusSource;
  label: string;
  window: ExportWindow;
}): SourceIngestJob {
  return {
    label,
    run: () => {
      throw new Error(`job ${label} was run by a job-plan test`);
    },
    source,
    window,
  };
}

/** A seam the scenario never expects to be reached: calling it fails the test on the spot. */
function unusedSeam({ seam }: { seam: string }): () => never {
  return () => {
    throw new Error(`unused seam called: ${seam}`);
  };
}

/**
 * Parse real `refresh` flags, so the fixture stays aligned with the whole `RefreshOptions` contract.
 *
 * @returns the parsed refresh options those flags produce
 */
export function options({ rest }: { rest: readonly string[] }): RefreshOptions {
  return unwrap(parseRefreshOptions({ rest }));
}

interface Capture {
  readonly deps: RefreshDeps;
  readonly github: GithubArgs[];
  readonly org: OrgArgs[];
  readonly tokened: ClockRead<TokenedArgs>[];
  readonly gmail: ClockRead<GmailArgs>[];
  readonly calendar: ClockRead<CalendarArgs>[];
  readonly fathom: FathomArgs[];
  readonly chatgpt: ChatgptArgs[];
  readonly self: SelfArgs[];
  readonly info: string[];
  readonly warn: string[];
}

/**
 * A full `RefreshDeps` fake of plain capturing functions. Each builder hands back the job staged for its source
 * and records exactly what it was asked for; a seam the scenario does not supply throws when reached.
 *
 * @returns the capturing dependency fake beside every request each builder and the logger recorded
 */
// max-lines-exempt: one plain-object fake of the whole RefreshDeps interface, its length that interface's, moved verbatim out of a test file this gate skips
export function fakeDeps({
  jobs,
  wired,
  githubRefusal,
  slackRead,
  tokens,
  sourceProgress,
}: {
  jobs: Readonly<Partial<Record<CorpusSource, SourceIngestJob>>>;
  wired: { org: boolean; gmail: boolean; calendar: boolean; fathom: boolean; self: boolean; chatgpt?: boolean };
  githubRefusal?: readonly string[];
  slackRead?: { token?: string; warning?: string };
  tokens?: Readonly<Partial<Record<"slack" | "linear" | "notion", string>>>;
  sourceProgress?: SourceProgress;
}): Capture {
  const capture = {
    calendar: [] as ClockRead<CalendarArgs>[],
    chatgpt: [] as ChatgptArgs[],
    fathom: [] as FathomArgs[],
    github: [] as GithubArgs[],
    gmail: [] as ClockRead<GmailArgs>[],
    info: [] as string[],
    org: [] as OrgArgs[],
    self: [] as SelfArgs[],
    tokened: [] as ClockRead<TokenedArgs>[],
    warn: [] as string[],
  };
  const staged = ({ source }: { source: CorpusSource }): SourceIngestJob => {
    const found = jobs[source];
    if (found === undefined) {
      throw new Error(`no job staged for ${source}`);
    }
    return found;
  };
  const githubOutcome = (): ReturnType<RefreshDeps["buildGithubJob"]> =>
    githubRefusal !== undefined ? err(githubRefusal) : ok(staged({ source: "github" }));
  const buildGithubOrgJob: NonNullable<RefreshDeps["buildGithubOrgJob"]> = (args) => {
    capture.org.push(args);
    return githubOutcome();
  };
  const buildGmailJob: NonNullable<RefreshDeps["buildGmailJob"]> = (args) => {
    const { nowIso, ...rest } = args;
    capture.gmail.push({ ...rest, nowIso: nowIso() });
    return staged({ source: "gmail" });
  };
  const buildCalendarJob: NonNullable<RefreshDeps["buildCalendarJob"]> = (args) => {
    const { nowIso, ...rest } = args;
    capture.calendar.push({ ...rest, nowIso: nowIso() });
    return staged({ source: "calendar" });
  };
  const buildFathomJob: NonNullable<RefreshDeps["buildFathomJob"]> = (args) => {
    capture.fathom.push(args);
    return staged({ source: "fathom" });
  };
  const buildChatgptJob: NonNullable<RefreshDeps["buildChatgptJob"]> = (args) => {
    capture.chatgpt.push(args);
    return staged({ source: "chatgpt" });
  };
  const buildSelfJob: NonNullable<RefreshDeps["buildSelfJob"]> = (args) => {
    capture.self.push(args);
    return staged({ source: "self" });
  };
  const deps: RefreshDeps = {
    buildGithubJob: (args) => {
      capture.github.push(args);
      return githubOutcome();
    },
    buildSourceJob: (args) => {
      const { nowIso, ...rest } = args;
      capture.tokened.push({ ...rest, nowIso: nowIso() });
      return staged({ source: args.source });
    },
    home: unusedSeam({ seam: "home" }),
    ingestSources: unusedSeam({ seam: "ingestSources" }),
    logger: {
      error: unusedSeam({ seam: "logger.error" }),
      info: ({ msg }) => {
        capture.info.push(msg);
      },
      out: unusedSeam({ seam: "logger.out" }),
      warn: ({ msg }) => {
        capture.warn.push(msg);
      },
    },
    nowDate: () => new Date(NOW_ISO),
    readWatermark: unusedSeam({ seam: "readWatermark" }),
    resolveTokens: tokens !== undefined ? () => tokens : unusedSeam({ seam: "resolveTokens" }),
    slackReadToken: slackRead !== undefined ? () => slackRead : unusedSeam({ seam: "slackReadToken" }),
    ...(wired.org ? { buildGithubOrgJob } : {}),
    ...(wired.gmail ? { buildGmailJob } : {}),
    ...(wired.calendar ? { buildCalendarJob } : {}),
    ...(wired.fathom ? { buildFathomJob } : {}),
    ...(wired.chatgpt === true ? { buildChatgptJob } : {}),
    ...(wired.self ? { buildSelfJob } : {}),
    ...(sourceProgress !== undefined ? { sourceProgress } : {}),
  };
  return { ...capture, deps };
}

export const ALL_WIRED = { calendar: true, fathom: true, gmail: true, org: true, self: true };
export const NONE_WIRED = { calendar: false, fathom: false, gmail: false, org: false, self: false };
