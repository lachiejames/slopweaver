/**
 * `orgHealth/investigation.ts` — whether the fleet is looking into an open incident, and why. The Queue shows a subtle
 * visual indication that the fleet is looking into a thing, and says why when asked.
 */
import { describe, expect, it } from "vitest";

import {
  type InvestigationRow,
  incidentInvestigations,
  investigatedIncident,
  investigationLine,
  investigationWhy,
  type RowStep,
  rowNamesIncident,
} from "../../../orgHealth/investigation.js";
import { orgIncident } from "./orgIncidentFixture.js";

/** INC-33 as the live snapshot carried it. */
const INC_33 = orgIncident({
  over: {
    channelId: "C0SYN000020",
    homepageUrl: "https://app.incident.io/acme-group/incidents/33",
    ref: "INC-33",
  },
});

/** The INC-33 row's own summary, as the supervisor registered it. */
const INC_33_SUMMARY =
  "INC-33 'billing export delay' (Major, declared 23 Sep 2026, still Investigating, lead Ada Owner, " +
  "https://app.incident.io/acme-group/incidents/33) is investigated unasked to a result with receipts. Ends in ONE " +
  "floating note.";

/** A row naming INC-33, never started, raised by nobody this can name — `over` laid on top. */
function row({ over = {} }: { over?: Partial<InvestigationRow> } = {}): InvestigationRow {
  return {
    lastMovedIso: undefined,
    over: false,
    ownerWait: "not-waiting",
    paused: false,
    raisedBy: undefined,
    run: { kind: "never-started" },
    slug: "incident-inc-33-incorrectly-linked-nz-report",
    summary: INC_33_SUMMARY,
    ...over,
  };
}

describe("rowNamesIncident", () => {
  it("matches the homepage address only when nothing word-like follows it", () => {
    const incident = { channelId: undefined, homepageUrl: "https://app.incident.io/acme-group/incidents/33" };
    expect([
      rowNamesIncident({ incident, summary: "see https://app.incident.io/acme-group/incidents/33?tab=1" }),
      rowNamesIncident({ incident, summary: "see https://app.incident.io/acme-group/incidents/33/" }),
      rowNamesIncident({ incident, summary: "(https://app.incident.io/acme-group/incidents/33)" }),
      rowNamesIncident({ incident, summary: "see https://app.incident.io/acme-group/incidents/330" }),
      rowNamesIncident({ incident, summary: "see https://app.incident.io/acme-group/incidents/33-x" }),
    ]).toEqual([true, true, true, false, false]);
  });

  it("never reads INC-3's address inside the INC-33 row", () => {
    const inc3 = { channelId: undefined, homepageUrl: "https://app.incident.io/acme-group/incidents/3" };
    expect(rowNamesIncident({ incident: inc3, summary: INC_33_SUMMARY })).toBe(false);
  });

  it("matches the channel id only as a whole token, and skips it on an incident naming no channel", () => {
    const incident = { channelId: "C0SYN000020", homepageUrl: "https://app.incident.io/x/incidents/1" };
    expect([
      rowNamesIncident({ incident, summary: "https://acme.slack.com/archives/C0SYN000020, unasked," }),
      rowNamesIncident({ incident, summary: "channel C0SYN0000045" }),
      rowNamesIncident({ incident, summary: "channel XC0SYN000020" }),
      rowNamesIncident({ incident: { ...incident, channelId: undefined }, summary: "channel C0SYN000020" }),
    ]).toEqual([true, false, false, false]);
  });

  it("never matches on the reference alone", () => {
    expect(rowNamesIncident({ incident: INC_33, summary: "a quiet indication, after INC-33 floated" })).toBe(false);
  });
});

describe("investigationWhy", () => {
  it("says the sweep found the channel for a swept row, rather than quoting its procedure", () => {
    const swept = row({
      over: {
        summary:
          "Investigate the live incident #inc-2026-09-23-nz, channel C0SYN000020, " +
          "https://acme.slack.com/archives/C0SYN000020, unasked, by the incident skill.",
      },
    });
    expect(investigationWhy({ incident: INC_33, row: swept })).toBe(
      "the incident sweep found its channel live, and mid-incident is when a finding helps most",
    );
  });

  it("names the supervisor, never its shift's slug, and quotes the row's first sentence", () => {
    expect(investigationWhy({ incident: INC_33, row: row({ over: { raisedBy: { kind: "supervisor" } } }) })).toBe(
      "raised by the supervisor: INC-33 'billing export delay' (Major, declared 23 Sep 2026, still " +
        "Investigating, lead Ada Owner, https://app.incident.io/acme-group/incidents/33) is investigated unasked to a " +
        "result with receipts.",
    );
  });

  it("cuts a long why at a word inside the cap and marks the cut", () => {
    const why = investigationWhy({ incident: INC_33, row: row({ over: { summary: "word ".repeat(80) } }) });
    expect([why.length <= 240, why.endsWith(" word…")]).toEqual([true, true]);
  });

  it("quotes the row it was found while working on", () => {
    const found = row({
      over: {
        raisedBy: { kind: "row", summary: "Why the export matcher skips one region. It was rewritten in August." },
        summary: "The matcher may have linked INC-33's report.",
      },
    });
    expect(investigationWhy({ incident: INC_33, row: found })).toBe(
      'found while working on "Why the export matcher skips one region.": The matcher may have linked INC-33\'s report.',
    );
  });
});

describe("investigatedIncident", () => {
  const INC_31 = orgIncident({
    over: {
      channelId: "C0SYNOLDER0001",
      homepageUrl: "https://app.incident.io/acme-group/incidents/71",
      ref: "INC-71",
    },
  });

  it("attributes a row naming two open incidents to the one it names first, whichever is listed first", () => {
    const summary = `${INC_33_SUMMARY} Compare https://app.incident.io/acme-group/incidents/71.`;
    expect([
      investigatedIncident({ open: [INC_31, INC_33], summary }),
      investigatedIncident({ open: [INC_33, INC_31], summary }),
      investigatedIncident({ open: [INC_31], summary }),
      investigatedIncident({ open: [INC_31], summary: INC_33_SUMMARY }),
    ]).toEqual(["INC-33", "INC-33", "INC-71", undefined]);
  });
});

describe("incidentInvestigations", () => {
  /** A step the INC-33 note posts: its id is that incident's note id. */
  const NOTE: RowStep = { id: "inc-c0syn000020-r2", row: "incident-inc-33-incorrectly-linked-nz-report" };
  const PARKED_RUN: InvestigationRow["run"] = {
    action: undefined,
    actionUnreadable: false,
    askedIso: "2026-10-04T21:30:40.628Z",
    kind: "waiting-on-owner",
    question: "INC-33: share the write-up in the incident thread?",
    shape: undefined,
    shapeIso: undefined,
  };
  const at = ({
    rows,
    steps = [],
    landed = new Set<string>(),
  }: {
    rows: readonly InvestigationRow[];
    steps?: readonly RowStep[];
    landed?: ReadonlySet<string>;
  }) => incidentInvestigations({ landed, open: [INC_33], rows, steps }).get("INC-33")!;

  it("is none when no row names the incident", () => {
    expect(at({ rows: [row({ over: { summary: "something else entirely" } })] })).toEqual({ state: "none" });
  });

  it("reads INC-33's own journal — parked on a question that is the owner's — as findings on its ask card", () => {
    const parked = row({ over: { lastMovedIso: "2026-10-04T21:31:15.422Z", ownerWait: "owner", run: PARKED_RUN } });
    expect(at({ rows: [parked] })).toEqual({
      open: "ask:incident-inc-33-incorrectly-linked-nz-report",
      slug: "incident-inc-33-incorrectly-linked-nz-report",
      state: "findings",
      why: investigationWhy({ incident: INC_33, row: parked }),
    });
  });

  it("never says findings for a question the owner has ruled on or a paused row, which the Queue draws no card for", () => {
    const ruled = row({ over: { ownerWait: "already-ruled", run: PARKED_RUN } });
    const paused = row({ over: { ownerWait: "not-runnable", paused: true, run: PARKED_RUN } });
    expect([at({ rows: [ruled] }).state, at({ rows: [paused] }).state]).toEqual(["lined-up", "none"]);
  });

  it("reads the incident's own note up on the row as findings on its hand card, whatever the run says", () => {
    const active = row({ over: { lastMovedIso: "2026-10-04T21:00:00.000Z", run: { kind: "active" } } });
    expect(at({ rows: [active], steps: [NOTE] })).toMatchObject({ open: "hand:inc-c0syn000020-r2", state: "findings" });
  });

  it("reads a card the owner's spoken words landed on as lined up, never a findings link the Queue holds off", () => {
    const active = row({ over: { lastMovedIso: "2026-10-04T21:00:00.000Z", run: { kind: "active" } } });
    const parked = row({ over: { ownerWait: "owner", run: PARKED_RUN } });
    const decision: RowStep = { id: "share-the-inc-33-write-up", row: parked.slug };
    expect([
      at({ landed: new Set(["hand:inc-c0syn000020-r2"]), rows: [active], steps: [NOTE] }).state,
      at({ landed: new Set(["ask:incident-inc-33-incorrectly-linked-nz-report"]), rows: [parked] }).state,
      at({ landed: new Set(["hand:share-the-inc-33-write-up"]), rows: [parked], steps: [decision] }).state,
      at({ landed: new Set(["hand:some-other-card"]), rows: [parked], steps: [decision] }).state,
    ]).toEqual(["lined-up", "lined-up", "lined-up", "findings"]);
  });

  it("never reads another step on the row, or another channel's note, as findings", () => {
    const active = row({ over: { lastMovedIso: "2026-10-04T21:00:00.000Z", run: { kind: "active" } } });
    const steps: readonly RowStep[] = [
      { id: "sign-in-to-datadog", row: NOTE.row },
      { id: "inc-c0other0001-r1", row: NOTE.row },
      { id: "inc-c0syn000020-r2", row: "incident-another-row" },
    ];
    expect(at({ rows: [active], steps })).toMatchObject({ state: "looking" });
  });

  it("reads a seated run as looking, with when it last moved, and an unseated or orphaned one as lined up", () => {
    const active = row({ over: { lastMovedIso: "2026-10-04T21:00:00.000Z", run: { kind: "active" } } });
    const orphaned = row({
      over: { run: { deadSessionId: "dead", kind: "orphaned", lastEventIso: "2026-10-04T21:00:00.000Z" } },
    });
    expect([at({ rows: [active] }).state, at({ rows: [row()] }).state, at({ rows: [orphaned] }).state]).toEqual([
      "looking",
      "lined-up",
      "lined-up",
    ]);
    expect(at({ rows: [active] })).toMatchObject({ lastMovedIso: "2026-10-04T21:00:00.000Z" });
  });

  it("draws nothing for a row that is over or a run that finished without findings", () => {
    const finished = row({ over: { run: { atIso: "2026-10-04T22:00:00.000Z", kind: "finished", residue: [] } } });
    expect([at({ rows: [row({ over: { over: true } })] }), at({ rows: [finished] })]).toEqual([
      { state: "none" },
      { state: "none" },
    ]);
  });

  it("reads a journal that would not read as unmeasured, never as nobody looking", () => {
    const broken = row({ over: { run: { kind: "unreadable", reason: "2 journal line(s) could not be read" } } });
    expect(at({ rows: [broken] })).toEqual({
      because:
        "incident-inc-33-incorrectly-linked-nz-report's run journal would not read: 2 journal line(s) could not be read",
      state: "unmeasured",
    });
  });

  it("shows the furthest-along row when two name the incident", () => {
    const lined = row({ over: { slug: "incident-c0syn000020" } });
    const active = row({ over: { lastMovedIso: "2026-10-04T21:00:00.000Z", run: { kind: "active" } } });
    expect(at({ rows: [lined, active] })).toMatchObject({ slug: active.slug, state: "looking" });
  });
});

describe("investigationLine", () => {
  it("prints nothing for none and one line per other state", () => {
    expect([
      investigationLine({ investigation: { state: "none" } }),
      investigationLine({ investigation: { slug: "incident-x", state: "lined-up", why: "w" } }),
      investigationLine({
        investigation: { lastMovedIso: "2026-10-04T21:00:00.000Z", slug: "incident-x", state: "looking", why: "w" },
      }),
      investigationLine({ investigation: { open: "hand:inc-c1-r1", slug: "incident-x", state: "findings", why: "w" } }),
      investigationLine({ investigation: { because: "b", state: "unmeasured" } }),
    ]).toEqual([
      undefined,
      "lined up for the fleet to look into — w",
      "the fleet is looking into this (last moved 2026-10-04T21:00:00.000Z) — w",
      "findings ready on the Queue, hand:inc-c1-r1 — w",
      "investigation not measured — b",
    ]);
  });
});
