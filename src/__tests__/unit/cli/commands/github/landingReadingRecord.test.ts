/**
 * `github landing --record-reading <by>`'s ledger step over plain fakes: one ordered event log of every
 * clock read, ledger write, register append and diagnostic, so each case pins what was written, with what
 * instant, and that neither ledger's refusal stops the other write. The document is built through the real
 * `landingDocument`, over one row carrying two certified asks.
 */
import { describe, expect, it } from "vitest";

import { recordReadingOf } from "../../../../../cli/commands/github/landingReadingRecord.js";
import { type LandingDocument, landingDocument } from "../../../../../cli/commands/github/landingReport.js";
import type { GithubLandingDeps } from "../../../../../cli/commands/github/landingRun.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { LandingTally } from "../../../../../review/landing.js";
import type { ReviewerAskedRow } from "../../../../../review/reviewerRegister.js";
import { landingRowFake } from "../../../../landingRowFake.js";

const NOW = "2026-10-13T01:02:03.000Z";

const TALLY: LandingTally = {
  advisoryRedBypassed: 0,
  byAction: [{ action: "press", count: 1 }],
  byDispatch: [{ count: 1, verdict: "merge-now" }],
  ready: 1,
  total: 1,
};

/** A document over one row whose ask trail holds a DM to Ada and a channel ask to Ada and a group. */
function documentWithAsks({ withAsks }: { withAsks: boolean }): LandingDocument {
  const askTrail = withAsks
    ? [
        {
          atIso: "2026-10-12T22:00:00.000Z",
          channel: "ada",
          isDirectMessage: true,
          leg: "corpus" as const,
          messageKey: "D1:1760306400.000100",
          permalink: "https://example.slack.com/archives/D1/p1760306400000100",
          recipients: ["U1"],
        },
        {
          atIso: "2026-10-12T21:00:00.000Z",
          channel: "#dev-team",
          isDirectMessage: false,
          leg: "live" as const,
          messageKey: "C1:1760302800.000200",
          permalink: "https://example.slack.com/archives/C1/p1760302800000200",
          recipients: ["U1", "S9"],
        },
      ]
    : [];
  return landingDocument({
    census: [],
    loginSlackIds: {},
    logins: {},
    people: { U1: { name: "Ada" } },
    presses: [],
    residue: [],
    rows: [landingRowFake({ askTrail })],
    selection: { author: undefined, includeDrafts: false, repos: ["acme/widgets"] },
    tally: TALLY,
  });
}

/** The two asks above, as the reviewer register should receive them, recorded at {@link NOW}. */
const ASKED_ROWS: readonly ReviewerAskedRow[] = [
  {
    atIso: "2026-10-12T22:00:00.000Z",
    authorLogin: "octocat",
    channel: "ada",
    codeOwnerTeams: [],
    isDirectMessage: true,
    kind: "asked",
    messageKey: "D1:1760306400.000100",
    names: { U1: "Ada" },
    number: 16378,
    permalink: "https://example.slack.com/archives/D1/p1760306400000100",
    prKey: "acme/widgets#16378",
    recipients: ["U1"],
    recordedAtIso: NOW,
    repoSlug: "acme/widgets",
    schema: 1,
  },
  {
    atIso: "2026-10-12T21:00:00.000Z",
    authorLogin: "octocat",
    channel: "#dev-team",
    codeOwnerTeams: [],
    isDirectMessage: false,
    kind: "asked",
    messageKey: "C1:1760302800.000200",
    names: { U1: "Ada" },
    number: 16378,
    permalink: "https://example.slack.com/archives/C1/p1760302800000200",
    prKey: "acme/widgets#16378",
    recipients: ["U1", "S9"],
    recordedAtIso: NOW,
    repoSlug: "acme/widgets",
    schema: 1,
  },
];

/** One recorded effect, in the order it happened. */
type Event =
  | { readonly kind: "now" }
  | {
      readonly kind: "reading";
      readonly by: string;
      readonly home: string | undefined;
      readonly observedAtIso: string;
      readonly document: string;
    }
  | {
      readonly kind: "asks";
      readonly home: string | undefined;
      readonly nowIso: string;
      readonly rows: readonly ReviewerAskedRow[];
    }
  | { readonly kind: "diagnostic"; readonly line: string };

/** Fakes whose two ledgers answer the given results, logging every call in order. */
function harness({ reading, asks }: { reading: Result<string, string>; asks: Result<number, string> }): {
  deps: Pick<GithubLandingDeps, "appendReviewerAsks" | "now" | "recordReading" | "writeDiagnostic">;
  events: Event[];
} {
  const events: Event[] = [];
  return {
    deps: {
      appendReviewerAsks: ({ home, nowIso, rows }) => {
        events.push({ home, kind: "asks", nowIso, rows });
        return asks;
      },
      now: () => {
        events.push({ kind: "now" });
        return new Date(NOW);
      },
      recordReading: ({ by, document, home, observedAtIso }) => {
        events.push({ by, document, home, kind: "reading", observedAtIso });
        return reading;
      },
      writeDiagnostic: (line) => {
        events.push({ kind: "diagnostic", line });
      },
    },
    events,
  };
}

describe("recordReadingOf", () => {
  it("writes nothing and reads no clock when --record-reading was not given", () => {
    const { deps, events } = harness({ asks: ok(2), reading: ok("reading-1") });

    recordReadingOf({
      args: { home: "/h", recordReadingBy: undefined },
      deps,
      document: documentWithAsks({ withAsks: true }),
    });

    expect(events).toEqual([]);
  });

  it("reads the clock once and stamps the reading and both asks with that one instant", () => {
    const { deps, events } = harness({ asks: ok(2), reading: ok("reading-1") });
    const document = documentWithAsks({ withAsks: true });

    recordReadingOf({ args: { home: "/h", recordReadingBy: "row-42" }, deps, document });

    expect(events.filter((event) => event.kind === "now")).toEqual([{ kind: "now" }]);
    expect(events).toEqual([
      { kind: "now" },
      { by: "row-42", document: JSON.stringify(document), home: "/h", kind: "reading", observedAtIso: NOW },
      { kind: "diagnostic", line: "landing: reading recorded as row-42 (reading-1)" },
      { home: "/h", kind: "asks", nowIso: NOW, rows: ASKED_ROWS },
      { kind: "diagnostic", line: "landing: reviewer register took 2 new ask(s)" },
    ]);
  });

  it("records the document as JSON that parses back to the document, passing an absent home through", () => {
    const { deps, events } = harness({ asks: ok(0), reading: ok("reading-1") });
    const document = documentWithAsks({ withAsks: true });

    recordReadingOf({ args: { home: undefined, recordReadingBy: "row-42" }, deps, document });

    const readings = events.flatMap((event) => (event.kind === "reading" ? [event] : []));
    expect(readings.length).toBe(1);
    expect(readings[0]!.home).toBe(undefined);
    expect(JSON.parse(readings[0]!.document)).toEqual(document);
  });

  it("still appends the asks when the readings ledger refuses the document, reporting the refusal", () => {
    const { deps, events } = harness({ asks: ok(2), reading: err("the readings ledger is locked") });
    const document = documentWithAsks({ withAsks: true });

    recordReadingOf({ args: { home: "/h", recordReadingBy: "row-42" }, deps, document });

    expect(events.slice(2)).toEqual([
      { kind: "diagnostic", line: "landing: the reading was not recorded — the readings ledger is locked" },
      { home: "/h", kind: "asks", nowIso: NOW, rows: ASKED_ROWS },
      { kind: "diagnostic", line: "landing: reviewer register took 2 new ask(s)" },
    ]);
  });

  it("reports a register refusal after a successful reading, and says nothing more", () => {
    const { deps, events } = harness({ asks: err("the register is unreadable"), reading: ok("reading-1") });

    recordReadingOf({
      args: { home: "/h", recordReadingBy: "row-42" },
      deps,
      document: documentWithAsks({ withAsks: true }),
    });

    expect(events.slice(2)).toEqual([
      { kind: "diagnostic", line: "landing: reading recorded as row-42 (reading-1)" },
      { home: "/h", kind: "asks", nowIso: NOW, rows: ASKED_ROWS },
      {
        kind: "diagnostic",
        line: "landing: the reviewer register did not take this read's asks — the register is unreadable",
      },
    ]);
  });

  it("appends an empty row list, and reports zero new asks, when no row carries an ask", () => {
    const { deps, events } = harness({ asks: ok(0), reading: ok("reading-1") });

    recordReadingOf({
      args: { home: "/h", recordReadingBy: "row-42" },
      deps,
      document: documentWithAsks({ withAsks: false }),
    });

    expect(events.slice(2)).toEqual([
      { kind: "diagnostic", line: "landing: reading recorded as row-42 (reading-1)" },
      { home: "/h", kind: "asks", nowIso: NOW, rows: [] },
      { kind: "diagnostic", line: "landing: reviewer register took 0 new ask(s)" },
    ]);
  });
});
