/*
 * The pure half of the ISO nudge: which sample is ISO, when a work-hours stretch off ISO owes a nudge, and the cadence —
 * one, then one more only much later, never a third. The nudge says the ISO work is still waiting on the owner.
 */
import { describe, expect, it } from "vitest";

import { FRONT_WINDOW_POLL_MS, type FrontWindowActivity } from "../../lib/driftWatch";
import type { IsoNudgeNotice } from "../../lib/isoNudgeNotice";
import { EMPTY_ISO_QUEUE, type IsoQueueSnapshot } from "../../lib/isoQueueItems";
import { isoStrayStateOf, isoStrayStateText } from "../../lib/isoStrayStore";
import {
  foldIsoStrayWatch,
  IDLE_ISO_STRAY_WATCH,
  ISO_STRAY_AGAIN_MS,
  ISO_STRAY_DWELL_MS,
  ISO_STRAY_GAP_MS,
  type IsoStrayState,
  inIsoWorkHours,
  isoNudgeOwed,
  isoStrayClassOf,
} from "../../lib/isoStrayWatch";

const MINUTE = 60_000;

/** A Monday morning in UTC: the first work minute of the week, read in UTC. */
const MONDAY_NINE = Date.UTC(2026, 9, 12, 9);

const VANTA_DOCS = { key: "handover:six-vanta-evidence-documents", subject: "Six Vanta evidence documents" };
const ACCESS_REVIEW = { key: "handover:open-the-access-review-pr", subject: "Open the access review PR" };

/** Two ISO cards waiting, nothing open. */
const WAITING: IsoQueueSnapshot = { openCard: "unknown", waiting: [VANTA_DOCS, ACCESS_REVIEW] };

const SLACK: FrontWindowActivity = { app: "Slack", bundleId: "com.tinyspeck.slackmacgap", title: "#dev-platform" };
const CURSOR: FrontWindowActivity = { app: "Cursor", bundleId: "com.todesktop.cursor", title: "devex.ts — slopweaver" };
const VANTA: FrontWindowActivity = { app: "Google Chrome", bundleId: "com.google.Chrome", title: "Vanta — Controls" };
const SLOPWEAVER: FrontWindowActivity = {
  app: "Slopweaver",
  bundleId: "ai.slopweaver.desktop",
  title: "Queue",
};
const UNTITLED: FrontWindowActivity = { app: "Slack", bundleId: "com.tinyspeck.slackmacgap", title: null };

/** One stretch of the same window, sampled every poll from `fromMs` up to but not including `toMs`. */
interface Leg {
  readonly activity: FrontWindowActivity | undefined;
  readonly fromMs: number;
  readonly toMs: number;
  readonly queue?: IsoQueueSnapshot;
}

/**
 * The page's loop over a run of legs: sample every poll, and whenever a nudge is owed say it at once and fold it told.
 *
 * @returns every nudge said, in order, with when
 */
function walk({
  legs,
  timeZone = "UTC",
  from = IDLE_ISO_STRAY_WATCH,
}: {
  legs: readonly Leg[];
  timeZone?: string;
  from?: IsoStrayState;
}) {
  let state = from;
  const said: { atMs: number; notice: IsoNudgeNotice }[] = [];
  for (const leg of legs) {
    for (let nowMs = leg.fromMs; nowMs < leg.toMs; nowMs += FRONT_WINDOW_POLL_MS) {
      const queue = leg.queue ?? WAITING;
      const input = {
        activity: leg.activity,
        freshId: `n-${String(nowMs)}`,
        kind: "sample",
        nowMs,
        queue,
        timeZone,
      } as const;
      state = foldIsoStrayWatch({ input, state });
      const owed = isoNudgeOwed({ state });
      if (owed !== undefined) {
        said.push({ atMs: nowMs, notice: owed });
        state = foldIsoStrayWatch({ input: { kind: "told", noticeId: owed.noticeId, nowMs }, state });
      }
    }
  }
  return { said, state };
}

// The owner's proof (handover doc): an off-ISO work-hours stretch with ISO items yields exactly one nudge and a second
// only after the long gap, and an ISO stretch none.
describe("the ISO nudge's cadence", () => {
  it("says one nudge once an off-ISO work-hours stretch reaches the dwell, naming the first ISO card", () => {
    const { said } = walk({ legs: [{ activity: CURSOR, fromMs: MONDAY_NINE, toMs: MONDAY_NINE + 59 * MINUTE }] });
    expect(said).toEqual([
      {
        atMs: MONDAY_NINE + ISO_STRAY_DWELL_MS,
        notice: {
          again: false,
          item: VANTA_DOCS,
          minutes: 10,
          noticeId: `n-${String(MONDAY_NINE + ISO_STRAY_DWELL_MS)}`,
        },
      },
    ]);
  });

  it("says a second only the long gap after the first, and never a third however long the stretch runs", () => {
    const { said } = walk({ legs: [{ activity: CURSOR, fromMs: MONDAY_NINE, toMs: MONDAY_NINE + 7 * 60 * MINUTE }] });
    const first = MONDAY_NINE + ISO_STRAY_DWELL_MS;
    expect(said.map(({ atMs, notice }) => ({ again: notice.again, atMs, minutes: notice.minutes }))).toEqual([
      { again: false, atMs: first, minutes: 10 },
      { again: true, atMs: first + ISO_STRAY_AGAIN_MS, minutes: 70 },
    ]);
  });

  it("keeps that cadence across page reloads, the watch carried through this browser's storage", () => {
    const reload = ({ state, nowMs }: { state: IsoStrayState; nowMs: number }): IsoStrayState =>
      isoStrayStateOf({ nowMs, text: isoStrayStateText({ state }) })!;
    const first = walk({ legs: [{ activity: CURSOR, fromMs: MONDAY_NINE, toMs: MONDAY_NINE + 11 * MINUTE }] });
    const second = walk({
      from: reload({ nowMs: MONDAY_NINE + 11 * MINUTE, state: first.state }),
      legs: [{ activity: CURSOR, fromMs: MONDAY_NINE + 11 * MINUTE, toMs: MONDAY_NINE + 22 * MINUTE }],
    });
    const rest = walk({
      from: reload({ nowMs: MONDAY_NINE + 22 * MINUTE, state: second.state }),
      legs: [{ activity: CURSOR, fromMs: MONDAY_NINE + 22 * MINUTE, toMs: MONDAY_NINE + 8 * 60 * MINUTE }],
    });
    expect([...first.said, ...second.said, ...rest.said].map(({ atMs }) => atMs)).toEqual([
      MONDAY_NINE + ISO_STRAY_DWELL_MS,
      MONDAY_NINE + ISO_STRAY_DWELL_MS + ISO_STRAY_AGAIN_MS,
    ]);
  });

  it("reads back every state the fold reaches, at the instant it was reached, so the strict reader drops none", () => {
    // Slow tells, a withheld title, an ISO break and a card that stops waiting: every shape a live day leaves stored.
    const script: readonly Leg[] = [
      { activity: CURSOR, fromMs: MONDAY_NINE, toMs: MONDAY_NINE + 90 * MINUTE },
      { activity: UNTITLED, fromMs: MONDAY_NINE + 90 * MINUTE, toMs: MONDAY_NINE + 100 * MINUTE },
      { activity: VANTA, fromMs: MONDAY_NINE + 100 * MINUTE, toMs: MONDAY_NINE + 110 * MINUTE },
      { activity: SLACK, fromMs: MONDAY_NINE + 110 * MINUTE, toMs: MONDAY_NINE + 190 * MINUTE },
      {
        activity: SLACK,
        fromMs: MONDAY_NINE + 190 * MINUTE,
        queue: { ...WAITING, waiting: [ACCESS_REVIEW] },
        toMs: MONDAY_NINE + 300 * MINUTE,
      },
    ];
    let state = IDLE_ISO_STRAY_WATCH;
    let minted = 0;
    let owedPolls = 0;
    const reached: { nowMs: number; state: IsoStrayState }[] = [];
    for (const leg of script) {
      for (let nowMs = leg.fromMs; nowMs < leg.toMs; nowMs += FRONT_WINDOW_POLL_MS) {
        minted += 1;
        const freshId = `00000000-0000-4000-8000-${String(minted).padStart(12, "0")}`;
        const input = { activity: leg.activity, freshId, kind: "sample", nowMs, queue: leg.queue ?? WAITING } as const;
        state = foldIsoStrayWatch({ input: { ...input, timeZone: "UTC" }, state });
        reached.push({ nowMs, state });
        const owed = isoNudgeOwed({ state });
        if (owed === undefined) {
          owedPolls = 0;
          continue;
        }
        owedPolls += 1;
        if (owedPolls === 3) {
          state = foldIsoStrayWatch({ input: { kind: "told", noticeId: owed.noticeId, nowMs }, state });
          reached.push({ nowMs, state });
        }
      }
    }
    const shapes = new Set(reached.map(({ state: s }) => `${String(s.toldInStretch)}:${String(s.pending?.again)}`));
    expect([...shapes].toSorted()).toEqual(["0:false", "0:undefined", "1:true", "1:undefined", "2:undefined"]);
    expect(
      reached.map(({ nowMs, state: s }) => isoStrayStateOf({ nowMs, text: isoStrayStateText({ state: s }) })),
    ).toEqual(reached.map(({ state: s }) => s));
  });

  it("says nothing across a whole work day spent on ISO, in Vanta or with an ISO card open in Slopweaver", () => {
    const isoOpen: IsoQueueSnapshot = { ...WAITING, openCard: "iso" };
    const { said } = walk({
      legs: [
        { activity: VANTA, fromMs: MONDAY_NINE, toMs: MONDAY_NINE + 4 * 60 * MINUTE },
        {
          activity: SLOPWEAVER,
          fromMs: MONDAY_NINE + 4 * 60 * MINUTE,
          queue: isoOpen,
          toMs: MONDAY_NINE + 8 * 60 * MINUTE,
        },
      ],
    });
    expect(said).toEqual([]);
  });

  it("says nothing when no ISO card waits on the owner, however long the owner is off ISO", () => {
    const { said } = walk({
      legs: [{ activity: SLACK, fromMs: MONDAY_NINE, queue: EMPTY_ISO_QUEUE, toMs: MONDAY_NINE + 8 * 60 * MINUTE }],
    });
    expect(said).toEqual([]);
  });

  it("says nothing outside work hours: a weekday evening and a Saturday", () => {
    const evening = Date.UTC(2026, 9, 12, 17);
    const saturday = Date.UTC(2026, 9, 17, 10);
    const { said } = walk({
      legs: [
        { activity: SLACK, fromMs: evening, toMs: evening + 3 * 60 * MINUTE },
        { activity: SLACK, fromMs: saturday, toMs: saturday + 3 * 60 * MINUTE },
      ],
    });
    expect(said).toEqual([]);
  });

  it("never lets stepping onto ISO and off again buy a fresh nudge inside the long gap", () => {
    const first = MONDAY_NINE + ISO_STRAY_DWELL_MS;
    const { said } = walk({
      legs: [
        { activity: SLACK, fromMs: MONDAY_NINE, toMs: first + MINUTE },
        { activity: VANTA, fromMs: first + MINUTE, toMs: first + 2 * MINUTE },
        { activity: SLACK, fromMs: first + 2 * MINUTE, toMs: first + ISO_STRAY_AGAIN_MS },
      ],
    });
    expect(said.map(({ atMs }) => atMs)).toEqual([first]);
  });

  it("starts a new stretch after a gap with no off-ISO sample, so the dwell runs again from it", () => {
    const back = MONDAY_NINE + ISO_STRAY_GAP_MS + 2 * MINUTE;
    const { said } = walk({
      legs: [
        { activity: SLACK, fromMs: MONDAY_NINE, toMs: MONDAY_NINE + 2 * MINUTE },
        { activity: undefined, fromMs: MONDAY_NINE + 2 * MINUTE, toMs: back },
        { activity: SLACK, fromMs: back, toMs: back + ISO_STRAY_DWELL_MS + MINUTE },
      ],
    });
    expect(said.map(({ atMs, notice }) => ({ atMs, minutes: notice.minutes }))).toEqual([
      { atMs: back + ISO_STRAY_DWELL_MS, minutes: 10 },
    ]);
  });

  it("carries a stretch across unreadable samples shorter than the gap, counting from its first off-ISO sample", () => {
    const { said } = walk({
      legs: [
        { activity: SLACK, fromMs: MONDAY_NINE, toMs: MONDAY_NINE + 4 * MINUTE },
        { activity: UNTITLED, fromMs: MONDAY_NINE + 4 * MINUTE, toMs: MONDAY_NINE + 8 * MINUTE },
        { activity: SLACK, fromMs: MONDAY_NINE + 8 * MINUTE, toMs: MONDAY_NINE + 12 * MINUTE },
      ],
    });
    expect(said.map(({ atMs }) => atMs)).toEqual([MONDAY_NINE + ISO_STRAY_DWELL_MS]);
  });

  it("reads work hours in the owner's own zone: 09:00 in Sydney is 22:00 UTC the day before", () => {
    const sydneyNine = Date.UTC(2026, 9, 11, 22);
    const { said } = walk({
      legs: [{ activity: SLACK, fromMs: sydneyNine, toMs: sydneyNine + ISO_STRAY_DWELL_MS + MINUTE }],
      timeZone: "Australia/Sydney",
    });
    expect(said.map(({ atMs }) => atMs)).toEqual([sydneyNine + ISO_STRAY_DWELL_MS]);
  });
});

describe("a nudge owed and not yet told", () => {
  /** The watch at the dwell, its nudge owed and never told. */
  const owedAtDwell = (): IsoStrayState => {
    let state = IDLE_ISO_STRAY_WATCH;
    for (let nowMs = MONDAY_NINE; nowMs <= MONDAY_NINE + ISO_STRAY_DWELL_MS; nowMs += FRONT_WINDOW_POLL_MS) {
      const input = {
        activity: SLACK,
        freshId: `n-${String(nowMs)}`,
        kind: "sample",
        nowMs,
        queue: WAITING,
        timeZone: "UTC",
      } as const;
      state = foldIsoStrayWatch({ input, state });
    }
    return state;
  };

  it("keeps its id and its card through every retry until it is told", () => {
    const before = owedAtDwell();
    const later = MONDAY_NINE + ISO_STRAY_DWELL_MS + 2 * MINUTE;
    const input = {
      activity: SLACK,
      freshId: "n-later",
      kind: "sample",
      nowMs: later,
      queue: WAITING,
      timeZone: "UTC",
    } as const;
    const after = foldIsoStrayWatch({ input, state: before });
    expect(isoNudgeOwed({ state: after })).toEqual(isoNudgeOwed({ state: before }));
    expect(isoNudgeOwed({ state: after })!.noticeId).toBe(`n-${String(MONDAY_NINE + ISO_STRAY_DWELL_MS)}`);
  });

  it("spends the slot unsaid once its card stops waiting, so the next is the stretch's second", () => {
    const gone = MONDAY_NINE + ISO_STRAY_DWELL_MS + MINUTE;
    const queue: IsoQueueSnapshot = { openCard: "unknown", waiting: [ACCESS_REVIEW] };
    const input = { activity: SLACK, freshId: "n-gone", kind: "sample", nowMs: gone, queue, timeZone: "UTC" } as const;
    const after = foldIsoStrayWatch({ input, state: owedAtDwell() });
    expect([isoNudgeOwed({ state: after }), after.toldInStretch, after.lastToldMs]).toEqual([undefined, 1, gone]);
  });

  it("spends it unsaid when its card waits under another subject, never speaking a name the card no longer has", () => {
    const renamed = MONDAY_NINE + ISO_STRAY_DWELL_MS + MINUTE;
    const queue: IsoQueueSnapshot = {
      openCard: "unknown",
      waiting: [{ ...VANTA_DOCS, subject: "Collect Vanta evidence" }, ACCESS_REVIEW],
    };
    const input = { activity: SLACK, freshId: "n-re", kind: "sample", nowMs: renamed, queue, timeZone: "UTC" } as const;
    const after = foldIsoStrayWatch({ input, state: owedAtDwell() });
    expect([isoNudgeOwed({ state: after }), after.toldInStretch, after.lastToldMs]).toEqual([undefined, 1, renamed]);
  });

  it("drops it when the owner goes onto ISO, counting it as told since a lost answer may have been said", () => {
    const onIso = MONDAY_NINE + ISO_STRAY_DWELL_MS + MINUTE;
    const input = {
      activity: VANTA,
      freshId: "n-iso",
      kind: "sample",
      nowMs: onIso,
      queue: WAITING,
      timeZone: "UTC",
    } as const;
    const after = foldIsoStrayWatch({ input, state: owedAtDwell() });
    expect(after).toEqual({ ...IDLE_ISO_STRAY_WATCH, lastToldMs: onIso });
  });

  it("ignores a told for any other id", () => {
    const before = owedAtDwell();
    const after = foldIsoStrayWatch({
      input: { kind: "told", noticeId: "n-other", nowMs: MONDAY_NINE + ISO_STRAY_DWELL_MS },
      state: before,
    });
    expect(after).toEqual(before);
  });
});

describe("isoStrayClassOf", () => {
  it("reads an ISO title word as ISO in any window, as a whole phrase only", () => {
    expect([
      isoStrayClassOf({ activity: VANTA, queue: WAITING }),
      isoStrayClassOf({ activity: { ...SLACK, title: "#iso-27001-review" }, queue: WAITING }),
      isoStrayClassOf({ activity: { ...CURSOR, title: "isomorphic.ts — slopweaver" }, queue: WAITING }),
      isoStrayClassOf({ activity: { ...SLACK, title: "ISMS scope" }, queue: WAITING }),
    ]).toEqual(["iso", "iso", "off", "iso"]);
  });

  it("judges Slopweaver by the card open in it, and a withheld title or no sample as unknown", () => {
    expect([
      isoStrayClassOf({ activity: SLOPWEAVER, queue: { ...WAITING, openCard: "iso" } }),
      isoStrayClassOf({ activity: SLOPWEAVER, queue: { ...WAITING, openCard: "off" } }),
      isoStrayClassOf({ activity: SLOPWEAVER, queue: WAITING }),
      isoStrayClassOf({ activity: UNTITLED, queue: WAITING }),
      isoStrayClassOf({ activity: undefined, queue: WAITING }),
    ]).toEqual(["iso", "off", "unknown", "unknown", "unknown"]);
  });

  it("never lets a Slopweaver title's words outrank the open card's tag", () => {
    const titled = { ...SLOPWEAVER, title: "ISO 27001 mentioned in passing — Slopweaver" };
    expect([
      isoStrayClassOf({ activity: titled, queue: { ...WAITING, openCard: "off" } }),
      isoStrayClassOf({ activity: titled, queue: WAITING }),
    ]).toEqual(["off", "unknown"]);
  });
});

describe("inIsoWorkHours", () => {
  it("is Monday to Friday, 09:00 inclusive to 17:00 exclusive, in the zone given", () => {
    expect([
      inIsoWorkHours({ nowMs: MONDAY_NINE - 1, timeZone: "UTC" }),
      inIsoWorkHours({ nowMs: MONDAY_NINE, timeZone: "UTC" }),
      inIsoWorkHours({ nowMs: Date.UTC(2026, 9, 16, 16, 59), timeZone: "UTC" }),
      inIsoWorkHours({ nowMs: Date.UTC(2026, 9, 16, 17), timeZone: "UTC" }),
      inIsoWorkHours({ nowMs: Date.UTC(2026, 9, 18, 12), timeZone: "UTC" }),
      inIsoWorkHours({ nowMs: Date.UTC(2026, 9, 11, 22), timeZone: "Australia/Sydney" }),
    ]).toEqual([false, true, true, false, false, true]);
  });
});
