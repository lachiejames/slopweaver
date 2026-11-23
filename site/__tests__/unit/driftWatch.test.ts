/*
 * The pure half of the drift watch: which window is on-plan, when a drift is owed, and how a line said or waved off
 * moves it. A notice that the work has drifted from the plan is useful even when the drift is intended.
 */
import { describe, expect, it } from "vitest";

import { DRIFT_MAX_MINUTES } from "../../lib/driftNotice";
import {
  activityKeyOf,
  activityOnPlan,
  DRIFT_COOLDOWN_MS,
  DRIFT_DWELL_MS,
  DRIFT_QUIET_MS,
  type DriftWatchInput,
  type DriftWatchState,
  driftOwed,
  type FocusPlan,
  type FrontWindowActivity,
  foldDriftWatch,
  frontWindowActivityOf,
  IDLE_DRIFT_WATCH,
  isBrowserName,
} from "../../lib/driftWatch";

const PLAN: FocusPlan = {
  apps: ["linear", "google chrome"],
  heard: "I'm gonna do the ISO access review first",
  keywords: ["iso", "access review"],
  plan: "do the ISO access review",
};

const SLACK: FrontWindowActivity = { app: "Slack", bundleId: "com.tinyspeck.slackmacgap", title: "#dev-platform" };
const MAIL: FrontWindowActivity = { app: "Mail", bundleId: "com.apple.mail", title: "Inbox" };
const CHROME: FrontWindowActivity = { app: "Google Chrome", bundleId: "com.google.Chrome", title: "YouTube" };

/** The watch after a run of inputs from a fresh plan. */
function run({ inputs, from = IDLE_DRIFT_WATCH }: { inputs: readonly DriftWatchInput[]; from?: DriftWatchState }) {
  return inputs.reduce((state, input) => foldDriftWatch({ input, state }), from);
}

/** One sample of a window at an instant. */
const sample = ({
  activity,
  nowMs,
  freshId = `id-${String(nowMs)}`,
}: {
  activity: FrontWindowActivity | undefined;
  nowMs: number;
  freshId?: string;
}): DriftWatchInput => ({ activity, freshId, kind: "sample", nowMs });

const SET: DriftWatchInput = { kind: "set", plan: PLAN };

describe("activityOnPlan", () => {
  it("takes a named application, never a browser by its name, and always Slopweaver", () => {
    expect([
      activityOnPlan({ activity: { app: "Linear", bundleId: "com.linear", title: "My issues" }, plan: PLAN }),
      activityOnPlan({ activity: CHROME, plan: PLAN }),
      activityOnPlan({ activity: { app: "Slopweaver", bundleId: null, title: null }, plan: PLAN }),
      activityOnPlan({
        activity: { app: "Electron", bundleId: "ai.slopweaver.desktop", title: "Console" },
        plan: PLAN,
      }),
      activityOnPlan({ activity: SLACK, plan: PLAN }),
    ]).toEqual([true, false, true, true, false]);
  });

  it("takes any application whose title holds a plan word as a whole phrase, and not as part of a word", () => {
    expect([
      activityOnPlan({ activity: { ...CHROME, title: "ISO 27001 controls – Vanta" }, plan: PLAN }),
      activityOnPlan({ activity: { ...SLACK, title: "#security · Access  Review thread" }, plan: PLAN }),
      activityOnPlan({ activity: { ...CHROME, title: "isomorphic rendering" }, plan: PLAN }),
      activityOnPlan({ activity: { ...CHROME, title: null }, plan: PLAN }),
    ]).toEqual([true, true, false, false]);
  });
});

describe("frontWindowActivityOf", () => {
  it("takes exactly a name with a bundle id and a title, each a string or null", () => {
    expect([
      frontWindowActivityOf({ value: SLACK }),
      frontWindowActivityOf({ value: { app: "Slack", bundleId: null, title: null } }),
    ]).toEqual([SLACK, { app: "Slack", bundleId: null, title: null }]);
  });

  it("takes no refusal, and nothing else, as a sample", () => {
    expect([
      frontWindowActivityOf({ value: { why: "the owner's screen is locked" } }),
      frontWindowActivityOf({ value: { ...SLACK, extra: 1 } }),
      frontWindowActivityOf({ value: { ...SLACK, title: 3 } }),
      frontWindowActivityOf({ value: { ...SLACK, app: " " } }),
      frontWindowActivityOf({ value: [SLACK] }),
      frontWindowActivityOf({ value: undefined }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("isBrowserName", () => {
  it("names the browsers focus_set refuses as applications", () => {
    expect([
      isBrowserName({ name: " Google  Chrome " }),
      isBrowserName({ name: "Arc" }),
      isBrowserName({ name: "Slack" }),
    ]).toEqual([true, true, false]);
  });
});

describe("activityKeyOf", () => {
  it("tells two titles of one application apart, and a missing title from an empty one", () => {
    expect([
      activityKeyOf({ activity: SLACK }),
      activityKeyOf({ activity: { ...SLACK, title: "#general" } }),
      activityKeyOf({ activity: { ...SLACK, title: null } }),
      activityKeyOf({ activity: { ...SLACK, title: "" } }),
    ]).toEqual([
      '["slack","com.tinyspeck.slackmacgap","#dev-platform"]',
      '["slack","com.tinyspeck.slackmacgap","#general"]',
      '["slack","com.tinyspeck.slackmacgap",null]',
      '["slack","com.tinyspeck.slackmacgap",""]',
    ]);
  });

  it("tells two applications of one display name apart by bundle id, so neither inherits the other's dwell", () => {
    const one: FrontWindowActivity = { app: "Othercompany", bundleId: "com.example.one", title: "Inbox" };
    const two: FrontWindowActivity = { ...one, bundleId: "com.example.two" };
    const state = run({
      inputs: [SET, sample({ activity: one, nowMs: 0 }), sample({ activity: two, nowMs: 60_000 })],
    });
    const after = foldDriftWatch({
      input: sample({ activity: two, freshId: "drift-1", nowMs: DRIFT_DWELL_MS }),
      state,
    });
    expect(driftOwed({ nowMs: DRIFT_DWELL_MS, state: after })).toBe(undefined);
  });
});

describe("foldDriftWatch and driftOwed", () => {
  it("owes nothing before the dwell, and the line once one off-plan window has held the front for it", () => {
    const early = run({
      inputs: [SET, sample({ activity: SLACK, nowMs: 0 }), sample({ activity: SLACK, nowMs: DRIFT_DWELL_MS - 1 })],
    });
    expect(driftOwed({ nowMs: DRIFT_DWELL_MS - 1, state: early })).toBe(undefined);
    const due = foldDriftWatch({
      input: sample({ activity: SLACK, freshId: "drift-1", nowMs: DRIFT_DWELL_MS }),
      state: early,
    });
    expect(driftOwed({ nowMs: DRIFT_DWELL_MS, state: due })).toEqual({
      app: "Slack",
      minutes: 3,
      noticeId: "drift-1",
      plan: "do the ISO access review",
    });
  });

  it("keeps one notice id through every sample while it is owed, so a retry is the same line", () => {
    const due = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: SLACK, freshId: "drift-1", nowMs: DRIFT_DWELL_MS }),
        sample({ activity: SLACK, freshId: "drift-2", nowMs: DRIFT_DWELL_MS + 15_000 }),
      ],
    });
    expect(driftOwed({ nowMs: DRIFT_DWELL_MS + 15_000, state: due })!.noticeId).toBe("drift-1");
  });

  it("starts the dwell again when the front moves to another off-plan window, or a sample cannot be read", () => {
    const moved = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: MAIL, nowMs: 60_000 }),
        sample({ activity: MAIL, nowMs: DRIFT_DWELL_MS }),
      ],
    });
    const unread = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: undefined, nowMs: 60_000 }),
        sample({ activity: SLACK, nowMs: 75_000 }),
        sample({ activity: SLACK, nowMs: DRIFT_DWELL_MS }),
      ],
    });
    expect([
      driftOwed({ nowMs: DRIFT_DWELL_MS, state: moved }),
      driftOwed({ nowMs: DRIFT_DWELL_MS, state: unread }),
    ]).toEqual([undefined, undefined]);
  });

  it("owes nothing once the owner is back on-plan, even with a notice minted", () => {
    const back = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: SLACK, freshId: "drift-1", nowMs: DRIFT_DWELL_MS }),
        sample({ activity: { ...CHROME, title: "ISO 27001 controls" }, nowMs: DRIFT_DWELL_MS + 15_000 }),
      ],
    });
    expect(driftOwed({ nowMs: DRIFT_DWELL_MS + 15_000, state: back })).toBe(undefined);
  });

  it("holds the next line for the cooldown after one is said, then names the whole stretch", () => {
    const told = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: SLACK, freshId: "drift-1", nowMs: DRIFT_DWELL_MS }),
        { kind: "told", noticeId: "drift-1", nowMs: DRIFT_DWELL_MS },
        sample({ activity: SLACK, freshId: "drift-2", nowMs: DRIFT_DWELL_MS + 15_000 }),
      ],
    });
    const after = DRIFT_DWELL_MS + DRIFT_COOLDOWN_MS;
    expect([driftOwed({ nowMs: after - 1, state: told }), driftOwed({ nowMs: after, state: told })]).toEqual([
      undefined,
      { app: "Slack", minutes: 13, noticeId: "drift-2", plan: "do the ISO access review" },
    ]);
  });

  it("ignores a told for a notice it no longer holds", () => {
    const due = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: SLACK, freshId: "drift-1", nowMs: DRIFT_DWELL_MS }),
      ],
    });
    expect(foldDriftWatch({ input: { kind: "told", noticeId: "drift-0", nowMs: DRIFT_DWELL_MS }, state: due })).toBe(
      due,
    );
  });

  it("on a wave-off never names that window again for the plan, and quiets every other line for a while", () => {
    const quiet = DRIFT_DWELL_MS + 60_000;
    const waved = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: SLACK, freshId: "drift-1", nowMs: DRIFT_DWELL_MS }),
        { kind: "told", noticeId: "drift-1", nowMs: DRIFT_DWELL_MS },
        { kind: "quiet", nowMs: quiet },
      ],
    });
    const slackLater = run({
      from: waved,
      inputs: [
        sample({ activity: SLACK, nowMs: quiet + DRIFT_QUIET_MS }),
        sample({ activity: SLACK, nowMs: quiet + DRIFT_QUIET_MS + DRIFT_DWELL_MS }),
      ],
    });
    const mailAt = ({ nowMs }: { nowMs: number }) =>
      run({
        from: waved,
        inputs: [sample({ activity: MAIL, nowMs: quiet }), sample({ activity: MAIL, freshId: "drift-3", nowMs })],
      });
    const quietEnds = quiet + DRIFT_QUIET_MS;
    expect([
      driftOwed({ nowMs: quiet + DRIFT_QUIET_MS + DRIFT_DWELL_MS, state: slackLater }),
      driftOwed({ nowMs: quietEnds - 1, state: mailAt({ nowMs: quietEnds - 1 }) }),
      driftOwed({ nowMs: quietEnds, state: mailAt({ nowMs: quietEnds }) })!.noticeId,
    ]).toEqual([undefined, undefined, "drift-3"]);
    expect(waved.plan).toBe(PLAN);
  });

  it("caps the minutes a long drift names", () => {
    const long = run({
      inputs: [
        SET,
        sample({ activity: SLACK, nowMs: 0 }),
        sample({ activity: SLACK, freshId: "drift-1", nowMs: 2 * DRIFT_MAX_MINUTES * 60_000 }),
      ],
    });
    expect(driftOwed({ nowMs: 2 * DRIFT_MAX_MINUTES * 60_000, state: long })!.minutes).toBe(DRIFT_MAX_MINUTES);
  });

  it("watches nothing with no plan, and forgets everything when the plan ends or a new one is set", () => {
    const unplanned = run({ inputs: [sample({ activity: SLACK, nowMs: 0 }), { kind: "quiet", nowMs: 0 }] });
    const due = run({
      inputs: [SET, sample({ activity: SLACK, nowMs: 0 }), sample({ activity: SLACK, nowMs: DRIFT_DWELL_MS })],
    });
    const next: FocusPlan = { ...PLAN, plan: "triage the Queue" };
    expect([
      unplanned,
      foldDriftWatch({ input: { kind: "end" }, state: due }),
      foldDriftWatch({ input: { kind: "set", plan: next }, state: due }),
    ]).toEqual([IDLE_DRIFT_WATCH, IDLE_DRIFT_WATCH, { ...IDLE_DRIFT_WATCH, plan: next }]);
  });
});
