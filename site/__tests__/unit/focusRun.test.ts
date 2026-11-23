/*
 * focus_set, focus_end and focus_quiet over a plain watch: a plan is held only from the owner's own words, bounded, never a
 * browser by name, and the wave-off quiets without dropping the plan.
 */
import { describe, expect, it } from "vitest";

import {
  type FocusSeams,
  newestFinalWordsOf,
  runFocusEnd,
  runFocusQuiet,
  runFocusSet,
} from "../../components/voice/focusRun";
import {
  DRIFT_QUIET_MS,
  type DriftWatchInput,
  type DriftWatchState,
  foldDriftWatch,
  IDLE_DRIFT_WATCH,
} from "../../lib/driftWatch";

const HIS_WORDS = "right, ISO first, the access review, then I'll triage";

/** A watch held in a plain box, a desktop app that can read the front window, and the owner's words as given. */
function box({
  heard = HIS_WORDS,
  canWatch = true,
}: {
  /** `null` for a call the owner has said nothing on yet. */
  heard?: string | null;
  canWatch?: boolean;
} = {}): {
  seams: FocusSeams;
  state: () => DriftWatchState;
} {
  let state = IDLE_DRIFT_WATCH;
  return {
    seams: {
      apply: ({ input }: { input: DriftWatchInput }) => {
        state = foldDriftWatch({ input, state });
      },
      canWatch: () => canWatch,
      heard: () => heard ?? undefined,
      nowMs: () => 1_000,
      read: () => state,
    },
    state: () => state,
  };
}

const ARGS = {
  apps: ["Linear", " Visual  Studio Code "],
  keywords: ["ISO", "access review", "ISO"],
  plan: "do the ISO access review",
};

describe("runFocusSet", () => {
  it("holds the plan with the owner's words beside it, its terms compared lowercased and once each", () => {
    const b = box();
    expect(runFocusSet({ args: ARGS, seams: b.seams })).toEqual({
      answer: {
        holding: "do the ISO access review",
        note: "say in a few words that you will nudge the owner if they drift, nothing more",
      },
      detail: "holding: do the ISO access review",
      refused: false,
    });
    expect(b.state().plan).toEqual({
      apps: ["linear", "visual studio code"],
      heard: HIS_WORDS,
      keywords: ["iso", "access review"],
      plan: "do the ISO access review",
    });
  });

  it("refuses before the owner has said anything, and where no desktop app can read the front window", () => {
    expect([
      runFocusSet({ args: ARGS, seams: box({ heard: null }).seams }).detail,
      runFocusSet({ args: ARGS, seams: box({ canWatch: false }).seams }).detail,
    ]).toEqual([
      "the owner has said nothing on this call yet: a plan is only ever their own words",
      "only the Slopweaver desktop app can see which window is in front, so no nudge can come here",
    ]);
  });

  it("refuses a browser named as an app, an empty plan, too many terms, and a plan with nothing to match", () => {
    const b = box();
    expect([
      runFocusSet({ args: { ...ARGS, apps: ["Google Chrome"] }, seams: b.seams }).detail,
      runFocusSet({ args: { ...ARGS, plan: "  " }, seams: b.seams }).detail,
      runFocusSet({ args: { ...ARGS, apps: Array.from({ length: 9 }, (_, i) => `app ${String(i)}`) }, seams: b.seams })
        .detail,
      runFocusSet({ args: { ...ARGS, keywords: [3] }, seams: b.seams }).detail,
      runFocusSet({ args: { apps: [], keywords: [], plan: "focus" }, seams: b.seams }).detail,
    ]).toEqual([
      "google chrome is a browser, which holds anything: name a title keyword instead",
      "plan must complete 'you said you'd …' in a few words",
      "apps must be a list of at most 8 short words",
      "every one of keywords must be a short word or phrase",
      "give at least one app or title keyword that means the owner is doing it",
    ]);
    expect(b.state()).toBe(IDLE_DRIFT_WATCH);
  });
});

describe("runFocusEnd and runFocusQuiet", () => {
  it("quiets nudges without dropping the plan, then drops it", () => {
    const b = box();
    runFocusSet({ args: ARGS, seams: b.seams });
    expect(runFocusQuiet({ seams: b.seams }).refused).toBe(false);
    expect([b.state().quietUntilMs, b.state().plan?.plan]).toEqual([
      1_000 + DRIFT_QUIET_MS,
      "do the ISO access review",
    ]);
    expect(runFocusEnd({ seams: b.seams })).toEqual({
      answer: { dropped: "do the ISO access review" },
      detail: "dropped: do the ISO access review",
      refused: false,
    });
    expect(b.state()).toBe(IDLE_DRIFT_WATCH);
  });

  it("refuses both with no plan held", () => {
    const b = box();
    expect([runFocusEnd({ seams: b.seams }).detail, runFocusQuiet({ seams: b.seams }).detail]).toEqual([
      "no plan is held: focus_set holds one",
      "no plan is held, so there is no nudge to quiet",
    ]);
  });
});

describe("newestFinalWordsOf", () => {
  it("takes the owner's newest finished turn, never the voice's or one still being said", () => {
    expect(
      newestFinalWordsOf({
        segments: [
          { final: true, id: "1", text: "ISO first", who: "owner" },
          { final: true, id: "2", text: "Sounds good.", who: "voice" },
          { final: false, id: "3", text: "and then", who: "owner" },
        ],
      }),
    ).toBe("ISO first");
    expect(newestFinalWordsOf({ segments: [] })).toBe(undefined);
  });
});
