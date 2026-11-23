/**
 * `finishedRunRefusal` — the journal-derived closure fact the two execution doors were not asking for.
 *
 * Pure: a doc and a {@link RunDisposition} in, a sentence or `undefined` out. No filesystem, no clock.
 */
import { describe, expect, it } from "vitest";

import { rerunAllowedBy } from "../../../cli/commands/handover/finishedCycleGate.js";
import { ALLOW_RERUN, finishedRunRefusal } from "../../../handover/boardRefusal.js";
import { type RunDisposition, runDisposition } from "../../../handover/boardTypes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";

const DOC = parseHandoverDoc({
  path: "/tmp/handovers/acme-compact-corpus-run.md",
  text: "---\nslug: acme-compact-corpus-run\nstatus: ready\n---\n# doc\n",
});

const CYCLE: readonly RunEvent[] = [
  { atIso: "2026-09-01T08:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
  { atIso: "2026-09-01T09:00:41.052Z", kind: "finished", residue: [] },
];

describe("finishedRunRefusal", () => {
  it("refuses a doc whose current cycle finished, naming the slug and the instant", () => {
    const refusal = finishedRunRefusal({
      doc: DOC,
      run: runDisposition({ events: CYCLE, unreadableLines: [] }),
    });
    expect(refusal).toBe(
      "acme-compact-corpus-run's run already finished at 2026-09-01T09:00:41.052Z — " +
        "a closed run is not work to pick up, whatever `status:` still says. Read what it did: " +
        "`slopweaver handover resume acme-compact-corpus-run`. If there is genuinely more " +
        "to do, register a new row; to re-open THIS one deliberately, `SLOPWEAVER_ALLOW_RERUN=1` on the same " +
        "command.",
    );
  });

  it("says how many probes a forced close left unmet", () => {
    const forced: RunDisposition = {
      atIso: "2026-09-01T09:00:41.052Z",
      kind: "finished",
      residue: ["derive fits the ceiling", "corpus shrank"],
    };
    expect(finishedRunRefusal({ doc: DOC, run: forced })).toContain("forced through with 2 probe(s) unmet");
  });

  it("clears every disposition that is not a finished cycle", () => {
    const others: readonly RunDisposition[] = [
      { kind: "never-started" },
      { kind: "active" },
      {
        action: undefined,
        actionUnreadable: false,
        askedIso: "2026-09-01T08:00:00.000Z",
        kind: "waiting-on-owner",
        question: "which ceiling?",
        shape: undefined,
        shapeIso: undefined,
      },
      { kind: "abandoned", why: "superseded" },
      { deadSessionId: "s-1", kind: "orphaned", lastEventIso: "2026-09-01T09:00:00.000Z" },
      { kind: "unreadable", reason: "1 journal line(s) could not be read" },
    ];
    expect(others.map((run) => finishedRunRefusal({ doc: DOC, run }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("clears a doc whose finished cycle was superseded by a fresh start", () => {
    const reopened: readonly RunEvent[] = [
      ...CYCLE,
      { atIso: "2026-09-04T07:30:00.000Z", branch: "work", docHash: "abc", kind: "started" },
    ];
    expect(finishedRunRefusal({ doc: DOC, run: runDisposition({ events: reopened, unreadableLines: [] }) })).toBe(
      undefined,
    );
  });
});

describe("runDisposition", () => {
  it("reads a re-started cycle as waiting on the question its orphaned predecessor held", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-09-08T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
      { atIso: "2026-09-08T03:00:00.000Z", kind: "question", question: "which ceiling?" },
      {
        atIso: "2026-09-12T01:00:00.000Z",
        deadSessionId: "s-1",
        kind: "orphaned",
        lastEventIso: "2026-09-08T03:00:00.000Z",
      },
      { atIso: "2026-09-14T21:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
    ];
    // The instant is the ORIGINAL ask, not the re-start: a reap says the session died, never that the
    // question was asked again, so the clock on it must not go back to zero when a successor picks the row up.
    expect(runDisposition({ events, unreadableLines: [] })).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: "2026-09-08T03:00:00.000Z",
      kind: "waiting-on-owner",
      question: "which ceiling?",
      shape: undefined,
      shapeIso: undefined,
    });
  });

  it("reads a peer's start over a waiting cycle, with no ending on it, as still waiting on the same question", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-09-08T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
      { atIso: "2026-09-08T03:00:00.000Z", kind: "question", question: "which ceiling?" },
      { atIso: "2026-09-14T21:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
    ];
    expect(runDisposition({ events, unreadableLines: [] })).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: "2026-09-08T03:00:00.000Z",
      kind: "waiting-on-owner",
      question: "which ceiling?",
      shape: undefined,
      shapeIso: undefined,
    });
  });
});

describe("rerunAllowedBy", () => {
  it("reads only the exact break-glass value", () => {
    expect(rerunAllowedBy({ env: { [ALLOW_RERUN]: "1" } })).toBe(true);
    expect(rerunAllowedBy({ env: { [ALLOW_RERUN]: "true" } })).toBe(false);
    expect(rerunAllowedBy({ env: {} })).toBe(false);
  });
});

describe("runDisposition — a corrected question", () => {
  it("waits on the corrected text, not the stale one the board would otherwise print", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-09-01T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: "2026-09-01T01:00:00.000Z", kind: "question", question: "10 of 12?" },
      { atIso: "2026-09-01T02:00:00.000Z", kind: "question-corrected", question: "9/8/9/10 of 12?", why: "one run" },
    ];

    // Corrected text, ORIGINAL instant — tidying the wording of a three-week-old question does not make it
    // a fresh one, and a correction that reset the clock would hide exactly the rows this change surfaces.
    expect(runDisposition({ events, unreadableLines: [] })).toEqual({
      action: undefined,
      actionUnreadable: false,
      askedIso: "2026-09-01T01:00:00.000Z",
      kind: "waiting-on-owner",
      question: "9/8/9/10 of 12?",
      // No ruling follows the correction, so none answers the restated question.
      ruledAfterRestatement: [],
      shape: undefined,
      shapeIso: undefined,
    });
  });
});
