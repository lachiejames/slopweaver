/**
 * `buildRefreshJobs` across the option matrix: five rows whose flags never share a column, each read off what
 * every factory is handed and which window lines are logged (and withheld under `--numbers-only`), plus the
 * single-repo fallback when `--all-repos` has no org seam wired.
 */
import { describe, expect, it } from "vitest";
import type { RefreshOptions } from "../../../../../../cli/commands/refresh/core.js";
import { buildRefreshJobs } from "../../../../../../cli/commands/refresh/jobPlan.js";
import type { RefreshWindow } from "../../../../../../cli/commands/refresh/windows.js";
import type { SourceIngestJob } from "../../../../../../corpus/ingestJob.js";
import type { ExportWindow } from "../../../../../../corpus/types.js";
import { unwrap } from "../../../../../../lib/result.js";
import {
  ALL_WIRED,
  type CalendarArgs,
  type ClockRead,
  type FathomArgs,
  fakeDeps,
  type GithubArgs,
  type GmailArgs,
  HOME,
  job,
  NONE_WIRED,
  NOW_ISO,
  type OrgArgs,
  options,
  TODAY,
  type TokenedArgs,
} from "./fakeDeps.js";

interface MatrixRow {
  readonly name: string;
  readonly opts: RefreshOptions;
  readonly windows: readonly RefreshWindow[];
  readonly jobs: Readonly<Record<"github" | "gmail" | "calendar" | "fathom" | "notion", SourceIngestJob>>;
  readonly notionToken: string;
  readonly github: readonly GithubArgs[];
  readonly org: readonly OrgArgs[];
  readonly gmail: readonly ClockRead<GmailArgs>[];
  readonly calendar: readonly ClockRead<CalendarArgs>[];
  readonly fathom: readonly FathomArgs[];
  readonly tokened: readonly ClockRead<TokenedArgs>[];
  readonly info: readonly string[];
}

/** One matrix row's five windows, every one sharing the row's override flag. */
function rowWindows({
  cursorOverridden,
  spans,
}: {
  cursorOverridden: boolean;
  spans: readonly [ExportWindow, ExportWindow, ExportWindow, ExportWindow, ExportWindow];
}): readonly RefreshWindow[] {
  const sources = ["github", "gmail", "calendar", "fathom", "notion"] as const;
  return sources.map((source, index) => ({ cursorOverridden, source, window: spans[index]! }));
}

/** The five staged jobs for one matrix row, each window taken from that row's own plan. */
function rowJobs({
  windows,
  labels,
}: {
  windows: readonly RefreshWindow[];
  labels: readonly [string, string, string, string, string];
}): MatrixRow["jobs"] {
  return {
    calendar: job({ label: labels[2], source: "calendar", window: windows[2]!.window }),
    fathom: job({ label: labels[3], source: "fathom", window: windows[3]!.window }),
    github: job({ label: labels[0], source: "github", window: windows[0]!.window }),
    gmail: job({ label: labels[1], source: "gmail", window: windows[1]!.window }),
    notion: job({ label: labels[4], source: "notion", window: windows[4]!.window }),
  };
}

// allRepos=[F,F,T,F,F] noEnrich=[F,T,F,T,T] numbersOnly=[T,F,F,F,T] refetchUnchanged=[F,T,T,F,T]
// noNotionAttachments=[T,F,T,T,F] cursorOverridden=[T,T,F,F,F] sample=[11,12,13,-,-] fetchCap=[-,22,23,24,25]
// No two booleans, and no boolean and a cap's presence, share a column across the five rows — nor are any two
// columns each other's negation, so no flag can be read off another's value or its inverse.
const ROW_ONE = ((): MatrixRow => {
  const opts = options({
    rest: [
      "--numbers-only",
      "--no-notion-attachments",
      "--sample",
      "11",
      "--repo",
      "owner-xray/repo-yankee",
      "--slack-channel",
      "C-zulu",
      "--source",
      "notion",
      "--notion-item-time",
      "7m",
    ],
  });
  const windows = rowWindows({
    cursorOverridden: true,
    spans: [
      { since: "2026-02-01", until: "2026-02-20" },
      { since: "2026-01-02", until: "2026-02-21" },
      { since: "2025-12-03", until: "2026-02-22" },
      { since: "2025-11-04", until: "2026-02-23" },
      { since: "2025-10-05", until: "2026-02-24" },
    ],
  });
  const w = ({ at }: { at: number }): ExportWindow => windows[at]!.window;
  return {
    calendar: [{ cursorOverridden: true, home: HOME, nowIso: NOW_ISO, sample: 11, window: w({ at: 2 }) }],
    fathom: [{ home: HOME, sample: 11, window: w({ at: 3 }) }],
    github: [{ bounded: true, home: HOME, noEnrich: false, repoSlug: "owner-xray/repo-yankee", window: w({ at: 0 }) }],
    gmail: [{ cursorOverridden: true, home: HOME, nowIso: NOW_ISO, sample: 11, window: w({ at: 1 }) }],
    // Each label is a word its own window line carries, so withholding it is visible in the line.
    info: [
      "refresh github · [withheld] 2026-02-01..2026-02-20 · explicit [withheld] — pooled cursor ignored",
      "refresh gmail · window 2026-01-02..2026-02-21 · explicit window — [withheld] cursor ignored",
      "refresh calendar · window 2025-12-03..2026-02-22 · explicit window — pooled [withheld] ignored",
      "refresh fathom · window 2025-11-04..2026-02-23 · explicit window — pooled cursor [withheld]",
      "refresh notion · window 2025-10-05..2026-02-24 · [withheld] window — pooled cursor ignored",
    ],
    jobs: rowJobs({ labels: ["window", "pooled", "cursor", "ignored", "explicit"], windows }),
    name: "numbers-only single-repo, bounded by --sample, attachments withheld, cursor overridden",
    notionToken: "notion-token-row-one",
    opts,
    org: [],
    tokened: [
      {
        cursorOverridden: true,
        home: HOME,
        notionCaps: { ...opts.notionCaps, itemTimeBudgetMs: 420_000 },
        nowIso: NOW_ISO,
        sampled: true,
        slackChannels: ["C-zulu"],
        source: "notion",
        token: "notion-token-row-one",
        window: w({ at: 4 }),
        withAttachments: false,
      },
    ],
    windows,
  };
})();

const ROW_TWO = ((): MatrixRow => {
  const opts = options({
    rest: [
      "--no-enrich",
      "--refetch-unchanged",
      "--fetch-cap",
      "22",
      "--sample",
      "12",
      "--slack-channel",
      "C-dune",
      "--slack-channel",
      "C-ember",
    ],
  });
  const windows = rowWindows({
    cursorOverridden: true,
    spans: [
      { since: "2026-02-06", until: "2026-02-25" },
      { since: "2026-01-07", until: "2026-02-26" },
      { since: "2025-12-08", until: "2026-02-27" },
      { since: "2025-11-09", until: "2026-02-28" },
      { since: "2025-10-10", until: "2026-03-01" },
    ],
  });
  const w = ({ at }: { at: number }): ExportWindow => windows[at]!.window;
  return {
    calendar: [{ cursorOverridden: true, fetchCap: 22, home: HOME, nowIso: NOW_ISO, sample: 12, window: w({ at: 2 }) }],
    fathom: [{ fetchCap: 22, home: HOME, sample: 12, window: w({ at: 3 }) }],
    github: [{ bounded: true, home: HOME, noEnrich: true, repoSlug: undefined, window: w({ at: 0 }) }],
    gmail: [{ cursorOverridden: true, fetchCap: 22, home: HOME, nowIso: NOW_ISO, sample: 12, window: w({ at: 1 }) }],
    // The same kind of labels as row one, on lines that are NOT numbers-only: every one must survive intact.
    info: [
      "refresh github · window 2026-02-06..2026-02-25 · explicit window — pooled cursor ignored",
      "refresh gmail · window 2026-01-07..2026-02-26 · explicit window — pooled cursor ignored",
      "refresh calendar · window 2025-12-08..2026-02-27 · explicit window — pooled cursor ignored",
      "refresh fathom · window 2025-11-09..2026-02-28 · explicit window — pooled cursor ignored",
      "refresh notion · window 2025-10-10..2026-03-01 · explicit window — pooled cursor ignored",
    ],
    jobs: rowJobs({ labels: ["explicit", "window", "ignored", "pooled", "cursor"], windows }),
    name: "plain single-repo with --no-enrich, bounded by both caps, refetching unchanged, cursor overridden",
    notionToken: "notion-token-row-two",
    opts,
    org: [],
    tokened: [
      {
        cursorOverridden: true,
        fetchCap: 22,
        home: HOME,
        notionCaps: opts.notionCaps,
        nowIso: NOW_ISO,
        refetchUnchanged: true,
        sampled: true,
        slackChannels: ["C-dune", "C-ember"],
        source: "notion",
        token: "notion-token-row-two",
        window: w({ at: 4 }),
      },
    ],
    windows,
  };
})();

const ROW_THREE = ((): MatrixRow => {
  const opts = options({
    rest: [
      "--all-repos",
      "--refetch-unchanged",
      "--no-notion-attachments",
      "--sample",
      "13",
      "--fetch-cap",
      "23",
      "--repo",
      "owner-amber/repo-basalt",
      "--slack-channel",
      "C-cobalt",
    ],
  });
  const windows = rowWindows({
    cursorOverridden: false,
    spans: [
      { since: "2026-02-11", until: "2026-03-02" },
      { since: "2026-01-12", until: "2026-03-03" },
      { since: "2025-12-13", until: "2026-03-04" },
      { since: "2025-11-14", until: "2026-03-05" },
      { since: "2025-10-15", until: "2026-03-06" },
    ],
  });
  const w = ({ at }: { at: number }): ExportWindow => windows[at]!.window;
  return {
    calendar: [
      { cursorOverridden: false, fetchCap: 23, home: HOME, nowIso: NOW_ISO, sample: 13, window: w({ at: 2 }) },
    ],
    fathom: [{ fetchCap: 23, home: HOME, sample: 13, window: w({ at: 3 }) }],
    github: [],
    gmail: [{ cursorOverridden: false, fetchCap: 23, home: HOME, nowIso: NOW_ISO, sample: 13, window: w({ at: 1 }) }],
    info: [
      "refresh github · window 2026-02-11..2026-03-02",
      "refresh gmail · window 2026-01-12..2026-03-03",
      "refresh calendar · window 2025-12-13..2026-03-04",
      "refresh fathom · window 2025-11-14..2026-03-05",
      "refresh notion · window 2025-10-15..2026-03-06",
    ],
    jobs: rowJobs({ labels: ["refresh", "org-umbrella", "diary-amber", "calls-basalt", "pages-cobalt"], windows }),
    name: "org mode, bounded by both caps, refetching unchanged, attachments withheld, stored cursor kept",
    notionToken: "notion-token-row-three",
    opts,
    org: [{ home: HOME, ignoreRepoCursors: false, options: opts, window: w({ at: 0 }) }],
    tokened: [
      {
        cursorOverridden: false,
        fetchCap: 23,
        home: HOME,
        notionCaps: opts.notionCaps,
        nowIso: NOW_ISO,
        refetchUnchanged: true,
        sampled: true,
        slackChannels: ["C-cobalt"],
        source: "notion",
        token: "notion-token-row-three",
        window: w({ at: 4 }),
        withAttachments: false,
      },
    ],
    windows,
  };
})();

// The fourth row splits every boolean the first three left paired: attachments withheld WITHOUT --sample (so
// `sampled` is not `noNotionAttachments`), and --fetch-cap WITHOUT --refetch-unchanged.
const ROW_FOUR = ((): MatrixRow => {
  const opts = options({
    rest: [
      "--no-enrich",
      "--no-notion-attachments",
      "--fetch-cap",
      "24",
      "--repo",
      "owner-quartz/repo-ridge",
      "--slack-channel",
      "C-flint",
    ],
  });
  const windows = rowWindows({
    cursorOverridden: false,
    spans: [
      { since: "2026-02-16", until: "2026-03-07" },
      { since: "2026-01-17", until: "2026-03-08" },
      { since: "2025-12-18", until: "2026-03-09" },
      { since: "2025-11-19", until: "2026-03-10" },
      { since: "2025-10-20", until: "2026-03-11" },
    ],
  });
  const w = ({ at }: { at: number }): ExportWindow => windows[at]!.window;
  return {
    calendar: [{ cursorOverridden: false, fetchCap: 24, home: HOME, nowIso: NOW_ISO, window: w({ at: 2 }) }],
    fathom: [{ fetchCap: 24, home: HOME, window: w({ at: 3 }) }],
    github: [{ bounded: true, home: HOME, noEnrich: true, repoSlug: "owner-quartz/repo-ridge", window: w({ at: 0 }) }],
    gmail: [{ cursorOverridden: false, fetchCap: 24, home: HOME, nowIso: NOW_ISO, window: w({ at: 1 }) }],
    info: [
      "refresh github · window 2026-02-16..2026-03-07",
      "refresh gmail · window 2026-01-17..2026-03-08",
      "refresh calendar · window 2025-12-18..2026-03-09",
      "refresh fathom · window 2025-11-19..2026-03-10",
      "refresh notion · window 2025-10-20..2026-03-11",
    ],
    jobs: rowJobs({ labels: ["repo-ridge", "inbox-quartz", "agenda-flint", "meetings-slate", "wiki-tarn"], windows }),
    name: "single-repo with --no-enrich, bounded by --fetch-cap alone, attachments withheld unsampled, stored cursor kept",
    notionToken: "notion-token-row-four",
    opts,
    org: [],
    tokened: [
      {
        cursorOverridden: false,
        fetchCap: 24,
        home: HOME,
        notionCaps: opts.notionCaps,
        nowIso: NOW_ISO,
        sampled: false,
        slackChannels: ["C-flint"],
        source: "notion",
        token: "notion-token-row-four",
        window: w({ at: 4 }),
        withAttachments: false,
      },
    ],
    windows,
  };
})();

// The fifth row is numbers-only WITH a fetch cap, so numbers-only is not the negation of the cap's presence —
// and, against row one, numbers-only with the cursor kept, unsampled, unenriched and refetching, so withholding
// is never conjoined with any of those.
const ROW_FIVE = ((): MatrixRow => {
  const opts = options({
    rest: [
      "--numbers-only",
      "--no-enrich",
      "--refetch-unchanged",
      "--fetch-cap",
      "25",
      "--repo",
      "owner-sierra/repo-tundra",
      "--slack-channel",
      "C-granite",
    ],
  });
  const windows = rowWindows({
    cursorOverridden: false,
    spans: [
      { since: "2026-02-21", until: "2026-03-12" },
      { since: "2026-01-22", until: "2026-03-13" },
      { since: "2025-12-23", until: "2026-03-14" },
      { since: "2025-11-24", until: "2026-03-15" },
      { since: "2025-10-25", until: "2026-03-11" },
    ],
  });
  const w = ({ at }: { at: number }): ExportWindow => windows[at]!.window;
  return {
    calendar: [{ cursorOverridden: false, fetchCap: 25, home: HOME, nowIso: NOW_ISO, window: w({ at: 2 }) }],
    fathom: [{ fetchCap: 25, home: HOME, window: w({ at: 3 }) }],
    github: [{ bounded: true, home: HOME, noEnrich: true, repoSlug: "owner-sierra/repo-tundra", window: w({ at: 0 }) }],
    gmail: [{ cursorOverridden: false, fetchCap: 25, home: HOME, nowIso: NOW_ISO, window: w({ at: 1 }) }],
    // Each label is a word its own (un-overridden) line carries.
    info: [
      "[withheld] github · window 2026-02-21..2026-03-12",
      "refresh gmail · [withheld] 2026-01-22..2026-03-13",
      "refresh [withheld] · window 2025-12-23..2026-03-14",
      "refresh fathom · [withheld] 2025-11-24..2026-03-15",
      "[withheld] notion · window 2025-10-25..2026-03-11",
    ],
    jobs: rowJobs({ labels: ["refresh", "window", "calendar", "window", "refresh"], windows }),
    name: "numbers-only single-repo with --no-enrich, bounded by --fetch-cap alone, refetching, stored cursor kept",
    notionToken: "notion-token-row-five",
    opts,
    org: [],
    tokened: [
      {
        cursorOverridden: false,
        fetchCap: 25,
        home: HOME,
        notionCaps: opts.notionCaps,
        nowIso: NOW_ISO,
        refetchUnchanged: true,
        sampled: false,
        slackChannels: ["C-granite"],
        source: "notion",
        token: "notion-token-row-five",
        window: w({ at: 4 }),
      },
    ],
    windows,
  };
})();

describe("buildRefreshJobs — the option matrix", () => {
  it.each([ROW_ONE, ROW_TWO, ROW_THREE, ROW_FOUR, ROW_FIVE])("$name", (row) => {
    const cap = fakeDeps({
      jobs: row.jobs,
      tokens: { linear: "linear-decoy-token", notion: row.notionToken },
      wired: ALL_WIRED,
    });

    const result = buildRefreshJobs({
      deps: cap.deps,
      home: HOME,
      options: row.opts,
      today: TODAY,
      windows: row.windows,
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toStrictEqual([
      row.jobs.github,
      row.jobs.gmail,
      row.jobs.calendar,
      row.jobs.fathom,
      row.jobs.notion,
    ]);
    expect(cap.github).toStrictEqual(row.github);
    expect(cap.org).toStrictEqual(row.org);
    expect(cap.gmail).toStrictEqual(row.gmail);
    expect(cap.calendar).toStrictEqual(row.calendar);
    expect(cap.fathom).toStrictEqual(row.fathom);
    expect(cap.tokened).toStrictEqual(row.tokened);
    expect(cap.info).toStrictEqual(row.info);
    expect(cap.warn).toStrictEqual([]);
  });

  // Sampled with the cursor overridden, then unbounded with it kept, so the fallback is conjoined with neither.
  it.each([
    {
      bounded: true,
      cursorOverridden: true,
      line: "refresh github · window 2026-01-20..2026-03-08 · explicit window — pooled cursor ignored",
      rest: ["--all-repos", "--repo", "owner-lotus/repo-maple", "--sample", "5"],
    },
    {
      bounded: false,
      cursorOverridden: false,
      line: "refresh github · window 2026-01-20..2026-03-08",
      rest: ["--all-repos", "--repo", "owner-lotus/repo-maple"],
    },
  ])(
    "falls back to the single-repo job when --all-repos is asked for but no org seam is wired (cursor overridden $cursorOverridden)",
    ({ bounded, cursorOverridden, line, rest }) => {
      const opts = options({ rest });
      const window = { since: "2026-01-20", until: "2026-03-08" };
      const githubJob = job({ label: "label-nimbus", source: "github", window });
      const cap = fakeDeps({ jobs: { github: githubJob }, wired: NONE_WIRED });

      const result = buildRefreshJobs({
        deps: cap.deps,
        home: HOME,
        options: opts,
        today: TODAY,
        windows: [{ cursorOverridden, source: "github", window }],
      });

      expect(result.isOk()).toBe(true);
      expect(unwrap(result)).toStrictEqual([githubJob]);
      expect(cap.github).toStrictEqual([
        { bounded, home: HOME, noEnrich: false, repoSlug: "owner-lotus/repo-maple", window },
      ]);
      expect(cap.org).toStrictEqual([]);
      expect(cap.info).toStrictEqual([line]);
    },
  );
});
