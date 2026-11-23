import { describe, expect, it } from "vitest";

import {
  type ClosingView,
  closedWords,
  doneShare,
  endingLine,
  endingOf,
  type LinkedView,
  type LocalView,
  linkChipText,
  linkChipTitle,
  readWorkstreamTiles,
  shortDate,
  type TileView,
} from "../../lib/workstreamTiles";

import { abandoned, outcome } from "./workstreamOutcomeFixture";
import {
  closing,
  documentWith,
  linked,
  local,
  unrecordedClosing,
  withDerived,
  withDetail,
} from "./workstreamTilesFixture";

/**
 * The view of a one-workstream document, or `undefined` when it will not read.
 *
 * @returns the reader's answer
 */
function readOne({ row }: { row: unknown }): ReturnType<typeof readWorkstreamTiles> {
  return readWorkstreamTiles({ payload: documentWith({ workstreams: [row] }) });
}

describe("readWorkstreamTiles", () => {
  it("reads every known kind into its view, with its workspace, lane and hold", () => {
    const view = readWorkstreamTiles({ payload: documentWith({ workstreams: [outcome, linked, local, closing] }) })!;
    expect(view.workstreams.map((one) => [one.kind, one.workspace, one.lane, one.atRisk])).toEqual([
      ["outcome", "team", "chase", true],
      ["linked", "team", "your-call", true],
      ["local", "self", "kept-here", false],
      ["closing", "team", "done", false],
    ]);
    expect(view.skipped).toBe(0);
    const tile = view.workstreams[0] as TileView;
    expect([tile.outcome, tile.status, tile.statusNote, tile.agreedBy, tile.team]).toEqual([
      "No secret reaches a log line",
      "validating",
      "batch one in",
      "the platform lead",
      "platform",
    ]);
    expect(tile.feedback[0].sign).toBe("negative");
    expect(tile.priority).toEqual({
      anchor: "transcript:a#b",
      because: "a customer asked",
      level: "urgent",
      rank: undefined,
    });
    expect(tile.waitingOn).toEqual({ on: "someone", what: "to pick an approach", who: "the security lead" });
    const gauge = view.workstreams[1] as LinkedView;
    expect(gauge.waitingOn).toEqual({ on: "you", what: "which evidence tool to keep" });
    expect(gauge.priority).toBe(null);
    expect(view.lanes.map((one) => one.id)).toEqual(["your-call", "chase", "moving", "done", "kept-here", "abandoned"]);
    expect(tile.ending).toBe(null);
    expect(view.priorities).toEqual(["urgent", "high", "normal", "parked"]);
    expect(tile.people).toEqual([{ part: "picks the approach", slack: "U0FIXTURE1" }]);
    expect([...view.channels]).toEqual([["C0FIXTURE1", "#platform-squad"]]);
    expect(view.initiatives).toEqual([{ id: "security", name: "Security" }]);
    expect(view.grouping).toEqual({
      anchor: "transcript:a#b",
      builtFrom: "the register",
      label: "By initiative",
      why: "Each outcome under one aim.",
    });
  });

  it("reads progress against the workstream's own milestones, with the verb's line", () => {
    const view = readWorkstreamTiles({ payload: documentWith({ workstreams: [outcome, linked] }) })!;
    const tile = view.workstreams[0] as TileView;
    expect(tile.progress).toEqual({
      complete: false,
      doneCount: 1,
      next: { id: "first-batch", name: "First batch merged" },
      ready: [{ id: "first-batch", name: "First batch merged" }],
      totalCount: 3,
    });
    expect(tile.progressLine).toBe("1 of 3 done, next: First batch merged");
    expect([tile.startedOn, tile.lastMovedOn]).toEqual(["2026-09-01", "2026-09-10"]);
    expect((view.workstreams[1] as LinkedView).progressLine).toBe("1 of 3 done, next: Policy acceptance");
  });

  it("reads a complete workstream's progress with no next milestone", () => {
    const complete = withDerived({
      derived: {
        progress: { complete: true, doneCount: 3, next: null, ready: [], totalCount: 3 },
        progressLine: "3 of 3 done",
      },
      row: outcome,
    });
    const tile = readOne({ row: complete })!.workstreams[0] as TileView;
    expect([tile.progress.complete, tile.progress.next, tile.progressLine]).toEqual([true, null, "3 of 3 done"]);
  });

  it("refuses progress missing a count, naming a next milestone that will not read, or with no line", () => {
    const { doneCount: _doneCount, ...noDone } = outcome.derived.progress;
    expect(readOne({ row: withDerived({ derived: { progress: noDone }, row: outcome }) })).toBe(undefined);
    const badNext = { ...outcome.derived.progress, next: { id: "first-batch" } };
    expect(readOne({ row: withDerived({ derived: { progress: badNext }, row: outcome }) })).toBe(undefined);
    expect(readOne({ row: withDerived({ derived: { progressLine: null }, row: outcome }) })).toBe(undefined);
  });

  it("reads a story's entries in position order, each with the milestone it moves", () => {
    const tile = readOne({ row: outcome })!.workstreams[0] as TileView;
    expect(tile.entries.map((entry) => [entry.date, entry.milestoneId, entry.done])).toEqual([
      ["2026-09-01", null, false],
      ["2026-09-05", "approach", true],
      ["2026-09-10", "first-batch", false],
    ]);
    expect(tile.entries[1]).toEqual({
      date: "2026-09-05",
      done: true,
      href: "https://example.test/approach",
      id: "00000000-0000-4000-8000-000000000002",
      kind: "proposal",
      milestoneId: "approach",
      text: "the approach agreed",
    });
  });

  it("refuses an entry that finishes no milestone, and one missing its position", () => {
    const [first, ...rest] = outcome.entries;
    const finishesNothing = { ...outcome, entries: [{ ...first, done: true, milestoneId: null }, ...rest] };
    const { position: _position, ...unplaced } = first;
    const noPosition = { ...outcome, entries: [unplaced, ...rest] };
    expect(readOne({ row: finishesNothing })).toBe(undefined);
    expect(readOne({ row: noPosition })).toBe(undefined);
  });

  it("reads a workstream link as a related workstream, and every other link as a chip", () => {
    const tile = readOne({ row: outcome })!.workstreams[0] as TileView;
    expect(tile.related).toEqual([{ id: "iso", milestoneId: null, why: "an auditor checks it" }]);
    expect(tile.links).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000012",
        kind: "pull_request",
        label: "the first batch",
        milestoneId: "first-batch",
        target: "acme/app#1",
      },
    ]);
    const unlabelled = { ...outcome, links: [{ ...outcome.links[0], label: null }] };
    expect((readOne({ row: unlabelled })!.workstreams[0] as TileView).related).toEqual([
      { id: "iso", milestoneId: null, why: null },
    ]);
  });

  it("refuses a link of a kind the store does not declare, and one with no target", () => {
    const unknownKind = { ...outcome, links: [{ ...outcome.links[1], kind: "free_link" }] };
    const { target: _target, ...untargeted } = outcome.links[1];
    expect(readOne({ row: unknownKind })).toBe(undefined);
    expect(readOne({ row: { ...outcome, links: [untargeted] } })).toBe(undefined);
  });

  it("reads a workstream's own milestones as the graph the verb derived", () => {
    const gauge = readOne({ row: linked })!.workstreams[0] as LinkedView;
    expect(gauge.milestoneGraph.columns).toBe(2);
    expect(gauge.milestoneGraph.milestones.map((one) => [one.id, one.column, one.state, one.waitingFor])).toEqual([
      ["acceptance", 0, "moving", []],
      ["evidence", 0, "done", []],
      ["done", 1, "waiting", ["Policy acceptance"]],
    ]);
    expect(gauge.milestoneGraph.milestones[1].href).toBe("https://example.test/evidence");
  });

  it("refuses a milestone in a state the page does not know, and a driven kind with no graph", () => {
    const [first, ...rest] = linked.derived.milestoneGraph.milestones;
    const graph = { ...linked.derived.milestoneGraph, milestones: [{ ...first, state: "blocked" }, ...rest] };
    expect(readOne({ row: linked })!.workstreams).toHaveLength(1);
    expect(readOne({ row: withDerived({ derived: { milestoneGraph: graph }, row: linked }) })).toBe(undefined);
    expect(readOne({ row: withDerived({ derived: { milestoneGraph: null }, row: linked }) })).toBe(undefined);
  });

  it("reads a linked gauge and the verb's reading of it", () => {
    const gauge = readOne({ row: linked })!.workstreams[0] as LinkedView;
    expect([gauge.gauge.value, gauge.gauge.of, gauge.gauge.gate, gauge.reading.short]).toEqual([81, 124, 112, 31]);
    expect([gauge.leads, gauge.yourPart, gauge.outcome]).toEqual([
      "the compliance lead",
      "the engineering controls",
      "Certified against ISO 27001",
    ]);
  });

  it("refuses each kind carrying a value its kind holds null, or missing one it requires", () => {
    const refused = [
      { ...linked, status: "validating" },
      withDerived({ derived: { gauge: linked.derived.gauge }, row: outcome }),
      { ...local, outcome: "an outcome" },
      withDerived({ derived: { progressLine: "0 of 0 done" }, row: local }),
      { ...closing, status: "proven" },
      { ...outcome, status: null },
    ].map((row) => readOne({ row }));
    expect(refused).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses a row with no detail, or with no derived block", () => {
    const { detail: _detail, ...noDetail } = outcome;
    const { derived: _derived, ...noDerived } = outcome;
    expect(readOne({ row: noDetail })).toBe(undefined);
    expect(readOne({ row: noDerived })).toBe(undefined);
  });

  it("reads the Queue's workstream tag a story states, and none where it states none", () => {
    const tagged = withDetail({ detail: { queueWorkstream: "iso-certification" }, row: linked });
    const view = readWorkstreamTiles({ payload: documentWith({ workstreams: [tagged, outcome] }) })!;
    expect(view.workstreams.map((one) => (one as TileView | LinkedView).queueWorkstream)).toEqual([
      "iso-certification",
      undefined,
    ]);
  });

  it("refuses a Queue workstream tag no board tag could carry, rather than lifting no card silently", () => {
    const tagged = ["ISO certification", 7, "iso--certification", "iso-"].map((queueWorkstream) =>
      readOne({ row: withDetail({ detail: { queueWorkstream }, row: linked }) }),
    );
    // A doubled or trailing hyphen passes an id's pattern but no board tag's.
    expect(tagged).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("reads an ending, with its reason, date and anchor, in the abandoned lane", () => {
    const tile = readOne({ row: abandoned })!.workstreams[0] as TileView;
    expect([tile.lane, tile.atRisk, tile.ending]).toEqual([
      "abandoned",
      false,
      { anchor: "talk-call:a#turn_b", kind: "abandoned", on: "2026-10-02", reason: "previews moved to another tool" },
    ]);
  });

  it("refuses an ending with no reason, an unknown kind, and a detail with no ending field at all", () => {
    const { reason: _reason, ...noReason } = abandoned.detail.ending;
    const { ending: _ending, ...absent } = outcome.detail;
    const unread = [
      withDetail({ detail: { ending: noReason }, row: abandoned }),
      withDetail({ detail: { ending: { ...abandoned.detail.ending, kind: "paused" } }, row: abandoned }),
      { ...outcome, detail: absent },
    ].map((row) => readOne({ row }));
    expect(unread).toEqual([undefined, undefined, undefined]);
  });

  it("refuses a person with no part", () => {
    expect(readOne({ row: withDetail({ detail: { people: [{ slack: "U0FIXTURE1" }] }, row: outcome }) })).toBe(
      undefined,
    );
  });

  it("refuses a register document whose channel name is not text, and one with no channel map", () => {
    const meta = documentWith({ workstreams: [] })["meta"] as Record<string, unknown>;
    const { channels: _channels, ...noChannels } = meta;
    const badName = { ...meta, channels: { C0FIXTURE1: 7 } };
    expect(readWorkstreamTiles({ payload: documentWith({ meta: badName, workstreams: [] }) })).toBe(undefined);
    expect(readWorkstreamTiles({ payload: documentWith({ meta: noChannels, workstreams: [] }) })).toBe(undefined);
  });

  it("draws the workstreams of a register whose document is not written yet, naming no channel, grouping or initiative", () => {
    const view = readWorkstreamTiles({ payload: documentWith({ meta: null, workstreams: [outcome, local] }) })!;
    expect(view.workstreams.map((one) => one.id)).toEqual(["logs-scrub", "tool"]);
    expect([view.grouping, view.initiatives, [...view.channels]]).toEqual([null, [], []]);
  });

  it("refuses a document with no meta field at all, rather than reading it as unwritten", () => {
    const { meta: _meta, ...noMeta } = documentWith({ workstreams: [outcome] });
    expect(readWorkstreamTiles({ payload: noMeta })).toBe(undefined);
  });

  it("skips and counts a kind the page does not draw", () => {
    const view = readWorkstreamTiles({
      payload: documentWith({ workstreams: [outcome, { id: "x", kind: "future", name: "X" }] }),
    })!;
    expect(view.workstreams.length).toBe(1);
    expect(view.skipped).toBe(1);
  });

  it("refuses the whole document when a known kind will not read", () => {
    const progress = { ...outcome.derived.progress, doneCount: "one" };
    const broken = withDerived({ derived: { progress }, row: outcome });
    expect(readWorkstreamTiles({ payload: documentWith({ workstreams: [broken, linked] }) })).toBe(undefined);
  });

  it("refuses a workstream stating a workspace outside the two, rather than showing it in both", () => {
    expect(readOne({ row: { ...local, workspace: "elsewhere" } })).toBe(undefined);
  });

  it("refuses a chase that names nobody", () => {
    const waitingOn = { on: "someone", what: "an approach" };
    expect(readOne({ row: withDetail({ detail: { waitingOn }, row: outcome }) })).toBe(undefined);
  });

  it("refuses a priority missing the steer that set it", () => {
    const priority = { because: "a customer asked", level: "urgent" };
    expect(readOne({ row: withDetail({ detail: { priority }, row: outcome }) })).toBe(undefined);
  });

  it("refuses a lane the document does not declare, rather than drawing a chip carrying its bare id", () => {
    expect(readOne({ row: outcome })!.workstreams).toHaveLength(1);
    expect(readOne({ row: withDerived({ derived: { lane: "blocked" }, row: outcome }) })).toBe(undefined);
  });

  it("refuses a priority level the document does not declare", () => {
    const priority = { ...outcome.detail.priority, level: "someday" };
    expect(readOne({ row: withDetail({ detail: { priority }, row: outcome }) })).toBe(undefined);
  });

  it("refuses a feedback line with a sign outside the two", () => {
    const feedback = [{ ...outcome.detail.feedback[0], sign: "neutral" }];
    expect(readOne({ row: withDetail({ detail: { feedback }, row: outcome }) })).toBe(undefined);
  });

  it("refuses a document with no lanes, and one with no baseline", () => {
    const { lanes: _lanes, ...noLanes } = documentWith({ workstreams: [] });
    const { baseline: _baseline, ...noBaseline } = documentWith({ workstreams: [] });
    expect(readWorkstreamTiles({ payload: noLanes })).toBe(undefined);
    expect(readWorkstreamTiles({ payload: noBaseline })).toBe(undefined);
  });

  it("refuses a schema-version-1 document, and any version but 2, rather than drawing it", () => {
    expect(readWorkstreamTiles({ payload: documentWith({ workstreams: [outcome] }) })!.workstreams).toHaveLength(1);
    const versions = [1, 3, "2"].map((schemaVersion) =>
      readWorkstreamTiles({ payload: { ...documentWith({ workstreams: [outcome] }), schemaVersion } }),
    );
    expect(versions).toEqual([undefined, undefined, undefined]);
  });

  it("refuses a file register's document shape even carrying version 2", () => {
    // Channels, grouping and initiatives at the top level, phases beside them, a timeline on each workstream.
    const fileShaped = {
      channels: { C0FIXTURE1: "#platform-squad" },
      grouping: { anchor: "a", builtFrom: "b", label: "c", why: "d" },
      initiatives: [],
      lanes: [{ atRisk: false, id: "moving", label: "Moving", rule: "nothing holds it" }],
      phases: [{ from: 0, id: "agree", label: "Agree", to: 25 }],
      priorities: ["urgent", "high", "normal", "parked"],
      schemaVersion: 2,
      workstreams: [
        { atRisk: false, id: "x", kind: "outcome", lane: "moving", name: "X", timeline: [], workspace: "team" },
      ],
    };
    expect(readWorkstreamTiles({ payload: fileShaped })).toBe(undefined);
  });
});

describe("endingOf and endingLine", () => {
  it("says an ended workstream's reason with its date, and finds no ending on a live, local or handed-over one", () => {
    const view = readWorkstreamTiles({
      payload: documentWith({ workstreams: [abandoned, outcome, local, closing] }),
    })!;
    const endings = view.workstreams.map((one) => endingOf({ one }));
    expect(endings.slice(1)).toEqual([null, null, null]);
    expect(endingLine({ ending: endings[0]! })).toBe("Abandoned 2 Oct: previews moved to another tool");
  });

  it("reads an ending on a closing entry, which is how a wound-down workstream leaves the done lane", () => {
    const ending = abandoned.detail.ending;
    const wound = withDerived({
      derived: { lane: "abandoned" },
      row: withDetail({ detail: { ending }, row: closing }),
    });
    const view = readOne({ row: wound })!;
    expect([view.workstreams[0].lane, endingOf({ one: view.workstreams[0] })]).toEqual(["abandoned", ending]);
    const { ending: _ending, ...noField } = closing.detail;
    expect(readOne({ row: { ...closing, detail: noField } })).toBe(undefined);
  });
});

describe("readWorkstreamTiles, a page-only entry", () => {
  it("reads its note and its links, with no outcome, status or milestones", () => {
    const kept = readOne({ row: local })!.workstreams[0] as LocalView;
    expect([kept.note, kept.entries, kept.related]).toEqual(["kept here only", [], []]);
    expect(kept.links).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000031",
        kind: "automation",
        label: null,
        milestoneId: null,
        target: "nightly-sync",
      },
    ]);
  });
});

describe("readWorkstreamTiles, a closing entry's evidence", () => {
  it("reads a completion's outcome, closing day, dated entries, stakeholders and related", () => {
    const done = readOne({ row: closing })!.workstreams[0] as ClosingView;
    expect([done.outcome, done.closedOn, done.people, done.related]).toEqual([
      "Every service owns its monitors",
      "2026-09-20",
      [{ part: "took it over", slack: "U0FIXTURE2" }],
      [{ id: "logs-scrub", milestoneId: null, why: "the scrub reads those monitors" }],
    ]);
    expect(done.entries).toEqual([
      {
        date: "2026-09-20",
        done: false,
        href: "https://example.test/announce",
        id: "00000000-0000-4000-8000-000000000041",
        kind: "announce",
        milestoneId: null,
        text: "handed to the platform team",
      },
    ]);
  });

  it("reads a completion with none of its evidence recorded, each field unrecorded", () => {
    const older = readOne({ row: unrecordedClosing })!.workstreams[0] as ClosingView;
    expect([older.outcome, older.closedOn, older.entries, older.people, older.related]).toEqual([
      null,
      null,
      [],
      [],
      [],
    ]);
  });

  it("refuses a closing entry missing any of its evidence fields, or carrying one that will not read", () => {
    const { closedOn: _closedOn, ...noClosedOn } = closing.detail;
    const { people: _people, ...noPeople } = closing.detail;
    const { outcome: _outcome, ...noOutcome } = closing;
    const { entries: _entries, ...noEntries } = closing;
    const { links: _links, ...noLinks } = closing;
    const refused = [
      { ...closing, detail: noClosedOn },
      { ...closing, detail: noPeople },
      noOutcome,
      noEntries,
      noLinks,
      { ...closing, entries: [{ date: "2026-09-20", text: "no kind" }] },
      withDetail({ detail: { people: [{ slack: "U0FIXTURE2" }] }, row: closing }),
      withDetail({ detail: { closedOn: 20260920 }, row: closing }),
    ].map((row) => readOne({ row }));
    expect(refused).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("doneShare", () => {
  it("is the share of a workstream's own milestones done, and none of none", () => {
    const tile = readOne({ row: outcome })!.workstreams[0] as TileView;
    expect(doneShare({ progress: tile.progress })).toBe(1 / 3);
    expect(doneShare({ progress: { complete: false, doneCount: 0, next: null, ready: [], totalCount: 0 } })).toBe(0);
  });
});

describe("linkChipText", () => {
  it("names a link's kind and its canonical target", () => {
    const tile = readOne({ row: outcome })!.workstreams[0] as TileView;
    expect(linkChipText({ link: tile.links[0] })).toBe("Pull request acme/app#1");
    const kept = readOne({ row: local })!.workstreams[0] as LocalView;
    expect(linkChipText({ link: kept.links[0] })).toBe("Automation nightly-sync");
  });
});

describe("linkChipTitle", () => {
  it("names the milestone a link serves beside why it is linked", () => {
    const tile = readOne({ row: outcome })!.workstreams[0] as TileView;
    expect(linkChipTitle({ link: tile.links[0], milestones: tile.milestoneGraph.milestones })).toBe(
      "the first batch · for First batch merged",
    );
  });

  it("says nothing beyond the chip for a link with no label serving no milestone", () => {
    const kept = readOne({ row: local })!.workstreams[0] as LocalView;
    expect(linkChipTitle({ link: kept.links[0], milestones: [] })).toBe(undefined);
  });
});

describe("closedWords", () => {
  it("says the day a completion closed, or that it was never recorded", () => {
    expect(closedWords({ closedOn: "2026-09-20" })).toBe("closed 20 Sep");
    expect(closedWords({ closedOn: null })).toBe("closed date not recorded");
  });
});

describe("shortDate", () => {
  it("drops the year and names the month", () => {
    expect(shortDate({ date: "2026-09-10" })).toBe("10 Sep");
    expect(shortDate({ date: "2026-01-01" })).toBe("1 Jan");
  });

  it("leaves a date of another shape as it is", () => {
    expect(shortDate({ date: "Sep 2026" })).toBe("Sep 2026");
    expect(shortDate({ date: "2026-13-01" })).toBe("2026-13-01");
  });
});
