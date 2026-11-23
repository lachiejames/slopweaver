import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimPollRecord,
  confirmPollRecord,
  findPollByMessage,
  type PollRecord,
  readPollRecord,
  revisePollRecord,
} from "../../../../outbound/slack/pollStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh isolated home per test — a real filesystem round-trip, never a mock. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-poll-store-"));
  fixtureDirs.push(dir);
  return dir;
}

function record({ pollId, channel = "D0TEST", ts }: { pollId: string; channel?: string; ts?: string }): PollRecord {
  return {
    channel,
    createdIso: "2026-07-31T00:00:00.000Z",
    emojiNames: ["one", "two"],
    options: ["Waiting", "CI"],
    pollId,
    question: "Where did the time go?",
    schemaVersion: 1,
    why: "Finding the friction.",
    ...(ts === undefined ? {} : { ts }),
  };
}

/** The store directory, resolved the same way the module does rather than hardcoded. */
function pollsDirOf({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "slack-polls");
}

/** A read narrowed loudly to `found` — never narrowed inside an assertion. */
function foundOf({ home, pollId }: { home: string; pollId: string }): PollRecord {
  const read = readPollRecord({ home, pollId });
  if (read.kind !== "found") {
    throw new Error(`expected a found record, got ${read.kind}`);
  }
  return read.record;
}

/** A read narrowed loudly to `unreadable`, returning its reason. */
function unreadableReason({ home, pollId }: { home: string; pollId: string }): string {
  const read = readPollRecord({ home, pollId });
  if (read.kind !== "unreadable") {
    throw new Error(`expected an unreadable record, got ${read.kind}`);
  }
  return read.reason;
}

/** The located record, narrowed loudly — an assertion may not contain a `?.` conditional. */
function locatedRecord({ home, channel, ts }: { home: string; channel: string; ts: string }): PollRecord {
  const found = findPollByMessage({ channel, home, ts });
  if (found.record === undefined) {
    throw new Error(`expected to locate a poll at ${channel}:${ts}`);
  }
  return found.record;
}

/** Write raw bytes as a poll record file, for the corrupt-store cases. */
function writeRaw({ home, pollId, raw }: { home: string; pollId: string; raw: string }): void {
  mkdirSync(pollsDirOf({ home }), { recursive: true });
  writeFileSync(join(pollsDirOf({ home }), `${pollId}.json`), raw);
}

describe("claimPollRecord", () => {
  it("claims a fresh id and round-trips every field exactly", () => {
    const home = freshHome();

    expect(claimPollRecord({ home, record: record({ pollId: "abc" }) })).toEqual({ kind: "claimed" });
    expect(foundOf({ home, pollId: "abc" })).toEqual({
      channel: "D0TEST",
      createdIso: "2026-07-31T00:00:00.000Z",
      emojiNames: ["one", "two"],
      options: ["Waiting", "CI"],
      pollId: "abc",
      question: "Where did the time go?",
      schemaVersion: 1,
      why: "Finding the friction.",
    });
  });

  it("reports `exists` on a second claim — distinct from a write failure", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ pollId: "abc" }) });

    expect(claimPollRecord({ home, record: record({ pollId: "abc" }) })).toEqual({ kind: "exists" });
  });

  it("leaves no `ts` on a claim, because nothing has been posted yet", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ pollId: "abc" }) });

    expect(foundOf({ home, pollId: "abc" }).ts).toBeUndefined();
  });
});

describe("readPollRecord", () => {
  it("reports `absent` for an id that was never claimed", () => {
    expect(readPollRecord({ home: freshHome(), pollId: "nope" })).toEqual({ kind: "absent" });
  });

  it("reports `unreadable` for bytes that are not JSON, never `absent`", () => {
    const home = freshHome();
    writeRaw({ home, pollId: "bad", raw: "{not json" });

    expect(unreadableReason({ home, pollId: "bad" })).toContain("not valid JSON");
  });

  it("reports `unreadable` when a required field is missing", () => {
    const home = freshHome();
    writeRaw({ home, pollId: "bad", raw: JSON.stringify({ pollId: "bad", schemaVersion: 1 }) });

    expect(unreadableReason({ home, pollId: "bad" })).toContain("missing or wrongly-typed");
  });

  it("reports `unreadable` when the ballot and the options disagree in length", () => {
    const home = freshHome();
    writeRaw({
      home,
      pollId: "bad",
      raw: JSON.stringify({ ...record({ pollId: "bad" }), emojiNames: ["one"], options: ["A", "B"] }),
    });

    expect(unreadableReason({ home, pollId: "bad" })).toContain("ballot corrupt");
  });

  it("reports `unreadable` for an unknown schema version rather than guessing at the shape", () => {
    const home = freshHome();
    writeRaw({ home, pollId: "bad", raw: JSON.stringify({ ...record({ pollId: "bad" }), schemaVersion: 2 }) });

    expect(unreadableReason({ home, pollId: "bad" })).toContain("missing or wrongly-typed");
  });
});

describe("confirmPollRecord", () => {
  it("attaches the confirmed ts and the confirmation time", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ pollId: "abc" }) });

    const confirmed = confirmPollRecord({
      home,
      nowIso: "2026-07-31T01:02:03.000Z",
      pollId: "abc",
      ts: "1785418591.953499",
    });

    expect(confirmed).toEqual({ kind: "confirmed" });
    expect(foundOf({ home, pollId: "abc" }).ts).toBe("1785418591.953499");
    expect(foundOf({ home, pollId: "abc" }).confirmedIso).toBe("2026-07-31T01:02:03.000Z");
  });

  it("refuses to confirm an id that was never claimed, and says why", () => {
    const confirmed = confirmPollRecord({
      home: freshHome(),
      nowIso: "2026-07-31T01:02:03.000Z",
      pollId: "ghost",
      ts: "1.1",
    });

    expect(confirmed).toEqual({ kind: "failed", reason: "cannot confirm poll ghost: record is absent" });
  });

  it("is idempotent — confirming twice leaves the same ts", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ pollId: "abc" }) });
    confirmPollRecord({ home, nowIso: "2026-07-31T01:00:00.000Z", pollId: "abc", ts: "1.1" });

    expect(confirmPollRecord({ home, nowIso: "2026-07-31T02:00:00.000Z", pollId: "abc", ts: "1.1" })).toEqual({
      kind: "confirmed",
    });
    expect(foundOf({ home, pollId: "abc" }).ts).toBe("1.1");
  });
});

describe("revisePollRecord", () => {
  it("moves only the question and the reason, leaving the ballot and the confirmation as they were", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ pollId: "abc" }) });
    confirmPollRecord({ home, nowIso: "2026-07-31T01:00:00.000Z", pollId: "abc", ts: "1.1" });

    expect(
      revisePollRecord({ home, pollId: "abc", question: "Where does the week go?", why: "Still finding it." }),
    ).toEqual({
      kind: "confirmed",
    });
    expect(foundOf({ home, pollId: "abc" })).toEqual({
      ...record({ pollId: "abc", ts: "1.1" }),
      confirmedIso: "2026-07-31T01:00:00.000Z",
      question: "Where does the week go?",
      why: "Still finding it.",
    });
  });

  it("refuses to revise an id that was never claimed, and says why", () => {
    expect(revisePollRecord({ home: freshHome(), pollId: "ghost", question: "q", why: "w" })).toEqual({
      kind: "failed",
      reason: "cannot revise poll ghost: record is absent",
    });
  });
});

describe("findPollByMessage", () => {
  it("finds a confirmed poll by its channel and ts", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ channel: "D0AAA", pollId: "abc" }) });
    confirmPollRecord({ home, nowIso: "2026-07-31T01:00:00.000Z", pollId: "abc", ts: "111.222" });

    expect(locatedRecord({ channel: "D0AAA", home, ts: "111.222" }).pollId).toBe("abc");
    expect(findPollByMessage({ channel: "D0AAA", home, ts: "111.222" }).unreadable).toEqual([]);
  });

  it("does not match a poll in a different channel with the same ts", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ channel: "D0AAA", pollId: "abc" }) });
    confirmPollRecord({ home, nowIso: "2026-07-31T01:00:00.000Z", pollId: "abc", ts: "111.222" });

    expect(findPollByMessage({ channel: "D0BBB", home, ts: "111.222" }).record).toBeUndefined();
  });

  it("does not match an UNCONFIRMED poll, which has no ts to match on", () => {
    const home = freshHome();
    claimPollRecord({ home, record: record({ channel: "D0AAA", pollId: "abc" }) });

    expect(findPollByMessage({ channel: "D0AAA", home, ts: "111.222" }).record).toBeUndefined();
  });

  it("reports records it could not parse instead of silently skipping them", () => {
    const home = freshHome();
    writeRaw({ home, pollId: "broken", raw: "{{{" });

    const found = findPollByMessage({ channel: "D0AAA", home, ts: "111.222" });

    expect(found.record).toBeUndefined();
    expect(found.unreadable).toEqual(["broken.json"]);
  });

  it("treats an absent store as simply no polls", () => {
    expect(findPollByMessage({ channel: "D0AAA", home: freshHome(), ts: "1.1" })).toEqual({
      record: undefined,
      unreadable: [],
    });
  });
});
