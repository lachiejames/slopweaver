import { describe, expect, it } from "vitest";

import { E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import {
  liveLeaseIdsOf,
  malformedLeaseCount,
  openedPlanCalls,
  parseDesktopEventLog,
  parsePlanCallLog,
  settledLines,
  unendedPlanCalls,
} from "../../../desktop/e2eCallEvidence.js";
import {
  addOnce,
  offerCallIdOf,
  rowsOf,
  sameRows,
  transcriptCallIdOf,
  turnAndAnswer,
} from "../../../desktop/e2eCallRows.js";
import { ON_CALL_RULING } from "../../../desktop/onCallHold.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const GONE = JSON.stringify({
  atIso: "2026-10-25T19:00:00.000Z",
  call: { planCallId: "plan-1", transcriptCallId: "tx-1" },
  exitCode: 133,
  kind: "renderer-gone",
  reason: "killed",
  reconnect: true,
  window: "overlay",
});
const TAKEN = JSON.stringify({
  ageMs: 1200,
  atIso: "2026-10-25T19:00:02.000Z",
  kind: "recovery-taken",
  transcriptCallId: "tx-1",
});

describe("settledLines", () => {
  it("keeps an unterminated tail out of the lines", () => {
    expect(settledLines({ text: "a\nb\npartial" })).toEqual({ lines: ["a", "b"], tail: "partial" });
    expect(settledLines({ text: "no newline yet" })).toEqual({ lines: [], tail: "no newline yet" });
  });
});

describe("parseDesktopEventLog", () => {
  it("reads both kinds of entry, skipping blank lines and leaving a half-written one", () => {
    const events = unwrap(parseDesktopEventLog({ text: `${GONE}\n\n${TAKEN}\n{"atIso":` }));
    expect(events.map((event) => event.kind)).toEqual(["renderer-gone", "recovery-taken"]);
  });

  it("reads the owner's own app's console outages and a restart's decisions, which share the file", () => {
    const outage = JSON.stringify({
      atIso: "2026-11-01T07:51:49.138Z",
      downMs: 182,
      kind: "console-outage",
      outcome: "held",
      problem: "the console is not serving",
    });
    const resumed = JSON.stringify({
      atIso: "2026-11-01T05:32:40.000Z",
      decision: "retry-overlay-not-listening",
      instance: "own",
      kind: "update-resume",
      sinceIso: "2026-11-01T05:32:32.000Z",
    });
    const events = unwrap(parseDesktopEventLog({ text: `${outage}\n${resumed}\n` }));
    expect(events).toEqual([JSON.parse(outage), JSON.parse(resumed)]);
  });

  it("fails a restart line carrying a decision the shell never writes, or naming no instance", () => {
    const base = { atIso: "2026-11-01T05:32:40.000Z", kind: "update-resume", sinceIso: "2026-11-01T05:32:32.000Z" };
    const badDecision = JSON.stringify({ ...base, decision: "maybe", instance: "e2e" });
    const noInstance = JSON.stringify({ ...base, decision: "handed" });
    expect(unwrapErr(parseDesktopEventLog({ text: `${badDecision}\n` })).code).toBe("MALFORMED_LINE");
    expect(unwrapErr(parseDesktopEventLog({ text: `${noInstance}\n` })).code).toBe("MALFORMED_LINE");
  });

  it("fails a complete line that is not an entry, naming it", () => {
    const error = unwrapErr(parseDesktopEventLog({ text: `${GONE}\n{"kind":"other"}\n` }));
    expect([error.code, error.lineIndex]).toEqual(["MALFORMED_LINE", 1]);
    expect(error.message).toBe('desktop-events.jsonl line 2 is not one it writes: {"kind":"other"}');
  });
});

describe("parsePlanCallLog", () => {
  const LOG =
    "▲ Next.js ready\n" +
    "2026-10-25T19:00:00.000Z talk plan call plan-1 opened: open\n" +
    "GET /voice 200\n" +
    "2026-10-25T19:01:00.000Z talk plan call plan-1 ended after 60s: the voice window's renderer was killed (killed, exit 133)\n" +
    "2026-10-25T19:01:01.000Z talk plan call plan-2 opened: open\n";

  it("reads the plan lines among the server's others, numbered in order", () => {
    expect(unwrap(parsePlanCallLog({ text: LOG }))).toEqual([
      { atIso: "2026-10-25T19:00:00.000Z", callId: "plan-1", kind: "opened", lineIndex: 0, reason: "open" },
      {
        atIso: "2026-10-25T19:01:00.000Z",
        callId: "plan-1",
        kind: "ended",
        lineIndex: 1,
        reason: "the voice window's renderer was killed (killed, exit 133)",
      },
      { atIso: "2026-10-25T19:01:01.000Z", callId: "plan-2", kind: "opened", lineIndex: 2, reason: "open" },
    ]);
  });

  it("fails a marked line that is not a plan line", () => {
    const error = unwrapErr(parsePlanCallLog({ text: "x talk plan call plan-1 vanished\n" }));
    expect(error.message).toBe("the console log line 1 is not one it writes: x talk plan call plan-1 vanished");
  });

  it("names what opened and what never ended", () => {
    const events = unwrap(parsePlanCallLog({ text: LOG }));
    expect(openedPlanCalls({ events })).toEqual(["plan-1", "plan-2"]);
    expect(unendedPlanCalls({ callIds: ["plan-1", "plan-2"], events })).toEqual(["plan-2"]);
  });
});

describe("liveLeaseIdsOf", () => {
  it("keeps the leases whose time has not run out, sorted, and holds nothing for one that does not parse", () => {
    const leases = [
      JSON.stringify({ callId: "z", untilMs: 2000 }),
      JSON.stringify({ callId: "old", untilMs: 500 }),
      "{torn",
      JSON.stringify({ callId: "a", untilMs: 1500 }),
    ];
    expect(liveLeaseIdsOf({ leases, nowMs: 1000 })).toEqual(["a", "z"]);
  });
});

describe("malformedLeaseCount — what the on-call hold cannot read as no call", () => {
  it("counts torn JSON and JSON that is not a lease, never an expired lease", () => {
    const leases = [
      JSON.stringify({ callId: "old", untilMs: 500 }),
      "{torn",
      JSON.stringify({ callId: "no-until" }),
      JSON.stringify({ callId: "a", untilMs: 1500 }),
    ];
    expect(malformedLeaseCount({ leases })).toBe(2);
  });

  it("is zero with no leases at all", () => {
    expect(malformedLeaseCount({ leases: [] })).toBe(0);
  });
});

describe("the wire's call ids", () => {
  it("reads the plan call id off a successful offer only", () => {
    expect(offerCallIdOf({ body: { callId: "plan-1", ok: true, sdp: "v=0" } })).toBe("plan-1");
    expect(offerCallIdOf({ body: { notMinted: "busy", ok: false } })).toBeUndefined();
  });

  it("reads the transcript call id off a batch, and nothing off a body that is not one", () => {
    expect(transcriptCallIdOf({ body: JSON.stringify({ callId: "tx-1", lines: [] }) })).toBe("tx-1");
    expect(transcriptCallIdOf({ body: "not json" })).toBeUndefined();
    expect(transcriptCallIdOf({ body: null })).toBeUndefined();
  });

  it("adds an id once, in first-seen order", () => {
    const into: string[] = [];
    for (const id of ["b", "a", "b", undefined]) {
      addOnce({ id, into });
    }
    expect(into).toEqual(["b", "a"]);
  });
});

describe("turnAndAnswer", () => {
  const rows = rowsOf({
    raw: [
      { medium: "voice", text: "hello", who: "voice" },
      { medium: "voice", text: "E2E typed n1: reply", who: "owner" },
      { medium: null, text: null, who: "system" },
      { medium: "voice", text: "acknowledged", who: "voice" },
    ],
  });

  it("keeps only the owner's rows and the voice's", () => {
    expect(rows.map((row) => row.who)).toEqual(["voice", "owner", "voice"]);
  });

  it("takes a typed conversation's mark off its rows' words, and only a typed row's", () => {
    expect(
      rowsOf({
        raw: [
          { medium: "typed", text: "typedFOUND", who: "voice" },
          { medium: "typed", text: "typedE2E typed n1: reply", who: "owner" },
          { medium: "voice", text: "typed it in", who: "voice" },
        ],
      }).map((row) => row.text),
    ).toEqual(["FOUND", "E2E typed n1: reply", "typed it in"]);
  });

  it("finds the owner's matching turn and an answer after it", () => {
    expect(turnAndAnswer({ ownerText: "E2E typed n1", rows })).toEqual({ ownerTurn: true, voiceAnswer: true });
  });

  it("finds no turn when none matches, and no answer when none follows", () => {
    expect(turnAndAnswer({ ownerText: "E2E typed other", rows })).toEqual({ ownerTurn: false, voiceAnswer: false });
    expect(turnAndAnswer({ ownerText: undefined, rows: rows.slice(0, 2) })).toEqual({
      ownerTurn: true,
      voiceAnswer: false,
    });
  });
});

describe("sameRows", () => {
  const asked = { text: "I want a briefing", who: "owner" } as const;
  const cut = {
    text: " The lint configuration exempts test files; I read the configuration but",
    who: "voice",
  } as const;

  it("holds for the same rows read twice", () => {
    expect(sameRows({ after: [asked, cut], before: [asked, { ...cut }] })).toBe(true);
  });

  it("reads a voice row still growing as a change (a call cut at 'but')", () => {
    const grown = { ...cut, text: `${cut.text} haven't tested enforcement. The fleet will write the briefing.` };
    expect(sameRows({ after: [asked, grown], before: [asked, cut] })).toBe(false);
  });

  it("reads a correction appended after the answer as a change", () => {
    const correction = { text: " To be clear, the fleet writes that briefing, not me.", who: "voice" } as const;
    expect(sameRows({ after: [asked, cut, correction], before: [asked, cut] })).toBe(false);
  });

  it("reads a row changing hands as a change", () => {
    expect(sameRows({ after: [{ ...asked, who: "voice" }], before: [asked] })).toBe(false);
  });

  it("holds for two empty reads", () => {
    expect(sameRows({ after: [], before: [] })).toBe(true);
  });
});

describe("E2eCallErrors", () => {
  it("refuses beside a live call, saying how many, to re-run, and naming the on-call ruling", () => {
    const refused = E2eCallErrors.callAlreadyLive({ live: 1 });
    expect([refused.code, refused.message]).toEqual([
      "CALL_ALREADY_LIVE",
      `1 voice call lease(s) are live on this machine — a call is up or being minted, so no test call is placed beside it; re-run once it has ended (${ON_CALL_RULING})`,
    ]);
  });

  it("stops the leg on a call it cannot prove ended", () => {
    expect(E2eCallErrors.cleanupFailed({ detail: "transcript tx-1 has no end" }).message).toBe(
      "a test call could not be proven ended, so no further call is placed: transcript tx-1 has no end",
    );
  });

  it("names how many voice windows matched when it will not crash one", () => {
    const unclear = E2eCallErrors.voiceWindowUnclear({ found: 2 });
    expect([unclear.code, unclear.message]).toEqual([
      "VOICE_WINDOW_UNCLEAR",
      "2 live voice windows matched /voice; exactly one is crashed, so none was",
    ]);
  });
});
