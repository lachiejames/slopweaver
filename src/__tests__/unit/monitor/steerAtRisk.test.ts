/**
 * `steer-at-risk` turns the judge's verdicts into notes: one subject per at-risk row, keyed on the row and the
 * reason's identity, held when the owner closed it or was already shown that same risk. Verdicts come from the real judge over
 * a journal the real decoder read, shaped like a real parked row's.
 */
import { describe, expect, it } from "vitest";

import { UNBLOCKS_CAP } from "../../../hand/step.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { parseLedger } from "../../../handover/ledger.js";
import { judgeSteerRisk, type SteerRiskVerdict } from "../../../handover/steerRisk.js";
import { unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import { subjectKey } from "../../../monitor/evaluate.js";
import {
  evaluateSteerAtRisk,
  STEER_AT_RISK,
  steerAtRiskSubject,
  steerRiskReasonOf,
} from "../../../monitor/steerAtRisk.js";

const SESSION = "a0000006-0000-4000-8000-000000000007";
const PARKED_AT = "2026-10-22T04:01:11.997Z";

const DOC = parseHandoverDoc({
  path: "/board/a-row.md",
  text: ["---", "slug: a-row", "summary: a row", "status: ready", "---", "", "# a row", ""].join("\n"),
});

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

const STEER = {
  anchor: "talk-call:00000000#turn",
  atIso: "2026-10-22T03:51:00.000Z",
  explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z" },
  kind: "ruling",
  ruling: "overriding the previous guidance: just do it raw",
};

const PARKED = {
  atIso: PARKED_AT,
  branch: "a-row",
  kind: "parked",
  screenTail: "",
  sessionId: SESSION,
  wake: { atIso: "2026-10-22T04:50:00Z", kind: "at" },
  workspaceRef: "workspace:1",
  worktree: "/tmp/a-row",
};

/** Judge a journal of lines with the real decoder and judge. */
function verdictOf({
  doc = DOC,
  lines,
}: {
  doc?: HandoverDoc;
  lines: readonly Record<string, unknown>[];
}): SteerRiskVerdict {
  const parsed = parseLedger({ text: lines.map((line) => JSON.stringify(line)).join("\n") });
  expect(parsed.unreadable).toEqual([]);
  return judgeSteerRisk({ doc, events: parsed.events, nowIso: "2026-10-22T04:01:12.000Z" });
}

/** The at-risk verdict, or a thrown failure naming what the judge said instead. */
function atRisk({ verdict }: { verdict: SteerRiskVerdict }): Extract<SteerRiskVerdict, { kind: "at-risk" }> {
  if (verdict.kind !== "at-risk") {
    throw new Error(`expected an at-risk verdict, got ${verdict.kind}`);
  }
  return verdict;
}

const PARKED_VERDICT = verdictOf({ lines: [...OPENED, STEER, PARKED] });
const ON_TRACK = verdictOf({ lines: [...OPENED, STEER] });
const PARKED_KEY = subjectKey({ name: `a-row parked ${PARKED_AT}` });
const NOTHING = new Set<string>();
const ADDRESS = { consoleBase: "http://localhost:3000", occurrence: 1 };

describe("steerAtRiskSubject", () => {
  it("carries the owner's words, their time, the reason and the anchor, keyed on the row and the reason", () => {
    const subject = steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: PARKED_VERDICT }) });

    expect(subject).toEqual({
      details: [
        "Your steer, word for word: overriding the previous guidance: just do it raw",
        "You wanted it by 2026-10-22T05:00:00.000Z",
        `At risk since ${PARKED_AT}: its seat closed until 2026-10-22T04:50:00Z, so nobody is working it`,
        "Row a-row, anchored at talk-call:00000000#turn",
      ],
      id: "a-row",
      key: PARKED_KEY,
      label: "its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
    });
  });

  it("names every other reason standing beside the one that leads", () => {
    const verdict = atRisk({
      verdict: verdictOf({
        lines: [
          ...OPENED,
          STEER,
          PARKED,
          { atIso: "2026-10-22T04:02:00.000Z", kind: "steer-risk", standing: "at-risk", why: "no verb" },
        ],
      }),
    });

    expect(steerAtRiskSubject({ slug: "a-row", verdict }).details).toEqual([
      "Your steer, word for word: overriding the previous guidance: just do it raw",
      "You wanted it by 2026-10-22T05:00:00.000Z",
      "At risk since 2026-10-22T04:02:00.000Z: the seat named a risk: no verb",
      `Also standing since ${PARKED_AT}: its seat closed until 2026-10-22T04:50:00Z, so nobody is working it`,
      "Row a-row, anchored at talk-call:00000000#turn",
    ]);
  });
});

describe("evaluateSteerAtRisk", () => {
  it("fires one subject per at-risk row and skips a row on track", () => {
    const reading = evaluateSteerAtRisk({
      dismissed: NOTHING,
      rows: [
        { slug: "a-row", verdict: PARKED_VERDICT },
        { slug: "b-row", verdict: ON_TRACK },
      ],
      shown: NOTHING,
    });

    expect(reading).toEqual({
      monitorId: "steer-at-risk",
      state: "firing",
      subjects: [steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: PARKED_VERDICT }) })],
    });
  });

  it("is clear when no steered row is at risk, and over no rows at all", () => {
    expect(
      evaluateSteerAtRisk({ dismissed: NOTHING, rows: [{ slug: "b-row", verdict: ON_TRACK }], shown: NOTHING }),
    ).toEqual({ monitorId: "steer-at-risk", state: "clear" });
    expect(evaluateSteerAtRisk({ dismissed: NOTHING, rows: [], shown: NOTHING })).toEqual({
      monitorId: "steer-at-risk",
      state: "clear",
    });
  });

  it("holds a note the owner closed, and one already shown, while the same risk stands", () => {
    const rows = [{ slug: "a-row", verdict: PARKED_VERDICT }];
    const closed = evaluateSteerAtRisk({ dismissed: new Set([PARKED_KEY]), rows, shown: NOTHING });
    const shown = evaluateSteerAtRisk({ dismissed: NOTHING, rows, shown: new Set([PARKED_KEY]) });

    expect(closed).toEqual({
      monitorId: "steer-at-risk",
      state: "firing",
      subjects: [
        {
          ...steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: PARKED_VERDICT }) }),
          delivery: { kind: "hold", why: "you closed this note, and the same risk still stands" },
        },
      ],
    });
    expect(shown).toEqual({
      monitorId: "steer-at-risk",
      state: "firing",
      subjects: [
        {
          ...steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: PARKED_VERDICT }) }),
          delivery: { kind: "hold", why: "this note was already shown for the same risk" },
        },
      ],
    });
  });

  it("re-cuts a closed note when the reason changes, because the key carries the reason's identity", () => {
    const reparked = {
      ...PARKED,
      atIso: "2026-10-22T04:56:33.215Z",
      wake: { atIso: "2026-10-22T05:30:00Z", kind: "at" },
    };
    const verdict = verdictOf({
      lines: [
        ...OPENED,
        STEER,
        PARKED,
        {
          atIso: "2026-10-22T04:46:33.000Z",
          host: "claude-code",
          kind: "claimed",
          pid: 2,
          sessionId: SESSION,
          why: "reseat",
          worktree: "/tmp/a-row",
        },
        reparked,
      ],
    });
    const reading = evaluateSteerAtRisk({
      dismissed: new Set([PARKED_KEY]),
      rows: [{ slug: "a-row", verdict }],
      shown: NOTHING,
    });

    expect(reading).toEqual({
      monitorId: "steer-at-risk",
      state: "firing",
      subjects: [steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict }) })],
    });
    expect(steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict }) }).key).not.toBe(PARKED_KEY);
  });
});

describe("STEER_AT_RISK", () => {
  it("is a floating notice at the ordinary level that stops no work", () => {
    expect([STEER_AT_RISK.floats, STEER_AT_RISK.noteLevel, STEER_AT_RISK.perSubject, STEER_AT_RISK.stopsWork]).toEqual([
      true,
      undefined,
      true,
      undefined,
    ]);
  });

  it("names the row in the note and says nothing waits on the owner when nothing does", () => {
    const subject = steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: PARKED_VERDICT }) });
    const step = unwrap(
      buildArrival({
        address: ADDRESS,
        definition: STEER_AT_RISK,
        nowIso: PARKED_AT,
        postedBy: "handover park",
        subject,
      }),
    );

    expect(STEER_AT_RISK.what({ subject })).toBe("Your steered a-row is at risk");
    expect(STEER_AT_RISK.unblocks({ subject })).toBe(
      "nothing waits on you — its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
    );
    expect(step.unaddressed).toBe("nothing waits on you — steer it another way, or take it yourself, if you want");
    expect(steerRiskReasonOf({ unblocks: step.unblocks })).toBe(
      "its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
    );
  });
});

// A note must never read "nothing waits on you — it is stopped on a question to you", nor say nothing waits on the
// owner while a seat sits parked on the owner's pick. A question that is the owner's says so.
describe("a steered row stopped on the owner's question", () => {
  const ASKED_AT = "2026-10-22T04:10:00.000Z";
  const QUESTION =
    "acme-admin#19364 needs one approver in both team-a and team-b: A name one, B withhold the line, C skip it?";
  const asked = ({ question }: { question: string }): SteerRiskVerdict =>
    verdictOf({ lines: [...OPENED, STEER, { atIso: ASKED_AT, kind: "question", question }] });

  it("opens 'waiting on you' with the question and names the Queue, on the note and its no-link line", () => {
    const subject = steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: asked({ question: QUESTION }) }) });
    const step = unwrap(
      buildArrival({
        address: ADDRESS,
        definition: STEER_AT_RISK,
        nowIso: ASKED_AT,
        postedBy: "handover ask",
        subject,
      }),
    );

    expect([subject.key, subject.steerQuestion, subject.label]).toEqual([
      subjectKey({ name: `a-row asked ${ASKED_AT}` }),
      QUESTION,
      `it is stopped on a question to you: ${QUESTION}`,
    ]);
    expect(step.unblocks).toBe(`waiting on you: ${QUESTION} — answer it on your Queue`);
    expect([step.notice, step.url, step.unaddressed]).toEqual([
      true,
      undefined,
      "waiting on you — answer the question on your Queue",
    ]);
    expect(steerRiskReasonOf({ unblocks: step.unblocks })).toBe(
      `waiting on you: ${QUESTION} — answer it on your Queue`,
    );
  });

  it("cuts a long question rather than the Queue clause, inside the cap", () => {
    const long = Array.from({ length: 40 }, () => "seven7").join(" ");
    const subject = steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: asked({ question: long }) }) });
    const unblocks = STEER_AT_RISK.unblocks({ subject });

    expect(unblocks).toBe(
      `waiting on you: ${Array.from({ length: 22 }, () => "seven7").join(" ")} — answer it on your Queue`,
    );
    expect(unblocks.length).toBeLessThanOrEqual(UNBLOCKS_CAP);
  });

  // A risk the seat named outranks the question, and the note must not read "nothing waits on you".
  it("opens on the owner's question when a named risk leads, keyed so asking it re-cuts the note", () => {
    const named = { atIso: "2026-10-22T04:02:00.000Z", kind: "steer-risk", standing: "at-risk", why: "no verb" };
    const both = atRisk({
      verdict: verdictOf({
        lines: [...OPENED, STEER, named, { atIso: ASKED_AT, kind: "question", question: QUESTION }],
      }),
    });
    const namedOnly = atRisk({ verdict: verdictOf({ lines: [...OPENED, STEER, named] }) });
    const subject = steerAtRiskSubject({ slug: "a-row", verdict: both });

    expect([both.reason.kind, subject.label, subject.key, subject.unaddressed]).toEqual([
      "named",
      "the seat named a risk: no verb",
      subjectKey({ name: `a-row named 2026-10-22T04:02:00.000Z asked ${ASKED_AT}` }),
      "waiting on you — answer the question on your Queue",
    ]);
    expect(STEER_AT_RISK.unblocks({ subject })).toBe(`waiting on you: ${QUESTION} — answer it on your Queue`);
    expect(steerAtRiskSubject({ slug: "a-row", verdict: namedOnly }).key).toBe(
      subjectKey({ name: "a-row named 2026-10-22T04:02:00.000Z" }),
    );
  });

  // The note's id is cut from its key, so a key that does not change leaves the old note up with its old words —
  // "waiting on you" over a question the owner answered, or an older note saying nothing waited on the owner.
  it("re-keys when a later ruling answers the owner's question, and never reuses the earlier key", () => {
    const open = steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: asked({ question: QUESTION }) }) });
    // The owner's second explicit steer, after the question, answers it while standing as the steer itself.
    const again = { ...STEER, atIso: "2026-10-22T04:20:00.000Z" };
    const lines = [...OPENED, STEER, { atIso: ASKED_AT, kind: "question", question: QUESTION }, again];
    const answered = steerAtRiskSubject({ slug: "a-row", verdict: atRisk({ verdict: verdictOf({ lines }) }) });
    const before = subjectKey({ name: `a-row waiting ${ASKED_AT}` });

    expect([open.key, answered.key, answered.unaddressed]).toEqual([
      subjectKey({ name: `a-row asked ${ASKED_AT}` }),
      subjectKey({ name: `a-row unasked ${ASKED_AT}` }),
      undefined,
    ]);
    expect(open.key).not.toBe(before);
    expect(answered.key).not.toBe(before);
  });

  // A paused question behind a named risk dropped out of the key, which then equalled main's key for the
  // same row while the question was open — so a note cut by main could hold the paused one down.
  it("keys a paused question behind a named risk, never as the named risk alone", () => {
    const named = { atIso: "2026-10-22T04:02:00.000Z", kind: "steer-risk", standing: "at-risk", why: "no verb" };
    const paused = parseHandoverDoc({
      path: "/board/a-row.md",
      text: ["---", "slug: a-row", "summary: a row", "status: paused", "---", "", "# a row", ""].join("\n"),
    });
    const lines = [...OPENED, STEER, named, { atIso: ASKED_AT, kind: "question", question: QUESTION }];
    const subject = steerAtRiskSubject({
      slug: "a-row",
      verdict: atRisk({ verdict: verdictOf({ doc: paused, lines }) }),
    });

    expect([subject.key, subject.unaddressed]).toEqual([
      subjectKey({ name: `a-row named 2026-10-22T04:02:00.000Z unasked ${ASKED_AT}` }),
      undefined,
    ]);
  });
});
