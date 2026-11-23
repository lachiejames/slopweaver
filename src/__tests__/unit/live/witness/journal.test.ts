import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  foldWitnessJournal,
  parseWitnessJournalLine,
  planWitnessSettlement,
  witnessDispatchPermit,
  witnessesNewestFirst,
} from "../../../../live/witness/journal.js";
import {
  threadStandDownIdOf,
  type WitnessDispatchedEvent,
  type WitnessKey,
  type WitnessSettledEvent,
  type WitnessThreadStoodDownEvent,
  witnessIdOf,
} from "../../../../live/witness/types.js";

const KEY: WitnessKey = { channel: "C0SYN000000001", messageTs: "1789000000.000200", threadTs: "1789000000.000100" };
const OTHER: WitnessKey = { channel: "C0SYN000000002", messageTs: "1789000001.000200", threadTs: "1789000001.000100" };

function dispatched({ key, tsIso }: { key: WitnessKey; tsIso: string }): WitnessDispatchedEvent {
  return {
    ...key,
    host: "claude-code",
    kind: "dispatched",
    model: "sonnet",
    schemaVersion: 1,
    surfaceId: "surface-id-1",
    surfaceRef: "surface:1",
    text: "the deploy finished cleanly",
    tsIso,
    witnessId: witnessIdOf({ key }),
    workspaceId: "workspace-id-1",
    workspaceRef: "workspace:1",
  };
}

function settled({
  key,
  outcome,
  tsIso,
}: {
  key: WitnessKey;
  outcome: WitnessSettledEvent["outcome"];
  tsIso: string;
}): WitnessSettledEvent {
  return { ...key, kind: "settled", outcome, schemaVersion: 1, tsIso, witnessId: witnessIdOf({ key }) };
}

const NOW = "2026-10-05T01:00:00.000Z";

const THREAD_ROW: WitnessThreadStoodDownEvent = {
  channel: KEY.channel,
  kind: "thread-stood-down",
  schemaVersion: 1,
  standDownId: threadStandDownIdOf({ channel: KEY.channel, threadTs: KEY.threadTs }),
  threadTs: KEY.threadTs,
  tsIso: NOW,
  why: "owner: stop witnessing the thread",
};

describe("witnessIdOf", () => {
  it("is stable for one key and distinct across keys", () => {
    expect(witnessIdOf({ key: KEY })).toBe(witnessIdOf({ key: { ...KEY } }));
    expect(witnessIdOf({ key: KEY })).not.toBe(witnessIdOf({ key: OTHER }));
    expect(witnessIdOf({ key: KEY })).toMatch(/^w-[0-9a-f]{16}$/);
  });
});

describe("parseWitnessJournalLine", () => {
  it("parses a dispatched row", () => {
    const event = dispatched({ key: KEY, tsIso: NOW });
    const parsed = parseWitnessJournalLine({ line: JSON.stringify(event), lineNumber: 1, path: "/j" });

    expect(unwrap(parsed)).toEqual(event);
  });

  it("refuses a line that is not JSON, naming the line", () => {
    const error = unwrapErr(parseWitnessJournalLine({ line: "{torn", lineNumber: 7, path: "/j" }));

    expect(error.code).toBe("JOURNAL_LINE_MALFORMED");
    expect(error.message).toContain("line 7");
  });

  it("parses a stood-down row that says why", () => {
    const event: WitnessSettledEvent = { ...settled({ key: KEY, outcome: "stood-down", tsIso: NOW }), why: "shut up" };

    expect(unwrap(parseWitnessJournalLine({ line: JSON.stringify(event), lineNumber: 3, path: "/j" }))).toEqual(event);
  });

  it.each([
    ["no why", {}],
    ["a blank why", { why: "   " }],
  ])("refuses a stood-down row with %s, since it silences a whole thread", (_label, over) => {
    const line = JSON.stringify({ ...settled({ key: KEY, outcome: "stood-down", tsIso: NOW }), ...over });
    const error = unwrapErr(parseWitnessJournalLine({ line, lineNumber: 4, path: "/j" }));

    expect(error.code).toBe("JOURNAL_LINE_MALFORMED");
    expect(error.message).toContain("a stood-down row carries a non-blank why");
  });

  it("refuses an unknown key", () => {
    const line = JSON.stringify({ ...dispatched({ key: KEY, tsIso: NOW }), extra: true });

    expect(unwrapErr(parseWitnessJournalLine({ line, lineNumber: 2, path: "/j" })).code).toBe("JOURNAL_LINE_MALFORMED");
  });

  it("refuses a row whose id is not the one its coordinates derive", () => {
    const line = JSON.stringify({ ...dispatched({ key: KEY, tsIso: NOW }), witnessId: witnessIdOf({ key: OTHER }) });
    const error = unwrapErr(parseWitnessJournalLine({ line, lineNumber: 3, path: "/j" }));

    expect(error.message).toContain("not the id its own coordinates derive");
  });

  it("parses a whole-thread stand-down row", () => {
    expect(unwrap(parseWitnessJournalLine({ line: JSON.stringify(THREAD_ROW), lineNumber: 5, path: "/j" }))).toEqual(
      THREAD_ROW,
    );
  });

  it("refuses a whole-thread row whose id is not the one its thread derives", () => {
    const line = JSON.stringify({
      ...THREAD_ROW,
      standDownId: threadStandDownIdOf({ channel: OTHER.channel, threadTs: OTHER.threadTs }),
    });
    const error = unwrapErr(parseWitnessJournalLine({ line, lineNumber: 6, path: "/j" }));

    expect(error.message).toContain("not the id its own thread coordinates derive");
  });

  it("refuses a whole-thread row with a blank why", () => {
    const line = JSON.stringify({ ...THREAD_ROW, why: "  " });
    const error = unwrapErr(parseWitnessJournalLine({ line, lineNumber: 7, path: "/j" }));

    expect(error.message).toContain("a thread stand-down carries a non-blank why");
  });
});

describe("threadStandDownIdOf", () => {
  it("is stable for one thread, distinct across threads, and never a witness id", () => {
    const id = threadStandDownIdOf({ channel: KEY.channel, threadTs: KEY.threadTs });

    expect(id).toBe(THREAD_ROW.standDownId);
    expect(id).not.toBe(threadStandDownIdOf({ channel: OTHER.channel, threadTs: OTHER.threadTs }));
    expect(id).toMatch(/^t-[0-9a-f]{16}$/);
  });
});

describe("foldWitnessJournal", () => {
  it("folds no record from a whole-thread stand-down, which is about no witness", () => {
    const s = settled({ key: KEY, outcome: "nothing-checkable", tsIso: NOW });
    const folded = foldWitnessJournal({ events: [s, THREAD_ROW] });

    expect([...folded.keys()]).toEqual([witnessIdOf({ key: KEY })]);
    expect(folded.get(witnessIdOf({ key: KEY }))!.settled).toEqual(s);
  });

  it("folds a dispatch and its terminal into one record", () => {
    const d = dispatched({ key: KEY, tsIso: "2026-10-05T00:00:00.000Z" });
    const s = settled({ key: KEY, outcome: "posted", tsIso: "2026-10-05T00:05:00.000Z" });
    const record = foldWitnessJournal({ events: [d, s] }).get(witnessIdOf({ key: KEY }))!;

    expect(record.dispatched).toEqual(d);
    expect(record.settled).toEqual(s);
    expect(record.latestIso).toBe("2026-10-05T00:05:00.000Z");
    expect(record.key).toEqual(KEY);
  });

  it("keeps the FIRST terminal when a second one appears", () => {
    const first = settled({ key: KEY, outcome: "nothing-checkable", tsIso: "2026-10-05T00:00:00.000Z" });
    const second = settled({ key: KEY, outcome: "failed", tsIso: "2026-10-05T00:01:00.000Z" });

    expect(foldWitnessJournal({ events: [first, second] }).get(witnessIdOf({ key: KEY }))!.settled).toEqual(first);
  });

  it("folds an empty journal to an empty map", () => {
    expect(foldWitnessJournal({ events: [] }).size).toBe(0);
  });

  it("opens a fresh attempt on a dispatch AFTER a failed terminal", () => {
    const secondAttempt = dispatched({ key: KEY, tsIso: "2026-10-05T00:10:00.000Z" });
    const record = foldWitnessJournal({
      events: [
        dispatched({ key: KEY, tsIso: "2026-10-05T00:00:00.000Z" }),
        settled({ key: KEY, outcome: "failed", tsIso: "2026-10-05T00:01:00.000Z" }),
        secondAttempt,
      ],
    }).get(witnessIdOf({ key: KEY }))!;

    expect(record.dispatched).toEqual(secondAttempt);
    expect(record.settled).toBeUndefined();
    expect(record.latestIso).toBe("2026-10-05T00:10:00.000Z");
  });

  it("keeps the first terminal of the fresh attempt", () => {
    const secondEnd = settled({ key: KEY, outcome: "posted", tsIso: "2026-10-05T00:11:00.000Z" });
    const record = foldWitnessJournal({
      events: [
        dispatched({ key: KEY, tsIso: "2026-10-05T00:00:00.000Z" }),
        settled({ key: KEY, outcome: "failed", tsIso: "2026-10-05T00:01:00.000Z" }),
        dispatched({ key: KEY, tsIso: "2026-10-05T00:10:00.000Z" }),
        secondEnd,
        settled({ key: KEY, outcome: "nothing-material", tsIso: "2026-10-05T00:12:00.000Z" }),
      ],
    }).get(witnessIdOf({ key: KEY }))!;

    expect(record.settled).toEqual(secondEnd);
  });

  it("re-opens nothing on a dispatch after a terminal that carries a verdict", () => {
    const verdict = settled({ key: KEY, outcome: "nothing-material", tsIso: "2026-10-05T00:01:00.000Z" });
    const record = foldWitnessJournal({
      events: [
        dispatched({ key: KEY, tsIso: "2026-10-05T00:00:00.000Z" }),
        verdict,
        dispatched({ key: KEY, tsIso: "2026-10-05T00:10:00.000Z" }),
      ],
    }).get(witnessIdOf({ key: KEY }))!;

    expect(record.settled).toEqual(verdict);
  });
});

describe("witnessDispatchPermit", () => {
  it("permits a message the journal has never seen", () => {
    expect(unwrap(witnessDispatchPermit({ current: new Map(), key: KEY }))).toBeUndefined();
  });

  it("refuses a message that already has a live worker", () => {
    const current = foldWitnessJournal({ events: [dispatched({ key: KEY, tsIso: NOW })] });

    expect(unwrapErr(witnessDispatchPermit({ current, key: KEY })).code).toBe("ALREADY_DISPATCHED");
  });

  it("refuses a message that is already settled, even with no worker", () => {
    const current = foldWitnessJournal({ events: [settled({ key: KEY, outcome: "nothing-checkable", tsIso: NOW })] });

    expect(unwrapErr(witnessDispatchPermit({ current, key: KEY })).code).toBe("ALREADY_SETTLED");
  });

  it("refuses any message while ANOTHER witness is still live — one investigation at a time", () => {
    const current = foldWitnessJournal({ events: [dispatched({ key: OTHER, tsIso: NOW })] });
    const error = unwrapErr(witnessDispatchPermit({ current, key: KEY }));

    expect(error.code).toBe("ANOTHER_WITNESS_LIVE");
    expect(error.message).toContain(`${witnessIdOf({ key: OTHER })} is still being investigated`);
    expect(error.message).toContain("one unasked peer-bot thread investigation at a time");
  });

  it("permits the next message once the live one settles", () => {
    const current = foldWitnessJournal({
      events: [
        dispatched({ key: OTHER, tsIso: NOW }),
        settled({ key: OTHER, outcome: "nothing-material", tsIso: NOW }),
      ],
    });

    expect(unwrap(witnessDispatchPermit({ current, key: KEY }))).toBeUndefined();
  });

  it("permits a failed witness again — a failure is no verdict on the claim", () => {
    const current = foldWitnessJournal({
      events: [dispatched({ key: KEY, tsIso: NOW }), settled({ key: KEY, outcome: "failed", tsIso: NOW })],
    });

    expect(unwrap(witnessDispatchPermit({ current, key: KEY }))).toBeUndefined();
  });

  it("refuses every outcome that carries a verdict or an act", () => {
    const outcomes = ["nothing-checkable", "nothing-material", "posted", "helped"] as const;
    const codes = outcomes.map(
      (outcome) =>
        unwrapErr(
          witnessDispatchPermit({
            current: foldWitnessJournal({ events: [settled({ key: KEY, outcome, tsIso: NOW })] }),
            key: KEY,
          }),
        ).code,
    );

    expect(codes).toEqual(["ALREADY_SETTLED", "ALREADY_SETTLED", "ALREADY_SETTLED", "ALREADY_SETTLED"]);
  });

  it("still holds a failed witness to the one-at-a-time cap", () => {
    const current = foldWitnessJournal({
      events: [
        dispatched({ key: KEY, tsIso: NOW }),
        settled({ key: KEY, outcome: "failed", tsIso: NOW }),
        dispatched({ key: OTHER, tsIso: NOW }),
      ],
    });

    expect(unwrapErr(witnessDispatchPermit({ current, key: KEY })).code).toBe("ANOTHER_WITNESS_LIVE");
  });

  it("refuses a second worker for a re-dispatched witness that is live again", () => {
    const current = foldWitnessJournal({
      events: [
        dispatched({ key: KEY, tsIso: NOW }),
        settled({ key: KEY, outcome: "failed", tsIso: NOW }),
        dispatched({ key: KEY, tsIso: NOW }),
      ],
    });

    expect(unwrapErr(witnessDispatchPermit({ current, key: KEY })).code).toBe("ALREADY_DISPATCHED");
  });
});

describe("planWitnessSettlement", () => {
  const live = foldWitnessJournal({ events: [dispatched({ key: KEY, tsIso: "2026-10-05T00:00:00.000Z" })] });
  const byId = { kind: "id", witnessId: witnessIdOf({ key: KEY }) } as const;

  it("plans a posted terminal carrying the posted ts", () => {
    const event = unwrap(
      planWitnessSettlement({
        current: live,
        nowIso: NOW,
        outcome: "posted",
        postedTs: "1789000002.000300",
        selector: byId,
        why: undefined,
      }),
    );

    expect(event).toEqual({
      ...KEY,
      kind: "settled",
      outcome: "posted",
      postedTs: "1789000002.000300",
      schemaVersion: 1,
      tsIso: NOW,
      witnessId: witnessIdOf({ key: KEY }),
    });
  });

  it("refuses posted with no posted ts", () => {
    const error = unwrapErr(
      planWitnessSettlement({
        current: live,
        nowIso: NOW,
        outcome: "posted",
        postedTs: undefined,
        selector: byId,
        why: undefined,
      }),
    );

    expect(error.code).toBe("POSTED_TS_REQUIRED");
  });

  it("refuses a posted ts on any other outcome", () => {
    const error = unwrapErr(
      planWitnessSettlement({
        current: live,
        nowIso: NOW,
        outcome: "nothing-material",
        postedTs: "1789000002.000300",
        selector: byId,
        why: "checked Datadog",
      }),
    );

    expect(error.code).toBe("POSTED_TS_FORBIDDEN");
  });

  it("requires a non-blank why for nothing-material and failed", () => {
    const material = unwrapErr(
      planWitnessSettlement({
        current: live,
        nowIso: NOW,
        outcome: "nothing-material",
        postedTs: undefined,
        selector: byId,
        why: "   ",
      }),
    );
    const failed = unwrapErr(
      planWitnessSettlement({
        current: live,
        nowIso: NOW,
        outcome: "failed",
        postedTs: undefined,
        selector: byId,
        why: undefined,
      }),
    );

    expect(material.code).toBe("WHY_REQUIRED");
    expect(failed.code).toBe("WHY_REQUIRED");
  });

  it("settles nothing-checkable by coordinates with no prior dispatch", () => {
    const event = unwrap(
      planWitnessSettlement({
        current: new Map(),
        nowIso: NOW,
        outcome: "nothing-checkable",
        postedTs: undefined,
        selector: { key: KEY, kind: "key" },
        why: undefined,
      }),
    );

    expect(event.witnessId).toBe(witnessIdOf({ key: KEY }));
    expect(event.outcome).toBe("nothing-checkable");
    expect(event.why).toBeUndefined();
  });

  it("refuses any other outcome by coordinates with no prior dispatch", () => {
    const error = unwrapErr(
      planWitnessSettlement({
        current: new Map(),
        nowIso: NOW,
        outcome: "nothing-material",
        postedTs: undefined,
        selector: { key: KEY, kind: "key" },
        why: "checked",
      }),
    );

    expect(error.code).toBe("NOT_DISPATCHED");
  });

  it("refuses an id the journal does not hold", () => {
    const error = unwrapErr(
      planWitnessSettlement({
        current: new Map(),
        nowIso: NOW,
        outcome: "nothing-checkable",
        postedTs: undefined,
        selector: byId,
        why: undefined,
      }),
    );

    expect(error.code).toBe("WITNESS_UNKNOWN");
  });

  it("refuses a second terminal", () => {
    const done = foldWitnessJournal({ events: [settled({ key: KEY, outcome: "nothing-checkable", tsIso: NOW })] });
    const error = unwrapErr(
      planWitnessSettlement({
        current: done,
        nowIso: NOW,
        outcome: "failed",
        postedTs: undefined,
        selector: byId,
        why: "x",
      }),
    );

    expect(error.code).toBe("ALREADY_SETTLED");
  });

  it("trims the why it keeps", () => {
    const event = unwrap(
      planWitnessSettlement({
        current: live,
        nowIso: NOW,
        outcome: "nothing-material",
        postedTs: undefined,
        selector: byId,
        why: "  Datadog and CI agree  ",
      }),
    );

    expect(event.why).toBe("Datadog and CI agree");
  });
});

describe("witnessesNewestFirst", () => {
  it("orders records by their latest event, newest first", () => {
    const current = foldWitnessJournal({
      events: [
        dispatched({ key: KEY, tsIso: "2026-10-05T00:00:00.000Z" }),
        dispatched({ key: OTHER, tsIso: "2026-10-05T00:01:00.000Z" }),
        settled({ key: KEY, outcome: "nothing-material", tsIso: "2026-10-05T00:02:00.000Z" }),
      ],
    });

    expect(witnessesNewestFirst({ current }).map((record) => record.witnessId)).toEqual([
      witnessIdOf({ key: KEY }),
      witnessIdOf({ key: OTHER }),
    ]);
  });
});
