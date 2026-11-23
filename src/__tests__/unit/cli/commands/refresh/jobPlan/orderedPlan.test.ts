/**
 * `buildRefreshJobs` over one ordered mixed-source plan: which factory each planned window reaches, what every
 * factory is handed, which jobs come back in which order, and which window lines are logged.
 */
import { describe, expect, it } from "vitest";
import { buildRefreshJobs } from "../../../../../../cli/commands/refresh/jobPlan.js";
import type { RefreshWindow } from "../../../../../../cli/commands/refresh/windows.js";
import type { ExportWindow } from "../../../../../../corpus/types.js";
import { unwrap } from "../../../../../../lib/result.js";
import { ALL_WIRED, fakeDeps, HOME, job, NOW_ISO, options, TODAY } from "./fakeDeps.js";

describe("buildRefreshJobs — an ordered mixed-source plan", () => {
  const opts = options({
    rest: ["--repo", "owner-alpha/repo-bravo", "--slack-channel", "C-alpha", "--slack-channel", "C-bravo"],
  });
  const windows: readonly RefreshWindow[] = [
    { cursorOverridden: true, source: "github", window: { since: "2026-03-01", until: "2026-03-16" } },
    { cursorOverridden: false, source: "gold", window: { since: "2026-02-02", until: "2026-02-03" } },
    { cursorOverridden: false, source: "gmail", window: { since: "2026-01-04", until: "2026-03-12" } },
    { cursorOverridden: true, source: "calendar", window: { since: "2025-12-05", until: "2026-03-13" } },
    { cursorOverridden: true, source: "fathom", window: { since: "2025-11-06", until: "2026-03-11" } },
    { cursorOverridden: false, source: "slack", window: { since: "2025-10-07", until: "2026-03-10" } },
    { cursorOverridden: true, source: "linear", window: { since: "2025-09-08", until: "2026-03-09" } },
    { cursorOverridden: false, source: "notion", window: { since: "2025-08-09", until: "2026-03-17" } },
  ];
  const w = ({ at }: { at: number }): ExportWindow => windows[at]!.window;
  // Every staged job reports a window the plan never asked for, so a window line read off the returned job
  // rather than off the planned window prints these dates instead.
  const stagedDecoy: ExportWindow = { since: "2019-04-01", until: "2019-04-02" };
  const jobs = {
    calendar: job({ label: "label-november", source: "calendar", window: stagedDecoy }),
    fathom: job({ label: "label-oscar", source: "fathom", window: stagedDecoy }),
    github: job({ label: "label-kilo", source: "github", window: stagedDecoy }),
    gmail: job({ label: "label-mike", source: "gmail", window: stagedDecoy }),
    linear: job({ label: "label-quebec", source: "linear", window: stagedDecoy }),
    notion: job({ label: "label-romeo", source: "notion", window: stagedDecoy }),
    slack: job({ label: "label-papa", source: "slack", window: stagedDecoy }),
  };

  it("builds every non-gold source in window order, hands each factory exactly its slice, and logs each window", () => {
    const cap = fakeDeps({
      jobs,
      slackRead: { token: "slack-read-token-sierra", warning: "slack read warning whiskey" },
      tokens: { linear: "linear-token-tango", slack: "slack-resolved-decoy-victor", notion: "notion-token-uniform" },
      wired: ALL_WIRED,
    });

    const result = buildRefreshJobs({ deps: cap.deps, home: HOME, options: opts, today: TODAY, windows });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toStrictEqual([
      jobs.github,
      jobs.gmail,
      jobs.calendar,
      jobs.fathom,
      jobs.slack,
      jobs.linear,
      jobs.notion,
    ]);
    expect(cap.github).toStrictEqual([
      { bounded: false, home: HOME, noEnrich: false, repoSlug: "owner-alpha/repo-bravo", window: w({ at: 0 }) },
    ]);
    expect(cap.org).toStrictEqual([]);
    expect(cap.gmail).toStrictEqual([{ cursorOverridden: false, home: HOME, nowIso: NOW_ISO, window: w({ at: 2 }) }]);
    expect(cap.calendar).toStrictEqual([{ cursorOverridden: true, home: HOME, nowIso: NOW_ISO, window: w({ at: 3 }) }]);
    expect(cap.fathom).toStrictEqual([{ home: HOME, window: w({ at: 4 }) }]);
    expect(cap.tokened).toStrictEqual([
      {
        cursorOverridden: false,
        home: HOME,
        notionCaps: opts.notionCaps,
        nowIso: NOW_ISO,
        sampled: false,
        slackChannels: ["C-alpha", "C-bravo"],
        source: "slack",
        token: "slack-read-token-sierra",
        window: w({ at: 5 }),
      },
      {
        cursorOverridden: true,
        home: HOME,
        notionCaps: opts.notionCaps,
        nowIso: NOW_ISO,
        sampled: false,
        slackChannels: ["C-alpha", "C-bravo"],
        source: "linear",
        token: "linear-token-tango",
        window: w({ at: 6 }),
      },
      {
        cursorOverridden: false,
        home: HOME,
        notionCaps: opts.notionCaps,
        nowIso: NOW_ISO,
        sampled: false,
        slackChannels: ["C-alpha", "C-bravo"],
        source: "notion",
        token: "notion-token-uniform",
        window: w({ at: 7 }),
      },
    ]);
    expect(cap.self).toStrictEqual([]);
    expect(cap.warn).toStrictEqual(["slack read warning whiskey"]);
    expect(cap.info).toStrictEqual([
      "refresh github · window 2026-03-01..2026-03-15 · explicit window — pooled cursor ignored",
      "refresh gmail · window 2026-01-04..2026-03-12",
      "refresh calendar · window 2025-12-05..2026-03-13 · explicit window — pooled cursor ignored",
      "refresh fathom · window 2025-11-06..2026-03-11 · explicit window — pooled cursor ignored",
      "refresh slack · window 2025-10-07..2026-03-10",
      "refresh linear · window 2025-09-08..2026-03-09 · explicit window — pooled cursor ignored",
      "refresh notion · window 2025-08-09..2026-03-15",
    ]);
  });
});
