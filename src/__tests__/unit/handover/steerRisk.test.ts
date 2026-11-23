/**
 * The steer-risk judge, over journals shaped like the one it was built for: a steered row
 * whose seat parked on a clock 59 minutes before the owner's deadline. Every journal here goes through the
 * real decoder, so a field the decoder drops is a test that fails rather than one that passes on a hand-built event.
 */
import { describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { parseLedger } from "../../../handover/ledger.js";
import { judgeSteerRisk, steerRiskSentence } from "../../../handover/steerRisk.js";

const SESSION = "a0000006-0000-4000-8000-000000000007";
const RESEAT = "a0000008-0000-4000-8000-000000000009";
const DUE = "2026-10-22T05:00:00.000Z";

/** One row, built from real front-matter so the parser decides every field. */
function row({ lines = [] }: { lines?: readonly string[] } = {}): HandoverDoc {
  return parseHandoverDoc({
    path: "/board/a-row.md",
    text: ["---", "slug: a-row", "summary: a row", "status: ready", ...lines, "---", "", "# a row", ""].join("\n"),
  });
}

/** The journal lines of a steered row, opened and seated. */
const OPENED = [
  { atIso: "2026-10-22T03:50:39.735Z", branch: "a-row", docHash: "6cebb758c21ec1c2", kind: "started" },
  {
    atIso: "2026-10-22T03:50:39.735Z",
    host: "claude-code",
    kind: "launched",
    pid: 1,
    sessionId: SESSION,
    worktree: "/tmp/a-row",
  },
];

/** The owner's explicit steer, recorded live by the chair. */
function steer({ deliverByIso }: { deliverByIso?: string } = {}): Record<string, unknown> {
  return {
    anchor: "talk-call:00000000#turn",
    atIso: "2026-10-22T03:51:00.000Z",
    explicitSteer: deliverByIso === undefined ? {} : { deliverByIso },
    kind: "ruling",
    ruling: "overriding the previous guidance: just do it raw, build the integration later",
  };
}

/** The seat closing on a clock, as `handover park --wake-at` writes it. */
const PARKED_ON_A_CLOCK = {
  atIso: "2026-10-22T04:01:11.997Z",
  branch: "a-row",
  kind: "parked",
  screenTail: "",
  sessionId: SESSION,
  wake: { atIso: "2026-10-22T04:50:00Z", kind: "at" },
  workspaceRef: "workspace:1",
  worktree: "/tmp/a-row",
};

/** Decode a journal written as lines, exactly as the shared home holds it. */
function journal({ lines }: { lines: readonly Record<string, unknown>[] }): ReturnType<typeof parseLedger> {
  return parseLedger({ text: lines.map((line) => JSON.stringify(line)).join("\n") });
}

/** Judge a journal of lines at one instant. */
function judge({
  doc = row(),
  lines,
  nowIso = "2026-10-22T04:01:12.000Z",
}: {
  doc?: HandoverDoc;
  lines: readonly Record<string, unknown>[];
  nowIso?: string;
}): ReturnType<typeof judgeSteerRisk> {
  const parsed = journal({ lines });
  expect(parsed.unreadable).toEqual([]);
  return judgeSteerRisk({ doc, events: parsed.events, nowIso });
}

/** The at-risk verdict, or a thrown failure naming what the judge said instead — `unwrap`'s shape, for a verdict. */
function atRisk({
  verdict,
}: {
  verdict: ReturnType<typeof judgeSteerRisk>;
}): Extract<ReturnType<typeof judgeSteerRisk>, { kind: "at-risk" }> {
  if (verdict.kind !== "at-risk") {
    throw new Error(`expected an at-risk verdict, got ${verdict.kind}`);
  }
  return verdict;
}

describe("judgeSteerRisk — the clock-park hold", () => {
  it("reads the clock-park on a steered row as at risk the moment it lands, 59 minutes before the owner's time", () => {
    const verdict = judge({ lines: [...OPENED, steer({ deliverByIso: DUE }), PARKED_ON_A_CLOCK] });

    const judged = atRisk({ verdict });
    expect(judged.reason).toEqual({
      identity: "parked 2026-10-22T04:01:11.997Z",
      kind: "parked",
      sinceIso: "2026-10-22T04:01:11.997Z",
      wakeAtIso: "2026-10-22T04:50:00Z",
    });
    expect(judged.alsoStanding).toEqual([]);
    expect(judged.steer.explicitSteer.deliverByIso).toBe(DUE);
  });

  it("says nothing of the same park on a row the owner never explicitly steered", () => {
    expect(judge({ lines: [...OPENED, PARKED_ON_A_CLOCK] })).toEqual({ kind: "unsteered" });
  });

  it("reads the row on track once a seat is open on it again, and at risk again on the second clock-park", () => {
    const reseated = {
      atIso: "2026-10-22T04:46:33.620Z",
      host: "claude-code",
      kind: "claimed",
      pid: 2,
      sessionId: RESEAT,
      why: "reseating a parked run",
      worktree: "/tmp/a-row",
    };
    const lines = [...OPENED, steer({ deliverByIso: DUE }), PARKED_ON_A_CLOCK, reseated];
    expect(judge({ lines, nowIso: "2026-10-22T04:47:00.000Z" }).kind).toBe("on-track");

    const second = {
      ...PARKED_ON_A_CLOCK,
      atIso: "2026-10-22T04:56:33.215Z",
      sessionId: RESEAT,
      wake: { atIso: "2026-10-22T05:30:00Z", kind: "at" },
    };
    const verdict = judge({ lines: [...lines, second], nowIso: "2026-10-22T04:56:34.000Z" });
    expect(atRisk({ verdict }).reason.identity).toBe("parked 2026-10-22T04:56:33.215Z");
  });
});

describe("judgeSteerRisk — every reason, and its precedence", () => {
  it("reads a park on CI as work in motion, not a risk", () => {
    const onChecks = { ...PARKED_ON_A_CLOCK, wake: { kind: "checks", number: 7, repo: "o/r" } };
    expect(judge({ lines: [...OPENED, steer(), onChecks] }).kind).toBe("on-track");
  });

  it("puts a risk the seat named ahead of every other reason, and a clear takes only the named one away", () => {
    const named = { atIso: "2026-10-22T04:00:00.000Z", kind: "steer-risk", standing: "at-risk", why: "no raw door" };
    const verdict = judge({ lines: [...OPENED, steer(), named, PARKED_ON_A_CLOCK] });
    const judged = atRisk({ verdict });
    expect([judged.reason.kind, ...judged.alsoStanding.map((reason) => reason.kind)]).toEqual(["named", "parked"]);

    const cleared = { atIso: "2026-10-22T04:00:30.000Z", kind: "steer-risk", standing: "cleared", why: "went raw" };
    const after = judge({ lines: [...OPENED, steer(), named, cleared] });
    expect(after.kind).toBe("on-track");
  });

  it("ignores a risk named before the standing steer was given", () => {
    const named = { atIso: "2026-10-22T03:50:50.000Z", kind: "steer-risk", standing: "at-risk", why: "old" };
    expect(judge({ lines: [...OPENED, named, steer()] }).kind).toBe("on-track");
  });

  it("reads a question to the owner as at risk, naming the question", () => {
    const asked = { atIso: "2026-10-22T04:10:00.000Z", kind: "question", question: "may I post it raw?" };
    const verdict = judge({ lines: [...OPENED, steer(), asked] });
    expect(atRisk({ verdict }).reason).toEqual({
      identity: "asked 2026-10-22T04:10:00.000Z",
      kind: "waiting-on-owner",
      question: "may I post it raw?",
      sinceIso: "2026-10-22T04:10:00.000Z",
    });
  });

  // The Queue draws the owner's ask card off `ownerWaitOf` alone, so a question that is not the owner's there is never "waiting on you"
  // on the note: the seat is stopped all the same, so it reads as a park, under an identity of its own so the note
  // it was re-cuts.
  it("reads a question the owner's later steer already answered as a park, not a wait on them", () => {
    const asked = { atIso: "2026-10-22T03:50:50.000Z", kind: "question", question: "may I post it raw?" };
    const verdict = judge({ lines: [...OPENED, asked, steer()] });
    expect([atRisk({ verdict }).reason, atRisk({ verdict }).alsoStanding]).toEqual([
      { identity: "unasked 2026-10-22T03:50:50.000Z", kind: "parked", sinceIso: "2026-10-22T03:50:50.000Z" },
      [],
    ]);
    expect(steerRiskSentence({ reason: atRisk({ verdict }).reason })).toBe("its seat closed and nobody is working it");
  });

  it("reads a question on a paused row as a park, since the Queue lists no ask for a row that is not runnable", () => {
    const asked = { atIso: "2026-10-22T04:10:00.000Z", kind: "question", question: "may I post it raw?" };
    const paused = parseHandoverDoc({
      path: "/board/a-row.md",
      text: ["---", "slug: a-row", "summary: a row", "status: paused", "---", "", "# a row", ""].join("\n"),
    });
    const verdict = judge({ doc: paused, lines: [...OPENED, steer(), asked] });
    expect(atRisk({ verdict }).reason).toEqual({
      identity: "unasked 2026-10-22T04:10:00.000Z",
      kind: "parked",
      sinceIso: "2026-10-22T04:10:00.000Z",
    });
  });

  // a registered ask with no run is the owner's on the Queue (`registeredAskOf`), and the judge read only a run's
  // question, so the note said nothing waited on the owner over a card asking them.
  it("reads a whole-shaped registered ask with no run as waiting on the owner, and their later steer as its answer", () => {
    const ask = {
      ...row({ lines: ["kind: ask", "askedIso: 2026-10-22T04:10:00.000Z"] }),
      lean: "A",
      options: [
        { letter: "A", option: "post it raw", tradeoff: "no integration yet" },
        { letter: "B", option: "wait", tradeoff: "misses the time" },
      ],
      problem: "the integration is not built",
    };
    const verdict = judge({ doc: ask, lines: [steer()] });
    expect(atRisk({ verdict }).reason).toEqual({
      identity: "asked 2026-10-22T04:10:00.000Z",
      kind: "waiting-on-owner",
      question: "a row",
      sinceIso: "2026-10-22T04:10:00.000Z",
    });
    const answered = { ...steer(), atIso: "2026-10-22T04:20:00.000Z" };
    expect(judge({ doc: ask, lines: [steer(), answered] }).kind).toBe("on-track");
  });

  // the board puts a registered ask with a `blockedBy` standing in NOT YET, so the Queue draws no card.
  it("does not read a registered ask declaring a blocker as waiting on the owner", () => {
    const blocked = {
      ...row({ lines: ["kind: ask", "askedIso: 2026-10-22T04:10:00.000Z", "blockedBy: [unfinished]"] }),
      lean: "A",
      options: [
        { letter: "A", option: "post it raw", tradeoff: "no integration yet" },
        { letter: "B", option: "wait", tradeoff: "misses the time" },
      ],
      problem: "the integration is not built",
    };
    expect(blocked.blockedBy.length).toBe(1);
    expect(judge({ doc: blocked, lines: [steer()] }).kind).toBe("on-track");
  });

  it("reads a seat giving the cycle up as at risk rather than ended", () => {
    const gaveUp = { atIso: "2026-10-22T04:10:00.000Z", kind: "abandoned", why: "no verb for documents" };
    const verdict = judge({ lines: [...OPENED, steer(), gaveUp] });
    expect(steerRiskSentence({ reason: atRisk({ verdict }).reason })).toBe(
      "the seat gave it up: no verb for documents",
    );
  });

  it("reads the owner's time passing as at risk at the exact instant, and not a millisecond before", () => {
    const lines = [...OPENED, steer({ deliverByIso: DUE })];
    expect(judge({ lines, nowIso: "2026-10-22T04:59:59.999Z" }).kind).toBe("on-track");
    const verdict = judge({ lines, nowIso: DUE });
    expect(atRisk({ verdict }).reason.identity).toBe(`overdue ${DUE}`);
  });

  it("stops watching once the run finishes or the row ships", () => {
    const finished = { atIso: "2026-10-22T05:05:41.093Z", kind: "finished", residue: [] };
    const late = "2026-10-22T06:00:00.000Z";
    expect(judge({ lines: [...OPENED, steer({ deliverByIso: DUE }), finished], nowIso: late }).kind).toBe("ended");
    const closed = { atIso: "2026-10-22T05:05:57.077Z", kind: "closed", residue: [], summary: "shipped" };
    expect(judge({ lines: [...OPENED, steer({ deliverByIso: DUE }), closed], nowIso: late }).kind).toBe("ended");
  });

  it("lets a later ordinary ruling replace the steer", () => {
    const ordinary = {
      anchor: "talk-call:00000000#later",
      atIso: "2026-10-22T04:00:00.000Z",
      kind: "ruling",
      ruling: "fine, wait for the verb",
    };
    expect(judge({ lines: [...OPENED, steer(), ordinary, PARKED_ON_A_CLOCK] })).toEqual({ kind: "unsteered" });
  });

  // A reconstruction is an answer the owner really gave, so one decided after the steer is their newer word.
  it("lets a reconstructed ruling the owner decided after the steer replace it too", () => {
    const answeredLater = "2026-10-22T04:00:30.000Z";
    const backfilled = {
      anchor: "talk-call:00000000#answer",
      atIso: "2026-10-25T00:00:00.000Z",
      backfilledFrom: answeredLater,
      decidedIso: answeredLater,
      kind: "ruling",
      ruling: "fine, wait for the verb",
    };
    expect(judge({ lines: [...OPENED, steer(), backfilled, PARKED_ON_A_CLOCK] })).toEqual({ kind: "unsteered" });
  });

  // The decoder refuses this line, so the events are built in memory: the reader holds the invariant itself.
  it("never reads a reconstruction carrying a steer as one, even handed past the decoder", () => {
    const events = journal({ lines: [...OPENED, PARKED_ON_A_CLOCK] }).events;
    const reconstructed = {
      anchor: "talk-call:00000000#answer",
      atIso: "2026-10-22T03:51:00.000Z",
      backfilledFrom: "2026-10-22T03:40:00.000Z",
      decidedIso: "2026-10-22T03:40:00.000Z",
      explicitSteer: {},
      kind: "ruling",
      ruling: "overriding the previous guidance",
    } as const;
    const verdict = judgeSteerRisk({
      doc: row(),
      events: [reconstructed, ...events],
      nowIso: "2026-10-22T04:01:12.000Z",
    });
    expect(verdict).toEqual({ kind: "unsteered" });
  });
});
