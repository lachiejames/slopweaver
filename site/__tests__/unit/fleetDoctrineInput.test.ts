/**
 * The doctrine panel's input boundary: which live channel states it may count, and the glance it may draw from.
 * Split from `fleetDoctrine.test.ts`, which holds the five lines themselves.
 */
import { describe, expect, it } from "vitest";
import { fleetDoctrineOf } from "../../lib/fleetDoctrine";
import { doctrineGlanceOf, doctrineInputOf, doctrinePendingOf } from "../../lib/fleetDoctrineInput";

const ready = {
  fixture: undefined,
  observedAtIso: "2026-11-03T06:00:00.000Z",
  phase: "ready",
  stampedByRoute: false,
  value: { rows: 3 },
} as const;

describe("doctrineInputOf", () => {
  const pick = (value: { rows: number }): number => value.rows;

  it("takes a current reading and refuses a loading, failed or stale one, saying why", () => {
    expect(doctrineInputOf({ pick, state: ready, subject: "the board" })).toEqual({ kind: "read", value: 3 });
    expect(doctrineInputOf({ pick, state: { phase: "loading" }, subject: "the board" })).toEqual({
      kind: "unread",
      pending: true,
      why: "the board is still loading",
    });
    // A read's own reason is quoted apart from the words naming it, exactly as it arrived, newlines and all (steer 7).
    const stack = "Error: board read failed\n    at readBoard (/srv/app/board.ts:12:5)";
    expect(doctrineInputOf({ pick, state: { phase: "not-measured", why: stack }, subject: "the board" })).toEqual({
      kind: "unread",
      why: { lead: "The board did not read", why: stack },
    });
    expect(doctrineInputOf({ pick, state: { ...ready, stale: { why: "timed out" } }, subject: "the board" })).toEqual({
      kind: "unread",
      why: { lead: "The latest read of the board failed", why: "timed out" },
    });
  });

  it("refuses a reading handed over from an earlier page while its replacement loads, without holding the panel busy", () => {
    // toStrictEqual, so a `pending` key left on the handed-over input fails rather than passing as an extra field.
    expect(doctrineInputOf({ pick, state: { ...ready, refreshing: true }, subject: "the board" })).toStrictEqual({
      kind: "unread",
      why: "the board is not yet current for this page",
    });
  });
});

describe("doctrinePendingOf", () => {
  const settledUnread = { kind: "unread", why: "the board did not read: 404" } as const;
  const loading = doctrineInputOf({ pick: () => 0, state: { phase: "loading" }, subject: "the board" });
  const handedOver = doctrineInputOf({
    pick: (value: { rows: number }) => value.rows,
    state: { ...ready, refreshing: true },
    subject: "session watch",
  });
  const settledGlance = { burst: { kind: "read", open: [], taken: false }, ceiling: 2, working: 1 } as const;

  it("is busy while any input has nothing in hand yet, and settled once none is", () => {
    expect(doctrinePendingOf({ glance: settledGlance, inputs: [{ kind: "read", value: 1 }, loading] })).toBe(true);
    expect(doctrinePendingOf({ glance: settledGlance, inputs: [{ kind: "read", value: 1 }, settledUnread] })).toBe(
      false,
    );
    expect(doctrinePendingOf({ glance: settledGlance, inputs: [] })).toBe(false);
  });

  // A fresh window hands every input over from the console's saved readings, and their first reads queue behind the
  // page's other reads in three shared slots: waiting on them held the desktop walk past its 30 s cap at load.
  it("settles over inputs handed over from an earlier page, and stays busy beside one still loading", () => {
    const handedOverGlance = doctrineGlanceOf({
      capacity: { ...ready, refreshing: true },
      ceiling: { ...ready, refreshing: true },
      glance: settledGlance,
    });
    const fourHandedOver = [handedOver, handedOver, handedOver, handedOver];
    expect(doctrinePendingOf({ glance: handedOverGlance, inputs: fourHandedOver })).toBe(false);
    expect(
      doctrinePendingOf({ glance: settledGlance, inputs: [{ kind: "read", value: 1 }, handedOver, settledUnread] }),
    ).toBe(false);
    expect(doctrinePendingOf({ glance: settledGlance, inputs: [handedOver, loading] })).toBe(true);
  });

  it("is busy while the capacity or ceiling channel the glance stands on is still loading", () => {
    const capacityLoading = doctrineGlanceOf({ capacity: { phase: "loading" }, ceiling: ready, glance: settledGlance });
    const ceilingLoading = doctrineGlanceOf({ capacity: ready, ceiling: { phase: "loading" }, glance: settledGlance });
    expect(doctrinePendingOf({ glance: capacityLoading, inputs: [{ kind: "read", value: 1 }] })).toBe(true);
    expect(doctrinePendingOf({ glance: ceilingLoading, inputs: [{ kind: "read", value: 1 }] })).toBe(true);
  });
});

describe("doctrineGlanceOf", () => {
  const glance = { burst: { kind: "read", open: ["plan-a"], taken: false }, ceiling: 8, working: 3 } as const;

  it("withdraws a ceiling and a burst drawn off readings whose latest refresh failed", () => {
    const stale = { ...ready, stale: { why: "timed out" } };
    expect(doctrineGlanceOf({ capacity: stale, ceiling: stale, glance })).toEqual({
      burst: {
        kind: "unread",
        why: { lead: "The latest read of the machine capacity reading failed", why: "timed out" },
      },
      ceiling: undefined,
      ceilingWhy: { lead: "The latest read of the plans' seat ceiling reading failed", why: "timed out" },
      working: 3,
    });
  });

  it("names the ceiling channel's own reason on every line that lacks the ceiling, quoted beneath it", () => {
    const stale = { ...ready, stale: { why: "HTTP 429 Too Many Requests" } };
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: doctrineGlanceOf({ capacity: ready, ceiling: stale, glance }),
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: {
        kind: "read",
        value: {
          diagnostics: [],
          rows: ["w1", "w2", "w3"].map((workspaceId) => ({
            manager: false,
            sessionTitle: undefined,
            signal: "working",
            title: "worker",
            workspaceId,
            workspaceRef: undefined,
          })),
          suppressed: 0,
        },
      },
    });
    const quoted = [
      { lead: "The latest read of the plans' seat ceiling reading failed", why: "HTTP 429 Too Many Requests" },
    ];
    // The sentence keeps the console's own words; the channel's raw reason sits beneath it, never inside (steer 7).
    expect([lines[0].sentence, lines[0].quoted]).toEqual([
      "3 seats working; how many seats the plans' week carries was not read.",
      quoted,
    ]);
    expect([lines.at(-1)!.sentence, lines.at(-1)!.quoted]).toEqual(["Plan headroom unused: not read.", quoted]);
  });

  it("passes the glance through whole when both readings are current", () => {
    expect(doctrineGlanceOf({ capacity: ready, ceiling: ready, glance })).toEqual(glance);
  });
});

describe("what session watch could not see", () => {
  // A seat whose state did not read only hides a seat, so it leaves every seat count a floor.
  const unknownSeat = {
    manager: false,
    sessionTitle: undefined,
    signal: "",
    title: "worker",
    workspaceId: "w1",
    workspaceRef: undefined,
  } as const;
  // The glance's working count is session watch's own, so a fixture counting one carries the row it counts.
  const workingSeat = { ...unknownSeat, signal: "working", workspaceId: "w2" } as const;

  it("reads no seat count at all once the drain reports a problem, since one cuts both ways", () => {
    const supervisor = {
      manager: true,
      sessionTitle: undefined,
      signal: "working",
      title: "/slopweaver:supervisor",
      workspaceId: "old",
      workspaceRef: undefined,
    } as const;
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 1, working: 1 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: {
        kind: "read",
        value: {
          diagnostics: ["the cmux inventory could not be read (socket closed)"],
          rows: [supervisor],
          suppressed: 0,
        },
      },
    });
    const why = "session watch reported 1 problem, so a seat it shows may have closed and one it does not may be open";
    expect(lines.map((line) => [line.sentence, line.tone])).toEqual([
      [`Seats working: not read (${why}).`, "unread"],
      ["Board rows kept from a seat: not read (no reconcile reading yet; the board is loading).", "unread"],
      [
        "Your open pull requests with no seat: not read (no landing reading yet; no reconcile reading yet; the board is loading).",
        "unread",
      ],
      [`Supervisor workspaces open: not read (${why}).`, "unread"],
      [`Plan headroom unused: not read (${why}).`, "unread"],
    ]);
    expect(lines[3].groups).toEqual([
      { items: [{ href: undefined, key: "old", text: "old, pinned" }], label: "shown by session watch, not checked" },
      {
        items: [
          {
            href: undefined,
            key: "the cmux inventory could not be read (socket closed)",
            text: "the cmux inventory could not be read (socket closed)",
          },
        ],
        label: "not checked",
      },
    ]);
  });

  it("names every seat it showed as not checked on a seat line withdrawn over a problem", () => {
    const worker = { ...unknownSeat, signal: "working" } as const;
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 2, working: 1 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: { kind: "read", value: { diagnostics: ["the event cursor aged out"], rows: [worker], suppressed: 0 } },
    });
    const groups = [
      {
        items: [{ href: undefined, key: "w1", text: "worker (w1), working" }],
        label: "shown by session watch, not checked",
      },
      {
        items: [{ href: undefined, key: "the event cursor aged out", text: "the event cursor aged out" }],
        label: "not checked",
      },
    ];
    expect(lines[0].groups).toEqual(groups);
    expect(lines.at(-1)!.groups).toEqual(groups);
  });

  it("names every other place not checked beside a reported problem, never only the problem", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 1, working: 0 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: {
        kind: "read",
        value: { diagnostics: ["the event cursor aged out"], rows: [unknownSeat], suppressed: 2 },
      },
    });
    const why = "session watch reported 1 problem, so a seat it shows may have closed and one it does not may be open";
    expect(lines[0].sentence).toBe(
      `Seats working: not read (${why}; session watch could not see everything (1 seat with a state that did not read)).`,
    );
    expect(lines[3].sentence).toBe(
      `Supervisor workspaces open: not read (${why}; session watch left out 2 seats too quiet to count; session watch could not see everything (1 seat with a state that did not read)).`,
    );
  });

  it("qualifies a full week behind a blind spot, and never reads it ok", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 1, working: 1 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: { kind: "read", value: { diagnostics: [], rows: [unknownSeat, workingSeat], suppressed: 0 } },
    });
    expect(lines.at(-1)!.sentence).toBe(
      "As far as session watch could see, every seat the plans' week carries is in use, and no plan is behind its week. session watch could not see everything (1 seat with a state that did not read).",
    );
    expect(lines.at(-1)!.tone).toBe("unread");
  });

  it("names every reading a withdrawn seat line also lacks, never only session watch", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "unread", why: "the burn reading is loading" }, ceiling: undefined, working: 0 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: { kind: "unread", why: "session watch is still loading" },
    });
    expect(lines[0].sentence).toBe(
      "Seats working: not read (session watch is still loading; how many seats the plans' week carries was not read).",
    );
    expect(lines.at(-1)!.sentence).toBe(
      "Plan headroom unused: not read (session watch is still loading; how many seats the plans' week carries was not read; the burn reading is loading).",
    );
  });

  it("names the burst and the blind spot beside an unread ceiling, never only the ceiling", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "unread", why: "the week of plan-a did not read" }, ceiling: undefined, working: 0 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: { kind: "read", value: { diagnostics: ["the event cursor aged out"], rows: [], suppressed: 0 } },
    });
    expect(lines.at(-1)!.sentence).toBe(
      "Plan headroom unused: not read (session watch reported 1 problem, so a seat it shows may have closed and one it does not may be open; how many seats the plans' week carries was not read; the week of plan-a did not read).",
    );
    expect(lines.at(-1)!.tone).toBe("unread");
    expect(lines.at(-1)!.groups).toEqual([
      {
        items: [{ href: undefined, key: "the event cursor aged out", text: "the event cursor aged out" }],
        label: "not checked",
      },
    ]);
  });

  it("reads a seat whose state did not read as a place not checked, never as not working", () => {
    const seat = {
      manager: false,
      sessionTitle: undefined,
      signal: "",
      title: "worker",
      workspaceId: "w1",
      workspaceRef: undefined,
    } as const;
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 0, working: 0 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: { kind: "read", value: { diagnostics: [], rows: [seat], suppressed: 0 } },
    });
    expect(lines[0].sentence).toBe(
      "At least 0 seats working of the 0 the plans' week carries. session watch could not see everything (1 seat with a state that did not read).",
    );
    expect(lines[0].tone).toBe("unread");
    expect(lines[0].groups).toEqual([
      { items: [{ href: undefined, key: "w1", text: 'worker (w1), state "" did not read' }], label: "not checked" },
    ]);
  });

  it("never reads a full seat count ok behind a blind spot", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 1, working: 1 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: { kind: "read", value: { diagnostics: [], rows: [unknownSeat, workingSeat], suppressed: 0 } },
    });
    expect(lines[0].sentence).toBe(
      "At least 1 seat working of the 1 the plans' week carries. session watch could not see everything (1 seat with a state that did not read).",
    );
    expect(lines[0].tone).toBe("unread");
    // Every place it could not look is named, folded, on each seat-based line.
    const notChecked = {
      items: [{ href: undefined, key: "w1", text: 'worker (w1), state "" did not read' }],
      label: "not checked",
    };
    expect(
      lines.filter((line) => line.groups.some((group) => group.label === "not checked")).map((line) => line.key),
    ).toEqual(["seats", "supervisors", "headroom"]);
    expect(lines[0].groups).toEqual([
      { items: [{ href: undefined, key: "w2", text: "worker" }], label: "working now" },
      notChecked,
    ]);
  });

  it("qualifies an undrawn burst a seat whose state did not read could draw", () => {
    const glanceOf = ({ ceiling }: { ceiling: number }) =>
      ({ burst: { kind: "read", open: ["plan-a"], taken: false }, ceiling, working: 1 }) as const;
    const seatsOf = {
      kind: "read",
      value: {
        diagnostics: [],
        rows: [workingSeat, unknownSeat, { ...unknownSeat, workspaceId: "w3" }],
        suppressed: 0,
      },
    } as const;
    const unchecked = "session watch could not see everything (2 seats with a state that did not read).";
    const inputs = {
      board: { kind: "unread", why: "the board is loading" },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: seatsOf,
    } as const;
    const could = fleetDoctrineOf({ ...inputs, glance: glanceOf({ ceiling: 2 }) });
    expect(could.lines.at(-1)!.sentence).toBe(
      `At most 1 seat the plans' week carries sits empty, and 1 plan is behind its week with the five-hour burst undrawn as far as session watch could see. ${unchecked}`,
    );
    // Even both unread seats working stays within three, so undrawn is proven.
    const cannot = fleetDoctrineOf({ ...inputs, glance: glanceOf({ ceiling: 3 }) });
    expect(cannot.lines.at(-1)!.sentence).toBe(
      `At most 2 seats the plans' week carries sit empty, and 1 plan is behind its week with the five-hour burst undrawn. ${unchecked}`,
    );
    expect(cannot.lines.at(-1)!.tone).toBe("attention");
  });

  it("never reads a full week ok while whether a plan is behind its week was not read", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "unread", why: "the burn reading is loading" }, ceiling: 1, working: 1 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: { kind: "read", value: { diagnostics: [], rows: [workingSeat], suppressed: 0 } },
    });
    expect(lines.at(-1)!.sentence).toBe(
      "Every seat the plans' week carries is in use; whether a plan is behind its week was not read: the burn reading is loading.",
    );
    expect(lines.at(-1)!.tone).toBe("unread");
  });
});
