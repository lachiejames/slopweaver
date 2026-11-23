/*
 * The Queue's freshness line: the quiet age when current, a spinner while a read is in flight, and a staleness mark
 * naming every register with its reason whenever the cards it draws are not the latest — never a sentence.
 */

import { describe, expect, it } from "vitest";

import { emptyListDraw, freshnessLine, queueFreshness, type RegisterFreshness } from "../../lib/registerFreshness";

const age = (iso: string): string => `at ${iso}`;

const ready = ({ label, at }: { label: string; at: string }): RegisterFreshness => ({
  drawn: { observedAtIso: at, phase: "ready", refreshing: false },
  label,
  read: { phase: "ready" },
});

describe("queueFreshness", () => {
  it("says only the age of the oldest reading when every register is current", () => {
    const freshness = queueFreshness({
      registers: [
        ready({ at: "2026-10-04T11:20:00.000Z", label: "your hands" }),
        ready({ at: "2026-10-04T11:00:00.000Z", label: "recorded asks" }),
      ],
    });
    expect(freshness.oldestIso).toBe("2026-10-04T11:00:00.000Z");
    expect(freshnessLine({ age, freshness })).toStrictEqual({
      kind: "text",
      title: "the oldest reading on screen was taken at 2026-10-04T11:00:00.000Z",
      tone: "quiet",
      words: "updated at 2026-10-04T11:00:00.000Z",
    });
  });

  it("marks a register drawing an earlier reading over a failed read, with the read's reason and the reading's age", () => {
    const freshness = queueFreshness({
      registers: [
        {
          drawn: { observedAtIso: "2026-10-04T11:00:00.000Z", phase: "ready", refreshing: false },
          label: "your hands",
          read: { phase: "not-measured", why: "hand list exited 1" },
        },
      ],
    });
    expect(freshness.stale).toStrictEqual([
      { label: "your hands", observedAtIso: "2026-10-04T11:00:00.000Z", why: "hand list exited 1" },
    ]);
    expect(freshnessLine({ age, freshness })).toStrictEqual({
      facts: [{ observedAtIso: "2026-10-04T11:00:00.000Z", subject: "your hands", why: "hand list exited 1" }],
      kind: "stale",
      words: "",
    });
  });

  it("names every register that never read and every one drawn stale in the one mark, never-read first", () => {
    const freshness = queueFreshness({
      registers: [
        { drawn: { phase: "not-measured" }, label: "held replies", read: { phase: "not-measured" } },
        {
          drawn: { observedAtIso: "2026-10-04T11:00:00.000Z", phase: "ready", refreshing: false },
          label: "your hands",
          read: { phase: "not-measured", why: "hand list exited 1" },
        },
      ],
    });
    expect(freshnessLine({ age, freshness })).toStrictEqual({
      facts: [
        { subject: "held replies", why: "its latest read did not answer" },
        { observedAtIso: "2026-10-04T11:00:00.000Z", subject: "your hands", why: "hand list exited 1" },
      ],
      kind: "stale",
      words: "",
    });
  });

  it("draws a spinner naming every register in flight, a first read or a handed-over one", () => {
    const freshness = queueFreshness({
      registers: [
        {
          drawn: { observedAtIso: "2026-10-04T11:00:00.000Z", phase: "ready", refreshing: true },
          label: "your hands",
          read: { phase: "ready" },
        },
        { drawn: { phase: "loading" }, label: "recorded asks", read: { phase: "loading" } },
      ],
    });
    expect(freshness.rereading).toEqual(["your hands"]);
    expect(freshness.reading).toEqual(["recorded asks"]);
    expect(freshnessLine({ age, freshness })).toStrictEqual({
      kind: "reading",
      label: "Reading recorded asks, your hands",
      words: "",
    });
  });

  it("prints nothing when nothing is drawn and nothing is outstanding", () => {
    expect(freshnessLine({ age, freshness: queueFreshness({ registers: [] }) })).toStrictEqual({
      kind: "text",
      title: "",
      tone: "quiet",
      words: "",
    });
  });
});

describe("emptyListDraw", () => {
  const NO_OVERLAY = queueFreshness({ registers: [] });
  const twoRead = queueFreshness({
    registers: [
      ready({ at: "2026-10-31T12:00:00.000Z", label: "your hands" }),
      ready({ at: "2026-10-31T12:00:00.000Z", label: "recorded asks" }),
    ],
  });

  it("calls the list a measured zero when every register's latest read answered", () => {
    expect(
      emptyListDraw({ answered: 2, deciders: NO_OVERLAY, expected: 2, freshness: twoRead, overlays: NO_OVERLAY }),
    ).toStrictEqual({
      kind: "measured-zero",
    });
  });

  it("draws the spinner, never the measured zero, while a handed-over reading is being replaced", () => {
    // On a first boot every register had A reading, one of them saved by an earlier process and still
    // being re-read, and the page drew "A measured zero" under its own spinner while the walk said not yet.
    const freshness = queueFreshness({
      registers: [
        ready({ at: "2026-10-31T12:00:00.000Z", label: "your hands" }),
        {
          drawn: { observedAtIso: "2026-10-31T11:00:00.000Z", phase: "ready", refreshing: true },
          label: "pull requests on your judgment",
          read: { phase: "ready" },
        },
      ],
    });
    expect(
      emptyListDraw({ answered: 2, deciders: NO_OVERLAY, expected: 2, freshness, overlays: NO_OVERLAY }),
    ).toStrictEqual({
      kind: "reading",
      label: "Reading pull requests on your judgment",
    });
  });

  it("names a register still on its first read before one re-reading", () => {
    const freshness = queueFreshness({
      registers: [
        {
          drawn: { observedAtIso: "2026-10-31T11:00:00.000Z", phase: "ready", refreshing: true },
          label: "your hands",
          read: { phase: "ready" },
        },
        { drawn: { phase: "loading" }, label: "held replies", read: { phase: "loading" } },
      ],
    });
    expect(
      emptyListDraw({ answered: 1, deciders: NO_OVERLAY, expected: 2, freshness, overlays: NO_OVERLAY }),
    ).toStrictEqual({
      kind: "reading",
      label: "Reading held replies, your hands",
    });
  });

  it("names every register that could not be read once nothing is in flight", () => {
    const freshness = queueFreshness({
      registers: [
        ready({ at: "2026-10-31T12:00:00.000Z", label: "your hands" }),
        {
          drawn: { phase: "not-measured" },
          label: "pull requests on your judgment",
          read: { phase: "not-measured", why: "the readings ledger holds no reading by `github landing` yet" },
        },
      ],
    });
    expect(
      emptyListDraw({ answered: 1, deciders: NO_OVERLAY, expected: 2, freshness, overlays: NO_OVERLAY }),
    ).toStrictEqual({
      facts: [
        {
          subject: "pull requests on your judgment",
          why: "the readings ledger holds no reading by `github landing` yet",
        },
      ],
      kind: "stale",
    });
  });

  it("refuses the zero while an overlay's earlier reading, kept over a failed read, could have taken the last card off", () => {
    const overlays = queueFreshness({
      registers: [
        {
          drawn: { observedAtIso: "2026-10-31T11:00:00.000Z", phase: "ready", refreshing: false },
          label: "who reviews each pull request",
          read: { phase: "not-measured", why: "github reviewer list exited 1" },
        },
      ],
    });
    expect(
      emptyListDraw({ answered: 2, deciders: NO_OVERLAY, expected: 2, freshness: twoRead, overlays }),
    ).toStrictEqual({
      facts: [
        {
          observedAtIso: "2026-10-31T11:00:00.000Z",
          subject: "who reviews each pull request",
          why: "github reviewer list exited 1, and an earlier reading of it can take a card off this list",
        },
      ],
      kind: "stale",
    });
  });

  it("draws the spinner while an overlay's handed-over reading is being replaced", () => {
    const overlays = queueFreshness({
      registers: [
        {
          drawn: { observedAtIso: "2026-10-31T11:00:00.000Z", phase: "ready", refreshing: true },
          label: "what you said about cards",
          read: { phase: "ready" },
        },
      ],
    });
    expect(
      emptyListDraw({ answered: 2, deciders: NO_OVERLAY, expected: 2, freshness: twoRead, overlays }),
    ).toStrictEqual({
      kind: "reading",
      label: "Reading what you said about cards",
    });
  });

  it("still proves the zero over an overlay that has no reading at all, since it removes nothing", () => {
    const overlays = queueFreshness({
      registers: [
        {
          drawn: { phase: "not-measured" },
          label: "who reviews each pull request",
          read: { phase: "not-measured", why: "no landing reading yet" },
        },
      ],
    });
    expect(
      emptyListDraw({ answered: 2, deciders: NO_OVERLAY, expected: 2, freshness: twoRead, overlays }),
    ).toStrictEqual({
      kind: "measured-zero",
    });
  });

  it("refuses the zero when a decider's first read failed, since it moves a card even unread", () => {
    // An urgent workstream whose first read failed would have stamped a cross-context card as stopping.
    const deciders = queueFreshness({
      registers: [
        {
          drawn: { phase: "not-measured" },
          label: "which workstream you made urgent",
          read: { phase: "not-measured", why: "workstreams candidates exited 3" },
        },
      ],
    });
    expect(
      emptyListDraw({ answered: 2, deciders, expected: 2, freshness: twoRead, overlays: NO_OVERLAY }),
    ).toStrictEqual({
      facts: [
        {
          subject: "which workstream you made urgent",
          why: "workstreams candidates exited 3, and it can move a card onto or off this list",
        },
      ],
      kind: "stale",
    });
  });

  it("draws the spinner while a decider is on its first read", () => {
    const deciders = queueFreshness({
      registers: [
        {
          drawn: { phase: "loading" },
          label: "the steers you gave that are still being relayed",
          read: { phase: "loading" },
        },
      ],
    });
    expect(
      emptyListDraw({ answered: 2, deciders, expected: 2, freshness: twoRead, overlays: NO_OVERLAY }),
    ).toStrictEqual({
      kind: "reading",
      label: "Reading the steers you gave that are still being relayed",
    });
  });

  it("fails closed when fewer registers answered than the list is built from, even with no gap named", () => {
    expect(
      emptyListDraw({ answered: 0, deciders: NO_OVERLAY, expected: 6, freshness: NO_OVERLAY, overlays: NO_OVERLAY }),
    ).toStrictEqual({
      facts: [{ subject: "the Queue's registers", why: "0 of the 6 registers it is built from answered" }],
      kind: "stale",
    });
  });
});
