import { describe, expect, it } from "vitest";

import { isSettled, ledgerLine, NO_RUN, parseLedger, type RunEvent, runStateOf } from "../../../handover/ledger.js";
import { inheritedQuestion } from "../../../handover/openQuestion.js";

const AT = "2026-08-04T00:00:00.000Z";

const STARTED: RunEvent = { atIso: AT, branch: "feat/x", docHash: "abc123", kind: "started" };

/** A journal as it would be on disk. */
function journal({ events }: { events: readonly RunEvent[] }): string {
  return events.map((event) => ledgerLine({ event })).join("");
}

describe("parseLedger", () => {
  it("round-trips every event kind through the on-disk form", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      { atIso: AT, failed: 1, kind: "probed", passed: 2 },
      { atIso: AT, docHash: "def456", kind: "amended", why: "scope moved" },
      { atIso: AT, kind: "question", question: "which base?" },
      { atIso: AT, channel: "D1", kind: "question-posted", question: "which base?", ts: "1700000000.000100" },
      {
        atIso: AT,
        channel: "D1",
        kind: "question-posted",
        permalink: "https://acme.slack.com/archives/D1/p1700000000000200",
        question: "which base?",
        ts: "1700000000.000200",
      },
      { atIso: AT, kind: "question-corrected", question: "which base, really?", why: "overstated" },
      { answer: "main", atIso: AT, kind: "answered" },
      { atIso: AT, kind: "finished", residue: ["one probe unmet"] },
      { atIso: AT, kind: "abandoned", why: "superseded" },
      {
        atIso: AT,
        host: "codex",
        kind: "claimed",
        pid: 42,
        sessionId: "codex-thread",
        why: "moving hosts",
        worktree: "/tmp/worktree",
      },
      { atIso: AT, kind: "released", sessionId: "codex-thread", why: "continue in Claude Code" },
      { anchor: "https://example.invalid/p9", atIso: AT, decidedIso: AT, kind: "ruling", ruling: "yes, raise it" },
      {
        anchor: "journal:runs/a-row.jsonl#2026-09-04T12:38:57.414Z",
        atIso: AT,
        backfilledFrom: "2026-09-04T12:38:57.414Z",
        decidedIso: "2026-09-04T12:38:57.414Z",
        kind: "ruling",
        ruling: "OWNER RULED: ship it",
      },
    ];

    expect(parseLedger({ text: journal({ events }) })).toEqual({ events, unknownKind: [], unreadable: [] });
  });

  it("decodes a ruling written before decidedIso existed, with the optional halves genuinely absent", () => {
    const line = `{"kind":"ruling","atIso":"${AT}","ruling":"yes","anchor":"p9"}\n`;
    const parsed = parseLedger({ text: line });

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toEqual([{ anchor: "p9", atIso: AT, kind: "ruling", ruling: "yes" }]);
  });

  it("reports a ruling with no words as UNREADABLE — an anchor alone says nothing about what they decided", () => {
    expect(parseLedger({ text: `{"kind":"ruling","atIso":"${AT}","anchor":"p9"}\n` })).toEqual({
      events: [],
      unknownKind: [],
      unreadable: [1],
    });
  });

  it("reports a ruling with no anchor as UNREADABLE — words with nowhere to check them are a claim", () => {
    expect(parseLedger({ text: `{"kind":"ruling","atIso":"${AT}","ruling":"yes"}\n` })).toEqual({
      events: [],
      unknownKind: [],
      unreadable: [1],
    });
  });

  it("reports a ruling whose words are blank as UNREADABLE rather than decoding an empty decision", () => {
    expect(parseLedger({ text: `{"kind":"ruling","atIso":"${AT}","ruling":"   ","anchor":"p9"}\n` })).toEqual({
      events: [],
      unknownKind: [],
      unreadable: [1],
    });
  });

  it("reports a ruling with a BLANK backfilledFrom as unreadable — absence there is a claim about provenance", () => {
    const line = `{"kind":"ruling","atIso":"${AT}","decidedIso":"${AT}","ruling":"yes","anchor":"p9","backfilledFrom":""}\n`;

    expect(parseLedger({ text: line })).toEqual({ events: [], unknownKind: [], unreadable: [1] });
  });

  it("reports a ruling whose backfilledFrom is not its decidedIso as unreadable", () => {
    const line = `{"kind":"ruling","atIso":"${AT}","decidedIso":"${AT}","ruling":"yes","anchor":"p9","backfilledFrom":"2026-09-04T00:00:00.000Z"}\n`;

    expect(parseLedger({ text: line })).toEqual({ events: [], unknownKind: [], unreadable: [1] });
  });

  it("reports a ruling with a present-but-unparseable decidedIso as unreadable", () => {
    const line = `{"kind":"ruling","atIso":"${AT}","decidedIso":"last tuesday","ruling":"yes","anchor":"p9"}\n`;

    expect(parseLedger({ text: line })).toEqual({ events: [], unknownKind: [], unreadable: [1] });
  });

  it("preserves a ruling's words byte for byte, whitespace and unicode included", () => {
    const words = "  yes — “raise it”, then \\wait\n";
    const event: RunEvent = { anchor: "p9", atIso: AT, decidedIso: AT, kind: "ruling", ruling: words };

    expect(parseLedger({ text: journal({ events: [event] }) }).events).toEqual([event]);
  });

  it("treats an empty journal as no events rather than an error", () => {
    expect(parseLedger({ text: "" })).toEqual({ events: [], unknownKind: [], unreadable: [] });
  });

  it("ignores blank lines without counting them unreadable", () => {
    expect(parseLedger({ text: `\n${ledgerLine({ event: STARTED })}\n\n` })).toEqual({
      events: [STARTED],
      unknownKind: [],
      unreadable: [],
    });
  });

  /** The normal case for an append-only file: a process killed mid-write. It must be visible, not dropped. */
  it("reports a truncated final line by number, keeping the events before it", () => {
    const parsed = parseLedger({ text: `${ledgerLine({ event: STARTED })}{"kind":"probed","atIs` });

    expect(parsed.events).toEqual([STARTED]);
    expect(parsed.unreadable).toEqual([2]);
  });

  it("reports a line whose kind this build does not know, rather than silently skipping it", () => {
    const parsed = parseLedger({ text: `{"kind":"teleported","atIso":"${AT}"}\n` });

    expect(parsed.events).toEqual([]);
    expect(parsed.unreadable).toEqual([1]);
  });

  it("reports a line with no timestamp", () => {
    expect(parseLedger({ text: '{"kind":"started"}\n' }).unreadable).toEqual([1]);
  });

  it("defaults a missing string field rather than losing the whole entry", () => {
    const parsed = parseLedger({ text: `{"kind":"abandoned","atIso":"${AT}"}\n` });

    expect(parsed.events).toEqual([{ atIso: AT, kind: "abandoned", why: "" }]);
  });

  it("decodes a resume's own pid, which is a different process from the launch's", () => {
    const parsed = parseLedger({
      text: `{"kind":"resumed","atIso":"${AT}","sessionId":"s-1","attempt":2,"pid":1234}\n`,
    });

    expect(parsed.events).toEqual([{ atIso: AT, attempt: 2, kind: "resumed", pid: 1234, sessionId: "s-1" }]);
  });

  it("still decodes a resume written before the pid field existed, rather than reporting it unreadable", () => {
    const parsed = parseLedger({ text: `{"kind":"resumed","atIso":"${AT}","sessionId":"s-1","attempt":2}\n` });

    expect(parsed.events).toEqual([{ atIso: AT, attempt: 2, kind: "resumed", pid: undefined, sessionId: "s-1" }]);
    expect(parsed.unreadable).toEqual([]);
  });

  it("round-trips forced true on a claimed event", () => {
    const event: RunEvent = {
      atIso: AT,
      forced: true,
      host: "claude-code",
      kind: "claimed",
      pid: 42,
      sessionId: "s-2",
      why: "holder liveness unknown, owner authorised the takeover",
      worktree: "/wt",
    };

    const parsed = parseLedger({ text: ledgerLine({ event }) });

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toEqual([event]);
  });

  it("decodes a pre-forced-field claimed event without inventing the field", () => {
    const parsed = parseLedger({
      text: `{"kind":"claimed","atIso":"${AT}","host":"claude-code","sessionId":"s-1","why":"moving"}\n`,
    });

    const claimed = parsed.events.find((event) => event.kind === "claimed")!;
    expect(parsed.unreadable).toEqual([]);
    expect("forced" in claimed).toBe(false);
  });

  it("refuses a claim without a visible-host label because cross-host liveness would be unknowable", () => {
    const parsed = parseLedger({
      text: `{"kind":"claimed","atIso":"${AT}","sessionId":"s-1","why":"moving"}\n`,
    });

    expect(parsed.events).toEqual([]);
    expect(parsed.unreadable).toEqual([1]);
  });
});

describe("runStateOf", () => {
  it("is closed with nothing recorded when no run ever started", () => {
    expect(runStateOf({ events: [] })).toEqual(NO_RUN);
  });

  it("ignores events that precede the first start", () => {
    expect(runStateOf({ events: [{ atIso: AT, failed: 0, kind: "probed", passed: 1 }] })).toEqual(NO_RUN);
  });

  it("is open, with the branch and hash, right after a start", () => {
    const state = runStateOf({ events: [STARTED] });

    expect(state.phase).toBe("open");
    expect(state.branch).toBe("feat/x");
    expect(state.docHash).toBe("abc123");
    expect(state.entries).toBe(1);
  });

  it("moves to waiting-on-owner on a question, carrying it", () => {
    const state = runStateOf({ events: [STARTED, { atIso: AT, kind: "question", question: "which base?" }] });

    expect(state.phase).toBe("waiting-on-owner");
    expect(state.openQuestion).toBe("which base?");
  });

  it("returns to open once answered, clearing the question", () => {
    const state = runStateOf({
      events: [STARTED, { atIso: AT, kind: "question", question: "q" }, { answer: "a", atIso: AT, kind: "answered" }],
    });

    expect(state.phase).toBe("open");
    expect(state.openQuestion).toBeUndefined();
  });

  it("closes on finish", () => {
    expect(runStateOf({ events: [STARTED, { atIso: AT, kind: "finished", residue: [] }] }).phase).toBe("closed");
  });

  it("closes on abandon", () => {
    expect(runStateOf({ events: [STARTED, { atIso: AT, kind: "abandoned", why: "no" }] }).phase).toBe("closed");
  });

  it("tracks the doc hash forward through an amendment", () => {
    const state = runStateOf({
      events: [STARTED, { atIso: AT, docHash: "newhash", kind: "amended", why: "scope moved" }],
    });

    expect(state.docHash).toBe("newhash");
  });

  /** A doc may legitimately be run twice; folding old cycles in left a finished run looking permanently open. */
  it("reads only the most recent cycle, so a second run is not polluted by the first", () => {
    const state = runStateOf({
      events: [
        STARTED,
        { atIso: AT, kind: "question", question: "old" },
        { atIso: AT, kind: "finished", residue: [] },
        { atIso: AT, branch: "feat/second", docHash: "second", kind: "started" },
      ],
    });

    expect(state.phase).toBe("open");
    expect(state.branch).toBe("feat/second");
    expect(state.openQuestion).toBeUndefined();
    expect(state.entries).toBe(1);
  });

  it("counts only the current cycle's entries, which is what a bounded gate reads for progress", () => {
    const state = runStateOf({
      events: [
        STARTED,
        { atIso: AT, kind: "finished", residue: [] },
        STARTED,
        { atIso: AT, failed: 0, kind: "probed", passed: 1 },
      ],
    });

    expect(state.entries).toBe(2);
  });
});

describe("a question the previous cycle closed still holding — reaped or started over", () => {
  const QUESTION: RunEvent = { atIso: "2026-09-08T03:23:25.337Z", kind: "question", question: "three calls?" };
  const ORPHANED: RunEvent = {
    atIso: "2026-09-12T01:20:33.327Z",
    cycleEvents: 2,
    deadSessionId: "dead-session",
    kind: "orphaned",
    lastEventIso: "2026-09-08T03:23:25.337Z",
  };

  it("reopens the next cycle WAITING on it, because a dead session is not an answer", () => {
    const state = runStateOf({ events: [STARTED, QUESTION, ORPHANED, STARTED] });

    expect(state.phase).toBe("waiting-on-owner");
    expect(state.openQuestion).toBe("three calls?");
    expect(state.entries).toBe(1);
  });

  it("is settled by an answer recorded on the new cycle", () => {
    const state = runStateOf({
      events: [STARTED, QUESTION, ORPHANED, STARTED, { answer: "yes", atIso: AT, kind: "answered" }],
    });

    expect(state.phase).toBe("open");
    expect(state.openQuestion).toBe(undefined);
  });

  it("leaves the orphaned cycle itself closed", () => {
    expect(runStateOf({ events: [STARTED, QUESTION, ORPHANED] }).phase).toBe("closed");
  });

  it("carries the CORRECTED text and the posted handle, so a re-start never resurfaces the stale question", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      QUESTION,
      { atIso: AT, channel: "D1", kind: "question-posted", question: "three calls?", ts: "1700000000.000100" },
      { atIso: AT, kind: "question-corrected", question: "four calls?", why: "miscounted" },
      ORPHANED,
      STARTED,
    ];
    const state = runStateOf({ events });

    expect(state.phase).toBe("waiting-on-owner");
    expect(state.openQuestion).toBe("four calls?");
    expect(state.openQuestionPost).toEqual({ channel: "D1", ts: "1700000000.000100" });
  });

  it("carries through a second orphaned cycle nobody answered in", () => {
    const events: readonly RunEvent[] = [STARTED, QUESTION, ORPHANED, STARTED, ORPHANED, STARTED];

    expect(inheritedQuestion({ events })).toEqual(QUESTION);
    expect(runStateOf({ events }).phase).toBe("waiting-on-owner");
  });

  it("carries nothing when the question was answered before the session died", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      QUESTION,
      { answer: "yes", atIso: AT, kind: "answered" },
      ORPHANED,
      STARTED,
    ];

    expect(inheritedQuestion({ events })).toBe(undefined);
    expect(runStateOf({ events }).phase).toBe("open");
  });

  it("carries nothing out of a cycle that ended finished or abandoned, which settle it their own way", () => {
    const finished = runStateOf({ events: [STARTED, QUESTION, { atIso: AT, kind: "finished", residue: [] }, STARTED] });
    const abandoned = runStateOf({ events: [STARTED, QUESTION, { atIso: AT, kind: "abandoned", why: "no" }, STARTED] });

    expect(finished.phase).toBe("open");
    expect(abandoned.phase).toBe("open");
  });

  it("carries out of a cycle a peer re-started with no ending, since a re-start is not an answer either", () => {
    const events: readonly RunEvent[] = [STARTED, QUESTION, STARTED];

    expect(inheritedQuestion({ events })).toEqual(QUESTION);
    expect(runStateOf({ events }).phase).toBe("waiting-on-owner");
    expect(runStateOf({ events }).openQuestion).toBe("three calls?");
  });

  it("carries through a re-start and then a reap, in either order, until somebody answers", () => {
    const events: readonly RunEvent[] = [STARTED, QUESTION, STARTED, ORPHANED, STARTED, STARTED];

    expect(inheritedQuestion({ events })).toEqual(QUESTION);
  });

  it("carries through two bare re-starts in a row", () => {
    expect(inheritedQuestion({ events: [STARTED, QUESTION, STARTED, STARTED] })).toEqual(QUESTION);
  });

  it("carries nothing out of a re-started cycle whose holder withdrew the question first", () => {
    const withdrawn: RunEvent = { atIso: AT, kind: "question-withdrawn", question: "three calls?", why: "resolved" };

    expect(inheritedQuestion({ events: [STARTED, QUESTION, withdrawn, STARTED] })).toBe(undefined);
  });

  it("still carries past a withdrawal naming some OTHER question, which settles nothing", () => {
    const withdrawn: RunEvent = { atIso: AT, kind: "question-withdrawn", question: "two calls?", why: "stale" };

    expect(inheritedQuestion({ events: [STARTED, QUESTION, withdrawn, STARTED] })).toEqual(QUESTION);
  });

  it.each<[string, RunEvent]>([
    ["answered", { answer: "yes", atIso: AT, kind: "answered" }],
    ["finished", { atIso: AT, kind: "finished", residue: [] }],
    ["closed", { atIso: AT, kind: "closed", residue: [], summary: "shipped" }],
    ["abandoned", { atIso: AT, kind: "abandoned", why: "no" }],
  ])("carries nothing out of a re-started cycle that %s settled", (_kind, settling) => {
    expect(inheritedQuestion({ events: [STARTED, QUESTION, settling, STARTED] })).toBe(undefined);
  });

  it("stops carrying once a later cycle finishes, so an older orphan never resurfaces", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      QUESTION,
      ORPHANED,
      STARTED,
      { atIso: AT, kind: "finished", residue: [] },
      STARTED,
    ];

    expect(inheritedQuestion({ events })).toBe(undefined);
  });
});

describe("isSettled", () => {
  it("refuses to call an open run settled", () => {
    expect(isSettled({ state: runStateOf({ events: [STARTED] }) })).toBe(false);
  });

  /** The escape hatch: writing the question down is itself a legitimate ending. */
  it("treats a recorded question as settled", () => {
    const state = runStateOf({ events: [STARTED, { atIso: AT, kind: "question", question: "q" }] });

    expect(isSettled({ state })).toBe(true);
  });

  it("treats a finished run as settled", () => {
    const state = runStateOf({ events: [STARTED, { atIso: AT, kind: "finished", residue: [] }] });

    expect(isSettled({ state })).toBe(true);
  });

  it("treats a doc that was never run as settled, so a gate is inert by default", () => {
    expect(isSettled({ state: NO_RUN })).toBe(true);
  });
});

describe("the supervisor-written events — the first two written by someone OTHER than the session doing the work", () => {
  it("decodes a dispatch, carrying who sent it and where", () => {
    const line = JSON.stringify({
      atIso: "2026-08-21T10:00:00.000Z",
      by: "supervisor-one",
      kind: "dispatched",
      target: "ws-7",
    });

    const parsed = parseLedger({ text: line });

    expect(parsed.events).toEqual([
      { atIso: "2026-08-21T10:00:00.000Z", by: "supervisor-one", kind: "dispatched", target: "ws-7" },
    ]);
  });

  it("decodes a dispatch with no target, since a workspace name is context rather than the load-bearing fact", () => {
    const line = JSON.stringify({ atIso: "2026-08-21T10:00:00.000Z", by: "s", kind: "dispatched" });

    const parsed = parseLedger({ text: line });

    expect(parsed.events).toEqual([
      { atIso: "2026-08-21T10:00:00.000Z", by: "s", kind: "dispatched", target: undefined },
    ]);
  });

  it("decodes a sign-off with its note", () => {
    const line = JSON.stringify({
      atIso: "2026-08-21T11:00:00.000Z",
      by: "supervisor-one",
      kind: "signed-off",
      note: "probes re-run against the merge",
    });

    const parsed = parseLedger({ text: line });

    expect(parsed.events).toEqual([
      {
        atIso: "2026-08-21T11:00:00.000Z",
        by: "supervisor-one",
        kind: "signed-off",
        note: "probes re-run against the merge",
      },
    ]);
  });

  it("moves NO phase — a supervisor must not be able to open or close a run from outside it", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-08-21T09:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: "2026-08-21T10:00:00.000Z", by: "sup", kind: "dispatched", target: undefined },
      { atIso: "2026-08-21T11:00:00.000Z", by: "sup", kind: "signed-off", note: "looks done" },
    ];

    expect(runStateOf({ events }).phase).toBe("open");
  });
});

describe("runStateOf — the posted handle a correction replies under", () => {
  const ASKED: RunEvent = { atIso: AT, kind: "question", question: "10 of 12 — ship it?" };
  const POSTED: RunEvent = {
    atIso: AT,
    channel: "D1",
    kind: "question-posted",
    question: "10 of 12 — ship it?",
    ts: "1700000000.000100",
  };

  it("carries the handle once the question's post is journalled", () => {
    expect(runStateOf({ events: [STARTED, ASKED, POSTED] }).openQuestionPost).toEqual({
      channel: "D1",
      ts: "1700000000.000100",
    });
  });

  it("carries the post's permalink with the handle, so a card can link the question", () => {
    const linked: RunEvent = { ...POSTED, permalink: "https://acme.slack.com/archives/D1/p1700000000000100" };
    expect(runStateOf({ events: [STARTED, ASKED, linked] }).openQuestionPost).toEqual({
      channel: "D1",
      permalink: "https://acme.slack.com/archives/D1/p1700000000000100",
      ts: "1700000000.000100",
    });
  });

  it("ignores a handle journalled while no question is open, so it can never point at a closed thread", () => {
    expect(runStateOf({ events: [STARTED, POSTED] }).openQuestionPost).toBeUndefined();
  });

  it("replaces the question's text on a correction, keeping the phase and the handle", () => {
    const state = runStateOf({
      events: [
        STARTED,
        ASKED,
        POSTED,
        { atIso: AT, kind: "question-corrected", question: "9/8/9/10 of 12 — ship it?", why: "one run quoted" },
      ],
    });

    expect(state.phase).toBe("waiting-on-owner");
    expect(state.openQuestion).toBe("9/8/9/10 of 12 — ship it?");
    expect(state.openQuestionPost).toEqual({ channel: "D1", ts: "1700000000.000100" });
  });

  it("ignores a correction when no question is open, rather than inventing one", () => {
    const state = runStateOf({
      events: [STARTED, { atIso: AT, kind: "question-corrected", question: "stray", why: "no" }],
    });

    expect(state.phase).toBe("open");
    expect(state.openQuestion).toBeUndefined();
  });

  it("clears the handle on every edge that clears the question", () => {
    const endings: readonly RunEvent[] = [
      { answer: "yes", atIso: AT, kind: "answered" },
      { atIso: AT, kind: "finished", residue: [] },
      { atIso: AT, kind: "closed", residue: [], summary: "done" },
      { atIso: AT, kind: "abandoned", why: "superseded" },
      { atIso: AT, cycleEvents: 3, deadSessionId: "s", kind: "orphaned", lastEventIso: AT },
    ];

    expect(endings.length).toBe(5);
    expect(endings.map((ending) => runStateOf({ events: [STARTED, ASKED, POSTED, ending] }).openQuestionPost)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("clears the handle when a fresh question is asked after an answer, so a correction cannot reach the old thread", () => {
    const state = runStateOf({
      events: [
        STARTED,
        ASKED,
        POSTED,
        { answer: "yes", atIso: AT, kind: "answered" },
        { atIso: AT, kind: "question", question: "next?" },
      ],
    });

    expect(state.openQuestion).toBe("next?");
    expect(state.openQuestionPost).toBeUndefined();
  });

  it("refuses a handle that lands late, after an answer and a NEW question, so it cannot bind to the wrong one", () => {
    const state = runStateOf({
      events: [
        STARTED,
        ASKED,
        { answer: "yes", atIso: AT, kind: "answered" },
        { atIso: AT, kind: "question", question: "next?" },
        POSTED,
      ],
    });

    expect(state.openQuestion).toBe("next?");
    expect(state.openQuestionPost).toBeUndefined();
  });
});
