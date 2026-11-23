/*
 * Every console sidebar entry carries a decided badge, and every count is derived from a reading — a count of
 * work still open shows zero when every workstream is complete, never a hundred.
 */
import { describe, expect, it } from "vitest";

import { CONSOLE_ROUTES } from "../../../src/consoleProfile/plan";
import type { LiveState } from "../../lib/liveState";
import {
  automationsReadingOf,
  SIDEBAR_ENTRIES,
  switchedOnAutomationsOf,
  unfinishedWorkstreamsOf,
  workingSessionsCountOf,
} from "../../lib/sidebarCounts";
import {
  countBasisOf,
  countStandInOf,
  earliestStaleOf,
  sidebarReadOf,
  unmeasuredOf,
} from "../../lib/sidebarCountsBasis";
import type { LocalView, WorkstreamWorkspace } from "../../lib/workstreamTiles";

describe("SIDEBAR_ENTRIES", () => {
  it("decides every entry's badge, in the sidebar's order", () => {
    expect(SIDEBAR_ENTRIES.length).toBeGreaterThan(0);
    expect(SIDEBAR_ENTRIES.map((entry) => [entry.key, entry.badge.kind])).toEqual([
      ["queue", "count"],
      ["alignment", "count"],
      ["pull-requests", "count"],
      ["workstreams", "count"],
      ["automations", "count"],
      ["fleet", "count"],
      ["settings", "none"],
      ["docs", "none"],
    ]);
  });

  it("draws Queue and Pull requests hot: every other count is neutral", () => {
    expect(SIDEBAR_ENTRIES.length).toBeGreaterThan(0);
    const hot = SIDEBAR_ENTRIES.filter((entry) => entry.badge.kind === "count" && entry.badge.attention).map(
      (entry) => entry.key,
    );
    expect(hot).toEqual(["queue", "pull-requests"]);
  });

  it("says in Settings' hover that a dot marks it while no plan is connected, since Setup went into it", () => {
    const settings = SIDEBAR_ENTRIES.find((entry) => entry.key === "settings")!;
    expect([settings.href, settings.place, settings.badge]).toEqual([
      null,
      "foot",
      {
        kind: "none",
        why: "no count: it holds your plans and preferences, and nothing in it waits or runs; a dot marks it while no plan is connected",
      },
    ]);
  });

  it("counts Pull requests as the cards that page lists under Everything, drafts included, never GitHub's census", () => {
    const entry = SIDEBAR_ENTRIES.find((each) => each.key === "pull-requests")!;
    expect(entry.badge).toEqual({
      attention: true,
      kind: "count",
      means:
        "your open pull requests in this context, drafts included: the cards that page lists under Everything, from its current complete landing reading",
    });
  });

  it("says why an entry carries no number, and what each count counts", () => {
    expect(SIDEBAR_ENTRIES.length).toBeGreaterThan(0);
    const unsaid = SIDEBAR_ENTRIES.filter((entry) => {
      const words = entry.badge.kind === "count" ? entry.badge.means : entry.badge.why;
      return words.trim().length === 0;
    });
    expect(unsaid).toEqual([]);
  });

  it("links the same pages, in the same order, as the performance walk clicks", () => {
    expect(SIDEBAR_ENTRIES.length).toBeGreaterThan(0);
    const links = SIDEBAR_ENTRIES.flatMap((entry) => (entry.href === null ? [] : [entry.href]));
    const walked = CONSOLE_ROUTES.filter((route) => route.inSidebar).map((route) => route.path);
    expect(links).toEqual(walked);
  });

  it("opens Settings over the page rather than linking it", () => {
    expect(SIDEBAR_ENTRIES.filter((entry) => entry.href === null).map((entry) => entry.key)).toEqual(["settings"]);
  });
});

/**
 * A current reading of `value`, one kept over a failed read when `stale` is given, or one handed over to the next
 * read when `refreshing` is.
 */
function readingOf<T>({
  value,
  stale,
  refreshing,
}: {
  value: T;
  stale?: { why: string };
  refreshing?: true;
}): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-17T00:00:00.000Z",
    phase: "ready",
    stampedByRoute: true,
    value,
    ...(stale === undefined ? {} : { stale }),
    ...(refreshing === undefined ? {} : { refreshing }),
  };
}

describe("countStandInOf", () => {
  it("draws a stale reading as the stale mark with its stamp, never the spinner", () => {
    expect([
      countStandInOf({ state: readingOf({ stale: { why: "timed out" }, value: 3 }) }),
      countStandInOf({ state: readingOf({ refreshing: true, value: 3 }) }),
      countStandInOf({ state: { phase: "loading" } }),
      countStandInOf({ state: { phase: "not-measured", why: "exit 2" } }),
    ]).toEqual([
      { observedAtIso: "2026-10-17T00:00:00.000Z", phase: "stale", why: "timed out" },
      { phase: "loading" },
      { phase: "loading" },
      { phase: "not-measured", why: "exit 2" },
    ]);
  });
});

describe("unmeasuredOf", () => {
  const ready = (over: { stale?: { why: string } } = {}): LiveState<number> => readingOf({ value: 3, ...over });

  it("lets a count print once every reading it is made from is current", () => {
    expect(
      unmeasuredOf({
        inputs: [
          { state: ready(), subject: "a" },
          { state: ready(), subject: "b" },
        ],
      }),
    ).toBe(undefined);
  });

  it("refuses while any reading is on its way", () => {
    expect(
      unmeasuredOf({
        inputs: [
          { state: ready(), subject: "a" },
          { state: { phase: "loading" }, subject: "b" },
        ],
      }),
    ).toEqual({ phase: "loading" });
  });

  it("names the failed reading — a stale one too — over one still on its way", () => {
    expect([
      unmeasuredOf({
        inputs: [
          { state: { phase: "loading" }, subject: "the ledger" },
          { state: { phase: "not-measured", why: "exit 1" }, subject: "the answers" },
        ],
      }),
      unmeasuredOf({ inputs: [{ state: ready({ stale: { why: "timed out" } }), subject: "the feedback" }] }),
      // Each raw reason quoted apart from the console's words, never "<subject> did not read: <raw>".
    ]).toEqual([
      {
        failures: [{ lead: "the answers did not read", subject: "the answers", why: "exit 1" }],
        phase: "not-measured",
      },
      {
        failures: [{ lead: "the feedback did not read", subject: "the feedback", why: "timed out" }],
        phase: "not-measured",
      },
    ]);
  });

  it("holds a reading handed over on mount as still loading until the read it started lands", () => {
    const handedOver: LiveState<number> = readingOf({ refreshing: true, value: 3 });
    expect([
      sidebarReadOf({ state: handedOver }),
      sidebarReadOf({ state: ready() }),
      unmeasuredOf({
        inputs: [
          { state: ready(), subject: "a" },
          { state: handedOver, subject: "b" },
        ],
      }),
    ]).toEqual([{ phase: "loading" }, { phase: "ready" }, { phase: "loading" }]);
  });

  it("holds a reading handed over while drawn over a failed read as loading", () => {
    const both = readingOf({ refreshing: true, stale: { why: "exit 1" }, value: 3 });
    expect([
      unmeasuredOf({ inputs: [{ state: both, subject: "the automations" }] }),
      countBasisOf({ inputs: [{ state: both, subject: "the automations" }] }),
    ]).toEqual([
      { phase: "loading" },
      {
        phase: "provisional",
        stale: {
          kind: "updating",
          notes: ["the automations is being read again now"],
          observedAtIso: "2026-10-17T00:00:00.000Z",
        },
      },
    ]);
  });
});

describe("countBasisOf", () => {
  const handedOver = ({ at }: { at: string }): LiveState<number> => ({
    fixture: undefined,
    observedAtIso: at,
    phase: "ready",
    refreshing: true,
    stampedByRoute: true,
    value: 3,
  });

  it("is current when every reading is, and with no reading to judge", () => {
    expect([
      countBasisOf({ inputs: [{ state: readingOf({ value: 3 }), subject: "a" }] }),
      countBasisOf({ inputs: [] }),
    ]).toEqual([{ phase: "current" }, { phase: "current" }]);
  });

  it("is provisional over handed-over readings, as of the oldest, naming each in the order given", () => {
    expect([
      countBasisOf({
        inputs: [
          { state: readingOf({ value: 3 }), subject: "the ledger" },
          { state: handedOver({ at: "2026-10-25T18:00:00.000Z" }), subject: "the answers" },
        ],
      }),
      countBasisOf({
        inputs: [
          { state: handedOver({ at: "2026-10-25T18:09:00.000Z" }), subject: "the ledger" },
          { state: handedOver({ at: "2026-10-25T18:02:00+00:00" }), subject: "the answers" },
          { state: handedOver({ at: "2026-10-25T18:05:00.000Z" }), subject: "the drafts" },
        ],
      }),
    ]).toEqual([
      {
        phase: "provisional",
        stale: {
          kind: "updating",
          notes: ["the answers is being read again now"],
          observedAtIso: "2026-10-25T18:00:00.000Z",
        },
      },
      {
        phase: "provisional",
        stale: {
          kind: "updating",
          notes: ["the ledger, the answers and the drafts are being read again now"],
          observedAtIso: "2026-10-25T18:02:00+00:00",
        },
      },
    ]);
  });

  it("names every failed reading in the order given, never only the first", () => {
    expect(
      countBasisOf({
        inputs: [
          { state: { phase: "not-measured", why: "exit 1" }, subject: "the ledger" },
          { state: readingOf({ value: 3 }), subject: "the drafts" },
          { state: { phase: "not-measured", why: "exit 2" }, subject: "the answers" },
        ],
      }),
    ).toEqual({
      failures: [
        { lead: "the ledger did not read", subject: "the ledger", why: "exit 1" },
        { lead: "the answers did not read", subject: "the answers", why: "exit 2" },
      ],
      phase: "not-measured",
    });
  });

  it("is loading while any reading has none yet, and names a failure ahead of either", () => {
    const rereading = handedOver({ at: "2026-10-25T18:00:00.000Z" });
    expect([
      countBasisOf({
        inputs: [
          { state: rereading, subject: "a" },
          { state: { phase: "loading" }, subject: "b" },
        ],
      }),
      countBasisOf({
        inputs: [
          { state: { phase: "loading" }, subject: "a" },
          { state: rereading, subject: "b" },
          { state: readingOf({ stale: { why: "exit 1" }, value: 3 }), subject: "the feedback" },
        ],
      }),
    ]).toEqual([
      { phase: "loading" },
      {
        failures: [{ lead: "the feedback did not read", subject: "the feedback", why: "exit 1" }],
        phase: "not-measured",
      },
    ]);
  });
});

describe("earliestStaleOf", () => {
  const failure = { lead: "the board did not read", subject: "the board", why: "exit 1" };

  it("is none for no mark, and otherwise the earliest instant with every note in order, still updating", () => {
    expect([
      earliestStaleOf({ marks: [] }),
      earliestStaleOf({
        marks: [
          { kind: "updating", notes: ["one"], observedAtIso: "2026-10-25T18:00:00.000Z" },
          { kind: "updating", notes: ["two"], observedAtIso: "2026-10-25T17:59:59.000Z" },
        ],
      }),
    ]).toEqual([undefined, { kind: "updating", notes: ["one", "two"], observedAtIso: "2026-10-25T17:59:59.000Z" }]);
  });

  it("is a failure once any mark is, keeping every note and every failure", () => {
    expect(
      earliestStaleOf({
        marks: [
          { kind: "updating", notes: ["one"], observedAtIso: "2026-10-25T17:00:00.000Z" },
          { failures: [failure], kind: "failed", notes: ["two"], observedAtIso: "2026-10-25T18:00:00.000Z" },
        ],
      }),
    ).toEqual({
      failures: [failure],
      kind: "failed",
      notes: ["one", "two"],
      observedAtIso: "2026-10-25T17:00:00.000Z",
    });
  });
});

describe("unfinishedWorkstreamsOf", () => {
  const stream = ({
    id,
    lane,
    workspace,
  }: {
    id: string;
    lane: string;
    workspace: WorkstreamWorkspace;
  }): LocalView => ({
    atRisk: false,
    entries: [],
    id,
    kind: "local",
    lane,
    lastMovedOn: null,
    links: [],
    name: id,
    note: "",
    related: [],
    startedOn: null,
    workspace,
  });

  it("counts what is still to finish in the context shown — the call's 'active workstreams'", () => {
    const view = {
      skipped: 0,
      workstreams: [
        stream({ id: "a", lane: "moving", workspace: "self" }),
        stream({ id: "b", lane: "your-call", workspace: "self" }),
        stream({ id: "c", lane: "done", workspace: "self" }),
        stream({ id: "d", lane: "moving", workspace: "team" }),
      ],
    };
    expect(unfinishedWorkstreamsOf({ context: "slopweaver", view })).toEqual({
      count: {
        count: 2,
        title: "2 unfinished workstreams in this context; 1 done, abandoned or kept here only not counted",
      },
      phase: "measured",
    });
  });

  it("reads zero, not the total, when every workstream is complete", () => {
    const view = {
      skipped: 0,
      workstreams: [
        stream({ id: "a", lane: "done", workspace: "team" }),
        stream({ id: "b", lane: "abandoned", workspace: "team" }),
        stream({ id: "c", lane: "kept-here", workspace: "team" }),
      ],
    };
    expect(unfinishedWorkstreamsOf({ context: "work", view })).toEqual({
      count: {
        count: 0,
        title: "no unfinished workstream in this context; 3 done, abandoned or kept here only not counted",
      },
      phase: "measured",
    });
  });

  it("says one in the singular, and never counts the other context's", () => {
    const view = {
      skipped: 0,
      workstreams: [
        stream({ id: "a", lane: "chase", workspace: "team" }),
        stream({ id: "b", lane: "chase", workspace: "self" }),
      ],
    };
    expect(unfinishedWorkstreamsOf({ context: "work", view })).toEqual({
      count: {
        count: 1,
        title: "1 unfinished workstream in this context; 0 done, abandoned or kept here only not counted",
      },
      phase: "measured",
    });
  });

  it("prints no number when the reader skipped a workstream of a kind it does not know, since its lane is unknown", () => {
    const workstreams = [stream({ id: "a", lane: "chase", workspace: "team" })];
    expect([
      unfinishedWorkstreamsOf({ context: "work", view: { skipped: 1, workstreams } }),
      unfinishedWorkstreamsOf({ context: "work", view: { skipped: 2, workstreams } }),
    ]).toEqual([
      { phase: "not-measured", why: "1 workstream of a kind this console does not draw yet" },
      { phase: "not-measured", why: "2 workstreams of a kind this console does not draw yet" },
    ]);
  });
});

describe("switchedOnAutomationsOf", () => {
  it("counts the rows switched on, and not one paused or disabled", () => {
    expect(
      switchedOnAutomationsOf({ automations: [{ switchedOn: true }, { switchedOn: false }, { switchedOn: true }] }),
    ).toEqual({ count: 2, title: "2 automations switched on; 1 paused or disabled not counted" });
  });

  it("reads zero when everything is off, and one in the singular", () => {
    expect([
      switchedOnAutomationsOf({ automations: [{ switchedOn: false }] }),
      switchedOnAutomationsOf({ automations: [{ switchedOn: true }] }),
    ]).toEqual([
      { count: 0, title: "no automation switched on; 1 paused or disabled not counted" },
      { count: 1, title: "1 automation switched on; 0 paused or disabled not counted" },
    ]);
  });
});

describe("automationsReadingOf", () => {
  const whole = { automations: [{ switchedOn: true }], issues: [], rejected: [], rosterGap: undefined };

  it("counts the switched-on rows when the page marks nothing short", () => {
    expect(automationsReadingOf({ view: whole })).toEqual({
      count: { count: 1, title: "1 automation switched on; 0 paused or disabled not counted" },
      phase: "measured",
    });
  });

  it("prints no number when the rows did not list, a definition file is not a row, or a store did not read", () => {
    expect([
      automationsReadingOf({ view: { ...whole, rosterGap: "exit 2" } }),
      automationsReadingOf({ view: { ...whole, rejected: [{ file: "a.json", why: "no schedule" }] } }),
      automationsReadingOf({ view: { ...whole, issues: ["the run ledger did not parse"] } }),
    ]).toEqual([
      { phase: "not-measured", why: "the scheduled rows did not read: exit 2" },
      { phase: "not-measured", why: "a.json is not a row: no schedule" },
      { phase: "not-measured", why: "a store this page reads did not read: the run ledger did not parse" },
    ]);
  });
});

describe("workingSessionsCountOf", () => {
  it("counts only the seats working now — the call's 'active session count'", () => {
    const seats = [
      { signal: "working" },
      { signal: "needs-input" },
      { signal: "idle" },
      { signal: "silent" },
      { signal: "working" },
    ];
    expect(workingSessionsCountOf({ seats })).toEqual({
      count: 2,
      title: "2 sessions working now, off the last session reading",
    });
  });

  it("reads zero with no seat working, and one in the singular", () => {
    expect([
      workingSessionsCountOf({ seats: [{ signal: "idle" }] }),
      workingSessionsCountOf({ seats: [{ signal: "working" }] }),
    ]).toEqual([
      { count: 0, title: "no session working now, off the last session reading" },
      { count: 1, title: "1 session working now, off the last session reading" },
    ]);
  });
});
