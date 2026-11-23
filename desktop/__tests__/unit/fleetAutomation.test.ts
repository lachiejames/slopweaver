/**
 * When the shell recovers the fleet by itself — once per down episode, continued only past a deferral, never a
 * loop — and the exact line it types.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { FleetErrors } from "../../src/errors";
import {
  chairLive,
  nextDownSince,
  recoveryDetail,
  STALL_NOTE_HOLD_MS,
  stallNoteHeld,
  withStalledRecovery,
} from "../../src/fleetAutomation";
import {
  decodeFleetAutomation,
  type FleetAutomation,
  type FleetReading,
  launchDidNotHappen,
  launchPending,
  MAX_LAUNCHES,
  NO_EPISODE,
  pressButton,
  stepFleetAutomation,
} from "../../src/fleetAutomationEpisode";
import { fleetLaunchLine, launchForAction, withBridgeFailure } from "../../src/fleetAutomationLaunch";
import type { AttemptOutcome, FleetHandStep, FleetHealth, FleetSeat } from "../../src/fleetHealth";

const EPISODE = "0b6f2b8e-3c1a-4d6e-9f00-1a2b3c4d5e6f";
const mint = (): string => EPISODE;

/** A reading in one state with no attempt running and none finished. */
function at({ state }: { state: FleetHealth["state"] }): FleetReading {
  return { lastAttempt: undefined, recoveryPhase: undefined, state };
}

/** A reading in one state with no attempt running, after the named attempt of this episode finished. */
function after({
  state,
  attemptId,
  outcome,
}: {
  state: FleetHealth["state"];
  attemptId: string;
  outcome: AttemptOutcome;
}): FleetReading {
  return { lastAttempt: { attemptId, episodeId: EPISODE, outcome }, recoveryPhase: undefined, state };
}

/** A reading with an attempt running. */
const RUNNING: FleetReading = { lastAttempt: undefined, recoveryPhase: "seats", state: "recovering" };

/** Apply readings in order from no episode, collecting each launch decision. */
function readings({ steps, blocked }: { steps: readonly FleetReading[]; blocked: boolean }): {
  automation: FleetAutomation;
  launches: readonly boolean[];
} {
  let automation = NO_EPISODE;
  const launches: boolean[] = [];
  for (const reading of steps) {
    const step = stepFleetAutomation({ automation, blocked, mint, reading });
    automation = step.automation;
    launches.push(step.launch);
  }
  return { automation, launches };
}

/** Readings in the named states, nothing running, nothing finished. */
function states({ list, blocked }: { list: readonly FleetHealth["state"][]; blocked: boolean }): {
  automation: FleetAutomation;
  launches: readonly boolean[];
} {
  return readings({ blocked, steps: list.map((state) => at({ state })) });
}

describe("stepFleetAutomation", () => {
  it("launches exactly once across a whole down episode whose attempt ran", () => {
    const failed = after({ attemptId: "a1", outcome: "failed", state: "down" });
    expect(readings({ blocked: false, steps: [at({ state: "down" }), RUNNING, failed, failed] }).launches).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("types its own line again while no attempt finishes after it, up to the episode's cap", () => {
    expect(states({ blocked: false, list: ["down", "down", "recovering", "down", "down", "down"] }).launches).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("holds that retype while the shell still counts the line as pending", () => {
    const launched = states({ blocked: false, list: ["down"] }).automation;
    expect(
      stepFleetAutomation({ automation: launched, blocked: true, mint, reading: at({ state: "down" }) }).launch,
    ).toBe(false);
  });

  it("never retypes a line the owner's button typed, which may be a sign-in waiting on them", () => {
    const handStep = after({ attemptId: "a1", outcome: "hand-step", state: "down" });
    const opened = readings({ blocked: false, steps: [at({ state: "down" }), handStep] }).automation;
    const pressed = pressButton({ automation: opened, mint }).automation;
    expect(stepFleetAutomation({ automation: pressed, blocked: false, mint, reading: handStep }).launch).toBe(false);
  });

  it("retypes after a restart when the saved line never finished an attempt", () => {
    const saved = unwrap(
      decodeFleetAutomation({
        value: {
          awaiting: { after: null },
          continuedAttempt: null,
          dismissedStep: null,
          episodeId: EPISODE,
          launches: 1,
          version: 1,
        },
      }),
    );
    expect(
      stepFleetAutomation({ automation: saved, blocked: false, mint, reading: at({ state: "down" }) }).launch,
    ).toBe(true);
  });

  it("opens a fresh episode, and a fresh launch, once the fleet has read healthy", () => {
    expect(states({ blocked: false, list: ["down", "healthy", "down"] }).launches).toEqual([true, false, true]);
  });

  it("launches nothing more once the only red seat is a crash loop handed to the supervisor", () => {
    const later = states({ blocked: false, list: ["down", "degraded", "degraded"] });
    expect(later.launches).toEqual([true, false, false]);
    expect(later.automation).toEqual(NO_EPISODE);
  });

  it("closes the episode on degraded, so a later failure still gets its own launch", () => {
    expect(states({ blocked: false, list: ["down", "degraded", "down"] }).launches).toEqual([true, false, true]);
  });

  it("never launches for a fleet that is only settling", () => {
    const later = states({ blocked: false, list: ["recovering", "recovering"] });
    expect(later.launches).toEqual([false, false]);
    expect(later.automation).toEqual(NO_EPISODE);
  });

  it("never launches over a running attempt, even with the fleet down", () => {
    const running: FleetReading = { ...RUNNING, state: "down" };
    expect(readings({ blocked: false, steps: [running] }).launches).toEqual([false]);
  });

  it("opens the episode but holds the launch while the shell's own last launch stands failed", () => {
    const later = states({ blocked: true, list: ["down"] });
    expect(later.launches).toEqual([false]);
    expect(later.automation).toEqual({ ...NO_EPISODE, episodeId: EPISODE });
  });

  it("does not launch again after a restart mid-episode, because the launch was saved", () => {
    const saved = unwrap(
      decodeFleetAutomation({
        value: {
          awaiting: null,
          continuedAttempt: null,
          dismissedStep: null,
          episodeId: EPISODE,
          launches: 1,
          version: 1,
        },
      }),
    );
    expect(
      stepFleetAutomation({ automation: saved, blocked: false, mint, reading: at({ state: "down" }) }).launch,
    ).toBe(false);
  });

  it("gives the episode its launch back when the launch never reached cmux", () => {
    const down = at({ state: "down" });
    const launched = stepFleetAutomation({ automation: NO_EPISODE, blocked: false, mint, reading: down }).automation;
    const back = launchDidNotHappen({ automatic: true, automation: launched });
    expect(stepFleetAutomation({ automation: back, blocked: false, mint, reading: down }).launch).toBe(true);
  });

  it("continues an attempt that deferred, once, while the supervisor is still settling", () => {
    const deferred = after({ attemptId: "a1", outcome: "deferred", state: "recovering" });
    const failed = after({ attemptId: "a2", outcome: "failed", state: "recovering" });
    const later = readings({ blocked: false, steps: [at({ state: "down" }), RUNNING, deferred, RUNNING, failed] });
    expect(later.launches).toEqual([true, false, true, false, false]);
    expect(later.automation).toEqual({
      awaiting: null,
      continuedAttempt: "a1",
      dismissedStep: null,
      episodeId: EPISODE,
      launches: 2,
      version: 1,
    });
  });

  it("continues each new deferral, and stops at the episode's cap", () => {
    const steps = [at({ state: "down" })];
    for (let index = 1; index <= MAX_LAUNCHES + 1; index += 1) {
      steps.push(after({ attemptId: `a${String(index)}`, outcome: "deferred", state: "down" }));
    }
    expect(readings({ blocked: false, steps }).launches).toEqual([true, true, true, true, false, false]);
  });

  it("never continues an attempt that failed or stopped on the owner's step — those are the button's", () => {
    const failed = after({ attemptId: "a1", outcome: "failed", state: "down" });
    const handStep = after({ attemptId: "a2", outcome: "hand-step", state: "down" });
    expect(readings({ blocked: false, steps: [at({ state: "down" }), failed, handStep] }).launches).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("never continues a deferral from another episode", () => {
    const stale: FleetReading = {
      lastAttempt: { attemptId: "a0", episodeId: "6f1d6c1e-0a7b-4c2d-8e3f-112233445566", outcome: "deferred" },
      recoveryPhase: undefined,
      state: "down",
    };
    expect(readings({ blocked: false, steps: [at({ state: "down" }), stale] }).launches).toEqual([true, false]);
  });

  it("releases the deferral again when its continuation never reached cmux", () => {
    const deferred = after({ attemptId: "a1", outcome: "deferred", state: "down" });
    const first = readings({ blocked: false, steps: [at({ state: "down" }), deferred] }).automation;
    const back = launchDidNotHappen({ automatic: true, automation: first });
    expect(back).toEqual({
      awaiting: null,
      continuedAttempt: null,
      dismissedStep: null,
      episodeId: EPISODE,
      launches: 1,
      version: 1,
    });
    expect(stepFleetAutomation({ automation: back, blocked: false, mint, reading: deferred }).launch).toBe(true);
  });

  it("gives a button's launch back without releasing a deferral already continued", () => {
    const deferred = after({ attemptId: "a1", outcome: "deferred", state: "down" });
    const continued = readings({ blocked: false, steps: [at({ state: "down" }), deferred] }).automation;
    const pressed = pressButton({ automation: continued, mint }).automation;
    expect(continued.awaiting).toEqual({ after: "a1" });
    expect(launchDidNotHappen({ automatic: false, automation: pressed })).toEqual({ ...continued, awaiting: null });
  });
});

describe("launchPending", () => {
  const typed = { atMs: 1_000_000, lastAttemptId: "a1" };
  const sameAttempt = after({ attemptId: "a1", outcome: "hand-step", state: "down" });

  it("holds a second launch while no reading has shown the first one's attempt", () => {
    expect(launchPending({ nowMs: 1_030_000, pending: typed, reading: sameAttempt })).toBe(true);
  });

  it("releases once a reading shows the attempt running", () => {
    expect(launchPending({ nowMs: 1_030_000, pending: typed, reading: RUNNING })).toBe(false);
  });

  it("releases once a newer attempt has finished", () => {
    const newer = after({ attemptId: "a2", outcome: "hand-step", state: "down" });
    expect(launchPending({ nowMs: 1_030_000, pending: typed, reading: newer })).toBe(false);
  });

  it("releases after two minutes with no attempt, since the typed line never ran", () => {
    expect(launchPending({ nowMs: 1_120_000, pending: typed, reading: sameAttempt })).toBe(false);
  });

  it("holds nothing when no launch was typed", () => {
    expect(launchPending({ nowMs: 1_030_000, pending: undefined, reading: sameAttempt })).toBe(false);
  });
});

describe("pressButton", () => {
  it("opens an episode with one launch when none is open", () => {
    expect(pressButton({ automation: NO_EPISODE, mint })).toEqual({
      automation: {
        awaiting: null,
        continuedAttempt: null,
        dismissedStep: null,
        episodeId: EPISODE,
        launches: 1,
        version: 1,
      },
      episodeId: EPISODE,
    });
  });

  it("counts a press inside an open episode, so the app's own continuations still stop at the cap", () => {
    const handStep = after({ attemptId: "a1", outcome: "hand-step", state: "down" });
    const opened = readings({ blocked: false, steps: [at({ state: "down" }), handStep] }).automation;
    let automation = pressButton({ automation: opened, mint }).automation;
    const launches: boolean[] = [];
    for (let index = 2; index <= MAX_LAUNCHES + 1; index += 1) {
      const reading = after({ attemptId: `a${String(index)}`, outcome: "deferred", state: "down" });
      const step = stepFleetAutomation({ automation, blocked: false, mint, reading });
      automation = step.automation;
      launches.push(step.launch);
    }
    expect(launches).toEqual([true, true, false, false]);
    expect(automation.launches).toBe(MAX_LAUNCHES);
  });
});

describe("decodeFleetAutomation", () => {
  it("refuses an episode id that was not minted, since it is typed into a terminal", () => {
    expect(
      unwrapErr(
        decodeFleetAutomation({
          value: { continuedAttempt: null, dismissedStep: null, episodeId: "$(id)", launches: 0, version: 1 },
        }),
      ).message,
    ).toBe("the saved window state was malformed at fleet.episodeId, so it opened fresh");
  });

  it("refuses a launch count that is not a whole number", () => {
    expect(
      unwrapErr(
        decodeFleetAutomation({
          value: { continuedAttempt: null, dismissedStep: null, episodeId: EPISODE, launches: 1.5, version: 1 },
        }),
      ).message,
    ).toBe("the saved window state was malformed at fleet.launches, so it opened fresh");
  });

  it("refuses an awaited line whose attempt id is not text", () => {
    expect(
      unwrapErr(
        decodeFleetAutomation({
          value: {
            awaiting: { after: 7 },
            continuedAttempt: null,
            dismissedStep: null,
            episodeId: EPISODE,
            launches: 1,
            version: 1,
          },
        }),
      ).message,
    ).toBe("the saved window state was malformed at fleet.awaiting, so it opened fresh");
  });
});

/** The launch line for a plain resume from `/c` in a shell started with no overrides, any field replaced. */
function launchLine(over: Partial<Parameters<typeof fleetLaunchLine>[0]> = {}): ReturnType<typeof fleetLaunchLine> {
  return fleetLaunchLine({
    checkout: "/c",
    claudeConfig: undefined,
    home: undefined,
    launch: { episodeId: EPISODE, kind: "resume" },
    ...over,
  });
}

describe("fleetLaunchLine", () => {
  it("resumes from the checkout, naming the episode", () => {
    expect(unwrap(launchLine({ checkout: "/Users/me/slop weaver" }))).toBe(
      `cd '/Users/me/slop weaver' && bin/slopweaver fleet resume --episode ${EPISODE}`,
    );
  });

  it("exports the shell's own home into the tab, so the resume acts on the fleet the page read", () => {
    expect(unwrap(launchLine({ home: "/h it's" }))).toBe(
      `cd '/c' && export SLOPWEAVER_HOME='/h it'\\''s' && bin/slopweaver fleet resume --episode ${EPISODE}`,
    );
  });

  it("exports the shell's own Claude config dir too, so the resume reads the registry the page read", () => {
    expect(unwrap(launchLine({ claudeConfig: "/cc", home: "/h" }))).toBe(
      `cd '/c' && export SLOPWEAVER_HOME='/h' && export CLAUDE_CONFIG_DIR='/cc' && bin/slopweaver fleet resume --episode ${EPISODE}`,
    );
  });

  it("signs in on the named plan, then resumes the same episode", () => {
    expect(unwrap(launchLine({ launch: { alias: "max-1", episodeId: EPISODE, kind: "claude-signin" } }))).toBe(
      `cd '/c' && bin/slopweaver claude signin --plan 'max-1' && bin/slopweaver fleet resume --episode ${EPISODE}`,
    );
  });

  it("sets exactly the one hatch on a policy override", () => {
    expect(
      unwrap(launchLine({ launch: { episodeId: EPISODE, hatch: "ALLOW_FABLE_OVERRIDE", kind: "policy-override" } })),
    ).toBe(`cd '/c' && ALLOW_FABLE_OVERRIDE=1 bin/slopweaver fleet resume --episode ${EPISODE}`);
  });

  it("quotes a checkout holding a single quote", () => {
    expect(unwrap(launchLine({ checkout: "/it's" }))).toBe(
      `cd '/it'\\''s' && bin/slopweaver fleet resume --episode ${EPISODE}`,
    );
  });

  it("refuses a home holding a line break, which would end the typed line early", () => {
    expect(unwrapErr(launchLine({ home: "/h\nrm" }))).toBe("the checkout or home path holds a line break");
  });

  it("refuses a Claude config dir holding a line break, for the same reason", () => {
    expect(unwrapErr(launchLine({ claudeConfig: "/cc\rrm" }))).toBe("the checkout or home path holds a line break");
  });

  it("refuses an episode id it did not mint", () => {
    expect(unwrapErr(launchLine({ launch: { episodeId: "x;y", kind: "resume" } }))).toBe(
      "episode id x;y is not a minted id",
    );
  });
});

describe("launchForAction", () => {
  it("leaves the two buttons the shell carries out itself to the shell", () => {
    expect(launchForAction({ action: { kind: "open-cmux" }, episodeId: EPISODE })).toBeUndefined();
  });
});

describe("withBridgeFailure", () => {
  const health: FleetHealth = {
    capacity: { configured: 15, online: 0 },
    console: "serving",
    lastAttempt: undefined,
    newestAttempt: undefined,
    observedAtIso: "t",
    reason: { code: "FLEET_DOWN", detail: "d", handStep: undefined, headline: "3 seats are down.", raw: undefined },
    recoveryPhase: undefined,
    seats: [],
    state: "down",
    unmapped: [],
  };

  it("puts the Automation button in front while macOS refuses the shell control of cmux", () => {
    const shown = withBridgeFailure({
      failure: FleetErrors.automationDenied({ detail: "Not authorized to send Apple events to cmux. (-1743)" }),
      health,
    });
    expect(shown.reason.headline).toBe("Slopweaver is not allowed to open a cmux tab.");
    expect(shown.reason.handStep!.action).toEqual({ kind: "automation-consent" });
    expect(shown.reason.raw).toBe(
      "macOS refused Slopweaver control of cmux: Not authorized to send Apple events to cmux. (-1743)",
    );
  });

  it("offers to open cmux for any other launch failure", () => {
    const shown = withBridgeFailure({
      failure: FleetErrors.cmuxUnavailable({ detail: "Unable to find application named 'cmux'" }),
      health,
    });
    expect(shown.reason.handStep!.action).toEqual({ kind: "open-cmux" });
  });

  it("shows the fleet's own reason, and no button of the shell's, while an attempt is recovering it", () => {
    const shown = withBridgeFailure({
      failure: FleetErrors.automationDenied({ detail: "Not authorized to send Apple events to cmux. (-1743)" }),
      health: { ...health, state: "recovering" },
    });
    expect(shown.reason.headline).toBe("3 seats are down.");
    expect(shown.reason.handStep).toBeUndefined();
  });

  it("shows the fleet's own reason once nothing failed", () => {
    expect(withBridgeFailure({ failure: undefined, health }).reason.headline).toBe("3 seats are down.");
  });
});

/** One seat on the page, by role and colour. */
function seat({
  role,
  colour,
  rowTitle = "Supervisor — your one intake",
  held = false,
  live = false,
}: {
  role: FleetSeat["role"];
  colour: FleetSeat["colour"];
  rowTitle?: string;
  held?: boolean;
  live?: boolean;
}): FleetSeat {
  return {
    colour,
    detail: "d",
    flashing: false,
    held,
    lastSignal: undefined,
    live,
    priority: "p0",
    role,
    rowTitle,
    seatId: `${role}-${rowTitle}`,
    signalExpectedSinceIso: undefined,
  };
}

/** The seats `fleet health` reads: the supervisor, the Slack loop and the keep-alive, in the given colours. */
function seats({
  supervisor,
  loop,
}: {
  supervisor: FleetSeat["colour"];
  loop: FleetSeat["colour"];
}): readonly FleetSeat[] {
  return [
    seat({ colour: supervisor, role: "supervisor" }),
    seat({ colour: loop, role: "loop", rowTitle: "Slack loop" }),
    seat({ colour: "green", role: "keep-alive", rowTitle: "Credential keep-alive" }),
  ];
}

/** The first down reading after a Slack loop's arm disarmed, two seconds later. */
const DOWN_SINCE_MS = Date.parse("2026-10-06T02:39:31.000Z");

describe("withStalledRecovery", () => {
  const down: FleetHealth = {
    capacity: { configured: 15, online: 0 },
    console: "serving",
    lastAttempt: undefined,
    newestAttempt: undefined,
    observedAtIso: "t",
    reason: { code: "FLEET_DOWN", detail: "d", handStep: undefined, headline: "1 seat is down.", raw: undefined },
    recoveryPhase: undefined,
    seats: seats({ loop: "green", supervisor: "red" }),
    state: "down",
    unmapped: [],
  };
  const spent = states({ blocked: false, list: ["down", "down", "down", "down"] }).automation;
  /** The measured incident's recovery: four lines typed, and no attempt of this episode journalled as starting. */
  const NONE_STARTED = "Recovery was sent to cmux 4 times, and no attempt has recorded starting.";

  /** `withStalledRecovery` read in Sydney, down since the first down reading. */
  function stall({
    automation,
    health,
    pending,
    unsaved,
  }: {
    automation: FleetAutomation;
    health: FleetHealth;
    pending: boolean;
    unsaved: boolean;
  }): FleetHealth {
    return withStalledRecovery({
      automation,
      downSinceMs: DOWN_SINCE_MS,
      health,
      pending,
      timeZone: "Australia/Sydney",
      unsaved,
    });
  }

  it("offers to start recovery again once the cap is spent on lines that finished nothing", () => {
    expect(spent.launches).toBe(MAX_LAUNCHES);
    const step = stall({ automation: spent, health: down, pending: false, unsaved: false }).reason.handStep!;
    expect(step.action).toEqual({ kind: "resume" });
    expect(step.label).toBe("Start recovery again");
    expect(launchForAction({ action: step.action, episodeId: EPISODE })).toEqual({
      episodeId: EPISODE,
      kind: "resume",
    });
  });

  it("offers it after an attempt that finished healthy while the fleet still reads down", () => {
    const healthy: FleetHealth = { ...down, lastAttempt: { attemptId: "a1", episodeId: EPISODE, outcome: "healthy" } };
    const opened = readings({ blocked: false, steps: [at({ state: "down" }), healthy] }).automation;
    expect(stall({ automation: opened, health: healthy, pending: false, unsaved: false }).reason.handStep!.id).toBe(
      "resume-1",
    );
  });

  it("offers nothing while the app would still launch by itself, or while a line is pending", () => {
    const launched = states({ blocked: false, list: ["down"] }).automation;
    expect(
      stall({ automation: launched, health: down, pending: false, unsaved: false }).reason.handStep,
    ).toBeUndefined();
    expect(stall({ automation: spent, health: down, pending: true, unsaved: false }).reason.handStep).toBeUndefined();
  });

  it("offers it when the app held its own launch back because its memory would not save", () => {
    const step = stall({ automation: NO_EPISODE, health: down, pending: false, unsaved: true }).reason.handStep!;
    expect(step).toStrictEqual({
      action: { kind: "resume" },
      id: "resume-unsaved",
      label: "Start recovery again",
      note:
        "Slopweaver reads the supervisor as down. It first read the fleet down at 1:39 pm and has not read it recovered since. Recovery will not start by itself, because it " +
        "could not save its progress. Nothing is being supervised until the supervisor is back. Slack tags are still " +
        "being answered.",
      recoveryDetail: "Recovery will not start by itself, because it could not save its progress.",
    });
  });

  it("offers nothing for an unsaved memory while a line is pending or the fleet offers its own step", () => {
    const own: FleetHealth = {
      ...down,
      reason: { ...down.reason, handStep: { action: { kind: "open-cmux" }, id: "x", label: "l", note: "n" } },
    };
    expect(
      stall({ automation: NO_EPISODE, health: down, pending: true, unsaved: true }).reason.handStep,
    ).toBeUndefined();
    expect(stall({ automation: NO_EPISODE, health: own, pending: false, unsaved: true }).reason.handStep!.id).toBe("x");
  });

  it("keeps the fleet's own step rather than replacing it", () => {
    const own: FleetHealth = {
      ...down,
      reason: { ...down.reason, handStep: { action: { kind: "open-cmux" }, id: "x", label: "l", note: "n" } },
    };
    expect(stall({ automation: spent, health: own, pending: false, unsaved: false }).reason.handStep!.id).toBe("x");
  });

  it("offers nothing once the fleet is no longer down", () => {
    const settling: FleetHealth = { ...down, state: "recovering" };
    expect(
      stall({ automation: spent, health: settling, pending: false, unsaved: true }).reason.handStep,
    ).toBeUndefined();
  });

  /** The incident's chair: red, quiet past the wait, and its own process running — live. */
  const quietLive = seat({ colour: "red", live: true, role: "supervisor" });

  it("never asks for a press over a live supervisor, however the episode's attempts ended", () => {
    const deferred: FleetHealth = {
      ...down,
      lastAttempt: { attemptId: "a4", episodeId: EPISODE, outcome: "deferred" },
      newestAttempt: { attemptId: "a4", episodeId: EPISODE, finished: true },
      seats: [quietLive, ...seats({ loop: "red", supervisor: "red" }).slice(1)],
    };
    expect(spent.launches).toBe(MAX_LAUNCHES);
    expect(chairLive({ health: deferred })).toBe(true);
    expect(stall({ automation: spent, health: deferred, pending: false, unsaved: false })).toBe(deferred);
    expect(stall({ automation: NO_EPISODE, health: deferred, pending: false, unsaved: true })).toBe(deferred);
  });

  it("never asks for a press over a live supervisor with a worker or the console down beside it", () => {
    const beside: FleetHealth = {
      ...down,
      console: "down",
      seats: [
        seat({ colour: "green", live: true, role: "supervisor" }),
        seat({ colour: "red", role: "worker", rowTitle: "16339 staging e2e" }),
      ],
    };
    expect(
      stall({ automation: spent, health: beside, pending: false, unsaved: false }).reason.handStep,
    ).toBeUndefined();
  });

  it("never asks for a press over a supervisor reading up from a checkout that prints no live mark (r3)", () => {
    const worker = seat({ colour: "red", role: "worker", rowTitle: "16339 staging e2e" });
    const unmarked = ({ colour }: { colour: FleetSeat["colour"] }): FleetHealth => ({
      ...down,
      seats: [seat({ colour, role: "supervisor" }), worker],
    });
    expect(
      stall({ automation: spent, health: unmarked({ colour: "green" }), pending: false, unsaved: false }).reason
        .handStep,
    ).toBeUndefined();
    expect(
      stall({ automation: spent, health: unmarked({ colour: "red" }), pending: false, unsaved: false }).reason.handStep!
        .action,
    ).toEqual({ kind: "resume" });
  });

  it("reads the supervisor live off its seat's own mark, never off its colour", () => {
    expect(chairLive({ health: { seats: [seat({ colour: "green", role: "supervisor" })] } })).toBe(false);
    expect(chairLive({ health: { seats: [seat({ colour: "red", live: true, role: "worker" })] } })).toBe(false);
    expect(chairLive({ health: { seats: [quietLive] } })).toBe(true);
  });

  it("says what it read as down and when it first did, what recovery did, the air, and that Slack still answers", () => {
    const step = stall({ automation: spent, health: down, pending: false, unsaved: false }).reason.handStep!;
    expect(step.note).toBe(
      `Slopweaver reads the supervisor as down. It first read the fleet down at 1:39 pm and has not read it recovered since. ${NONE_STARTED} ` +
        "Nothing is being supervised until the supervisor is back. Slack tags are still being answered.",
    );
    expect(step.recoveryDetail).toBe(NONE_STARTED);
  });

  it("never says recovery could not bring it back over an episode no attempt ever started in", () => {
    const otherEpisode: FleetHealth = {
      ...down,
      lastAttempt: { attemptId: "old", episodeId: "47230f40-6498-4b7c-be16-5c2de95e31fc", outcome: "healthy" },
      newestAttempt: { attemptId: "old", episodeId: "47230f40-6498-4b7c-be16-5c2de95e31fc", finished: true },
    };
    const note = stall({ automation: spent, health: otherEpisode, pending: false, unsaved: false }).reason.handStep!
      .note;
    expect(note).toContain(NONE_STARTED);
    expect(note).not.toContain("could not bring");
  });

  it("names how this episode's finished attempt ended, and that it still reads down", () => {
    const deferred: FleetHealth = {
      ...down,
      lastAttempt: { attemptId: "a4", episodeId: EPISODE, outcome: "deferred" },
      newestAttempt: { attemptId: "a4", episodeId: EPISODE, finished: true },
    };
    expect(recoveryDetail({ automation: spent, health: deferred, plural: false, unsaved: false })).toBe(
      "The last recovery attempt ended by putting itself off, and it still reads down.",
    );
    expect(recoveryDetail({ automation: spent, health: deferred, plural: true, unsaved: false })).toBe(
      "The last recovery attempt ended by putting itself off, and they still read down.",
    );
  });

  it("says an attempt of this episode started and recorded no end, which a finished-only field cannot", () => {
    const unfinished: FleetHealth = {
      ...down,
      newestAttempt: { attemptId: "a5", episodeId: EPISODE, finished: false },
    };
    expect(recoveryDetail({ automation: spent, health: unfinished, plural: false, unsaved: false })).toBe(
      "A recovery attempt started and has not recorded how it ended.",
    );
  });

  it("never says no ending was recorded for an attempt the reading marks finished", () => {
    const finishedUnnamed: FleetHealth = {
      ...down,
      newestAttempt: { attemptId: "a5", episodeId: EPISODE, finished: true },
    };
    expect(recoveryDetail({ automation: spent, health: finishedUnnamed, plural: false, unsaved: false })).toBe(
      "A recovery attempt finished, and it still reads down.",
    );
  });

  it("never calls an older finished attempt the last while a newer one is still open", () => {
    const olderFailedNewerOpen: FleetHealth = {
      ...down,
      lastAttempt: { attemptId: "a1", episodeId: EPISODE, outcome: "failed" },
      newestAttempt: { attemptId: "a4", episodeId: EPISODE, finished: false },
    };
    expect(recoveryDetail({ automation: spent, health: olderFailedNewerOpen, plural: false, unsaved: false })).toBe(
      "A recovery attempt started and has not recorded how it ended.",
    );
  });

  it("never lends another episode's outcome to this episode's attempt through a shared attempt id", () => {
    const sharedId: FleetHealth = {
      ...down,
      lastAttempt: { attemptId: "a1", episodeId: "another-episode", outcome: "failed" },
      newestAttempt: { attemptId: "a1", episodeId: EPISODE, finished: true },
    };
    expect(recoveryDetail({ automation: spent, health: sharedId, plural: false, unsaved: false })).toBe(
      "A recovery attempt finished, and it still reads down.",
    );
  });

  it("names this episode's finished attempt without calling it the last when another episode's is newer", () => {
    const newerElsewhere: FleetHealth = {
      ...down,
      lastAttempt: { attemptId: "a1", episodeId: EPISODE, outcome: "failed" },
      newestAttempt: { attemptId: "b1", episodeId: "another-episode", finished: false },
    };
    expect(recoveryDetail({ automation: spent, health: newerElsewhere, plural: false, unsaved: false })).toBe(
      "A recovery attempt ended in a failure, and it still reads down.",
    );
  });

  it("says once, not 1 times, for a single line typed", () => {
    const once: FleetAutomation = { ...spent, launches: 1 };
    expect(recoveryDetail({ automation: once, health: down, plural: false, unsaved: false })).toBe(
      "Recovery was sent to cmux once, and no attempt has recorded starting.",
    );
  });

  it("names one worker by its row beside a supervisor that is not live", () => {
    const worker: FleetHealth = {
      ...down,
      seats: [
        ...seats({ loop: "green", supervisor: "red" }),
        seat({ colour: "red", role: "worker", rowTitle: "16339 staging e2e" }),
      ],
    };
    expect(stall({ automation: spent, health: worker, pending: false, unsaved: false }).reason.handStep!.note).toBe(
      `Slopweaver reads the supervisor and the session on "16339 staging e2e" as down. It first read the fleet down at 1:39 pm and has not read it recovered since. ${NONE_STARTED} ` +
        "Nothing is being supervised until the supervisor is back. Slack tags are still being answered.",
    );
  });

  it("says a console it could not check is unchecked, never down", () => {
    const unchecked: FleetHealth = { ...down, console: "unmeasured" };
    expect(stall({ automation: spent, health: unchecked, pending: false, unsaved: false }).reason.handStep!.note).toBe(
      `Slopweaver reads the supervisor as down. Slopweaver could not check the console. It first read the fleet down at 1:39 pm and has not read it recovered since. ${NONE_STARTED} ` +
        "Nothing is being supervised until the supervisor is back. Slack tags are still being answered.",
    );
  });

  it("counts several workers, the console, and a Slack loop down beside them", () => {
    const many: FleetHealth = {
      ...down,
      console: "down",
      seats: [
        ...seats({ loop: "red", supervisor: "red" }),
        seat({ colour: "red", role: "worker", rowTitle: "a" }),
        seat({ colour: "red", role: "worker", rowTitle: "b" }),
      ],
    };
    expect(stall({ automation: spent, health: many, pending: false, unsaved: false }).reason.handStep!.note).toBe(
      `Slopweaver reads the supervisor, the console and 2 sessions as down. It first read the fleet down at 1:39 pm and has not read it recovered since. ${NONE_STARTED} ` +
        "Nothing is being supervised until the supervisor is back. Slack tags are not being answered either.",
    );
  });

  it("never says the supervisor is up while its seat reads red, even one recovery cannot move", () => {
    const unpinned: FleetHealth = {
      ...down,
      console: "down",
      reason: { ...down.reason, code: "NO_CHAIR_PIN" },
      seats: [...seats({ loop: "green", supervisor: "red" })],
    };
    expect(stall({ automation: spent, health: unpinned, pending: false, unsaved: false }).reason.handStep!.note).toBe(
      `Slopweaver reads the console as down. It first read the fleet down at 1:39 pm and has not read it recovered since. ${NONE_STARTED} ` +
        "Nothing is being supervised until the supervisor is back. Slack tags are still being answered.",
    );
  });

  it("says no supervisor is pinned when the reading carries no supervisor seat at all", () => {
    const chairless: FleetHealth = {
      ...down,
      console: "down",
      reason: { ...down.reason, code: "NO_CHAIR_PIN" },
      seats: [seat({ colour: "green", role: "loop", rowTitle: "loop" })],
    };
    expect(stall({ automation: spent, health: chairless, pending: false, unsaved: false }).reason.handStep!.note).toBe(
      `Slopweaver reads the console as down. It first read the fleet down at 1:39 pm and has not read it recovered since. ${NONE_STARTED} ` +
        "No supervisor is pinned, so nothing is being supervised. Slack tags are still being answered.",
    );
  });

  it("offers no button over a seat recovery held as a crash loop, beside a Slack loop down", () => {
    // No pin, so the red supervisor is not recovery's to move either, and the held seat alone decides.
    const heldBeside: FleetHealth = {
      ...down,
      reason: { ...down.reason, code: "NO_CHAIR_PIN" },
      seats: [
        ...seats({ loop: "red", supervisor: "red" }),
        seat({ colour: "red", held: true, role: "worker", rowTitle: "looping" }),
      ],
    };
    const shown = stall({ automation: spent, health: heldBeside, pending: false, unsaved: false });
    expect(shown.reason.handStep).toBeUndefined();
    const unheld: FleetHealth = {
      ...heldBeside,
      seats: [
        ...seats({ loop: "red", supervisor: "red" }),
        seat({ colour: "red", role: "worker", rowTitle: "looping" }),
      ],
    };
    expect(stall({ automation: spent, health: unheld, pending: false, unsaved: false }).reason.handStep!.id).toBe(
      "resume-4",
    );
  });

  it("offers no button over a supervisor no pin records, which recovery refuses before touching", () => {
    const unpinned: FleetHealth = { ...down, reason: { ...down.reason, code: "NO_CHAIR_PIN" } };
    expect(
      stall({ automation: spent, health: unpinned, pending: false, unsaved: false }).reason.handStep,
    ).toBeUndefined();
    expect(stall({ automation: spent, health: down, pending: false, unsaved: false }).reason.handStep!.id).toBe(
      "resume-4",
    );
  });

  it("offers no button when only the Slack loop is down, since recovery never restarts it", () => {
    const loopOnly: FleetHealth = { ...down, seats: seats({ loop: "red", supervisor: "red" }).slice(1) };
    expect(
      stall({ automation: spent, health: loopOnly, pending: false, unsaved: false }).reason.handStep,
    ).toBeUndefined();
    expect(
      stall({ automation: spent, health: loopOnly, pending: false, unsaved: true }).reason.handStep,
    ).toBeUndefined();
  });
});

describe("the stall note's hold", () => {
  const resume: FleetHandStep = {
    action: { kind: "resume" },
    id: "resume-1",
    label: "Start recovery again",
    note: "n",
  };

  it("holds the shell's own button off your screen until the fleet has read down for two minutes", () => {
    expect(STALL_NOTE_HOLD_MS).toBe(120_000);
    expect(stallNoteHeld({ downSinceMs: DOWN_SINCE_MS, nowMs: DOWN_SINCE_MS + 119_999, step: resume })).toBe(true);
    expect(stallNoteHeld({ downSinceMs: DOWN_SINCE_MS, nowMs: DOWN_SINCE_MS + 120_000, step: resume })).toBe(false);
    expect(stallNoteHeld({ downSinceMs: undefined, nowMs: DOWN_SINCE_MS, step: resume })).toBe(true);
  });

  it("never holds a step that is the owner's alone, which does not settle by itself", () => {
    const signIn: FleetHandStep = {
      action: { alias: "claude-one", email: undefined, kind: "claude-signin" },
      id: "signin",
      label: "Sign in",
      note: "n",
    };
    expect(stallNoteHeld({ downSinceMs: DOWN_SINCE_MS, nowMs: DOWN_SINCE_MS, step: signIn })).toBe(false);
  });

  it("starts the clock on the first down reading, keeps it through a recovery, and clears it once healthy", () => {
    const first = nextDownSince({ before: undefined, nowMs: 1_000, state: "down" });
    expect(first).toBe(1_000);
    expect(nextDownSince({ before: first, nowMs: 31_000, state: "recovering" })).toBe(1_000);
    expect(nextDownSince({ before: first, nowMs: 61_000, state: "down" })).toBe(1_000);
    expect(nextDownSince({ before: first, nowMs: 91_000, state: "healthy" })).toBeUndefined();
    expect(nextDownSince({ before: first, nowMs: 91_000, state: "degraded" })).toBeUndefined();
    expect(nextDownSince({ before: undefined, nowMs: 91_000, state: "recovering" })).toBeUndefined();
  });
});

/**
 * A Slack loop swap, replayed reading by reading from its records: the old arm disarmed, the new arm armed 43
 * seconds later (`live/listener/arms.jsonl`); the app's attempt ran about a second and finished `healthy`
 * (`fleet/resume.jsonl`). The shell reads every half minute.
 */
describe("the 02:40Z Slack loop swap", () => {
  const attempt = {
    attemptId: "1db70ded-7b03-4f2c-81d7-b4a97714348e",
    episodeId: EPISODE,
    outcome: "healthy" as const,
  };

  /** One reading of the swap: who is red, whether the attempt is running, and whether it has finished. */
  function reading({
    at: atIso,
    state,
    supervisor,
    loop,
    running,
    finished,
  }: {
    at: string;
    state: FleetHealth["state"];
    supervisor: FleetSeat["colour"];
    loop: FleetSeat["colour"];
    running: boolean;
    finished: boolean;
  }): { readonly nowMs: number; readonly health: FleetHealth } {
    return {
      health: {
        capacity: { configured: 15, online: 9 },
        console: "serving",
        lastAttempt: finished ? attempt : undefined,
        newestAttempt: finished || running ? { attemptId: attempt.attemptId, episodeId: EPISODE, finished } : undefined,
        observedAtIso: atIso,
        reason: { code: "FLEET_DOWN", detail: "d", handStep: undefined, headline: "1 seat is down.", raw: undefined },
        recoveryPhase: running ? "bringing the supervisor back" : undefined,
        seats: seats({ loop, supervisor }),
        state,
        unmapped: [],
      },
      nowMs: Date.parse(atIso),
    };
  }

  /** The swap's first three readings: down, the attempt running, down again after it finished. */
  function swap({ supervisor }: { supervisor: FleetSeat["colour"] }): ReturnType<typeof reading>[] {
    return [
      reading({
        at: "2026-10-06T02:39:31.000Z",
        finished: false,
        loop: "red",
        running: false,
        state: "down",
        supervisor,
      }),
      reading({
        at: "2026-10-06T02:39:33.000Z",
        finished: false,
        loop: "red",
        running: true,
        state: "recovering",
        supervisor,
      }),
      reading({
        at: "2026-10-06T02:40:01.000Z",
        finished: true,
        loop: "red",
        running: false,
        state: "down",
        supervisor,
      }),
    ];
  }

  /** The reading after the new arm connected. */
  const settled = reading({
    at: "2026-10-06T02:40:31.000Z",
    finished: true,
    loop: "green",
    running: false,
    state: "healthy",
    supervisor: "green",
  });

  /** Every note the shell would have floated over the readings, in order. */
  function floated({ timeline }: { timeline: readonly ReturnType<typeof reading>[] }): readonly string[] {
    let automation = NO_EPISODE;
    let downSinceMs: number | undefined;
    const notes: string[] = [];
    for (const { health, nowMs } of timeline) {
      downSinceMs = nextDownSince({ before: downSinceMs, nowMs, state: health.state });
      automation = stepFleetAutomation({ automation, blocked: false, mint, reading: health }).automation;
      const step = withStalledRecovery({
        automation,
        downSinceMs,
        health,
        pending: false,
        timeZone: "Australia/Sydney",
        unsaved: false,
      }).reason.handStep;
      if (step !== undefined && !stallNoteHeld({ downSinceMs, nowMs, step })) {
        notes.push(step.note);
      }
    }
    return notes;
  }

  it("floats nothing: only the Slack loop was down, and recovery has no button for it", () => {
    expect(floated({ timeline: [...swap({ supervisor: "green" }), settled] })).toEqual([]);
  });

  it("floats nothing for the same minute with the supervisor down, because the hold had not passed", () => {
    expect(floated({ timeline: [...swap({ supervisor: "red" }), settled] })).toEqual([]);
  });

  it("floats the note once a supervisor still down has stood past the hold", () => {
    const stillDown = [
      reading({
        at: "2026-10-06T02:41:01.000Z",
        finished: true,
        loop: "red",
        running: false,
        state: "down",
        supervisor: "red",
      }),
      reading({
        at: "2026-10-06T02:41:31.000Z",
        finished: true,
        loop: "red",
        running: false,
        state: "down",
        supervisor: "red",
      }),
    ];
    expect(floated({ timeline: [...swap({ supervisor: "red" }), ...stillDown] })).toEqual([
      "Slopweaver reads the supervisor as down. It first read the fleet down at 1:39 pm and has not read it recovered since. The last recovery attempt ended saying all was well, " +
        "and it still reads down. Nothing is being supervised until the supervisor is back. Slack tags are not being " +
        "answered either.",
    ]);
  });
});
