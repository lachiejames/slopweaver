/*
 * The live wiring's three facts, each of which is a decision the module's own header claims it fixes.
 *
 * The transport is a plain injected object over a recorded call log — never a mock — and the home is a real
 * `mkdtempSync` directory, so what is under test is the shipped `deleteOwnedMessage` and the shipped
 * journal rather than a restatement of them.
 *
 * The verdict cases are what could not be proved one layer down: `settleSupersession` takes a `review`
 * argument and cannot see where it came from, so a wiring that forgot to read `verdict.supersession` would
 * pass every test in `run.test.ts` while deleting a message no reviewer ever looked at.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ReviewVerdict } from "../../../../../admit/reviewVerdict.js";
import type { DeleteMessageOutcome, PostedMessage } from "../../../../../corpus/slack/writeTransport.js";
import { appendTurnCompletionEvent } from "../../../../../live/turn/completionStore.js";
import { answerDigestOf } from "../../../../../live/turn/posterAnswer.js";
import { readSupersessionLog, supersessionLogPath } from "../../../../../live/turn/supersession/store.js";
import { liveSupersession, SUPERSEDABLE_EVENT_TYPES } from "../../../../../live/turn/supersession/wiring.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import {
  ASSISTANT_ANSWER_EVENT_TYPE,
  ASSISTANT_ANSWER_EVENT_TYPE_V2,
} from "../../../../../outbound/assistant/answerMessage.js";
import type { OwnedDeleteTransport } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../../../outbound/slack/lifecycleGuards.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const CHANNEL = "C_THREAD";
const THREAD = "1790048427.171609";
const TARGET = "1790054484.916599";
const POSTED = "1790056000.111111";
const TURN = "turn-1790055912004";
const RECORDED_ISO = "2026-09-22T05:21:30.000Z";

const ASK = { channel: CHANNEL, messageTs: "1790055900.000100", threadTs: THREAD };
const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

/** The target as Slack reports it: this bot's own V2 answer, in this thread, never edited. */
const OURS: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: ASSISTANT_ANSWER_EVENT_TYPE_V2,
  renderer: "slack-assistant-answer-v2",
  threadTs: THREAD,
  ts: TARGET,
  userId: "U_SELF",
};

/** The correction this turn posted — the answer the warrant has to be bound to. */
const REPLACEMENT: AnswerFormAnswer = {
  body: [{ runs: [{ text: "the corrected affected-version claim", type: "text" }], type: "paragraph" }],
  citations: [],
  documents: [],
  grounding: {
    capability: { command: ["fleet", "status"], id: "fleet-status", what: "the affected versions" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "verb",
    provenance: { model: "claude-opus-5", skillsLoaded: ["loop-bot"], verbsLoaded: [] },
    result: "scripted",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "Correcting the affected-version claim.",
  measurements: [],
  supersedes: TARGET,
};

const WARRANTED: ReviewVerdict = {
  answerDigest: answerDigestOf({ answer: REPLACEMENT }),
  authorSession: "worker",
  claims: [],
  outcome: "clean",
  reviewerSession: "reviewer",
  schemaVersion: 1,
  supersession: { reason: "the affected-version claim is replaced", targetTs: TARGET, warranted: true },
};

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home whose completion log already records this install posting the target, in this thread. */
function homeRecordingTheTarget(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-wiring-"));
  homes.push(home);
  appendTurnCompletionEvent({
    event: {
      completion: {
        askIdentity: { channel: CHANNEL, messageTs: "1790049834.166409", threadTs: THREAD },
        primary: { answerTs: TARGET, kind: "answered" },
        provenance: { modelId: "claude-opus-5" },
        secondaryFailures: [],
        turnId: "turn-1790049846181",
        workingTs: "1790054400.000100",
      },
      kind: "turn-completed",
      tsIso: RECORDED_ISO,
    },
    home,
  });
  return home;
}

/** Every call the wiring made, in order, plus every message it removed. */
interface CallLog {
  readonly calls: string[];
  readonly deletes: PostedMessage[];
}

/**
 * The transport, over a call log. A read of any other `ts` answers absent, as the real one does.
 *
 * `laterMessage` is what the SECOND read answers, and it is the only way to express the race this wiring
 * closes: the decision reads the message once, the delete reads it again, and a world where those two reads
 * always agree cannot tell a wiring that forwards the edit guard from one that drops it.
 */
function fakeTransport({
  log,
  message = OURS,
  laterMessage,
}: {
  log: CallLog;
  message?: ReadSlackMessage;
  laterMessage?: ReadSlackMessage;
}): OwnedDeleteTransport {
  let reads = 0;
  return {
    deleteMessageOnce: async ({ posted }: { posted: PostedMessage }): Promise<DeleteMessageOutcome> => {
      log.calls.push("deleteMessageOnce");
      log.deletes.push(posted);
      return { kind: "gone" };
    },
    readMessage: async ({ posted }: { posted: PostedMessage }): Promise<ReadSlackMessage | undefined> => {
      log.calls.push("readMessage");
      reads += 1;
      let answer = message;
      if (reads > 1 && laterMessage !== undefined) {
        answer = laterMessage;
      }
      return posted.ts === answer.ts ? answer : undefined;
    },
    whoAmI: async (): Promise<SlackSelfIdentity> => {
      log.calls.push("whoAmI");
      return SELF;
    },
  };
}

/** The one call every case makes, against a home that already records the target. */
async function settle({
  log,
  verdict,
  message = OURS,
  laterMessage,
  seedJournal,
}: {
  log: CallLog;
  verdict: ReviewVerdict | undefined;
  message?: ReadSlackMessage;
  laterMessage?: ReadSlackMessage;
  seedJournal?: string;
}): Promise<{ readonly report: Awaited<ReturnType<ReturnType<typeof liveSupersession>>>; readonly home: string }> {
  const home = homeRecordingTheTarget();
  if (seedJournal !== undefined) {
    const path = supersessionLogPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, seedJournal, { encoding: "utf8" });
  }
  const settleOne = liveSupersession({
    doorLedger: memoryDoorLedger().port,
    home,
    nowIso: () => "2026-09-22T06:25:01.000Z",
    transport: fakeTransport({ log, message, ...(laterMessage === undefined ? {} : { laterMessage }) }),
    verdict,
  });
  const report = await settleOne({
    askIdentity: ASK,
    declaredTs: TARGET,
    postedAnswer: REPLACEMENT,
    postedAnswerTs: POSTED,
    turnId: TURN,
  });
  return { home, report };
}

describe("SUPERSEDABLE_EVENT_TYPES", () => {
  it("is the two ANSWER kinds and nothing else — a correction never removes furniture", () => {
    expect(SUPERSEDABLE_EVENT_TYPES).toEqual([ASSISTANT_ANSWER_EVENT_TYPE, ASSISTANT_ANSWER_EVENT_TYPE_V2]);
  });
});

describe("liveSupersession forwards the edit guard into the real delete", () => {
  it("refuses an answer edited BETWEEN the decision's read and the delete's own read", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { report } = await settle({
      laterMessage: { ...OURS, editedTs: "1790056013.000000" },
      log,
      verdict: WARRANTED,
    });

    // The mutant this kills is one character: dropping `unchangedSince` from the `deleteOwnedMessage` call
    // in `wiring.ts`. Every other test here reads the same message twice, so none of them can see it
    // (a review found exactly that survivor).
    expect(report.code).toBe("EDITED_SINCE");
    expect(log.deletes).toEqual([]);
    expect(log.calls.filter((call) => call === "readMessage").length).toBe(2);
  });

  it("deletes when the second read agrees with the first, so the guard is not refusing everything", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { report } = await settle({ laterMessage: OURS, log, verdict: WARRANTED });

    expect(report.outcome).toBe("deleted");
    expect(log.deletes).toEqual([{ channel: CHANNEL, ts: TARGET }]);
  });

  it("still deletes a target edited BEFORE the recorded completion, so the instant is that completion's own", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    // `1790054485.000000` (`slopweaver slack when 1790054485.000000`) is five
    // seconds BEFORE the completion row's own RECORDED_ISO. Forwarding SOME instant is not the property —
    // forwarding THAT one is. The mutant this kills replaces `unchangedSince` in `wiring.ts` with a
    // constant epoch, which refuses every edited answer and survived all 6,082 tests across the three unit
    // paths plus the replay lane.
    const editedEarlier: ReadSlackMessage = { ...OURS, editedTs: "1790054485.000000" };
    const { report } = await settle({ laterMessage: editedEarlier, log, message: editedEarlier, verdict: WARRANTED });

    expect(report.outcome).toBe("deleted");
    expect(log.deletes).toEqual([{ channel: CHANNEL, ts: TARGET }]);
  });
});

describe("liveSupersession reads the reviewer's warrant off the VERDICT", () => {
  it("deletes the target when the verdict names it and calls the delete warranted", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { report } = await settle({ log, verdict: WARRANTED });

    expect(report.outcome).toBe("deleted");
    expect(log.deletes).toEqual([{ channel: CHANNEL, ts: TARGET }]);
  });

  it("refuses on UNREVIEWED when no verdict reached the turn, and removes nothing", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { report } = await settle({ log, verdict: undefined });

    expect(report.code).toBe("UNREVIEWED");
    expect(log.deletes).toEqual([]);
  });

  it("refuses on UNREVIEWED when a verdict arrived and said nothing about superseding", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { supersession: _absent, ...silent } = WARRANTED;
    const { report } = await settle({ log, verdict: silent });

    expect(report.code).toBe("UNREVIEWED");
    expect(log.deletes).toEqual([]);
  });

  it("refuses on NOT_WARRANTED when the reviewer looked and called the follow-up additive", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const additive: ReviewVerdict = {
      ...WARRANTED,
      supersession: { reason: "it only adds a caveat", targetTs: TARGET, warranted: false },
    };
    const { report } = await settle({ log, verdict: additive });

    expect(report.code).toBe("NOT_WARRANTED");
    expect(log.deletes).toEqual([]);
  });
});

describe("liveSupersession writes the journal under the home it was given", () => {
  it("leaves both rows of a settled supersession in that home's own log", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { home } = await settle({ log, verdict: WARRANTED });

    const events = readSupersessionLog({ home }).events;
    expect(events.map((event) => event.kind)).toEqual(["supersession-intended", "supersession-settled"]);
    expect(events[0]!.tsIso).toBe("2026-09-22T06:25:01.000Z");
  });

  it("records a refusal that never reached a delete, naming the check that failed", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { home } = await settle({ log, verdict: undefined });

    const events = readSupersessionLog({ home }).events;
    expect(events.map((event) => event.kind)).toEqual(["supersession-settled"]);
    expect(JSON.stringify(events[0])).toContain("UNREVIEWED");
  });

  // The COMPOSITION a torn tail breaks, which neither layer alone can see: `readSupersessionLog` reported the
  // line it could not parse and the wiring dropped that half, so an otherwise eligible correction with a
  // damaged journal deleted as if the log had been empty.
  it("refuses, and deletes nothing, when a line of that home's journal will not parse", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const { report } = await settle({ log, seedJournal: "{not json\n", verdict: WARRANTED });

    expect(report.code).toBe("JOURNAL_UNREADABLE");
    expect(report.detail).toContain("line(s) 1 could not be parsed");
    expect(log.deletes).toEqual([]);
  });
});

describe("liveSupersession refuses a message the ANSWER kinds do not cover", () => {
  it("refuses this bot's own turn checklist on WRONG_EVENT_TYPE rather than deleting it", async () => {
    const log: CallLog = { calls: [], deletes: [] };
    const checklist: ReadSlackMessage = {
      ...OURS,
      metadataEventType: "slopweaver_turn_checklist",
      renderer: "slack-turn-checklist",
    };
    const { report } = await settle({ log, message: checklist, verdict: WARRANTED });

    expect(report.code).toBe("WRONG_EVENT_TYPE");
    expect(log.deletes).toEqual([]);
  });

  it("refuses this bot's own BARE line on MISSING_METADATA, though `slack delete` would take it", async () => {
    // The automatic caller passes `acceptUnmarked: false`; only a human typing `slack delete` opts in.
    const log: CallLog = { calls: [], deletes: [] };
    const bare: ReadSlackMessage = { botId: "B_SELF", fileIds: [], ts: OURS.ts, userId: "U_SELF" };
    const { report } = await settle({ log, message: bare, verdict: WARRANTED });

    expect(report.code).toBe("MISSING_METADATA");
    expect(log.deletes).toEqual([]);
  });
});
