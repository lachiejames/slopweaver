/*
 * The ISO watch as this browser keeps it between page loads: written whole, read back strictly, anything else idle.
 */
import { describe, expect, it } from "vitest";

import { isoStrayStateOf, isoStrayStateText } from "../../lib/isoStrayStore";
import { IDLE_ISO_STRAY_WATCH, type IsoStrayState } from "../../lib/isoStrayWatch";

/** Seventy-one minutes off ISO: the first told at ten, the second owed at seventy and not yet told. */
const MID_STRETCH: IsoStrayState = {
  lastOffMs: 1_760_260_260_000,
  lastToldMs: 1_760_256_600_000,
  pending: {
    again: true,
    item: { key: "handover:six-vanta-evidence-documents", subject: "Six Vanta evidence documents" },
    minutes: 70,
    noticeId: "9a1c3e5b-7d2f-4a6c-8e0b-1f3d5a7c9e2b",
  },
  stretchStartMs: 1_760_256_000_000,
  toldInStretch: 1,
};

/** The reload, a few seconds after {@link MID_STRETCH}'s newest sample. */
const READ_AT = 1_760_260_265_000;

describe("isoStrayStateText and isoStrayStateOf", () => {
  it("round-trips an idle watch and one mid-stretch with a nudge pending", () => {
    expect([
      isoStrayStateOf({ nowMs: READ_AT, text: isoStrayStateText({ state: IDLE_ISO_STRAY_WATCH }) }),
      isoStrayStateOf({ nowMs: READ_AT, text: isoStrayStateText({ state: MID_STRETCH }) }),
    ]).toEqual([IDLE_ISO_STRAY_WATCH, MID_STRETCH]);
  });

  it("writes every field, null standing for absent", () => {
    expect(isoStrayStateText({ state: IDLE_ISO_STRAY_WATCH })).toBe(
      '{"lastOffMs":null,"lastToldMs":null,"pending":null,"stretchStartMs":null,"toldInStretch":0}',
    );
  });

  it("reads nothing kept, unparseable text, a missing or surplus field, a bad count or a bad pending as no state", () => {
    const whole = JSON.parse(isoStrayStateText({ state: MID_STRETCH })) as Record<string, unknown>;
    const { toldInStretch: _dropped, ...missing } = whole;
    expect(
      [
        null,
        "{not json",
        JSON.stringify(missing),
        JSON.stringify({ ...whole, extra: 1 }),
        JSON.stringify({ ...whole, toldInStretch: 3 }),
        JSON.stringify({ ...whole, lastOffMs: "09:10" }),
        JSON.stringify({ ...whole, pending: { ...MID_STRETCH.pending, windowTitle: "Payroll" } }),
        JSON.stringify({ ...whole, pending: { ...MID_STRETCH.pending, noticeId: "employee-salary-200000" } }),
        "[]",
      ].map((text) => isoStrayStateOf({ nowMs: READ_AT, text })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads well-shaped fields the fold could never have written together as no state", () => {
    const whole = JSON.parse(isoStrayStateText({ state: MID_STRETCH })) as Record<string, unknown>;
    expect(
      [
        // A first nudge counted with no time told: read as long past, it bought the second at once on a reload.
        { ...whole, lastToldMs: null, pending: null },
        { ...whole, lastOffMs: null },
        { ...whole, lastOffMs: null, pending: null, stretchStartMs: null },
        { ...whole, lastOffMs: 1_760_255_000_000 },
        { ...whole, toldInStretch: 2 },
        { ...whole, toldInStretch: 0 },
        // A second owed a minute after the first: spoken as soon as the page came back, inside the hour.
        { ...whole, lastToldMs: MID_STRETCH.lastOffMs! - 60_000 },
        // A first owed five minutes into the stretch, before the dwell.
        {
          ...whole,
          lastToldMs: null,
          pending: { ...MID_STRETCH.pending, again: false },
          stretchStartMs: 1_760_259_960_000,
          toldInStretch: 0,
        },
        // Two told fifteen minutes into a stretch, the last before it began: every nudge it owed was silenced.
        { ...whole, pending: null, stretchStartMs: 1_760_259_360_000, toldInStretch: 2 },
        // One told before the dwell ended.
        { ...whole, lastToldMs: 1_760_256_300_000, pending: null },
        // None counted, yet told inside the stretch: the first would wait an hour it does not owe.
        { ...whole, pending: null, toldInStretch: 0 },
        // A pending nudge speaking a stretch shorter than the dwell, or longer than the stretch has run.
        { ...whole, pending: { ...MID_STRETCH.pending, minutes: 1 } },
        { ...whole, pending: { ...MID_STRETCH.pending, minutes: 72 } },
      ].map((state) => isoStrayStateOf({ nowMs: READ_AT, text: JSON.stringify(state) })),
    ).toEqual(Array.from({ length: 13 }, () => undefined));
  });

  it("reads a kept time still to come as no state, since a nudge told in the future held every nudge off", () => {
    const toldLater = isoStrayStateText({ state: { ...IDLE_ISO_STRAY_WATCH, lastToldMs: READ_AT + 1 } });
    expect([
      isoStrayStateOf({ nowMs: READ_AT, text: toldLater }),
      isoStrayStateOf({ nowMs: MID_STRETCH.lastOffMs! - 1, text: isoStrayStateText({ state: MID_STRETCH }) }),
    ]).toEqual([undefined, undefined]);
  });

  it("keeps a state between stretches, and a first nudge owed just as the dwell ends", () => {
    const between: IsoStrayState = { ...IDLE_ISO_STRAY_WATCH, lastToldMs: 1_760_259_600_000 };
    const firstOwed: IsoStrayState = {
      lastOffMs: MID_STRETCH.lastOffMs,
      lastToldMs: undefined,
      pending: { ...MID_STRETCH.pending!, again: false, minutes: 10 },
      stretchStartMs: MID_STRETCH.lastOffMs! - 10 * 60_000,
      toldInStretch: 0,
    };
    expect(
      [between, firstOwed].map((state) => isoStrayStateOf({ nowMs: READ_AT, text: isoStrayStateText({ state }) })),
    ).toEqual([between, firstOwed]);
  });
});
