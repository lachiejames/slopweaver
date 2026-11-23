/*
 * `settleSupersession` — the ORDER, and what each ending writes down.
 *
 * Plain injected functions over a recorded call log, never a mock. The guarantees under test are sequences —
 * nothing is read from Slack on an additive turn, the intent row is written BEFORE the delete, the result
 * row after it — and an outcome assertion alone is true of code that does all three in the wrong order.
 *
 * Every refusal case asserts the journal too. A refusal that acts correctly and records nothing leaves an
 * auditor unable to tell it from a turn that never declared anything, which is the exact distinction the
 * two-row journal exists to draw.
 */
import { describe, expect, it } from "vitest";

import type { PostedMessage } from "../../../../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { turnCompletionEventLine } from "../../../../../live/turn/completionLog.js";
import type { AnsweredPredecessor } from "../../../../../live/turn/supersession/completionReader.js";
import type { SupersessionReview, SupersessionWarrant } from "../../../../../live/turn/supersession/eligibility.js";
import { type SupersessionEvent, supersessionAttempts } from "../../../../../live/turn/supersession/journal.js";
import { type SupersessionDeps, settleSupersession } from "../../../../../live/turn/supersession/run.js";
import type { OwnedDeleteOutcome } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import type { ReadSlackMessage } from "../../../../../outbound/slack/lifecycleGuards.js";
import { type OwnedDeleteError, OwnedDeleteErrors } from "../../../../../outbound/slack/ownedDeleteErrors.js";

const CHANNEL = "C_THREAD";
const THREAD = "1790048427.171609";
const TARGET = "1790054484.916599";
const POSTED = "1790056000.111111";
const POSTED_DIGEST = `sha256:${"c".repeat(64)}`;

/** An independent reviewer, bound to the digest of the answer this turn posted. */
const WARRANT: SupersessionWarrant = {
  answerDigest: POSTED_DIGEST,
  authorSession: "worker",
  reviewerSession: "reviewer",
};
const TURN = "turn-1790055912004";
const RECORDED_ISO = "2026-09-22T05:21:30.000Z";

const ASK = { channel: CHANNEL, messageTs: "1790055900.000100", threadTs: THREAD };

const REVIEW: SupersessionReview = {
  reason: "the new answer replaces the affected-version claim",
  targetTs: TARGET,
  warranted: true,
};

const LIVE: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: "slopweaver_assistant_answer_v2",
  renderer: "slack-assistant-answer-v2",
  threadTs: THREAD,
  ts: TARGET,
  userId: "U_SELF",
};

/** A completion log holding exactly one answered turn at {@link TARGET}, built by the real writer. */
function completionLog({ answerTs = TARGET }: { answerTs?: string } = {}): string {
  const predecessor: AnsweredPredecessor = {
    answerTs,
    askIdentity: { channel: CHANNEL, messageTs: "1790049834.166409", threadTs: THREAD },
    recordedIso: RECORDED_ISO,
    turnId: "turn-1790049846181",
  };
  return `${turnCompletionEventLine({
    event: {
      completion: {
        askIdentity: predecessor.askIdentity,
        primary: { answerTs: predecessor.answerTs, kind: "answered" },
        provenance: { modelId: "claude-opus-5" },
        secondaryFailures: [],
        turnId: predecessor.turnId,
        workingTs: "1790054400.000100",
      },
      kind: "turn-completed",
      tsIso: RECORDED_ISO,
    },
  })}\n`;
}

/** Every call the shell made, in order, plus every row it journalled. */
interface Log {
  readonly calls: string[];
  readonly rows: SupersessionEvent[];
  readonly deleted: PostedMessage[];
  /** Each delete's `unchangedSince` — the edit guard the DELETE's own read re-applies. */
  readonly guardedSince: string[];
}

function freshLog(): Log {
  return { calls: [], deleted: [], guardedSince: [], rows: [] };
}

/** The deps, with any seam swapped for the case under test. */
function deps({
  log,
  completions = completionLog(),
  read = ok(LIVE),
  attempt = ok({ kind: "deleted", posted: { channel: CHANNEL, ts: TARGET } }),
  journalThrowsOn,
  completionsThrow,
  nowIsoThrows,
  attemptsReadFailure,
}: {
  log: Log;
  completions?: string;
  read?: Result<ReadSlackMessage, OwnedDeleteError>;
  attempt?: Result<OwnedDeleteOutcome, OwnedDeleteError>;
  journalThrowsOn?: SupersessionEvent["kind"] | undefined;
  completionsThrow?: unknown;
  nowIsoThrows?: string | undefined;
  attemptsReadFailure?: string | undefined;
}): SupersessionDeps {
  let instant = 0;
  return {
    deleteOwned: async ({ posted, unchangedSince }) => {
      log.calls.push("deleteOwned");
      log.deleted.push(posted);
      log.guardedSince.push(unchangedSince);
      return attempt;
    },
    journal: ({ event }) => {
      log.calls.push(`journal:${event.kind}`);
      if (event.kind === journalThrowsOn) {
        throw new Error("EISDIR: illegal operation on a directory, open 'supersessions.jsonl'");
      }
      log.rows.push(event);
    },
    nowIso: () => {
      if (nowIsoThrows !== undefined) {
        throw new Error(nowIsoThrows);
      }
      instant += 1;
      return `2026-09-22T06:25:0${instant}.000Z`;
    },
    // The REAL fold over the rows this same fake journalled, not a canned answer: that makes a second
    // `settleSupersession` in one case see the first one's intent exactly as the live seam would.
    readAttempts: () => ({
      attempts: supersessionAttempts({ events: log.rows }),
      readFailure: attemptsReadFailure,
    }),
    readCompletions: () => {
      log.calls.push("readCompletions");
      if (completionsThrow !== undefined) {
        throw completionsThrow;
      }
      return completions;
    },
    readOwned: async () => {
      log.calls.push("readOwned");
      return read;
    },
  };
}

/**
 * The call every case makes, with one input swapped.
 *
 * `declaredTs` and `review` are merged by SPREAD rather than by a destructured default, because a default
 * fires on an explicitly passed `undefined` too — so `settle({ review: undefined })` would have quietly run
 * the passing case and the absent-reviewer test would have proved nothing.
 */
async function settle({
  log,
  ...rest
}: {
  log: Log;
  declaredTs?: string | undefined;
  review?: SupersessionReview | undefined;
  warrant?: SupersessionWarrant | undefined;
  postedAnswerDigest?: string;
  completions?: string;
  read?: Result<ReadSlackMessage, OwnedDeleteError>;
  attempt?: Result<OwnedDeleteOutcome, OwnedDeleteError>;
  journalThrowsOn?: SupersessionEvent["kind"] | undefined;
  completionsThrow?: unknown;
  nowIsoThrows?: string | undefined;
  attemptsReadFailure?: string | undefined;
}): ReturnType<typeof settleSupersession> {
  const {
    completions,
    read,
    attempt,
    journalThrowsOn,
    completionsThrow,
    nowIsoThrows,
    attemptsReadFailure,
    ...inputs
  } = rest;
  return settleSupersession({
    askIdentity: ASK,
    declaredTs: TARGET,
    postedAnswerDigest: POSTED_DIGEST,
    postedAnswerTs: POSTED,
    review: REVIEW,
    turnId: TURN,
    warrant: WARRANT,
    ...inputs,
    deps: deps({
      log,
      ...(attempt === undefined ? {} : { attempt }),
      ...(attemptsReadFailure === undefined ? {} : { attemptsReadFailure }),
      ...(completions === undefined ? {} : { completions }),
      ...(completionsThrow === undefined ? {} : { completionsThrow }),
      ...(journalThrowsOn === undefined ? {} : { journalThrowsOn }),
      ...(nowIsoThrows === undefined ? {} : { nowIsoThrows }),
      ...(read === undefined ? {} : { read }),
    }),
  });
}

describe("settleSupersession — an additive turn", () => {
  it("does nothing at all, and touches neither Slack nor the journal", async () => {
    const log = freshLog();
    const report = await settle({ declaredTs: undefined, log });

    expect(report).toEqual({ outcome: "not-declared" });
    expect(log.calls).toEqual([]);
  });
});

describe("settleSupersession — the delete that happens", () => {
  it("reads the record, reads the message, journals the intent, deletes, journals the result — in that order", async () => {
    const log = freshLog();
    const report = await settle({ log });

    expect(log.calls).toEqual([
      "readCompletions",
      "readOwned",
      "journal:supersession-intended",
      "deleteOwned",
      "journal:supersession-settled",
    ]);
    expect(report.outcome).toBe("deleted");
    expect(log.deleted).toEqual([{ channel: CHANNEL, ts: TARGET }]);
  });

  it("hands the delete the same instant the decision judged by, so its own read re-applies the edit guard", async () => {
    const log = freshLog();
    await settle({ log });

    // The completion that recorded the target, not the correction's own clock: an edit landing between the
    // eligibility read and the delete's read is only caught if both compare against the same instant
    // (a review executed the open version and deleted an edited message).
    expect(log.guardedSince).toEqual([RECORDED_ISO]);
  });

  it("writes an intent naming both messages, both turns and the reviewer's warrant", async () => {
    const log = freshLog();
    await settle({ log });

    expect(log.rows[0]).toEqual({
      answerTs: POSTED,
      channel: CHANNEL,
      kind: "supersession-intended",
      reason: REVIEW.reason,
      schemaVersion: 1,
      supersededTurnId: "turn-1790049846181",
      targetTs: TARGET,
      threadTs: THREAD,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });
  });

  it("reports an already-gone target as such rather than as a delete it performed", async () => {
    const log = freshLog();
    const report = await settle({
      attempt: ok({ kind: "already-gone", posted: { channel: CHANNEL, ts: TARGET } }),
      log,
    });

    expect(report.outcome).toBe("already-gone");
    expect(log.rows[1]!.kind).toBe("supersession-settled");
  });
});

describe("settleSupersession — a delete that did not settle cleanly", () => {
  it("records an UNCONFIRMED delete as its own outcome, because the message may be gone", async () => {
    const log = freshLog();
    const report = await settle({
      attempt: err(OwnedDeleteErrors.deleteUnconfirmed({ reason: "socket hang up", ts: TARGET })),
      log,
    });

    expect(report.outcome).toBe("unconfirmed");
    expect(report.code).toBe("DELETE_UNCONFIRMED");
    // The ROWS, not just the codes. A mutation that returned the settlement straight out of
    // `deleteAndRecord` on this arm — skipping the result append entirely — left this file and the replay
    // lane green while an entered delete went unrecorded.
    expect(log.calls).toEqual([
      "readCompletions",
      "readOwned",
      "journal:supersession-intended",
      "deleteOwned",
      "journal:supersession-settled",
    ]);
    expect(log.rows[1]).toEqual({
      code: "DELETE_UNCONFIRMED",
      detail:
        "chat.delete of 1790054484.916599 did not confirm removal — socket hang up; the message may still be visible",
      kind: "supersession-settled",
      outcome: "unconfirmed",
      schemaVersion: 1,
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:02.000Z",
      turnId: TURN,
    });
  });

  it("records a door refusal as refused, keeping the intent that preceded it", async () => {
    const log = freshLog();
    const decision = { findings: [], overridden: [], status: "hold" } as const;
    const report = await settle({
      attempt: err(OwnedDeleteErrors.doorRefused({ decision, ts: TARGET })),
      log,
    });

    expect(report.outcome).toBe("refused");
    expect(report.code).toBe("DOOR_REFUSED");
    expect(log.rows.map((row) => row.kind)).toEqual(["supersession-intended", "supersession-settled"]);
  });
});

describe("settleSupersession — a refusal that never reaches a delete", () => {
  it("records the read's OWN code when the message is not ours, and deletes nothing", async () => {
    const log = freshLog();
    const report = await settle({
      log,
      read: err(OwnedDeleteErrors.notOurs({ messageBotId: undefined, ts: TARGET })),
    });

    expect(report.code).toBe("NOT_OURS");
    expect(log.calls).toEqual(["readCompletions", "readOwned", "journal:supersession-settled"]);
    expect(log.deleted).toEqual([]);
  });

  it("refuses a target this install never recorded posting, and says so in the journal", async () => {
    const log = freshLog();
    const report = await settle({ completions: "", log });

    expect(report.code).toBe("NO_SUCH_ANSWER");
    expect(log.rows.length).toBe(1);
    expect(log.rows[0]!.kind).toBe("supersession-settled");
    expect(log.deleted).toEqual([]);
  });

  it("refuses an unreviewed supersession and never asks the door", async () => {
    const log = freshLog();
    const report = await settle({ log, review: undefined });

    expect(report.code).toBe("UNREVIEWED");
    expect(log.calls).toEqual(["readCompletions", "readOwned", "journal:supersession-settled"]);
    expect(log.rows[0]!.kind).toBe("supersession-settled");
    expect(log.deleted).toEqual([]);
  });

  it("refuses a live message hanging in another thread, naming that thread", async () => {
    const log = freshLog();
    const report = await settle({ log, read: ok({ ...LIVE, threadTs: "1790000000.000900" }) });

    expect(report.code).toBe("LIVE_THREAD_MISMATCH");
    expect(report.detail).toContain("1790000000.000900");
    expect(log.deleted).toEqual([]);
  });
});

/*
 * The journal is the one thing this shell writes itself, and `./store.ts` writes it synchronously — so
 * every one of these cases is the same class the r1 review found: a fallible effect standing AFTER an
 * irreversible one. A throw escaping here rejects a turn whose answer already posted, and on the result-row
 * path it does so with the superseded answer already deleted.
 */
describe("settleSupersession — a journal that cannot be written", () => {
  it("still reports the delete that happened, and says the row is missing rather than swallowing it", async () => {
    const log = freshLog();
    const report = await settle({ journalThrowsOn: "supersession-settled", log });

    expect(report.outcome).toBe("deleted");
    // The CODE matters as much as the sentence: `../outcomeFields.ts` drops a clean removal, so a detail
    // with no code beside it never reaches the turn at all.
    expect(report.code).toBe("JOURNAL_UNWRITABLE");
    expect(report.detail).toBe(
      "the journal row recording this supersession could not be written: EISDIR: illegal operation on a " +
        "directory, open 'supersessions.jsonl'",
    );
    expect(log.deleted).toEqual([{ channel: CHANNEL, ts: TARGET }]);
  });

  it("contains a CLOCK that throws while the row is being built, not only a journal that will not take it", async () => {
    const log = freshLog();
    // Why `record` builds the row INSIDE its own try rather than taking a finished one: `nowIso` is a seam
    // like any other, and a row built outside the containment takes the clock's throw straight out through
    // every layer. Moving that one line out survives every other test here.
    const report = await settle({
      log,
      nowIsoThrows: "clock failed",
      read: err(OwnedDeleteErrors.notOurs({ messageBotId: undefined, ts: TARGET })),
    });

    expect(report.outcome).toBe("refused");
    expect(report.code).toBe("NOT_OURS");
    expect(report.detail).toContain("the journal row recording it could not be written: clock failed");
    expect(log.rows).toEqual([]);
    expect(log.deleted).toEqual([]);
  });

  it("refuses BEFORE the delete when the intent row cannot be written, so no unrecorded message comes down", async () => {
    const log = freshLog();
    const report = await settle({ journalThrowsOn: "supersession-intended", log });

    expect(report.code).toBe("JOURNAL_UNWRITABLE");
    expect(report.outcome).toBe("refused");
    expect(log.deleted).toEqual([]);
    expect(log.calls).not.toContain("deleteOwned");
    expect(log.rows.length).toBe(1);
    expect(log.rows[0]!.kind).toBe("supersession-settled");
  });
});

describe("settleSupersession — a seam that throws", () => {
  it("reports `unconfirmed` rather than rejecting, because it cannot know which side of the delete it was on", async () => {
    const log = freshLog();
    const report = await settle({ completionsThrow: "EACCES: permission denied, open 'turn-completions.jsonl'", log });

    expect(report.outcome).toBe("unconfirmed");
    expect(report.code).toBe("SUPERSESSION_THREW");
    expect(report.targetTs).toBe(TARGET);
    expect(report.detail).toContain("EACCES: permission denied");
  });

  it("leaves a settled row behind, so the audit can tell it from a turn that declared nothing", async () => {
    const log = freshLog();
    await settle({ completionsThrow: "EACCES: permission denied, open 'turn-completions.jsonl'", log });

    expect(log.rows.length).toBe(1);
    expect(log.rows[0]).toEqual({
      code: "SUPERSESSION_THREW",
      detail:
        "the supersession failed part-way through and may or may not have deleted anything — EACCES: " +
        "permission denied, open 'turn-completions.jsonl'",
      kind: "supersession-settled",
      outcome: "unconfirmed",
      schemaVersion: 1,
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });
  });

  it("reports the row it could not write when the journal is broken too, instead of falling silent", async () => {
    const log = freshLog();
    const report = await settle({
      completionsThrow: "EACCES: permission denied, open 'turn-completions.jsonl'",
      journalThrowsOn: "supersession-settled",
      log,
    });

    expect(log.rows).toEqual([]);
    expect(report.outcome).toBe("unconfirmed");
    expect(report.detail).toContain("the journal row recording it could not be written: EISDIR");
  });
});

describe("settleSupersession — a thrown value that cannot even be printed", () => {
  it("still returns a report, because a containment layer that throws while describing a throw is not one", async () => {
    const log = freshLog();
    // `Object.create(null)` has no prototype, so `String(it)` raises TypeError: Cannot convert object to
    // primitive value. Found by the r1 review as a counterexample to the no-throw property.
    const report = await settle({ completionsThrow: Object.create(null) as unknown, log });

    expect(report.outcome).toBe("unconfirmed");
    expect(report.code).toBe("SUPERSESSION_THREW");
    expect(report.detail).toBe(
      "the supersession failed part-way through and may or may not have deleted anything — the thrown " +
        "value (a object) could not be inspected or printed",
    );
    expect(log.rows.length).toBe(1);
  });

  it("survives an Error whose `message` is not a string, which only throws once a CALLER prints it", async () => {
    const log = freshLog();
    // The r1 review's third counterexample. `message` is typed `string` and need not be one: returned raw,
    // it reached the outer catch's own string concatenation and threw there — past every layer of
    // containment, with no journal row written.
    const thrown = new Error("failure");
    Object.defineProperty(thrown, "message", { value: Symbol("failure") });
    const report = await settle({ completionsThrow: thrown, log });

    expect(report.outcome).toBe("unconfirmed");
    expect(report.code).toBe("SUPERSESSION_THREW");
    expect(report.detail).toBe(
      "the supersession failed part-way through and may or may not have deleted anything — Symbol(failure)",
    );
    expect(log.rows.length).toBe(1);
  });

  it("survives a REVOKED proxy, whose prototype chain `instanceof` itself cannot walk", async () => {
    const log = freshLog();
    // The r1 review's second counterexample, after the first was fixed by guarding only the conversion:
    // `thrown instanceof Error` raises TypeError on a revoked proxy, so the guard has to cover both steps.
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    const report = await settle({ completionsThrow: revocable.proxy, log });

    expect(report.outcome).toBe("unconfirmed");
    expect(report.code).toBe("SUPERSESSION_THREW");
    expect(report.detail).toContain("could not be inspected or printed");
    expect(log.rows.length).toBe(1);
  });
});

describe("settleSupersession — at most once per turn and target", () => {
  const OTHER = "1790061193.442100";

  // A review pass drove `liveSupersession` twice
  // for one correction after a first delete reported `unconfirmed`, and watched TWO deletes go out and two
  // intent/result pairs land: `supersessionAttempts` existed and nothing in the run path ever read it.
  it("refuses a second delete for the same turn and target, and asks the door only once", async () => {
    const log = freshLog();
    const first = await settle({ log });
    const second = await settle({ log });

    expect(first.outcome).toBe("deleted");
    expect(second.code).toBe("ALREADY_ATTEMPTED");
    expect(second.detail).toBe(
      `this turn already journalled an intent to delete ${TARGET} at 2026-09-22T06:25:01.000Z — a delete ` +
        "is attempted at most once per turn and target, whatever that first attempt went on to report",
    );
    expect(log.deleted).toEqual([{ channel: CHANNEL, ts: TARGET }]);
  });

  // The falsifiable half: the key is (turn, target) TOGETHER. Keyed on the turn alone this case would
  // refuse, and the case above would pass just the same — which is exactly the mutant to hold down.
  it("still deletes when the same turn declares a different target", async () => {
    const log = freshLog();
    await settle({ log });
    const second = await settle({
      completions: completionLog({ answerTs: OTHER }),
      declaredTs: OTHER,
      log,
      read: ok({ ...LIVE, ts: OTHER }),
      review: { reason: REVIEW.reason, targetTs: OTHER, warranted: true },
    });

    expect(second.outcome).toBe("deleted");
    expect(log.deleted).toEqual([
      { channel: CHANNEL, ts: TARGET },
      { channel: CHANNEL, ts: OTHER },
    ]);
  });

  // A review pass made the journal unreadable
  // between two runs of one correction and watched a second delete go out: the store caught every open
  // failure and answered an empty list, so "we cannot tell" arrived here spelled "never attempted".
  it("refuses, and asks the door not at all, when the journal itself could not be read", async () => {
    const log = freshLog();
    const only = await settle({ attemptsReadFailure: "EACCES: permission denied", log });

    expect(only.code).toBe("JOURNAL_UNREADABLE");
    expect(only.detail).toBe(
      "the supersession journal could not be read, so whether this turn already tried to delete " +
        `${TARGET} is unknown — EACCES: permission denied`,
    );
    expect(log.deleted).toEqual([]);
  });
});
