/*
 * The as-me send failure journal: one bounded line per send under the owner's name that did not go out, and the newest one
 * aimed at a thread since the owner asked. The decisions are pure; the file round trip is under a throwaway home.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendSlackSendFailure,
  readSlackSendFailures,
  SendFailureJournalErrors,
} from "../../../../admit/slackSendFailureStore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  boundedSendError,
  latestFailureForThread,
  parseSendFailure,
  SEND_FAILURE_ERROR_MAX,
  type SlackSendFailure,
  sendFailureLine,
} from "../../../../outbound/slack/sendFailureJournal.js";
import { stateHomePaths } from "../../../../stateHome.js";

/** A refusal of the reply the owner asked for. */
const REFUSED: SlackSendFailure = {
  atIso: "2026-10-07T05:53:10.000Z",
  channel: "C0SYN000001",
  error: "slack reply blocked because Lena is named but not tagged.\n  Legitimate exceptions may include …",
  threadTs: "1791351441.819519",
};

describe("boundedSendError", () => {
  it("folds a multi-line refusal to one line and cuts it at the cap, by code point", () => {
    expect([
      boundedSendError({ error: REFUSED.error }),
      boundedSendError({ error: "—".repeat(SEND_FAILURE_ERROR_MAX + 3) }),
    ]).toEqual([
      "slack reply blocked because Lena is named but not tagged. Legitimate exceptions may include …",
      `${"—".repeat(SEND_FAILURE_ERROR_MAX)}…`,
    ]);
  });
});

describe("sendFailureLine / parseSendFailure", () => {
  it("round-trips a thread failure and a top-level one, bounding the error on the way in", () => {
    const topLevel: SlackSendFailure = { ...REFUSED, threadTs: null };
    expect([
      parseSendFailure({ line: sendFailureLine({ failure: REFUSED }) }),
      parseSendFailure({ line: sendFailureLine({ failure: topLevel }) }),
    ]).toEqual([
      { ...REFUSED, error: boundedSendError({ error: REFUSED.error }) },
      { ...topLevel, error: boundedSendError({ error: REFUSED.error }) },
    ]);
  });

  it("skips a torn line or another shape rather than refusing the read", () => {
    expect([
      parseSendFailure({ line: '{"atIso":"2026-10-07' }),
      parseSendFailure({ line: "[]" }),
      parseSendFailure({ line: JSON.stringify({ ...REFUSED, error: 7 }) }),
      parseSendFailure({ line: JSON.stringify({ ...REFUSED, threadTs: 1791351441 }) }),
      parseSendFailure({ line: JSON.stringify({ atIso: REFUSED.atIso, error: "x" }) }),
      parseSendFailure({ line: JSON.stringify({ ...REFUSED, atIso: "not an instant" }) }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses an instant Date.parse would guess at, so it reads as torn rather than as an old failure", () => {
    expect(
      ["0", "2026-10-07", "2026-10-07T06:00:00", "2026-02-30T06:00:00.000Z"].map((atIso) =>
        parseSendFailure({ line: JSON.stringify({ ...REFUSED, atIso }) }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("reads an offset-spelled instant back in canonical UTC", () => {
    expect(
      parseSendFailure({ line: JSON.stringify({ ...REFUSED, atIso: "2026-10-07T06:00:00.000+11:00" }) })!.atIso,
    ).toBe("2026-10-06T19:00:00.000Z");
  });
});

describe("latestFailureForThread", () => {
  it("is the newest failure aimed at the thread at or after the owner asked, and nothing for another thread or before", () => {
    const later = { ...REFUSED, atIso: "2026-10-07T05:55:00.000Z", error: "channel_not_found" };
    const failures = [
      later,
      REFUSED,
      { ...REFUSED, atIso: "2026-10-07T05:59:00.000Z", threadTs: "1791351000.000100" },
      { ...REFUSED, atIso: "2026-10-07T05:59:00.000Z", channel: "C0SYNELSEWHERE" },
      { ...REFUSED, atIso: "2026-10-07T05:59:00.000Z", threadTs: null },
    ];
    const thread = { channel: REFUSED.channel, threadTs: "1791351441.819519", topLevelCounts: false };
    expect([
      latestFailureForThread({ ...thread, failures, sinceIso: "2026-10-07T05:52:56.000Z" }),
      latestFailureForThread({ ...thread, failures, sinceIso: REFUSED.atIso }),
      latestFailureForThread({ ...thread, failures, sinceIso: "2026-10-07T06:00:00.000Z" }),
      latestFailureForThread({ ...thread, failures: [], sinceIso: "2026-10-07T05:52:56.000Z" }),
    ]).toEqual([later, later, undefined, undefined]);
  });

  it("matches a channel typed by name on its thread root alone, but never another id's or another thread's", () => {
    const byName = { ...REFUSED, channel: "proj-launch-room" };
    const thread = { channel: REFUSED.channel, threadTs: "1791351441.819519", topLevelCounts: true };
    const sinceIso = "2026-10-07T05:52:56.000Z";
    expect([
      latestFailureForThread({ ...thread, failures: [byName], sinceIso }),
      latestFailureForThread({ ...thread, failures: [{ ...byName, threadTs: "1791351000.000100" }], sinceIso }),
      latestFailureForThread({ ...thread, failures: [{ ...byName, threadTs: null }], sinceIso }),
      latestFailureForThread({ ...thread, failures: [{ ...REFUSED, channel: "C0SYNELSEWHERE" }], sinceIso }),
    ]).toEqual([byName, undefined, undefined, undefined]);
  });

  it("takes the later line of two failures at one millisecond, since the journal is appended in order", () => {
    const second = { ...REFUSED, error: "channel_not_found" };
    expect(
      latestFailureForThread({
        channel: REFUSED.channel,
        failures: [REFUSED, second],
        sinceIso: "2026-10-07T05:52:56.000Z",
        threadTs: "1791351441.819519",
        topLevelCounts: false,
      }),
    ).toEqual(second);
  });

  it("compares instants, never text: an offset spelling before the owner asked is not the owner's send's failure", () => {
    const beforeAsked = { ...REFUSED, atIso: "2026-10-07T06:00:00.000+11:00" };
    expect(
      latestFailureForThread({
        channel: REFUSED.channel,
        failures: [beforeAsked],
        sinceIso: "2026-10-07T05:52:56.000Z",
        threadTs: "1791351441.819519",
        topLevelCounts: false,
      }),
    ).toBeUndefined();
  });

  it("counts a top-level failure in the channel only when asked to, as a DM is", () => {
    const topLevel = { ...REFUSED, threadTs: null };
    const thread = { channel: REFUSED.channel, failures: [topLevel], sinceIso: "2026-10-07T05:52:56.000Z" };
    expect([
      latestFailureForThread({ ...thread, threadTs: "1791351441.819519", topLevelCounts: true }),
      latestFailureForThread({ ...thread, threadTs: "1791351441.819519", topLevelCounts: false }),
    ]).toEqual([topLevel, undefined]);
  });
});

describe("appendSlackSendFailure / readSlackSendFailures", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads no failures off a journal that does not exist, and back what was appended, owner-only", () => {
    home = mkdtempSync(join(tmpdir(), "send-failures-"));
    const before = unwrap(readSlackSendFailures({ home }));
    expect(appendSlackSendFailure({ failure: REFUSED, home }).isOk()).toBe(true);
    expect(appendSlackSendFailure({ failure: { ...REFUSED, threadTs: null }, home }).isOk()).toBe(true);
    const path = stateHomePaths({ home }).slackSendFailuresJsonl;
    const bounded = boundedSendError({ error: REFUSED.error });
    expect([before, unwrap(readSlackSendFailures({ home }))]).toEqual([
      [],
      [
        { ...REFUSED, error: bounded },
        { ...REFUSED, error: bounded, threadTs: null },
      ],
    ]);
    expect([statSync(path).mode & 0o777, readFileSync(path, "utf8").split("\n").length]).toEqual([0o600, 3]);
  });

  it("refuses a journal holding a torn line, which may be the newest failure, naming the line", () => {
    home = mkdtempSync(join(tmpdir(), "send-failures-"));
    expect(appendSlackSendFailure({ failure: REFUSED, home }).isOk()).toBe(true);
    const path = stateHomePaths({ home }).slackSendFailuresJsonl;
    writeFileSync(path, `${readFileSync(path, "utf8")}{"atIso":"2026-10-07T05:54:00.000Z","channel":"C0SYN000001"\n`);
    expect(unwrapErr(readSlackSendFailures({ home }))).toEqual(SendFailureJournalErrors.torn({ lines: [2], path }));
  });

  it("refuses a journal whose row carries an instant Date.parse would guess at, never filtering it out as old", () => {
    home = mkdtempSync(join(tmpdir(), "send-failures-"));
    const path = stateHomePaths({ home }).slackSendFailuresJsonl;
    expect(appendSlackSendFailure({ failure: REFUSED, home }).isOk()).toBe(true);
    writeFileSync(path, `${JSON.stringify({ ...REFUSED, atIso: "0" })}\n${readFileSync(path, "utf8")}`);
    expect(unwrapErr(readSlackSendFailures({ home }))).toEqual(SendFailureJournalErrors.torn({ lines: [1], path }));
  });

  it("refuses a journal whose row holds a byte that is not UTF-8, never reading it back repaired", () => {
    home = mkdtempSync(join(tmpdir(), "send-failures-"));
    const path = stateHomePaths({ home }).slackSendFailuresJsonl;
    expect(appendSlackSendFailure({ failure: REFUSED, home }).isOk()).toBe(true);
    const [before, after] = sendFailureLine({ failure: { ...REFUSED, error: "bad X reason" } }).split("X");
    const torn = Buffer.concat([Buffer.from(before!), Buffer.from([0xff]), Buffer.from(`${after!}\n`)]);
    writeFileSync(path, Buffer.concat([readFileSync(path), torn]));
    expect(unwrapErr(readSlackSendFailures({ home }))).toEqual(SendFailureJournalErrors.torn({ lines: [2], path }));
  });

  it("names a journal it could not write or read, never reading one it could not as nothing failed", () => {
    home = mkdtempSync(join(tmpdir(), "send-failures-"));
    const path = stateHomePaths({ home }).slackSendFailuresJsonl;
    writeFileSync(dirname(path), "a file where the ledgers directory goes");
    const written = appendSlackSendFailure({ failure: REFUSED, home });
    rmSync(dirname(path));
    mkdirSync(path, { recursive: true });
    const read = readSlackSendFailures({ home });
    expect([unwrapErr(written).code, unwrapErr(written).path, unwrapErr(read).code, unwrapErr(read).path]).toEqual([
      "JOURNAL_UNWRITABLE",
      path,
      "JOURNAL_UNREADABLE",
      path,
    ]);
    expect(unwrapErr(read).message).toContain(`the send failure journal ${path} could not be read: `);
  });

  it("names a journal behind a directory it cannot search, never reading it as nothing failed", () => {
    home = mkdtempSync(join(tmpdir(), "send-failures-"));
    const path = stateHomePaths({ home }).slackSendFailuresJsonl;
    expect(appendSlackSendFailure({ failure: REFUSED, home }).isOk()).toBe(true);
    chmodSync(dirname(path), 0o000);
    try {
      expect(unwrapErr(readSlackSendFailures({ home })).code).toBe("JOURNAL_UNREADABLE");
    } finally {
      chmodSync(dirname(path), 0o700);
    }
  });
});
