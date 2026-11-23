/*
 * The Queue's counts as the app shows them, over the rows it renders — what a count the voice says is checked
 * against. A voice count can drift from the app: the app showed Everything 29, Queue 26, Blocking the fleet 26 and
 * Check-ins 3 while the voice said fourteen.
 */

import { describe, expect, it } from "vitest";

import {
  queueContextRows,
  queueScopeAt,
  queueScopeOf,
  queueShownCounts,
  shownCountsLine,
  shownForVoice,
} from "../../lib/queueShownCounts";
import type { StoppingStamp } from "../../lib/queueStopping";
import { selectorText } from "../../lib/queueTags";
import type { ViewCard } from "../../lib/queueViews";
import type { WorkspacePlacement } from "../../lib/workspacePlacementBasis";
import { shownInContext } from "../../lib/workspacePlacementContext";

const card = (over: Partial<ViewCard> = {}): ViewCard => ({
  kind: "ask",
  tags: [],
  tagsRead: "whole",
  tier: "fleet-blocked",
  ...over,
});

/** The incident's Queue: 26 blocking the fleet, 3 check-ins. */
const INCIDENT: readonly ViewCard[] = [
  ...Array.from({ length: 26 }, () => card()),
  ...Array.from({ length: 3 }, () => card({ tier: "check-in" })),
];

const ALL = queueScopeOf({ pathname: "/queue", search: "" });

/** Read, in the work context, with nothing the switch hides. */
const READ = {
  allDrawn: true,
  badgeRead: true,
  boardRead: true,
  context: "work",
  otherRows: [],
  splitRead: true,
} as const;

describe("queueShownCounts", () => {
  it("shows the incident's figures: Everything 29, Queue 26, Blocking the fleet 26, Check-ins 3", () => {
    const shown = queueShownCounts({ ...READ, rows: INCIDENT, scope: ALL });
    expect([
      shown.everything,
      shown.waiting,
      shown.views.fleet,
      shown.views["check-in"],
      shown.views.colleague,
    ]).toEqual([29, 26, 26, 3, 0]);
    expect(shownCountsLine({ shown })).toBe("Everything 29, Queue 26, Blocking the fleet 26, Check-ins 3");
  });

  it("prints no figure where the app prints none: the selector before every register drew, the badge before it read", () => {
    const shown = queueShownCounts({ ...READ, allDrawn: false, badgeRead: false, rows: INCIDENT, scope: ALL });
    expect([shown.everything, shown.waiting, shown.views.fleet]).toEqual([undefined, undefined, undefined]);
    // The other context's count is unread too, never a zero.
    expect(shown.otherContext).toEqual({ context: "slopweaver", count: undefined });
    expect(shownCountsLine({ shown })).toBe(
      "Everything unread, Queue unread, Urgent unread, Blocking a colleague unread, Blocking the fleet unread, Slack drafts unread, Reviews under your name unread, New findings unread, Check-ins unread, In the Slopweaver context unread",
    );
  });

  it("counts under the Queue's tag filter, as the page and the badge do, and names the open view", () => {
    const urgent = { key: "priority", value: "p1" };
    const rows = [card({ tags: [urgent] }), card({ tags: [urgent], tier: "check-in" }), card()];
    const scope = queueScopeOf({ pathname: "/queue", search: `?tag=${selectorText(urgent)}&view=check-in` });
    const shown = queueShownCounts({ ...READ, rows, scope });
    expect([shown.everything, shown.waiting, shown.views["check-in"], shown.view]).toEqual([2, 1, 1, "check-in"]);
  });

  it("names the other context and how many cards it holds — the incident's Everything 0 beside twenty hidden", () => {
    const twenty = Array.from({ length: 20 }, () => card());
    const shown = queueShownCounts({ ...READ, otherRows: twenty, rows: [], scope: ALL });
    expect([shown.everything, shown.otherContext]).toEqual([0, { context: "slopweaver", count: 20 }]);
    expect(shownCountsLine({ shown })).toBe("Everything 0, Queue 0, In the Slopweaver context 20");
    const fromSlopweaver = queueShownCounts({
      ...READ,
      context: "slopweaver",
      otherRows: [card()],
      rows: [],
      scope: ALL,
    });
    expect(fromSlopweaver.otherContext).toEqual({ context: "work", count: 1 });
  });

  it("counts the other context before any tag filter or view, as the context switch hides them", () => {
    const urgent = { key: "priority", value: "p1" };
    const scope = queueScopeOf({ pathname: "/queue", search: `?tag=${selectorText(urgent)}&view=check-in` });
    const shown = queueShownCounts({ ...READ, otherRows: [card(), card()], rows: [card()], scope });
    expect([shown.everything, shown.otherContext.count]).toEqual([0, 2]);
  });

  it("leaves the other context's figure unread while workstreams has not read, though every register drew", () => {
    // An urgent workstream can make the hidden card a stopping one shown in both contexts once it reads.
    const shown = queueShownCounts({ ...READ, otherRows: [card()], rows: [], scope: ALL, splitRead: false });
    expect([shown.everything, shown.otherContext]).toEqual([0, { context: "slopweaver", count: undefined }]);
  });
});

describe("shownForVoice", () => {
  it("adds exactly one field for the other context, under a label naming it", () => {
    const shown = queueShownCounts({ ...READ, otherRows: [card(), card()], rows: INCIDENT, scope: ALL });
    const fields = shownForVoice({ shown });
    expect(Object.keys(fields).filter((label) => label.includes("context"))).toEqual(["In the Slopweaver context"]);
    expect([fields["Everything"], fields["In the Slopweaver context"]]).toEqual([29, 2]);
  });
});

describe("queueContextRows", () => {
  const placed = ({ workspace }: { workspace: "team" | "self" }): WorkspacePlacement => ({
    by: [],
    kind: "placed",
    workspace,
  });
  const shows = (row: { readonly placement: WorkspacePlacement }): boolean =>
    shownInContext({ context: "work", placement: row.placement });

  it("splits every placeable row exactly once: this context's, and the other's", () => {
    const placeable = [
      { key: "team-1", placement: placed({ workspace: "team" }) },
      { key: "self-1", placement: placed({ workspace: "self" }) },
      { key: "self-2", placement: placed({ workspace: "self" }) },
    ];
    const split = queueContextRows({ placeable, shows });
    expect(split.rows.map((row) => row.key)).toEqual(["team-1"]);
    expect(split.otherRows.map((row) => row.key)).toEqual(["self-1", "self-2"]);
  });

  it("never counts a card stopping the owner's work as hidden: every context draws it", () => {
    const stopping: StoppingStamp = { reason: "marked" };
    const placeable = [{ key: "self-stopping", placement: placed({ workspace: "self" }), stopping }];
    const split = queueContextRows({ placeable, shows });
    expect([split.rows.map((row) => row.key), split.otherRows.length]).toEqual([["self-stopping"], 0]);
  });
});

describe("queueScopeAt", () => {
  it("reads the console window's carried query whole, and the window's own only for a bare path", () => {
    expect(queueScopeAt({ path: "/queue?view=check-in", search: "?view=fleet" }).view).toBe("check-in");
    expect(queueScopeAt({ path: "/queue", search: "?view=fleet" }).view).toBe("fleet");
    expect(queueScopeAt({ path: "/talk?view=fleet", search: "" }).view).toBe("all");
  });
});

describe("queueScopeOf", () => {
  it("reads the filter and view only on the Queue, as useQueueTags does", () => {
    const off = queueScopeOf({ pathname: "/talk", search: "?tag=priority:p1&view=fleet" });
    expect([off.selection.groups.length, off.view]).toEqual([0, "all"]);
    expect(queueScopeOf({ pathname: "/queue/", search: "view=fleet" }).view).toBe("fleet");
    expect(queueScopeOf({ pathname: "/queue", search: "?view=nonsense" }).view).toBe("all");
  });
});
