/**
 * `buildRefreshJobs`' refusals: how a GitHub refusal, a planned self window or an unwired optional lane stops the
 * plan, and what was built and logged before it stopped.
 */
import { describe, expect, it } from "vitest";
import { buildRefreshJobs } from "../../../../../../cli/commands/refresh/jobPlan.js";
import type { RefreshWindow } from "../../../../../../cli/commands/refresh/windows.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { ALL_WIRED, fakeDeps, HOME, job, NONE_WIRED, NOW_ISO, options, TODAY } from "./fakeDeps.js";

describe("buildRefreshJobs — refusals", () => {
  it("stops at a single-repo GitHub refusal: the earlier window stands, nothing after it is built or logged", () => {
    const windows: readonly RefreshWindow[] = [
      { cursorOverridden: false, source: "calendar", window: { since: "2026-01-21", until: "2026-03-02" } },
      { cursorOverridden: true, source: "github", window: { since: "2026-02-22", until: "2026-03-03" } },
      { cursorOverridden: false, source: "notion", window: { since: "2025-12-23", until: "2026-03-04" } },
    ];
    const cap = fakeDeps({
      githubRefusal: ["repo-unresolvable-alpha", "remote-missing-bravo"],
      jobs: { calendar: job({ label: "label-vesper", source: "calendar", window: windows[0]!.window }) },
      wired: ALL_WIRED,
    });

    const result = buildRefreshJobs({
      deps: cap.deps,
      home: HOME,
      options: options({ rest: [] }),
      today: TODAY,
      windows,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toStrictEqual({
      code: "GITHUB_JOB_UNBUILDABLE",
      message: "repo-unresolvable-alpha; remote-missing-bravo",
      reasons: ["repo-unresolvable-alpha", "remote-missing-bravo"],
    });
    expect(cap.calendar).toStrictEqual([
      { cursorOverridden: false, home: HOME, nowIso: NOW_ISO, window: windows[0]!.window },
    ]);
    expect(cap.github).toStrictEqual([
      { bounded: false, home: HOME, noEnrich: false, repoSlug: undefined, window: windows[1]!.window },
    ]);
    expect(cap.tokened).toStrictEqual([]);
    expect(cap.info).toStrictEqual(["refresh calendar · window 2026-01-21..2026-03-02"]);
  });

  it("maps an org-mode GitHub refusal the same way", () => {
    const opts = options({ rest: ["--all-repos"] });
    const window = { since: "2026-02-24", until: "2026-03-05" };
    const cap = fakeDeps({
      githubRefusal: ["org-unresolvable-charlie", "token-scope-delta"],
      jobs: {},
      wired: ALL_WIRED,
    });

    const result = buildRefreshJobs({
      deps: cap.deps,
      home: HOME,
      options: opts,
      today: TODAY,
      windows: [{ cursorOverridden: false, source: "github", window }],
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toStrictEqual({
      code: "GITHUB_JOB_UNBUILDABLE",
      message: "org-unresolvable-charlie; token-scope-delta",
      reasons: ["org-unresolvable-charlie", "token-scope-delta"],
    });
    expect(cap.org).toStrictEqual([{ home: HOME, ignoreRepoCursors: false, options: opts, window }]);
    expect(cap.github).toStrictEqual([]);
    expect(cap.info).toStrictEqual([]);
  });

  // Both override values on each of gold and self, so skipping gold and refusing self read neither off the cursor.
  it.each([
    { goldOverridden: false, selfOverridden: true },
    { goldOverridden: true, selfOverridden: false },
  ])(
    "refuses a planned self window loudly, after a skipped gold window and before any later source (gold overridden $goldOverridden, self overridden $selfOverridden)",
    ({ goldOverridden, selfOverridden }) => {
      const cap = fakeDeps({ jobs: {}, wired: NONE_WIRED });

      const result = buildRefreshJobs({
        deps: cap.deps,
        home: HOME,
        options: options({ rest: [] }),
        today: TODAY,
        windows: [
          { cursorOverridden: goldOverridden, source: "gold", window: { since: "2026-01-25", until: "2026-03-06" } },
          { cursorOverridden: selfOverridden, source: "self", window: { since: "2026-01-26", until: "2026-03-07" } },
          { cursorOverridden: false, source: "slack", window: { since: "2026-01-27", until: "2026-03-08" } },
        ],
      });

      expect(result.isErr()).toBe(true);
      expect(unwrapErr(result)).toStrictEqual({
        code: "SELF_NOT_FETCHABLE",
        message: "refresh: self is not a fetchable source — use --self (a full local re-scan, no cursor)",
      });
      expect(cap.tokened).toStrictEqual([]);
      expect(cap.github).toStrictEqual([]);
      expect(cap.info).toStrictEqual([]);
      expect(cap.warn).toStrictEqual([]);
    },
  );

  // Each lane is refused both sampled with the cursor overridden and unsampled with it kept, so the refusal is
  // never conjoined with either.
  it.each(
    [
      {
        message: "refresh: gmail was requested but this build has no mail ingest lane wired",
        source: "gmail" as const,
        wired: { ...ALL_WIRED, gmail: false },
      },
      {
        message: "refresh: calendar was requested but this build has no diary ingest lane wired",
        source: "calendar" as const,
        wired: { ...ALL_WIRED, calendar: false },
      },
      {
        message: "refresh: fathom was requested but this build has no recorded-call ingest lane wired",
        source: "fathom" as const,
        wired: { ...ALL_WIRED, fathom: false },
      },
      {
        message: "refresh: chatgpt was requested but this build has no chat-history ingest lane wired",
        source: "chatgpt" as const,
        wired: { ...ALL_WIRED, chatgpt: false },
      },
      {
        // The fake deck wires no Outlook diary lane at all, so the refusal holds with every other lane wired.
        message: "refresh: outlook-calendar was requested but this build has no Outlook diary ingest lane wired",
        source: "outlook-calendar" as const,
        wired: ALL_WIRED,
      },
    ].flatMap((lane) => [
      { ...lane, cursorOverridden: true, rest: ["--sample", "3"] },
      { ...lane, cursorOverridden: false, rest: [] },
    ]),
  )(
    "refuses $source when its optional lane is not wired (cursor overridden $cursorOverridden)",
    ({ source, message, wired, cursorOverridden, rest }) => {
      const cap = fakeDeps({ jobs: {}, wired });

      const result = buildRefreshJobs({
        deps: cap.deps,
        home: HOME,
        options: options({ rest }),
        today: TODAY,
        windows: [{ cursorOverridden, source, window: { since: "2026-02-01", until: "2026-03-01" } }],
      });

      expect(result.isErr()).toBe(true);
      expect(unwrapErr(result)).toStrictEqual({ code: "LANE_NOT_WIRED", message, source });
      expect(cap.gmail).toStrictEqual([]);
      expect(cap.calendar).toStrictEqual([]);
      expect(cap.fathom).toStrictEqual([]);
      expect(cap.chatgpt).toStrictEqual([]);
      expect(cap.info).toStrictEqual([]);
    },
  );

  it("hands the chatgpt builder the home and the window, and nothing to narrow it with", () => {
    const window = { since: "1970-01-01", until: "2026-03-16" };
    const chatgptJob = job({ label: "label-chatgpt", source: "chatgpt", window });
    const cap = fakeDeps({ jobs: { chatgpt: chatgptJob }, wired: { ...ALL_WIRED, chatgpt: true } });

    const result = buildRefreshJobs({
      deps: cap.deps,
      home: HOME,
      options: options({ rest: ["--source", "chatgpt"] }),
      today: TODAY,
      windows: [{ cursorOverridden: false, source: "chatgpt", window }],
    });

    expect(unwrap(result)).toStrictEqual([chatgptJob]);
    expect(cap.chatgpt).toStrictEqual([{ home: HOME, window }]);
  });
});
