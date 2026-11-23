/**
 * `buildRefreshJobs`' progress adaptation: the one `sourceProgress` sink adapted per lane, GitHub per-item and
 * per-repo, every other lane passed through, under every flag, cap and cursor.
 */
import { describe, expect, it } from "vitest";
import { buildRefreshJobs } from "../../../../../../cli/commands/refresh/jobPlan.js";
import type { RefreshWindow } from "../../../../../../cli/commands/refresh/windows.js";
import type { SourceProgress, SourceProgressEvent } from "../../../../../../corpus/progress.js";
import type { ExportWindow } from "../../../../../../corpus/types.js";
import { ALL_WIRED, fakeDeps, HOME, job, NOW_ISO, options, TODAY } from "./fakeDeps.js";

describe("buildRefreshJobs — progress adaptation", () => {
  it("adapts the one sourceProgress sink per lane: GitHub per-item and per-repo, the rest passed through", () => {
    const progress: SourceProgressEvent[] = [];
    const sourceProgress: SourceProgress = (event) => {
      progress.push(event);
    };
    const singleOpts = options({ rest: ["--repo", "owner-hazel/repo-iris"] });
    // A passed-through sink reaches gmail with the cursor kept and slack with it overridden, so carrying the sink
    // is never read off whether the cursor was overridden.
    const singleWindows: readonly RefreshWindow[] = [
      { cursorOverridden: false, source: "github", window: { since: "2026-02-14", until: "2026-03-07" } },
      { cursorOverridden: false, source: "gmail", window: { since: "2026-01-15", until: "2026-03-06" } },
      { cursorOverridden: true, source: "calendar", window: { since: "2025-12-16", until: "2026-03-05" } },
      { cursorOverridden: true, source: "slack", window: { since: "2025-11-17", until: "2026-03-04" } },
    ];
    const sw = ({ at }: { at: number }): ExportWindow => singleWindows[at]!.window;
    const single = fakeDeps({
      jobs: {
        calendar: job({ label: "label-sable", source: "calendar", window: sw({ at: 2 }) }),
        github: job({ label: "label-quartz", source: "github", window: sw({ at: 0 }) }),
        gmail: job({ label: "label-raven", source: "gmail", window: sw({ at: 1 }) }),
        slack: job({ label: "label-topaz", source: "slack", window: sw({ at: 3 }) }),
      },
      // A warning on an OVERRIDDEN slack window with NO channels, against the ordered test's kept cursor and two
      // channels, so surfacing it is read off neither.
      slackRead: { token: "slack-read-progress-juniper", warning: "slack read warning kestrel" },
      sourceProgress,
      wired: ALL_WIRED,
    });

    const singleResult = buildRefreshJobs({
      deps: single.deps,
      home: HOME,
      options: singleOpts,
      today: TODAY,
      windows: singleWindows,
    });

    expect(singleResult.isOk()).toBe(true);
    const itemHook = single.github[0]!.onProgress!;
    expect(single.github).toStrictEqual([
      {
        bounded: false,
        home: HOME,
        noEnrich: false,
        onProgress: itemHook,
        repoSlug: "owner-hazel/repo-iris",
        window: sw({ at: 0 }),
      },
    ]);
    expect(single.gmail).toStrictEqual([
      { cursorOverridden: false, home: HOME, nowIso: NOW_ISO, onProgress: sourceProgress, window: sw({ at: 1 }) },
    ]);
    expect(single.calendar).toStrictEqual([
      { cursorOverridden: true, home: HOME, nowIso: NOW_ISO, window: sw({ at: 2 }) },
    ]);
    expect(single.tokened).toStrictEqual([
      {
        cursorOverridden: true,
        home: HOME,
        notionCaps: singleOpts.notionCaps,
        nowIso: NOW_ISO,
        onProgress: sourceProgress,
        sampled: false,
        slackChannels: [],
        source: "slack",
        token: "slack-read-progress-juniper",
        window: sw({ at: 3 }),
      },
    ]);
    expect(single.warn).toStrictEqual(["slack read warning kestrel"]);

    const slackEvent: SourceProgressEvent = {
      done: 7,
      lane: "heartbeat",
      phase: "channel",
      source: "slack",
      total: 31,
    };
    const gmailEvent: SourceProgressEvent = {
      done: 12,
      lane: "heartbeat",
      phase: "messages",
      source: "gmail",
      total: 44,
    };
    itemHook({ index: 4, number: 812, total: 19 });
    single.tokened[0]!.onProgress!(slackEvent);
    single.gmail[0]!.onProgress!(gmailEvent);

    const orgOpts = options({ rest: ["--all-repos", "--github-org", "org-jade"] });
    const orgWindow = { since: "2026-02-18", until: "2026-03-03" };
    const org = fakeDeps({
      jobs: { github: job({ label: "label-umber", source: "github", window: orgWindow }) },
      sourceProgress,
      wired: ALL_WIRED,
    });

    const orgResult = buildRefreshJobs({
      deps: org.deps,
      home: HOME,
      options: orgOpts,
      today: TODAY,
      windows: [{ cursorOverridden: true, source: "github", window: orgWindow }],
    });

    expect(orgResult.isOk()).toBe(true);
    const repoHook = org.org[0]!.onRepoProgress!;
    expect(org.org).toStrictEqual([
      { home: HOME, ignoreRepoCursors: true, onRepoProgress: repoHook, options: orgOpts, window: orgWindow },
    ]);
    expect(org.github).toStrictEqual([]);
    repoHook({ done: 6, recordCount: 144, repo: "repo-kestrel", total: 27 });

    expect(progress).toStrictEqual([
      { currentItem: { title: "#812" }, done: 4, lane: "heartbeat", phase: "items", source: "github", total: 19 },
      slackEvent,
      gmailEvent,
      {
        currentItem: { title: "repo-kestrel" },
        done: 6,
        lane: "heartbeat",
        metrics: { records: 144 },
        phase: "repos",
        source: "github",
        total: 27,
      },
    ]);
  });

  // The first test's sink rides an unflagged plan; this one holds the sink against every flag and cap, the
  // opposite cursor per lane, a second tokened source, and org mode under --numbers-only, so carrying the sink is
  // never conjoined with (or a stand-in for) any of them.
  it("carries the sink under the opposite cursors, every cap and flag, linear as well as slack, and numbers-only org mode", () => {
    const progress: SourceProgressEvent[] = [];
    const sourceProgress: SourceProgress = (event) => {
      progress.push(event);
    };
    const opts = options({
      rest: [
        "--sample",
        "9",
        "--fetch-cap",
        "19",
        "--refetch-unchanged",
        "--no-notion-attachments",
        "--no-enrich",
        "--repo",
        "owner-cedar/repo-dune",
        "--slack-channel",
        "C-fern",
      ],
    });
    const windows: readonly RefreshWindow[] = [
      { cursorOverridden: true, source: "github", window: { since: "2026-02-03", until: "2026-03-09" } },
      { cursorOverridden: true, source: "gmail", window: { since: "2026-01-05", until: "2026-03-10" } },
      { cursorOverridden: false, source: "calendar", window: { since: "2025-12-06", until: "2026-03-11" } },
      { cursorOverridden: true, source: "fathom", window: { since: "2025-11-07", until: "2026-03-12" } },
      { cursorOverridden: false, source: "slack", window: { since: "2025-10-08", until: "2026-03-13" } },
      { cursorOverridden: true, source: "linear", window: { since: "2025-09-09", until: "2026-03-14" } },
    ];
    const w = ({ at }: { at: number }): ExportWindow => windows[at]!.window;
    const run = fakeDeps({
      jobs: {
        calendar: job({ label: "refresh", source: "calendar", window: w({ at: 2 }) }),
        fathom: job({ label: "cursor", source: "fathom", window: w({ at: 3 }) }),
        github: job({ label: "window", source: "github", window: w({ at: 0 }) }),
        gmail: job({ label: "pooled", source: "gmail", window: w({ at: 1 }) }),
        linear: job({ label: "explicit", source: "linear", window: w({ at: 5 }) }),
        slack: job({ label: "window", source: "slack", window: w({ at: 4 }) }),
      },
      slackRead: { token: "slack-read-progress-larch" },
      sourceProgress,
      tokens: { linear: "linear-token-progress-maple" },
      wired: ALL_WIRED,
    });

    const result = buildRefreshJobs({ deps: run.deps, home: HOME, options: opts, today: TODAY, windows });

    expect(result.isOk()).toBe(true);
    const itemHook = run.github[0]!.onProgress!;
    expect(run.github).toStrictEqual([
      {
        bounded: true,
        home: HOME,
        noEnrich: true,
        onProgress: itemHook,
        repoSlug: "owner-cedar/repo-dune",
        window: w({ at: 0 }),
      },
    ]);
    expect(run.gmail).toStrictEqual([
      {
        cursorOverridden: true,
        fetchCap: 19,
        home: HOME,
        nowIso: NOW_ISO,
        onProgress: sourceProgress,
        sample: 9,
        window: w({ at: 1 }),
      },
    ]);
    expect(run.calendar).toStrictEqual([
      { cursorOverridden: false, fetchCap: 19, home: HOME, nowIso: NOW_ISO, sample: 9, window: w({ at: 2 }) },
    ]);
    expect(run.fathom).toStrictEqual([{ fetchCap: 19, home: HOME, sample: 9, window: w({ at: 3 }) }]);
    const tokenedShared = {
      fetchCap: 19,
      home: HOME,
      notionCaps: opts.notionCaps,
      nowIso: NOW_ISO,
      onProgress: sourceProgress,
      refetchUnchanged: true,
      sampled: true,
      slackChannels: ["C-fern"],
      withAttachments: false,
    };
    expect(run.tokened).toStrictEqual([
      {
        ...tokenedShared,
        cursorOverridden: false,
        source: "slack",
        token: "slack-read-progress-larch",
        window: w({ at: 4 }),
      },
      {
        ...tokenedShared,
        cursorOverridden: true,
        source: "linear",
        token: "linear-token-progress-maple",
        window: w({ at: 5 }),
      },
    ]);
    expect(run.warn).toStrictEqual([]);
    // Every label is a word its own line carries, and none is withheld: the sink is not --numbers-only.
    expect(run.info).toStrictEqual([
      "refresh github · window 2026-02-03..2026-03-09 · explicit window — pooled cursor ignored",
      "refresh gmail · window 2026-01-05..2026-03-10 · explicit window — pooled cursor ignored",
      "refresh calendar · window 2025-12-06..2026-03-11",
      "refresh fathom · window 2025-11-07..2026-03-12 · explicit window — pooled cursor ignored",
      "refresh slack · window 2025-10-08..2026-03-13",
      "refresh linear · window 2025-09-09..2026-03-14 · explicit window — pooled cursor ignored",
    ]);

    const orgOpts = options({ rest: ["--all-repos", "--github-org", "org-pine", "--numbers-only"] });
    const orgWindow = { since: "2026-02-18", until: "2026-03-03" };
    const org = fakeDeps({
      jobs: { github: job({ label: "refresh", source: "github", window: orgWindow }) },
      sourceProgress,
      wired: ALL_WIRED,
    });

    const orgResult = buildRefreshJobs({
      deps: org.deps,
      home: HOME,
      options: orgOpts,
      today: TODAY,
      windows: [{ cursorOverridden: false, source: "github", window: orgWindow }],
    });

    expect(orgResult.isOk()).toBe(true);
    const repoHook = org.org[0]!.onRepoProgress!;
    expect(org.org).toStrictEqual([
      { home: HOME, ignoreRepoCursors: false, onRepoProgress: repoHook, options: orgOpts, window: orgWindow },
    ]);
    expect(org.info).toStrictEqual(["[withheld] github · window 2026-02-18..2026-03-03"]);

    itemHook({ index: 2, number: 455, total: 8 });
    repoHook({ done: 3, recordCount: 61, repo: "repo-osprey", total: 5 });
    expect(progress).toStrictEqual([
      { currentItem: { title: "#455" }, done: 2, lane: "heartbeat", phase: "items", source: "github", total: 8 },
      {
        currentItem: { title: "repo-osprey" },
        done: 3,
        lane: "heartbeat",
        metrics: { records: 61 },
        phase: "repos",
        source: "github",
        total: 5,
      },
    ]);
  });
});
