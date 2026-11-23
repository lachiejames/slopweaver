/**
 * Whether a cmux hang is the same failure coming back after a restart, and when a restart for it is held — a
 * loop of two restarts followed by a third hang is the shape.
 */
import { describe, expect, it } from "vitest";

import { hangNamingEvents } from "../../../cmux/hangNaming.js";
import {
  fleetRecurrence,
  recurrenceForHang,
  recurrenceWasJournalled,
  recurringHoldOrigin,
} from "../../../cmux/recurrence.js";
import type { CmuxReviveEvent } from "../../../cmux/reviveJournal.js";
import { FLEET_JOURNAL_TAIL_ROWS } from "../../../fleet/journalTail.js";

/** `HH:MM` on the fixed test day as an instant. */
function at({ clock }: { clock: string }): string {
  return `2026-10-11T${clock}:00.000Z`;
}

/** One restart: its start for a hang, and its finish when an outcome is given. */
function restart({
  start,
  hungSince,
  finish,
  outcome = "answering",
}: {
  start: string;
  hungSince: string;
  finish?: string;
  outcome?: "answering" | "not-answering" | "failed";
}): CmuxReviveEvent[] {
  const started: CmuxReviveEvent = {
    appPid: 1,
    atIso: at({ clock: start }),
    hungSinceIso: at({ clock: hungSince }),
    kind: "restart-started",
    schemaVersion: 1,
  };
  if (finish === undefined) {
    return [started];
  }
  return [
    started,
    { atIso: at({ clock: finish }), detail: "", kind: "restart-finished", newAppPid: 2, outcome, schemaVersion: 1 },
  ];
}

/**
 * The loop's two restarts, each after its hang's first reading: a first hang, then one 18 minutes after the
 * first restart came back.
 */
const LOOP = [
  reading({ clock: "06:20" }),
  ...restart({ finish: "06:38", hungSince: "06:20", start: "06:37" }),
  reading({ clock: "06:56" }),
  ...restart({ finish: "07:15", hungSince: "06:56", start: "07:14" }),
];

/** The loop, then a hang whose first reading is at `HH:MM`. */
function loopThenHang({ clock }: { clock: string }): CmuxReviveEvent[] {
  return [...LOOP, reading({ clock })];
}

describe("recurrenceForHang", () => {
  it("names a hang that began within the hour after a restart came back answering", () => {
    expect(recurrenceForHang({ events: LOOP, hungSinceIso: at({ clock: "06:56" }) })).toEqual({
      afterRestartIso: at({ clock: "06:38" }),
      hungSinceIso: at({ clock: "06:56" }),
      intervalMs: 18 * 60_000,
    });
  });

  it("calls a hang with no restart before it a first one", () => {
    expect(recurrenceForHang({ events: LOOP, hungSinceIso: at({ clock: "06:20" }) })).toBeUndefined();
  });

  it("calls a hang first read more than an hour and a first reading's lag after the restart a first one", () => {
    const events = loopThenHang({ clock: "08:18" });
    expect(recurrenceForHang({ events, hungSinceIso: at({ clock: "08:18" }) })).toBeUndefined();
  });

  it("counts a hang first read a minute past the hour as recurring, since it may have begun inside it", () => {
    const events = loopThenHang({ clock: "08:16" });
    expect(recurrenceForHang({ events, hungSinceIso: at({ clock: "08:16" }) })?.intervalMs).toBe(61 * 60_000);
  });

  it("counts a hang exactly an hour after the restart as recurring", () => {
    const events = loopThenHang({ clock: "08:15" });
    expect(recurrenceForHang({ events, hungSinceIso: at({ clock: "08:15" }) })?.intervalMs).toBe(60 * 60_000);
  });

  it("places a hang by the journal, so one stamped before the restart by a clock set back still recurs", () => {
    const events = loopThenHang({ clock: "06:50" });
    expect(recurrenceForHang({ events, hungSinceIso: at({ clock: "06:50" }) })).toEqual({
      afterRestartIso: at({ clock: "07:15" }),
      hungSinceIso: at({ clock: "06:50" }),
      intervalMs: 0,
    });
  });

  it("calls a hang whose first reading has left the tail a first one", () => {
    expect(recurrenceForHang({ events: LOOP, hungSinceIso: at({ clock: "07:26" }) })).toBeUndefined();
  });

  it("never calls a hang after a restart that did not answer a recurrence — it is the same hang continuing", () => {
    const failed = [
      ...restart({ finish: "06:38", hungSince: "06:20", outcome: "not-answering", start: "06:37" }),
      reading({ clock: "06:56" }),
    ];
    expect(recurrenceForHang({ events: failed, hungSinceIso: at({ clock: "06:56" }) })).toBeUndefined();
  });

  it("reads a restart with no finish line as no recovery", () => {
    const lost = [...restart({ hungSince: "06:20", start: "06:37" }), reading({ clock: "06:56" })];
    expect(recurrenceForHang({ events: lost, hungSinceIso: at({ clock: "06:56" }) })).toBeUndefined();
  });
});

describe("recurrenceWasJournalled", () => {
  const recurrence = {
    afterRestartIso: at({ clock: "06:38" }),
    hungSinceIso: at({ clock: "06:56" }),
    intervalMs: 18 * 60_000,
  };
  const line: CmuxReviveEvent = {
    afterRestartIso: at({ clock: "06:38" }),
    atIso: at({ clock: "06:57" }),
    hungSinceIso: at({ clock: "06:56" }),
    kind: "recurring",
    schemaVersion: 1,
  };

  it("finds the line for the same hang and restart, and no other", () => {
    expect([
      recurrenceWasJournalled({ events: [line], recurrence }),
      recurrenceWasJournalled({ events: [{ ...line, hungSinceIso: at({ clock: "07:26" }) }], recurrence }),
      recurrenceWasJournalled({ events: [], recurrence }),
    ]).toEqual([true, false, false]);
  });
});

/** One unanswered or answering reading of app 1 at `HH:MM`. */
function reading({
  clock,
  state = "stalled",
}: {
  clock: string;
  state?: "stalled" | "answering" | "unprobed";
}): CmuxReviveEvent {
  return {
    appPid: 1,
    appStart: "Sun Oct 11 07:15:00 2026",
    atIso: at({ clock }),
    detail: "",
    kind: "reading",
    schemaVersion: 1,
    state,
  };
}

/** The held third hang's marker, stamped at `HH:MM`, for the hang that began at 07:26. */
function heldMarker({ clock }: { clock: string }): CmuxReviveEvent {
  return { atIso: at({ clock }), hungSinceIso: at({ clock: "07:26" }), kind: "restart-held", schemaVersion: 1 };
}

/**
 * A recurring hang at 06:56 that no seat called through for an hour, so the revive re-dated it to 08:00 when calls
 * resumed, and restarted it at 08:10 — with `between` journalled inside the quiet hour.
 */
function redatedRecurrence({ between }: { between: CmuxReviveEvent[] }): CmuxReviveEvent[] {
  return [
    reading({ clock: "06:20" }),
    ...restart({ finish: "06:38", hungSince: "06:20", start: "06:37" }),
    reading({ clock: "06:56" }),
    reading({ clock: "07:05", state: "unprobed" }),
    ...between,
    reading({ clock: "07:58", state: "unprobed" }),
    reading({ clock: "08:00" }),
    ...restart({ finish: "08:11", hungSince: "08:00", start: "08:10" }),
    reading({ clock: "08:20" }),
  ];
}

describe("recurringHoldOrigin", () => {
  it("holds the third restart when the recurring hang was re-dated after a quiet hour it never answered in", () => {
    const events = redatedRecurrence({ between: [] });
    expect(recurringHoldOrigin({ events, hungSinceIso: at({ clock: "08:20" }) })).toBe(at({ clock: "08:20" }));
  });

  it("restarts again when cmux answered inside the quiet hour, so the 08:00 hang was a new one", () => {
    const events = redatedRecurrence({ between: [reading({ clock: "07:30", state: "answering" })] });
    expect(recurringHoldOrigin({ events, hungSinceIso: at({ clock: "08:20" }) })).toBeUndefined();
  });

  it("allows the restart for the first recurrence — the fleet presses it once more", () => {
    const first = [...restart({ finish: "06:38", hungSince: "06:20", start: "06:37" }), reading({ clock: "06:56" })];
    expect(recurringHoldOrigin({ events: first, hungSinceIso: at({ clock: "06:56" }) })).toBeUndefined();
  });

  it("holds the third hang of a loop, however long it then lasts", () => {
    const events = loopThenHang({ clock: "07:26" });
    expect(recurringHoldOrigin({ events, hungSinceIso: at({ clock: "07:26" }) })).toBe(at({ clock: "07:26" }));
  });

  it("holds a third hang first read up to a first reading's lag past the hour after the loop's restart, and none after", () => {
    expect([
      recurringHoldOrigin({ events: loopThenHang({ clock: "08:15" }), hungSinceIso: at({ clock: "08:15" }) }),
      recurringHoldOrigin({ events: loopThenHang({ clock: "08:16" }), hungSinceIso: at({ clock: "08:16" }) }),
      recurringHoldOrigin({ events: loopThenHang({ clock: "08:17" }), hungSinceIso: at({ clock: "08:17" }) }),
      recurringHoldOrigin({ events: loopThenHang({ clock: "08:18" }), hungSinceIso: at({ clock: "08:18" }) }),
    ]).toEqual([at({ clock: "08:15" }), at({ clock: "08:16" }), at({ clock: "08:17" }), undefined]);
  });

  it("holds a third hang a clock set back stamped before the loop's restart, past its cooldown", () => {
    // R0 came back at 10:00, a hang at 10:10 was restarted by R1 by 10:21, and at 10:25 the clock went back to 09:55.
    const events = [
      reading({ clock: "09:40" }),
      ...restart({ finish: "10:00", hungSince: "09:40", start: "09:59" }),
      reading({ clock: "10:10" }),
      ...restart({ finish: "10:21", hungSince: "10:10", start: "10:20" }),
      reading({ clock: "09:55" }),
      reading({ clock: "10:50" }),
    ];
    expect(recurringHoldOrigin({ events, hungSinceIso: at({ clock: "09:55" }) })).toBe(at({ clock: "09:55" }));
  });

  it("holds a third hang when the first restart's finish was lost but cmux was read answering", () => {
    const events = [
      reading({ clock: "06:00" }),
      ...restart({ hungSince: "06:00", start: "06:10" }),
      reading({ clock: "06:11", state: "answering" }),
      reading({ clock: "06:20" }),
      ...restart({ finish: "06:41", hungSince: "06:20", start: "06:40" }),
      reading({ clock: "07:00" }),
    ];
    expect([
      recurrenceForHang({ events, hungSinceIso: at({ clock: "06:20" }) })?.afterRestartIso,
      recurringHoldOrigin({ events, hungSinceIso: at({ clock: "07:00" }) }),
    ]).toEqual([at({ clock: "06:11" }), at({ clock: "07:00" })]);
  });

  it("measures the hour from the loop restart's start when its finish was never written", () => {
    const lost = [
      reading({ clock: "06:20" }),
      ...restart({ finish: "06:38", hungSince: "06:20", start: "06:37" }),
      reading({ clock: "06:56" }),
      ...restart({ hungSince: "06:56", start: "07:14" }),
    ];
    expect([
      recurringHoldOrigin({ events: [...lost, reading({ clock: "08:16" })], hungSinceIso: at({ clock: "08:16" }) }),
      recurringHoldOrigin({ events: [...lost, reading({ clock: "08:17" })], hungSinceIso: at({ clock: "08:17" }) }),
    ]).toEqual([at({ clock: "08:16" }), undefined]);
  });

  it("keeps holding once the restarts and the hang's start have left the tail, by the marker", () => {
    const tail = [reading({ clock: "21:00" }), heldMarker({ clock: "21:26" }), reading({ clock: "21:30" })];
    expect(recurringHoldOrigin({ events: tail, hungSinceIso: at({ clock: "21:00" }) })).toBe(at({ clock: "07:26" }));
  });

  it("holds by the second hang's recurring line when the first restart has left the tail before any marker", () => {
    const recurring: CmuxReviveEvent = {
      afterRestartIso: at({ clock: "06:38" }),
      atIso: at({ clock: "06:57" }),
      hungSinceIso: at({ clock: "06:56" }),
      kind: "recurring",
      schemaVersion: 1,
    };
    const tail = [
      recurring,
      ...restart({ finish: "07:15", hungSince: "06:56", start: "07:14" }),
      reading({ clock: "07:26" }),
    ];
    expect([
      recurringHoldOrigin({ events: tail, hungSinceIso: at({ clock: "07:26" }) }),
      recurringHoldOrigin({ events: tail.slice(1), hungSinceIso: at({ clock: "07:26" }) }),
    ]).toEqual([at({ clock: "07:26" }), undefined]);
  });

  it("holds the hang after a restart for a recurring hang that lasted until its first restart left the tail", () => {
    // The 06:56 recurrence never answered; by 20:10 its restart and first reading are gone, and only its line remains.
    const recurring: CmuxReviveEvent = {
      afterRestartIso: at({ clock: "06:38" }),
      atIso: at({ clock: "19:00" }),
      hungSinceIso: at({ clock: "06:56" }),
      kind: "recurring",
      schemaVersion: 1,
    };
    const tail = ({ between }: { between: CmuxReviveEvent[] }): CmuxReviveEvent[] => [
      recurring,
      reading({ clock: "19:30", state: "unprobed" }),
      ...between,
      reading({ clock: "20:00" }),
      ...restart({ finish: "20:11", hungSince: "20:00", start: "20:10" }),
      reading({ clock: "20:20" }),
    ];
    expect([
      recurringHoldOrigin({ events: tail({ between: [] }), hungSinceIso: at({ clock: "20:20" }) }),
      recurringHoldOrigin({
        events: tail({ between: [reading({ clock: "19:40", state: "answering" })] }),
        hungSinceIso: at({ clock: "20:20" }),
      }),
    ]).toEqual([at({ clock: "20:20" }), undefined]);
  });

  it("holds by the marker when only the first restart has left the tail", () => {
    const tail = [
      ...restart({ finish: "07:15", hungSince: "06:56", start: "07:14" }),
      reading({ clock: "07:26" }),
      heldMarker({ clock: "07:30" }),
    ];
    expect(recurringHoldOrigin({ events: tail, hungSinceIso: at({ clock: "07:26" }) })).toBe(at({ clock: "07:26" }));
  });

  it("keeps the 07:26 hold over a run a decline at 08:20 began, cmux never answering", () => {
    const events: CmuxReviveEvent[] = [
      ...LOOP,
      reading({ clock: "07:26" }),
      heldMarker({ clock: "07:27" }),
      reading({ clock: "08:19" }),
      {
        atIso: at({ clock: "08:20" }),
        button: "Cancel",
        kind: "dialog-dismissed",
        schemaVersion: 1,
        title: "Run Project Action?",
      },
      reading({ clock: "08:21" }),
      reading({ clock: "08:31" }),
    ];
    expect(recurringHoldOrigin({ events, hungSinceIso: at({ clock: "08:21" }) })).toBe(at({ clock: "07:26" }));
  });

  it("releases the marker's hold after an answer, never after a declined dialog cmux did not answer past", () => {
    const answered = [
      heldMarker({ clock: "08:26" }),
      reading({ clock: "09:00", state: "answering" }),
      reading({ clock: "21:00" }),
    ];
    const declined: CmuxReviveEvent[] = [
      heldMarker({ clock: "08:26" }),
      {
        atIso: at({ clock: "08:59" }),
        button: "Cancel",
        kind: "dialog-dismissed",
        schemaVersion: 1,
        title: "Run Project Action?",
      },
      reading({ clock: "21:00" }),
    ];
    expect([
      recurringHoldOrigin({ events: answered, hungSinceIso: at({ clock: "21:00" }) }),
      recurringHoldOrigin({ events: declined, hungSinceIso: at({ clock: "21:00" }) }),
    ]).toEqual([undefined, at({ clock: "07:26" })]);
  });

  it("keeps the hold over a paused revive's answer from before the hang, appended after the marker", () => {
    // A revive probed cmux answering at 07:20, paused, and appended that reading at 08:17 behind the 07:26 hold.
    const events = [
      ...loopThenHang({ clock: "07:26" }),
      heldMarker({ clock: "07:27" }),
      reading({ clock: "07:20", state: "answering" }),
      reading({ clock: "08:18" }),
    ];
    expect(recurringHoldOrigin({ events, hungSinceIso: at({ clock: "08:18" }) })).toBe(at({ clock: "07:26" }));
  });

  it("steps over unprobed readings at the tail's start when carrying the hold", () => {
    const tail = [
      reading({ clock: "20:59", state: "unprobed" }),
      heldMarker({ clock: "21:26" }),
      reading({ clock: "21:00" }),
    ];
    expect(recurringHoldOrigin({ events: tail, hungSinceIso: at({ clock: "21:00" }) })).toBe(at({ clock: "07:26" }));
  });
});

describe("hangNamingEvents", () => {
  const LOOP_HANG = [...LOOP, reading({ clock: "07:26" })];
  const thirdRecurring: CmuxReviveEvent = {
    afterRestartIso: at({ clock: "07:15" }),
    atIso: at({ clock: "07:27" }),
    hungSinceIso: at({ clock: "07:26" }),
    kind: "recurring",
    schemaVersion: 1,
  };

  it("names a held third hang's recurrence and its marker", () => {
    expect(
      hangNamingEvents({ events: LOOP_HANG, hungSinceIso: at({ clock: "07:26" }), nowIso: at({ clock: "07:27" }) }),
    ).toEqual([thirdRecurring, heldMarker({ clock: "07:27" })]);
  });

  it("re-states the marker once a quarter of the tail has piled up behind it, at any probe rate", () => {
    const marked = [...LOOP_HANG, thirdRecurring, heldMarker({ clock: "07:27" })];
    // A quarter of the row tail is the re-statement threshold. The recurring line sits one entry before the marker,
    // so two readings short of a quarter leaves both under it, and a quarter exactly puts both at it — all in the
    // same minute.
    const piled = ({ count }: { count: number }): CmuxReviveEvent[] =>
      Array.from({ length: count }, () => reading({ clock: "07:28" }));
    const naming = ({ count }: { count: number }): readonly CmuxReviveEvent[] =>
      hangNamingEvents({
        events: [...marked, ...piled({ count })],
        hungSinceIso: at({ clock: "07:26" }),
        nowIso: at({ clock: "07:28" }),
      });
    expect([
      naming({ count: FLEET_JOURNAL_TAIL_ROWS / 4 - 2 }),
      naming({ count: FLEET_JOURNAL_TAIL_ROWS / 4 }),
    ]).toEqual([[], [{ ...thirdRecurring, atIso: at({ clock: "07:28" }) }, heldMarker({ clock: "07:28" })]]);
  });

  it("re-states a recurring hang's line while cmux has not answered, so a hang of days keeps it in the tail", () => {
    const secondRecurring = {
      ...thirdRecurring,
      afterRestartIso: at({ clock: "06:38" }),
      hungSinceIso: at({ clock: "06:56" }),
    };
    const quiet = Array.from({ length: FLEET_JOURNAL_TAIL_ROWS / 4 }, () => reading({ clock: "19:00" }));
    expect(
      hangNamingEvents({
        events: [secondRecurring, ...quiet],
        hungSinceIso: at({ clock: "19:00" }),
        nowIso: at({ clock: "19:01" }),
      }),
    ).toEqual([{ ...secondRecurring, atIso: at({ clock: "19:01" }) }]);
  });

  it("names a first recurrence once and holds nothing", () => {
    const first = [...restart({ finish: "06:38", hungSince: "06:20", start: "06:37" }), reading({ clock: "06:56" })];
    const line: CmuxReviveEvent = {
      afterRestartIso: at({ clock: "06:38" }),
      atIso: at({ clock: "06:57" }),
      hungSinceIso: at({ clock: "06:56" }),
      kind: "recurring",
      schemaVersion: 1,
    };
    expect([
      hangNamingEvents({ events: first, hungSinceIso: at({ clock: "06:56" }), nowIso: at({ clock: "06:57" }) }),
      hangNamingEvents({
        events: [...first, line],
        hungSinceIso: at({ clock: "06:56" }),
        nowIso: at({ clock: "06:58" }),
      }),
    ]).toEqual([[line], []]);
  });
});

describe("fleetRecurrence", () => {
  it("shows the open hang's own recurrence", () => {
    expect(
      fleetRecurrence({
        events: LOOP.slice(0, 4),
        nowIso: at({ clock: "07:00" }),
        openHangSinceIso: at({ clock: "06:56" }),
      }),
    ).toEqual({ afterRestartIso: at({ clock: "06:38" }), intervalMs: 18 * 60_000 });
  });

  it("keeps showing a loop's restart for the hour after it while cmux answers", () => {
    expect(fleetRecurrence({ events: LOOP, nowIso: at({ clock: "07:30" }), openHangSinceIso: undefined })).toEqual({
      afterRestartIso: at({ clock: "06:38" }),
      intervalMs: 18 * 60_000,
    });
  });

  it("lets the mark expire an hour after that restart", () => {
    expect(
      fleetRecurrence({ events: LOOP, nowIso: at({ clock: "08:16" }), openHangSinceIso: undefined }),
    ).toBeUndefined();
  });

  it("shows nothing after a first hang's restart", () => {
    const first = restart({ finish: "06:38", hungSince: "06:20", start: "06:37" });
    expect(
      fleetRecurrence({ events: first, nowIso: at({ clock: "06:45" }), openHangSinceIso: undefined }),
    ).toBeUndefined();
  });
});
