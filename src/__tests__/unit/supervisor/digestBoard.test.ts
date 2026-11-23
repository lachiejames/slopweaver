/**
 * Reconcile's lists as `tick open` reads them: a missing list or a session on no row id is unreadable, never
 * empty, and a ready row a spawn would be refused on is sorted out with its reason.
 */
import { describe, expect, it } from "vitest";

import { boardLists, exclusionLines, idShared, namelessReady, sortReady } from "../../../supervisor/digestBoard.js";

/** A reconcile document carrying every list, each empty unless given. */
const reconcileOf = (lists: Record<string, readonly unknown[]>): Record<string, readonly unknown[]> => ({
  aligned: [],
  held: [],
  misaligned: [],
  ready: [],
  repolessRows: [],
  sharedSlugs: [],
  ...lists,
});

describe("boardLists", () => {
  it("unwraps an in-flight row to its row, and calls a missing list or an id-less session unreadable", () => {
    expect([
      boardLists({ value: reconcileOf({ misaligned: [{ rank: 2, row: { id: "m" } }] }) }),
      boardLists({ value: { held: [] } }),
      boardLists({ value: reconcileOf({ aligned: [{ rank: 1, row: { standing: "in-flight" } }] }) }),
      boardLists({ value: reconcileOf({ held: [{ standing: "paused" }] }) }),
      boardLists({ value: reconcileOf({ repolessRows: [{ id: "x" }] }) }),
      boardLists({ value: reconcileOf({ sharedSlugs: [7] }) }),
      // an empty id names no row, so it could be any.
      boardLists({ value: reconcileOf({ aligned: [{ rank: 1, row: { id: "" } }] }) }),
      boardLists({ value: reconcileOf({ held: [{ id: "" }] }) }),
      boardLists({ value: reconcileOf({ repolessRows: [""] }) }),
      boardLists({ value: reconcileOf({ sharedSlugs: [""] }) }),
    ]).toEqual([
      { held: [], inFlight: [{ id: "m" }], ready: [], repolessRows: [], sharedSlugs: [] },
      { unreadable: "reconcile carries no aligned list" },
      { unreadable: "reconcile places 1 session(s) on no row id" },
      { unreadable: "reconcile's held list carries an entry that names no row id" },
      { unreadable: "reconcile's repolessRows list carries an entry that names no row id" },
      { unreadable: "reconcile's sharedSlugs list carries an entry that names no row id" },
      { unreadable: "reconcile places 1 session(s) on no row id" },
      { unreadable: "reconcile's held list carries an entry that names no row id" },
      { unreadable: "reconcile's repolessRows list carries an entry that names no row id" },
      { unreadable: "reconcile's sharedSlugs list carries an entry that names no row id" },
    ]);
  });
});

describe("idShared", () => {
  it("calls an id shared off sharedSlugs, a repeat between held and ready, or a repeat on repolessRows", () => {
    const lists = {
      held: [{ id: "h" }, { id: "x" }, { id: "y" }],
      inFlight: [],
      ready: [{ id: "h" }, { id: "r" }],
      repolessRows: ["x", "x", "y"],
      sharedSlugs: ["s"],
    };

    expect(["s", "h", "r", "x", "y"].map((id) => idShared({ id, lists }))).toEqual([true, true, false, true, false]);
  });
});

describe("namelessReady", () => {
  it("counts the ready rows naming no id, an empty or non-string one included, and none when every row names one", () => {
    const lists = { held: [], inFlight: [], repolessRows: [], sharedSlugs: [] };

    expect([
      namelessReady({ lists: { ...lists, ready: [{ id: "a" }, {}, { id: "" }, { id: 7 }, "row"] } }),
      namelessReady({ lists: { ...lists, ready: [{ id: "a" }] } }),
      namelessReady({ lists: { ...lists, ready: [] } }),
    ]).toEqual([4, 0, 0]);
  });
});

describe("sortReady and exclusionLines", () => {
  it("sorts each ready row a spawn would be refused on out, with its reason, and names nothing when none is", () => {
    const row = ({ id }: { id: string | undefined }): Record<string, unknown> => ({
      id,
      label: "a row",
      priority: "p1",
      ready: true,
      standing: "ready",
    });
    const lists = {
      held: [],
      inFlight: [{ id: "placed" }],
      ready: [
        row({ id: "free" }),
        row({ id: "dup" }),
        row({ id: "dup" }),
        row({ id: "norepo" }),
        row({ id: "placed" }),
        row({ id: "../x" }),
        row({ id: undefined }),
        { ...row({ id: "nolabel" }), label: undefined },
        { ...row({ id: "badpriority" }), priority: "urgent" },
        // a row on ready that reads paused, or not ready, or neither, contradicts the list it sits on.
        { ...row({ id: "paused" }), ready: false, standing: "paused" },
        { ...row({ id: "notready" }), ready: false },
        { ...row({ id: "nostanding" }), ready: undefined, standing: undefined },
      ],
      repolessRows: ["norepo"],
      sharedSlugs: [],
    };
    const sort = sortReady({ lists });

    expect([sort.unidentified, sort.incomplete, sort.shared, sort.repoless, sort.placed]).toEqual([
      2,
      ["nolabel", "badpriority", "paused", "notready", "nostanding"],
      ["dup"],
      ["norepo"],
      ["placed"],
    ]);
    expect(exclusionLines({ sort })).toEqual([
      "seatable: 2 ready row(s) carry no id cmux spawn accepts, so none is offered",
      "seatable: 5 ready id(s) lack the label, priority or ready standing every ready board row carries, so none is " +
        "offered — nolabel, badpriority, paused, notready, nostanding",
      "seatable: 1 ready id(s) more than one doc claims, so none is offered — dup",
      "seatable: 1 ready id(s) name no repo:, so none is offered — norepo",
      "seatable: 1 ready id(s) reconcile already places a session on, so none is offered — placed",
    ]);
    expect(
      exclusionLines({
        sort: sortReady({ lists: { ...lists, inFlight: [], ready: [row({ id: "free" })], repolessRows: [] } }),
      }),
    ).toEqual([]);
  });
});
