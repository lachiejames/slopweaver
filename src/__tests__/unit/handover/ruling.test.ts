/**
 * The ruling core — which recorded decision a row READS, and what the register refuses to record at all.
 *
 * Two properties carry this module and both are asserted rather than described. **Decision time decides, not
 * append order**, which is the only thing that makes a backfill of decisions from August safe to run onto a
 * live board in September. And **a reconstruction is checked against the answer it claims to come from,
 * exactly** — nothing is extracted from an answer, so the substring games an adversarial review raised
 * cannot arise, and the checks below are written to fail if that ever changes.
 */
import { describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RulingEvent, RunEvent } from "../../../handover/ledger.js";
import {
  isCanonicalInstant,
  latestFindingRuling,
  latestRuling,
  latestRulingEvent,
  rulingAnchor,
  rulingAppendProblem,
  rulingBackfilledFrom,
  rulingDecisionOrder,
  rulingSourceProblem,
  rulingWords,
} from "../../../handover/ruling.js";

const EARLY = "2026-08-22T22:41:20.584Z";
const MIDDLE = "2026-09-04T12:38:57.414Z";
const LATE = "2026-09-10T09:00:00.000Z";
const TODAY = "2026-09-13T02:00:00.000Z";

/** A ruling recorded as the owner gave it — decided at the instant it was written down. */
function live({
  at,
  words = "yes, raise it",
  anchor = "https://example.invalid/p9",
}: {
  at: string;
  words?: string;
  anchor?: string;
}): RulingEvent {
  return { anchor, atIso: at, decidedIso: at, kind: "ruling", ruling: words };
}

/** A ruling reconstructed today from an answer given earlier — the backfill's exact shape. */
function backfilled({
  decided,
  words = "OWNER RULED: ship it",
  at = TODAY,
}: {
  decided: string;
  words?: string;
  at?: string;
}): RulingEvent {
  return {
    anchor: `journal:runs/a-row.jsonl#${decided}`,
    atIso: at,
    backfilledFrom: decided,
    decidedIso: decided,
    kind: "ruling",
    ruling: words,
  };
}

/** The answered event a reconstruction is copied out of. */
function answered({ at, answer = "OWNER RULED: ship it" }: { at: string; answer?: string }): RunEvent {
  return { answer, atIso: at, kind: "answered" };
}

/** A row with no authored ruling on it, parsed by the real parser. */
function row({ lines = [] }: { lines?: readonly string[] } = {}): HandoverDoc {
  return parseHandoverDoc({
    path: "/board/a-row.md",
    text: ["---", "slug: a-row", "summary: a row", ...lines, "---", "", "# a row", ""].join("\n"),
  });
}

describe("rulingDecisionOrder", () => {
  it("places a ruling by the instant the owner decided it", () => {
    expect(rulingDecisionOrder({ event: live({ at: MIDDLE }) })).toBe(Date.parse(MIDDLE));
  });

  it("falls back to when the line was written, for a journal older than the decidedIso field", () => {
    const legacy: RulingEvent = { anchor: "a", atIso: EARLY, kind: "ruling", ruling: "yes" };
    expect(rulingDecisionOrder({ event: legacy })).toBe(Date.parse(EARLY));
  });

  it("places an unparseable instant EARLIEST, so one bad line cannot hide every later ruling", () => {
    const broken: RulingEvent = { anchor: "a", atIso: "not an instant", kind: "ruling", ruling: "yes" };
    expect(rulingDecisionOrder({ event: broken })).toBe(Number.NEGATIVE_INFINITY);
  });

  it("orders two spellings of one instant equally, rather than by their text", () => {
    const zulu = live({ at: "2026-09-04T12:38:57.414Z" });
    const offset = live({ at: "2026-09-04T22:38:57.414+10:00" });
    expect(rulingDecisionOrder({ event: zulu })).toBe(rulingDecisionOrder({ event: offset }));
  });
});

describe("latestRulingEvent", () => {
  it("is undefined for a journal with no ruling on it", () => {
    expect(latestRulingEvent({ events: [answered({ at: MIDDLE })] })).toBeUndefined();
  });

  it("takes the latest DECISION even when an older one was appended last", () => {
    const newer = live({ at: LATE, words: "actually, production" });
    const older = backfilled({ decided: EARLY });
    expect(latestRulingEvent({ events: [newer, older] })).toBe(newer);
  });

  it("breaks a tie toward the line written last", () => {
    const first = live({ at: MIDDLE, words: "first" });
    const second = live({ at: MIDDLE, words: "second" });
    expect(latestRulingEvent({ events: [first, second] })).toBe(second);
  });

  it("skips every reconstruction when asked for a live ruling only", () => {
    const permit = live({ at: EARLY });
    const reconstructed = backfilled({ decided: LATE });
    expect(latestRulingEvent({ events: [permit, reconstructed], liveOnly: true })).toBe(permit);
  });

  it("finds nothing live on a journal whose only rulings are reconstructions", () => {
    expect(latestRulingEvent({ events: [backfilled({ decided: LATE })], liveOnly: true })).toBeUndefined();
  });
});

describe("latestRuling and latestFindingRuling", () => {
  it("reads the authored pair when the register is silent", () => {
    const doc = row({ lines: ['ruling: "yes"', "rulingAnchor: https://example.invalid/p9"] });
    expect(latestRuling({ doc, events: [] })).toEqual({
      anchor: "https://example.invalid/p9",
      from: "authored",
      words: "yes",
    });
  });

  it("ignores half an authored pair, which is a claim with nowhere to check it", () => {
    expect(latestRuling({ doc: row({ lines: ['ruling: "yes"'] }), events: [] })).toBeUndefined();
    expect(latestRuling({ doc: row({ lines: ["rulingAnchor: a"] }), events: [] })).toBeUndefined();
  });

  it("gives the authored pair to a DOOR as well — it was written by the verb that clears one", () => {
    const doc = row({ lines: ['ruling: "yes"', "rulingAnchor: https://example.invalid/p9"] });
    expect(latestFindingRuling({ doc, events: [] })).toEqual({
      anchor: "https://example.invalid/p9",
      from: "authored",
      words: "yes",
    });
  });

  it("gives a door NOTHING when the only ruling is a reconstruction, however recent", () => {
    expect(latestFindingRuling({ doc: row(), events: [backfilled({ decided: LATE })] })).toBeUndefined();
  });
});

describe("rulingWords, rulingAnchor and rulingBackfilledFrom read either provenance", () => {
  const event = backfilled({ decided: MIDDLE, words: "the owner's words" });

  it("reads a register ruling", () => {
    const evidence = latestRuling({ doc: row(), events: [event] })!;
    expect(rulingWords({ evidence })).toBe("the owner's words");
    expect(rulingAnchor({ evidence })).toBe(`journal:runs/a-row.jsonl#${MIDDLE}`);
    expect(rulingBackfilledFrom({ evidence })).toBe(MIDDLE);
  });

  it("reads an authored ruling, and reports no reconstruction behind it", () => {
    const doc = row({ lines: ['ruling: "yes"', "rulingAnchor: p9"] });
    const evidence = latestRuling({ doc, events: [] })!;
    expect(rulingWords({ evidence })).toBe("yes");
    expect(rulingAnchor({ evidence })).toBe("p9");
    expect(rulingBackfilledFrom({ evidence })).toBeUndefined();
  });
});

describe("rulingAppendProblem — a live ruling", () => {
  it("allows the first ruling on an empty journal", () => {
    expect(rulingAppendProblem({ event: live({ at: MIDDLE }), events: [] })).toBeUndefined();
  });

  it("refuses an exact duplicate of one already recorded", () => {
    const event = live({ at: MIDDLE });
    const problem = rulingAppendProblem({ event, events: [event] });

    expect(problem!.code).toBe("RULING_ALREADY_RECORDED");
    expect(problem!.message).toContain(MIDDLE);
  });

  it("allows the same words decided at a different instant — the owner does say a thing twice", () => {
    const first = live({ at: EARLY, words: "ship it" });
    const again = live({ at: LATE, words: "ship it" });
    expect(rulingAppendProblem({ event: again, events: [first] })).toBeUndefined();
  });

  it("allows the same words at the same instant under a different anchor", () => {
    const first = live({ anchor: "p9", at: MIDDLE, words: "ship it" });
    const second = live({ anchor: "p10", at: MIDDLE, words: "ship it" });
    expect(rulingAppendProblem({ event: second, events: [first] })).toBeUndefined();
  });
});

describe("rulingAppendProblem — a reconstruction is checked against its source", () => {
  const SOURCE = answered({ at: MIDDLE });

  it("allows a reconstruction whose words equal its source answer exactly", () => {
    expect(rulingAppendProblem({ event: backfilled({ decided: MIDDLE }), events: [SOURCE] })).toBeUndefined();
  });

  it("refuses one whose source is not on this row's journal", () => {
    const problem = rulingAppendProblem({ event: backfilled({ decided: LATE }), events: [SOURCE] });

    expect(problem!.code).toBe("RULING_SOURCE_MISSING");
    expect(problem!.message).toContain(LATE);
  });

  it("refuses one whose source instant is shared by two answers, so nothing identifies it", () => {
    const problem = rulingAppendProblem({
      event: backfilled({ decided: MIDDLE }),
      events: [SOURCE, answered({ at: MIDDLE, answer: "a different answer" })],
    });

    expect(problem!.code).toBe("RULING_SOURCE_AMBIGUOUS");
  });

  it("refuses when a second answer shares the moment in another spelling — it cannot be placed, so fail closed", () => {
    const problem = rulingAppendProblem({
      event: backfilled({ decided: MIDDLE }),
      events: [SOURCE, answered({ answer: "wait", at: "2026-09-04T22:38:57.414+10:00" })],
    });

    expect(problem!.code).toBe("RULING_SOURCE_AMBIGUOUS");
  });

  it("refuses a source whose only answer is spelled with an offset, rather than normalising it", () => {
    const problem = rulingAppendProblem({
      event: backfilled({ decided: MIDDLE }),
      events: [answered({ at: "2026-09-04T22:38:57.414+10:00" })],
    });

    expect(problem!.code).toBe("RULING_SOURCE_AMBIGUOUS");
  });

  it("refuses a space-separated spelling Date.parse reads as a different year", () => {
    const event: RulingEvent = {
      anchor: "a",
      atIso: TODAY,
      backfilledFrom: "0001-01-01T00:00:00.000Z",
      decidedIso: "0001-01-01T00:00:00.000Z",
      kind: "ruling",
      ruling: "OWNER RULED: ship it",
    };
    const problem = rulingAppendProblem({
      event,
      events: [
        answered({ at: "0001-01-01T00:00:00.000Z" }),
        answered({ answer: "wait", at: "0001-01-01 00:00:00.000Z" }),
      ],
    });

    expect(problem!.code).toBe("RULING_SOURCE_AMBIGUOUS");
  });

  it("refuses a source instant 100 microseconds from the answer's own, which Date.parse alone reads as equal", () => {
    const event: RulingEvent = {
      anchor: "journal:runs/a-row.jsonl#2026-09-04T12:38:57.4142Z",
      atIso: TODAY,
      backfilledFrom: "2026-09-04T12:38:57.4142Z",
      decidedIso: "2026-09-04T12:38:57.4142Z",
      kind: "ruling",
      ruling: "OWNER RULED: ship it",
    };
    const problem = rulingAppendProblem({ event, events: [answered({ at: "2026-09-04T12:38:57.4141Z" })] });

    expect(problem!.code).toBe("RULING_SOURCE_MISSING");
  });

  it("refuses a sub-millisecond spelling outright, even one that would denote the same instant", () => {
    const event: RulingEvent = {
      anchor: "a",
      atIso: TODAY,
      backfilledFrom: "2026-09-04T12:38:57.41410Z",
      decidedIso: "2026-09-04T12:38:57.41410Z",
      kind: "ruling",
      ruling: "OWNER RULED: ship it",
    };

    expect(rulingAppendProblem({ event, events: [answered({ at: "2026-09-04T12:38:57.4141Z" })] })!.code).toBe(
      "RULING_SOURCE_MISSING",
    );
  });

  it("refuses a source named in an extended-year spelling it cannot place at full precision — fail closed", () => {
    const event: RulingEvent = {
      anchor: "a",
      atIso: TODAY,
      backfilledFrom: "+002026-09-04T12:38:57.4142Z",
      decidedIso: "+002026-09-04T12:38:57.4142Z",
      kind: "ruling",
      ruling: "OWNER RULED: ship it",
    };
    const problem = rulingAppendProblem({ event, events: [answered({ at: "+002026-09-04T12:38:57.4141Z" })] });

    expect(problem!.code).toBe("RULING_SOURCE_MISSING");
  });

  it("refuses when any answer on the journal cannot be placed, since uniqueness can then not be shown", () => {
    const problem = rulingAppendProblem({
      event: backfilled({ decided: MIDDLE }),
      events: [SOURCE, answered({ answer: "wait", at: "+002026-09-04T12:38:57.414Z" })],
    });

    expect(problem!.code).toBe("RULING_SOURCE_AMBIGUOUS");
  });

  it("refuses a calendar-overflow instant that fits the canonical shape but names a day that does not exist", () => {
    const event: RulingEvent = {
      anchor: "a",
      atIso: TODAY,
      backfilledFrom: "2026-02-30T12:00:00.000Z",
      decidedIso: "2026-02-30T12:00:00.000Z",
      kind: "ruling",
      ruling: "OWNER RULED: ship it",
    };
    const problem = rulingAppendProblem({ event, events: [answered({ at: "2026-02-30T12:00:00.000Z" })] });

    expect(problem!.code).toBe("RULING_SOURCE_MISSING");
  });

  it("refuses a SUBSTRING of the source answer — nothing is ever extracted from one", () => {
    const problem = rulingAppendProblem({
      event: backfilled({ decided: MIDDLE, words: "ship it" }),
      events: [SOURCE],
    });

    expect(problem!.code).toBe("RULING_SOURCE_WORDS_MISMATCH");
  });

  it("refuses words that differ by whitespace alone", () => {
    const problem = rulingAppendProblem({
      event: backfilled({ decided: MIDDLE, words: "OWNER RULED: ship it " }),
      events: [SOURCE],
    });

    expect(problem!.code).toBe("RULING_SOURCE_WORDS_MISMATCH");
  });

  it("refuses a second reconstruction of the same source answer", () => {
    const first = backfilled({ decided: MIDDLE });
    const problem = rulingAppendProblem({ event: first, events: [SOURCE, first] });

    expect(problem!.code).toBe("RULING_ALREADY_RECORDED");
  });

  it("refuses another reconstruction naming the same source with different words", () => {
    const standing = backfilled({ decided: MIDDLE });
    const rival = backfilled({ decided: MIDDLE, words: "something else entirely" });
    const problem = rulingAppendProblem({ event: rival, events: [SOURCE, standing] });

    expect(problem!.code).toBe("RULING_SOURCE_ALREADY_RECORDED");
    expect(problem!.message).toContain(MIDDLE);
  });

  it("refuses a reconstruction decided at an instant that is not its source's", () => {
    const crooked: RulingEvent = {
      anchor: "a",
      atIso: TODAY,
      backfilledFrom: MIDDLE,
      decidedIso: LATE,
      kind: "ruling",
      ruling: "OWNER RULED: ship it",
    };
    const problem = rulingAppendProblem({ event: crooked, events: [SOURCE] });

    expect(problem!.code).toBe("RULING_SOURCE_TIME_INVALID");
  });

  it("refuses a source that is not an answer at all, even at the right instant", () => {
    const question: RunEvent = { atIso: MIDDLE, kind: "question", question: "OWNER RULED: ship it" };
    const problem = rulingAppendProblem({ event: backfilled({ decided: MIDDLE }), events: [question] });

    expect(problem!.code).toBe("RULING_SOURCE_MISSING");
  });
});

describe("rulingSourceProblem — the source half, on its own, for a reader", () => {
  const SOURCE = answered({ at: MIDDLE });

  it("is silent about a live ruling, which claims no source", () => {
    expect(rulingSourceProblem({ event: live({ at: MIDDLE }), events: [SOURCE] })).toBeUndefined();
  });

  it("passes a recorded reconstruction that is ALREADY on the journal it is checked against", () => {
    const event = backfilled({ decided: MIDDLE });
    expect(rulingSourceProblem({ event, events: [SOURCE, event] })).toBeUndefined();
  });

  it("reports the same failures the write path refuses on", () => {
    const problem = rulingSourceProblem({ event: backfilled({ decided: LATE }), events: [SOURCE] });
    expect(problem!.code).toBe("RULING_SOURCE_MISSING");
  });
});

describe("isCanonicalInstant", () => {
  it("accepts the one spelling toISOString produces", () => {
    expect(isCanonicalInstant({ iso: new Date(Date.parse(MIDDLE)).toISOString() })).toBe(true);
  });

  it.each([
    ["an offset", "2026-09-04T22:38:57.414+10:00"],
    ["no milliseconds", "2026-09-04T12:38:57Z"],
    ["sub-millisecond digits", "2026-09-04T12:38:57.4140Z"],
    ["an extended year", "+002026-09-04T12:38:57.414Z"],
    ["a date that does not exist", "2026-02-30T12:00:00.000Z"],
    ["a space for the T", "0001-01-01 00:00:00.000Z"],
  ])("refuses %s", (_label, iso) => {
    expect(isCanonicalInstant({ iso })).toBe(false);
  });
});
