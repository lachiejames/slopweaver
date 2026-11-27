/**
 * The app's half of the chair hand-off: a `chair-watch --json` report read strictly, at most one press per outgoing
 * chat however many chats come between, its saved attempts read back strictly, the verb's exit codes read as
 * outcomes, and the menu bar's lines.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";

import {
  type ChairWatchView,
  chairTrayLines,
  type HandOffAttempt,
  handOffDue,
  handOffEpisodeOf,
  handOffOutcomeOf,
  lastPrintedLine,
  parseChairWatch,
  parseHandOffAttempts,
  withAttempt,
} from "../../src/chairHandOffAutomation";

/** A report as `supervisor chair-watch --json` prints one for an app chair due a hand-off. */
const REPORT = {
  chair: { appSessionId: "app-7", kind: "app", sessionIds: ["s-7"] },
  hold: undefined,
  notes: [],
  observedAtIso: "2026-11-27T19:00:00.000Z",
  overrides: ["slopweaver supervisor hand-off hold --reason <why>"],
  readings: [
    { alias: "plan-one", chair: true, reading: "week 91%, Fable week 88%", state: "measured", vendor: "claude" },
    { alias: "plan-four", chair: false, reading: "week 12%", state: "measured", vendor: "claude" },
  ],
  reasons: ["plan-one is past its bar at week 91%"],
  status: "hand-off",
  successor: { alias: "plan-four", target: { kind: "claude" } },
  usage: { gaps: [], plans: [], sessions: [] },
};

/** The parsed form of {@link REPORT}. */
const DUE: ChairWatchView = {
  appSessionId: "app-7",
  observedAtIso: "2026-11-27T19:00:00.000Z",
  plans: [
    { alias: "plan-one", chair: true, reading: "week 91%, Fable week 88%" },
    { alias: "plan-four", chair: false, reading: "week 12%" },
  ],
  reasons: ["plan-one is past its bar at week 91%"],
  status: "hand-off",
  successorAlias: "plan-four",
};

/** An attempt for the chair in {@link DUE}. */
const attempt = ({ outcome, episode }: Pick<HandOffAttempt, "episode" | "outcome">): HandOffAttempt => ({
  atIso: "2026-11-27T19:01:00.000Z",
  episode,
  line: "supervisor hand-off: seated plan-four",
  outcome,
});

describe("parseChairWatch", () => {
  it("reads an app chair due a hand-off, with its successor plan and every reading", () => {
    const parsed = parseChairWatch({ text: JSON.stringify(REPORT) });
    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap()).toStrictEqual(DUE);
  });

  it("reads a chair outside the app with no app session, and an owner hold", () => {
    const text = JSON.stringify({
      ...REPORT,
      chair: { kind: "cmux", sessionIds: [], workspaceId: "w-1" },
      hold: { reason: "keep this one tonight", sinceIso: "2026-11-27T18:00:00.000Z" },
      status: "unsupported",
      successor: undefined,
    });
    const parsed = parseChairWatch({ text })._unsafeUnwrap();
    expect(parsed.appSessionId).toBeUndefined();
    expect(parsed.holdReason).toBe("keep this one tonight");
    expect(parsed.status).toBe("unsupported");
  });

  it("refuses output that is not JSON", () => {
    expect(parseChairWatch({ text: "chair-watch: stays" })._unsafeUnwrapErr()).toBe(
      "the chair watch printed no JSON document",
    );
  });

  it("refuses a report with a status this app does not know", () => {
    const text = JSON.stringify({ ...REPORT, status: "replace" });
    expect(parseChairWatch({ text })._unsafeUnwrapErr()).toBe(
      "the chair watch's report is not the shape this app reads",
    );
  });

  it("refuses an app chair with no session id, rather than pressing a hand-off for no chat", () => {
    const text = JSON.stringify({ ...REPORT, chair: { kind: "app", sessionIds: [] } });
    expect(parseChairWatch({ text })._unsafeUnwrapErr()).toBe(
      "the chair watch's report is not the shape this app reads",
    );
  });

  it("refuses a due report missing a field the verb always prints, though the app does not read it", () => {
    const { notes: _notes, ...noNotes } = REPORT;
    const { overrides: _overrides, ...noOverrides } = REPORT;
    const { usage: _usage, ...noUsage } = REPORT;
    const reports = [noNotes, noOverrides, noUsage, { ...REPORT, notes: [1] }];
    expect(reports.length).toBe(4);
    expect(reports.map((report) => unwrapErr(parseChairWatch({ text: JSON.stringify(report) })))).toEqual(
      reports.map(() => "the chair watch's report is not the shape this app reads"),
    );
  });

  it("refuses a reading missing its phrase", () => {
    const text = JSON.stringify({ ...REPORT, readings: [{ alias: "plan-one", chair: true }] });
    expect(parseChairWatch({ text })._unsafeUnwrapErr()).toBe(
      "the chair watch's report is not the shape this app reads",
    );
  });

  it("refuses a hold with no reason", () => {
    const text = JSON.stringify({ ...REPORT, hold: { sinceIso: "2026-11-27T18:00:00.000Z" } });
    expect(parseChairWatch({ text })._unsafeUnwrapErr()).toBe(
      "the chair watch's report is not the shape this app reads",
    );
  });
});

describe("handOffEpisodeOf", () => {
  it("keys the episode on the outgoing chat's app session, as the verb does", () => {
    expect(handOffEpisodeOf({ view: DUE })).toBe("chair-hand-off:app-7");
  });

  it("names no episode for a chair outside the app", () => {
    const { appSessionId: _dropped, ...elsewhere } = DUE;
    expect(handOffEpisodeOf({ view: elsewhere })).toBeUndefined();
  });
});

describe("handOffDue", () => {
  it("presses the first time a reading says hand-off for an app chair", () => {
    expect(handOffDue({ pressed: [], view: DUE })).toBe(true);
  });

  it("presses for a new outgoing chat even after another one's attempt", () => {
    const pressed = [attempt({ episode: "chair-hand-off:app-6", outcome: "seated" })];
    expect(handOffDue({ pressed, view: DUE })).toBe(true);
  });

  it("never presses the same outgoing chat twice, whatever its one press ended in", () => {
    const episode = "chair-hand-off:app-7";
    const outcomes = ["running", "seated", "nothing-to-do", "not-yet", "refused", "failed"] as const;
    expect(outcomes.map((outcome) => handOffDue({ pressed: [attempt({ episode, outcome })], view: DUE }))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("never presses chat A again after chat B, when A's press ended not yet or failed", () => {
    const viewOf = ({ id }: { id: string }): ChairWatchView => ({ ...DUE, appSessionId: id });
    const outcomes = ["not-yet", "failed"] as const;
    expect(
      outcomes.map((outcome) => {
        const afterA = withAttempt({ attempt: attempt({ episode: "chair-hand-off:app-a", outcome }), pressed: [] });
        const pressesB = handOffDue({ pressed: afterA, view: viewOf({ id: "app-b" }) });
        const afterB = withAttempt({
          attempt: attempt({ episode: "chair-hand-off:app-b", outcome: "seated" }),
          pressed: afterA,
        });
        return [pressesB, handOffDue({ pressed: afterB, view: viewOf({ id: "app-a" }) })];
      }),
    ).toEqual([
      [true, false],
      [true, false],
    ]);
  });

  it("never presses on a reading that stays, is held, unmeasured or unsupported", () => {
    const statuses = ["stay", "held", "unmeasured", "unsupported"] as const;
    expect(statuses.map((status) => handOffDue({ pressed: [], view: { ...DUE, status } }))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("never presses for a chair outside the app, even when the watch says hand-off", () => {
    const { appSessionId: _dropped, ...elsewhere } = DUE;
    expect(handOffDue({ pressed: [], view: elsewhere })).toBe(false);
  });
});

describe("withAttempt", () => {
  it("replaces the attempt for its own episode and keeps every other one, the newest last", () => {
    const a = attempt({ episode: "chair-hand-off:app-a", outcome: "running" });
    const b = attempt({ episode: "chair-hand-off:app-b", outcome: "seated" });
    const aEnded = attempt({ episode: "chair-hand-off:app-a", outcome: "not-yet" });
    expect(withAttempt({ attempt: aEnded, pressed: [a, b] })).toEqual([b, aEnded]);
    expect(withAttempt({ attempt: b, pressed: [a] })).toEqual([a, b]);
  });
});

describe("handOffOutcomeOf", () => {
  it("reads each of the verb's exit codes", () => {
    expect([0, 1, 2, 3, 4, 137].map((code) => handOffOutcomeOf({ code }))).toEqual([
      "seated",
      "refused",
      "failed",
      "nothing-to-do",
      "not-yet",
      "failed",
    ]);
  });
});

describe("lastPrintedLine", () => {
  it("takes the last line that says something", () => {
    expect(lastPrintedLine({ text: "supervisor hand-off: asked\nsupervisor hand-off: seated plan-four\n\n" })).toBe(
      "supervisor hand-off: seated plan-four",
    );
  });

  it("says so when the verb printed nothing", () => {
    expect(lastPrintedLine({ text: " \n" })).toBe("it printed nothing");
  });
});

describe("parseHandOffAttempts", () => {
  it("reads back every attempt the app saved, and an empty list", () => {
    const saved = [
      attempt({ episode: "chair-hand-off:app-6", outcome: "seated" }),
      attempt({ episode: "chair-hand-off:app-7", outcome: "not-yet" }),
    ];
    const read = parseHandOffAttempts({ text: `${JSON.stringify(saved, null, 2)}\n` });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual(saved);
    expect(unwrap(parseHandOffAttempts({ text: "[]" }))).toEqual([]);
  });

  it("refuses a file that is not JSON, not a list, or holds one attempt not the shape the app writes", () => {
    const good = attempt({ episode: "chair-hand-off:app-6", outcome: "seated" });
    const texts = [
      "{",
      JSON.stringify(good),
      JSON.stringify([
        good,
        { ...attempt({ episode: "chair-hand-off:app-7", outcome: "seated" }), outcome: "pressed" },
      ]),
      JSON.stringify([attempt({ episode: "app-7", outcome: "seated" })]),
    ];
    expect(texts.length).toBe(4);
    expect(texts.map((text) => unwrapErr(parseHandOffAttempts({ text })))).toEqual([
      "the saved hand-off attempts are not JSON",
      "the saved hand-off attempts are not a list",
      "a saved hand-off attempt is not the shape this app writes",
      "a saved hand-off attempt is not the shape this app writes",
    ]);
  });
});

describe("chairTrayLines", () => {
  it("draws the status and first reason, the chair's plan, the successor plan and the attempt", () => {
    const last = attempt({ episode: "chair-hand-off:app-7", outcome: "running" });
    expect(chairTrayLines({ last, paused: undefined, problem: undefined, view: DUE })).toEqual([
      "Chair: hand-off due · plan-one is past its bar at week 91%",
      "Chair plan plan-one: week 91%, Fable week 88%",
      "Next chair on plan-four",
      "Hand-off running · supervisor hand-off: seated plan-four",
    ]);
  });

  it("says a not-yet press is not pressed again", () => {
    const last = attempt({ episode: "chair-hand-off:app-7", outcome: "not-yet" });
    expect(chairTrayLines({ last, paused: undefined, problem: undefined, view: DUE })).toContain(
      "Hand-off not yet, not pressed again · supervisor hand-off: seated plan-four",
    );
  });

  it("draws the owner's hold", () => {
    const held: ChairWatchView = { ...DUE, holdReason: "keep this one tonight", status: "held" };
    expect(chairTrayLines({ last: undefined, paused: undefined, problem: undefined, view: held })).toContain(
      "Held by you: keep this one tonight",
    );
  });

  it("says why the app presses nothing while its saved attempts cannot be used", () => {
    const paused = "the saved hand-off attempts are not JSON";
    expect(chairTrayLines({ last: undefined, paused, problem: undefined, view: DUE })).toContain(
      "Hand-off paused, nothing pressed · the saved hand-off attempts are not JSON",
    );
  });

  it("says why the watch could not be read, and waits before the first reading", () => {
    expect(
      chairTrayLines({
        last: undefined,
        paused: undefined,
        problem: "the chair watch printed no JSON document",
        view: undefined,
      }),
    ).toEqual(["Chair: could not be read · the chair watch printed no JSON document"]);
    expect(chairTrayLines({ last: undefined, paused: undefined, problem: undefined, view: undefined })).toEqual([
      "Chair: reading…",
    ]);
  });
});
