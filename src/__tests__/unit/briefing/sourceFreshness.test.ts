import { describe, expect, it } from "vitest";

import { type FreshnessObservation, projectFreshness } from "../../../briefing/freshness.js";
import { projectSourceFreshness, sourceFreshnessLines } from "../../../briefing/sourceFreshness.js";
import { ResyncErrors, type ResyncState } from "../../../live/resync/outcome.js";
import { buildResyncPolicies } from "../../../live/resync/policy.js";

const HOUR = 60 * 60 * 1000;
const NOW = "2026-10-04T14:00:00.000Z";
const NOW_MS = Date.parse(NOW);

/** An instant `hours` before {@link NOW}. */
function hoursAgo({ hours }: { readonly hours: number }): string {
  return new Date(NOW_MS - hours * HOUR).toISOString();
}

const policies = buildResyncPolicies({
  atlases: [],
  corpus: [{ source: "slack", subject: { kind: "none" }, windowMs: 4 * HOUR }],
}).policies;

/** A succeeded Slack record whose last success was `hours` ago. */
function slackSucceeded({ hours }: { readonly hours: number }): ResyncState {
  return {
    blocker: null,
    lastAttempt: {
      afterClock: hoursAgo({ hours }),
      beforeClock: hoursAgo({ hours: hours + 4 }),
      exitCode: 0,
      finishedAtIso: hoursAgo({ hours }),
      outcome: "succeeded",
      problems: [],
      recipeId: "resync-corpus-slack",
      startedAtIso: hoursAgo({ hours: hours + 0.1 }),
    },
    lastSuccessAtIso: hoursAgo({ hours }),
    recipeId: "resync-corpus-slack",
  };
}

/** Slack's one row, projected through the briefing's own judge and then this module. */
function slackRow({
  state,
  observation,
  registered = ["resync-corpus-slack"],
  paused = [],
  unreadable = [],
}: {
  readonly state: ResyncState | undefined;
  readonly observation: FreshnessObservation;
  readonly registered?: readonly string[];
  readonly paused?: readonly string[];
  readonly unreadable?: Parameters<typeof projectFreshness>[0]["unreadable"];
}): ReturnType<typeof projectSourceFreshness>["sources"][number] {
  const rows = projectFreshness({
    nowIso: NOW,
    observations: [observation],
    paused,
    policies,
    registered,
    states: state === undefined ? new Map() : new Map([["resync-corpus-slack", state]]),
    unreadable,
  }).rows;
  return projectSourceFreshness({ nowIso: NOW, rosterProblems: [], rows, sources: ["slack"] }).sources[0]!;
}

describe("projectSourceFreshness", () => {
  it("carries one row per requested source in the requested order, even one the roster built no policy for", () => {
    const report = projectSourceFreshness({ nowIso: NOW, rosterProblems: [], rows: [], sources: ["github", "slack"] });
    expect(report.sources.map((row) => [row.label, row.state])).toEqual([
      ["GitHub", "unscheduled"],
      ["Slack", "unscheduled"],
    ]);
    expect(report.sources[0]!.problems).toEqual(["no scheduled resync is derived for github"]);
    expect(report.sources[0]!.windowMs).toBe(4 * HOUR);
  });

  it("gives an unrostered source the roster's own words for it and never the GitHub atlas's", () => {
    const report = projectSourceFreshness({
      nowIso: NOW,
      rosterProblems: [
        "atlas github: cannot resolve",
        "corpus github: the declared main checkouts name 2 organisations",
      ],
      rows: [],
      sources: ["github"],
    });
    expect(report.sources[0]!.problems).toEqual(["corpus github: the declared main checkouts name 2 organisations"]);
    expect(report.issues).toEqual([
      "atlas github: cannot resolve",
      "corpus github: the declared main checkouts name 2 organisations",
    ]);
  });

  it("reads a source synced inside its window as current, with its age and zero lateness", () => {
    const row = slackRow({
      observation: { clock: hoursAgo({ hours: 0.5 }), late: false, recipeId: "resync-corpus-slack" },
      state: slackSucceeded({ hours: 1 }),
    });
    expect(row.state).toBe("current");
    expect(row.behindMs).toBe(HOUR);
    expect(row.lateByMs).toBe(0);
    expect(row.newestRecordAgeMs).toBe(0.5 * HOUR);
    expect(row.lastVerifiedSyncAtIso).toBe("2026-10-04T13:00:00.000Z");
  });

  it("reads a source past its window as late, by how much", () => {
    const row = slackRow({
      observation: { clock: hoursAgo({ hours: 6 }), late: true, recipeId: "resync-corpus-slack" },
      state: slackSucceeded({ hours: 7 }),
    });
    expect(row.state).toBe("late");
    expect(row.lateByMs).toBe(3 * HOUR);
    expect(row.marks.late).toBe(true);
  });

  it("names a failing sync in its record's own words and keeps the lateness mark beside it", () => {
    const failed: ResyncState = {
      ...slackSucceeded({ hours: 9 }),
      lastAttempt: {
        afterClock: hoursAgo({ hours: 9 }),
        beforeClock: hoursAgo({ hours: 9 }),
        exitCode: 1,
        finishedAtIso: hoursAgo({ hours: 1 }),
        outcome: "failed",
        problems: ["`slopweaver refresh --source slack --store` exited 1"],
        recipeId: "resync-corpus-slack",
        startedAtIso: hoursAgo({ hours: 1.1 }),
      },
    };
    const row = slackRow({
      observation: { clock: hoursAgo({ hours: 9 }), late: true, recipeId: "resync-corpus-slack" },
      state: failed,
    });
    expect(row.state).toBe("failing");
    expect(row.problems).toEqual(["`slopweaver refresh --source slack --store` exited 1"]);
    expect(row.marks).toEqual({
      blocked: false,
      failing: true,
      late: true,
      paused: false,
      recordUnreadable: false,
      unscheduled: false,
      unverified: false,
    });
    expect(row.lastAttemptAtIso).toBe("2026-10-04T13:00:00.000Z");
  });

  it("puts a blocker above a failure and carries its reason and steps", () => {
    const blocked: ResyncState = {
      ...slackSucceeded({ hours: 9 }),
      blocker: {
        findingSlug: null,
        key: "signed-out",
        reason: "the Slack token was revoked",
        steps: ["Re-issue the bot token", "Store it with `slopweaver secrets set slack`"],
      },
    };
    const row = slackRow({
      observation: { clock: hoursAgo({ hours: 9 }), late: true, recipeId: "resync-corpus-slack" },
      state: blocked,
    });
    expect(row.state).toBe("blocked");
    expect(row.problems).toEqual(["the Slack token was revoked"]);
    expect(row.blocker!.steps).toEqual(["Re-issue the bot token", "Store it with `slopweaver secrets set slack`"]);
  });

  it("reads a disabled row as paused and a missing one as unscheduled", () => {
    const observation = { clock: hoursAgo({ hours: 1 }), late: false, recipeId: "resync-corpus-slack" };
    const state = slackSucceeded({ hours: 1 });
    expect(slackRow({ observation, paused: ["resync-corpus-slack"], registered: [], state }).state).toBe("paused");
    expect(slackRow({ observation, registered: [], state }).state).toBe("unscheduled");
  });

  it("reads a source with no recorded success as never synced", () => {
    const row = slackRow({
      observation: { clock: null, late: true, recipeId: "resync-corpus-slack" },
      state: undefined,
    });
    expect(row.state).toBe("never-synced");
    expect(row.behindMs).toBe(null);
    expect(row.lateByMs).toBe(null);
  });

  it("reads a record that cannot be believed as unreadable, above everything else", () => {
    const corrupt = ResyncErrors.stateCorrupt({
      detail: "not JSON",
      path: "/home/live/recipe/resync-state/resync-corpus-slack.json",
      recipeId: "resync-corpus-slack",
    });
    const row = slackRow({
      observation: { clock: hoursAgo({ hours: 9 }), late: true, recipeId: "resync-corpus-slack" },
      state: undefined,
      unreadable: [corrupt],
    });
    expect(row.state).toBe("unreadable");
    expect(row.problems).toEqual([corrupt.message]);
  });

  it("reads a fresh sync over an old store clock as unverified, never current", () => {
    const row = slackRow({
      observation: {
        clock: hoursAgo({ hours: 48 }),
        clockLagsWindow: true,
        late: false,
        recipeId: "resync-corpus-slack",
      },
      state: slackSucceeded({ hours: 1 }),
    });
    expect(row.state).toBe("unverified");
  });
});

describe("sourceFreshnessLines", () => {
  it("prints one line per source with its age and lateness, problems indented, then the issues", () => {
    const report = projectSourceFreshness({
      nowIso: NOW,
      rosterProblems: ["corpus fathom: no key"],
      rows: projectFreshness({
        nowIso: NOW,
        observations: [{ clock: hoursAgo({ hours: 6 }), late: true, recipeId: "resync-corpus-slack" }],
        paused: [],
        policies,
        registered: ["resync-corpus-slack"],
        states: new Map([["resync-corpus-slack", slackSucceeded({ hours: 7 })]]),
        unreadable: [],
      }).rows,
      sources: ["slack", "fathom"],
    });
    expect(sourceFreshnessLines({ report })).toEqual([
      "Slack — late; last verified sync 7.0h ago, 3.0h past its window; newest stored record 6.0h old",
      "Fathom — unscheduled; no verified sync on record; no stored record",
      "    corpus fathom: no key",
      "issue: corpus fathom: no key",
    ]);
  });
});
