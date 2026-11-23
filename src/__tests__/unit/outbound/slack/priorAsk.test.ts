/**
 * The re-ask judgement: which words ask, what makes an earlier ask answered,
 * which declarations refuse, and what the row keeps.
 */
import { describe, expect, it } from "vitest";

import type { NoFoldArtifact, OneCardArtifact } from "../../../../outbound/artifact/types.js";
import type { ParkedPriorAsk } from "../../../../outbound/slack/draftRegister.js";
import {
  type AskedBefore,
  answersSinceRecording,
  askingWords,
  askingWordsOfBot,
  judgePriorAsk,
  type PriorJudgement,
  type PriorRead,
  parkedPriorAsk,
  priorAskRefusal,
  undeclaredAskRefusal,
} from "../../../../outbound/slack/priorAsk.js";

const SELF = "U0SYNADAOWN";
const PERMALINK = "https://acme.slack.com/archives/C0ISO/p1789000000000100";
const OURS = { text: "is the key spend expected?", ts: "1789000000.000100", userId: SELF };
const ANSWER = { text: "yes, the batch job", ts: "1789000100.000100", userId: "U0JONAH" };

/** A one-card form of one line of plain runs. */
function oneCard({ runs }: { runs: OneCardArtifact["lines"][number]["runs"] }): OneCardArtifact {
  return { kind: "one-card", lines: [{ runs }] };
}

const PRIOR: Extract<AskedBefore, { kind: "prior" }> = { changedMedia: [], kind: "prior", permalink: PERMALINK };

describe("askingWords — the authored words that ask", () => {
  it("reads an ask phrase and a closing question mark", () => {
    const asked = [
      oneCard({ runs: [{ text: "reply yes and i will switch it on.", type: "text" }] }),
      oneCard({ runs: [{ text: "is the key spend expected?", type: "text" }] }),
    ].map((artifact) => askingWords({ artifact }));
    expect(asked).toEqual(["reply yes", "expected?"]);
  });

  it("never reads a question mark inside a code run or a link label as ours", () => {
    const artifact = oneCard({
      runs: [
        { text: "the guard is ", type: "text" },
        { code: true, text: "x?.y", type: "text" },
        { text: ", see ", type: "text" },
        { label: "why does it fail?", type: "link", url: "https://example.com/issue" },
      ],
    });
    expect(askingWords({ artifact })).toBe(undefined);
  });

  it("strikes code, links and quoted lines out of a plain form before reading it", () => {
    const quoted = askingWords({
      artifact: { kind: "plain", text: "> did it ship?\nit shipped `x?` <https://a.b|why?>" },
    });
    const asked = askingWords({ artifact: { kind: "plain", text: "> it shipped\ndid the deploy land?" } });
    expect([quoted, asked]).toEqual([undefined, "land?"]);
  });
});

describe("askingWordsOfBot — every authored cell, the detail included", () => {
  it("finds a finding's question below the fold", () => {
    const artifact: NoFoldArtifact = {
      bullets: [[{ text: "spend tripled at 03:10Z", type: "text" }]],
      kind: "no-fold",
      lead: [{ text: "key spend is up on the batch key.", type: "text" }],
      trailing: [[{ text: "is this expected?", type: "text" }]],
    };
    const quiet: NoFoldArtifact = { ...artifact, trailing: [] };
    expect([askingWordsOfBot({ artifact }), askingWordsOfBot({ artifact: quiet })]).toEqual(["expected?", undefined]);
  });
});

describe("judgePriorAsk — ours, and who answered after it", () => {
  it("is not-found when the read holds no message at the link", () => {
    const read: PriorRead = { addressedTs: OURS.ts, channelTopLevel: [], messages: [ANSWER] };
    expect(judgePriorAsk({ read, selfUserId: SELF })).toEqual({ kind: "not-found" });
  });

  it("is not-ours when somebody else wrote the linked message", () => {
    const read: PriorRead = { addressedTs: ANSWER.ts, channelTopLevel: [], messages: [OURS, ANSWER] };
    expect(judgePriorAsk({ read, selfUserId: SELF })).toEqual({ kind: "not-ours", userId: "U0JONAH" });
  });

  it("counts only a person's words AFTER ours: not ours, not a bot's, not a system row, not the root before", () => {
    const read: PriorRead = {
      addressedTs: OURS.ts,
      channelTopLevel: [],
      messages: [
        { text: "the thread root somebody else opened", ts: "1788999999.000100", userId: "U0ROOT" },
        { botId: "B0CI", text: "deploy finished", ts: "1789000050.000100", userId: "U0CIAPP" },
        { text: "ANSWER LATER", ts: "1789000200.000100", userId: "U0ADA" },
        OURS,
        { subtype: "channel_join", text: "joined", ts: "1789000060.000100", userId: "U0NEW" },
        { text: "following up myself", ts: "1789000070.000100", userId: SELF },
        { subtype: "thread_broadcast", text: "broadcast answer", ts: "1789000150.000100", userId: "U0BEA" },
        ANSWER,
      ],
    };
    expect(judgePriorAsk({ read, selfUserId: SELF })).toEqual({
      answers: [
        ANSWER,
        { text: "broadcast answer", ts: "1789000150.000100", userId: "U0BEA" },
        { text: "ANSWER LATER", ts: "1789000200.000100", userId: "U0ADA" },
      ],
      kind: "read",
      ours: OURS,
      readThroughTs: "1789000200.000100",
    });
  });

  it("reads through ours alone when nothing came after it", () => {
    const read: PriorRead = { addressedTs: OURS.ts, channelTopLevel: [], messages: [OURS] };
    expect(judgePriorAsk({ read, selfUserId: SELF })).toEqual({
      answers: [],
      kind: "read",
      ours: OURS,
      readThroughTs: OURS.ts,
    });
  });
});

describe("judgePriorAsk — an answer posted at the top of the channel", () => {
  // An ask in #C0SYN000001: Ari answered 27 seconds later as the next top-level message.
  const ASK = {
    text: "Hey <@U0ARI>, we're now at 4 owing. Are you already chasing any of these?",
    ts: "1791341338.708319",
    userId: SELF,
  };
  const ARI = { text: "Nope have not been chasing", ts: "1791341365.000100", userId: "U0ARI" };
  const SKULL = { text: ":skull:", ts: "1791341368.000100", userId: "U0ARI" };
  const LATER = { text: "unrelated, a day on", ts: "1791380000.000100", userId: "U0SETH" };

  it("ties the next top-level post by the person ours tagged as an answer, beside nothing in the thread", () => {
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [ASK, ARI, SKULL, LATER], messages: [ASK] };
    expect(judgePriorAsk({ read, selfUserId: SELF })).toEqual({
      answers: [ARI],
      kind: "read",
      ours: ASK,
      readThroughTs: ASK.ts,
      topLevelTie: { kind: "answers", post: ARI },
    });
  });

  it("leaves the channel moving on unanswered, and the read mark the thread's own", () => {
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [ASK, LATER], messages: [ASK] };
    expect(judgePriorAsk({ read, selfUserId: SELF })).toEqual({
      answers: [],
      kind: "read",
      ours: ASK,
      readThroughTs: ASK.ts,
    });
  });

  it("keeps a thread reply and the tied post together, oldest first, each once", () => {
    const reply = { text: "in thread too", ts: "1791341400.000100", userId: "U0SETH" };
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [ARI, ARI], messages: [ASK, reply] };
    expect(readArm({ judged: judgePriorAsk({ read, selfUserId: SELF }) }).answers).toEqual([ARI, reply]);
  });

  it("refuses the re-ask over a clear top-level answer, saying where it was", () => {
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [ARI], messages: [ASK] };
    const lines = priorAskRefusal({ declared: PRIOR, judgement: judgePriorAsk({ read, selfUserId: SELF }) });
    expect(lines[0]).toContain(
      'ANSWERED — 1 reply by somebody else after ours, the first: "Nope have not been chasing"',
    );
    expect(lines[0]).toContain(
      "chasing\". It was posted at the top of the channel, the next person's message after ours. Asking",
    );
    expect(lines[0]!.split("Nope have not been chasing").length).toBe(2);
  });

  it("quotes the top-level answer apart when a thread reply came first", () => {
    const reply = { text: "in thread first", ts: "1791341350.000100", userId: "U0SETH" };
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [ARI], messages: [ASK, reply] };
    const lines = priorAskRefusal({ declared: PRIOR, judgement: judgePriorAsk({ read, selfUserId: SELF }) });
    expect(lines[0]).toContain(
      'the first: "in thread first". One was posted at the top of the channel, the next person\'s message after ' +
        'ours: "Nope have not been chasing',
    );
  });

  it("holds an ambiguous top-level post for the owner's judgement, and parks it once the recorder says why", () => {
    const other = { text: "I think Ari is out today", ts: "1791341400.000100", userId: "U0SETH" };
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [other], messages: [ASK] };
    const judgement = judgePriorAsk({ read, selfUserId: SELF });
    const held = priorAskRefusal({ declared: PRIOR, judgement });
    const parked = priorAskRefusal({ declared: { ...PRIOR, notAnswered: "Seth spoke for Ari" }, judgement });
    expect(held[0]).toContain('a message U0SETH posted at the top of the channel after ours MAY answer it: "I think');
    expect(held[1]).toContain("hold the bump for the owner's judgment if it is ambiguous");
    expect(held[1]).toContain('`--changed "<what changed>" --changed-media <png,…>`');
    expect(parked).toEqual([]);
    const changed = { ...PRIOR, changed: "the count moved to 9", changedMedia: ["/proof/chart.png"] };
    expect(priorAskRefusal({ declared: changed, judgement })).toEqual([]);
    const declared = { ...PRIOR, notAnswered: "Seth spoke for Ari" };
    expect(parkedPriorAsk({ declared, judgement: readArm({ judged: judgement }), proof: [] })).toEqual({
      answerCount: 1,
      answers: [other],
      kind: "prior",
      notAnswered: "Seth spoke for Ari",
      ours: ASK,
      permalink: PERMALINK,
      readThroughTs: ASK.ts,
    });
  });

  it("lets a definitive thread answer outrank an ambiguous top-level post", () => {
    const other = { text: "I think Ari is out today", ts: "1791341400.000100", userId: "U0SETH" };
    const reply = { text: "answered in thread", ts: "1791341500.000100", userId: "U0ARI" };
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [other], messages: [ASK, reply] };
    const lines = priorAskRefusal({ declared: PRIOR, judgement: judgePriorAsk({ read, selfUserId: SELF }) });
    expect(lines[0]).toContain("that question was ANSWERED — 2 replies");
  });

  it("refuses a release once a top-level answer lands after the recording's read", () => {
    const recorded: Extract<ParkedPriorAsk, { kind: "prior" }> = {
      answerCount: 0,
      answers: [],
      kind: "prior",
      ours: ASK,
      permalink: PERMALINK,
      readThroughTs: ASK.ts,
    };
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [ARI], messages: [ASK] };
    const since = answersSinceRecording({
      judgement: readArm({ judged: judgePriorAsk({ read, selfUserId: SELF }) }),
      priorAsk: recorded,
    });
    expect(since).toEqual([ARI]);
  });

  it("refuses a release when a deleted post exposes an older clear answer, and not when that answer was recorded", () => {
    // Seth's post was the recorded may-answer; it is deleted, and Ari's older post is now the tie,
    // older too than our own follow-up in the thread, which carried the recording's read mark past it.
    const seth = { text: "I think Ari is out", ts: "1791341350.000100", userId: "U0SETH" };
    const followUp = { text: "for context, the four owing", ts: "1791341400.000100", userId: SELF };
    const recorded: Extract<ParkedPriorAsk, { kind: "prior" }> = {
      answerCount: 1,
      answers: [seth],
      kind: "prior",
      notAnswered: "Seth spoke for Ari",
      ours: ASK,
      permalink: PERMALINK,
      readThroughTs: followUp.ts,
    };
    const read: PriorRead = { addressedTs: ASK.ts, channelTopLevel: [ARI], messages: [ASK, followUp] };
    const judgement = readArm({ judged: judgePriorAsk({ read, selfUserId: SELF }) });
    expect([
      answersSinceRecording({ judgement, priorAsk: recorded }),
      answersSinceRecording({ judgement, priorAsk: { ...recorded, answers: [seth, ARI] } }),
    ]).toEqual([[ARI], []]);
  });

  it("refuses a release over a thread reply posted between the recording's two reads", () => {
    // The thread read saw only ours; a reply landed; the channel read then saw a later, unrelated post.
    const reply = { text: "chasing two of them", ts: "1791352138.708400", userId: "U0ARI" };
    const unrelated = { text: "standup moved", ts: "1791352139.000100", userId: "U0SETH" };
    const recording = readArm({
      judged: judgePriorAsk({
        read: { addressedTs: ASK.ts, channelTopLevel: [unrelated], messages: [ASK] },
        selfUserId: SELF,
      }),
    });
    const row = priorRow({
      parked: parkedPriorAsk({
        declared: { ...PRIOR, notAnswered: "nobody replied" },
        judgement: recording,
        proof: [],
      }),
    });
    const release = readArm({
      judged: judgePriorAsk({
        read: { addressedTs: ASK.ts, channelTopLevel: [unrelated], messages: [ASK, reply] },
        selfUserId: SELF,
      }),
    });
    expect([row.readThroughTs, answersSinceRecording({ judgement: release, priorAsk: row })]).toEqual([
      ASK.ts,
      [reply],
    ]);
  });

  it("releases over the may-answer post the row recorded, and refuses on a reply newer than the thread read", () => {
    const other = { text: "I think Ari is out today", ts: "1791341400.000100", userId: "U0SETH" };
    const reply = { text: "back now, chasing", ts: "1791341500.000100", userId: "U0ARI" };
    const judged = ({ messages }: { messages: PriorRead["messages"] }): Extract<PriorJudgement, { kind: "read" }> =>
      readArm({
        judged: judgePriorAsk({ read: { addressedTs: ASK.ts, channelTopLevel: [other], messages }, selfUserId: SELF }),
      });
    const declared = { ...PRIOR, notAnswered: "Seth spoke for Ari" };
    const row = priorRow({ parked: parkedPriorAsk({ declared, judgement: judged({ messages: [ASK] }), proof: [] }) });
    expect([
      answersSinceRecording({ judgement: judged({ messages: [ASK] }), priorAsk: row }),
      answersSinceRecording({ judgement: judged({ messages: [ASK, reply] }), priorAsk: row }),
    ]).toEqual([[], [reply]]);
  });
});

/**
 * The `prior` row a recording parked, for a case that declared an earlier ask.
 *
 * @param parked what `parkedPriorAsk` returned
 * @returns its prior arm
 */
function priorRow({ parked }: { parked: ParkedPriorAsk | undefined }): Extract<ParkedPriorAsk, { kind: "prior" }> {
  if (parked?.kind !== "prior") {
    throw new Error("expected a prior row");
  }
  return parked;
}

/**
 * The read arm of a judgement a case has already asserted is `read`.
 *
 * @param judged the judgement
 * @returns its read arm
 */
function readArm({ judged }: { judged: PriorJudgement }): Extract<PriorJudgement, { kind: "read" }> {
  if (judged.kind !== "read") {
    throw new Error(`expected a read judgement, got ${judged.kind}`);
  }
  return judged;
}

describe("undeclaredAskRefusal", () => {
  it("refuses a question with no declaration, naming how to look", () => {
    const lines = undeclaredAskRefusal({ asked: "expected?", declared: "undeclared" });
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('asks a question ("expected?")');
    expect(lines[1]).toContain("slopweaver store hits");
  });

  it("says nothing for a draft that asks nothing, or one that declared", () => {
    const quiet = [
      undeclaredAskRefusal({ asked: undefined, declared: "undeclared" }),
      undeclaredAskRefusal({ asked: "expected?", declared: { kind: "none" } }),
      undeclaredAskRefusal({ asked: "expected?", declared: PRIOR }),
    ];
    expect(quiet).toEqual([[], [], []]);
  });
});

describe("priorAskRefusal", () => {
  const answered: PriorJudgement = { answers: [ANSWER], kind: "read", ours: OURS, readThroughTs: ANSWER.ts };

  it("refuses an answered ask with nothing shown, quoting the first answer", () => {
    const lines = priorAskRefusal({ declared: PRIOR, judgement: answered });
    expect(lines[0]).toContain('ANSWERED — 1 reply by somebody else after ours, the first: "yes, the batch job"');
    expect(lines[1]).toContain("--changed-media");
  });

  it("refuses an earlier message that is missing or not ours", () => {
    const missing = priorAskRefusal({ declared: PRIOR, judgement: { kind: "not-found" } });
    const theirs = priorAskRefusal({ declared: PRIOR, judgement: { kind: "not-ours", userId: "U0JONAH" } });
    expect(missing[0]).toContain("holds no message at that link");
    expect(theirs[0]).toContain("is a message by U0JONAH");
  });

  it("parks an answered ask that shows a change or says why it was no answer, and an unanswered one", () => {
    const shown = [
      priorAskRefusal({ declared: { ...PRIOR, changed: "tripled", changedMedia: ["a.png"] }, judgement: answered }),
      priorAskRefusal({ declared: { ...PRIOR, notAnswered: "they said they would look" }, judgement: answered }),
      priorAskRefusal({ declared: PRIOR, judgement: { ...answered, answers: [] } }),
    ];
    expect(shown).toEqual([[], [], []]);
  });
});

describe("parkedPriorAsk — what the row keeps", () => {
  it("keeps nothing for no declaration, and only the kind for none", () => {
    const kept = [
      parkedPriorAsk({ declared: "undeclared", judgement: undefined, proof: [] }),
      parkedPriorAsk({ declared: { kind: "none" }, judgement: undefined, proof: [] }),
    ];
    expect(kept).toEqual([undefined, { kind: "none" }]);
  });

  it("keeps the first three answers, the count of all of them, the change and its proof", () => {
    const answers = [1, 2, 3, 4].map((n) => ({ text: `answer ${String(n)}`, ts: `178900010${String(n)}.000100` }));
    const proof = [{ bytes: 12, name: "spend.png", sha256: "c".repeat(64) }];
    const kept = parkedPriorAsk({
      declared: { ...PRIOR, changed: "tripled", changedMedia: ["spend.png"] },
      judgement: { answers, kind: "read", ours: OURS, readThroughTs: "1789000104.000100" },
      proof,
    });
    expect(kept).toEqual({
      answerCount: 4,
      answers: answers.slice(0, 3),
      changed: "tripled",
      kind: "prior",
      ours: OURS,
      permalink: PERMALINK,
      proof,
      readThroughTs: "1789000104.000100",
    });
  });
});

describe("answersSinceRecording — what a release refuses on", () => {
  const recorded: Extract<ParkedPriorAsk, { kind: "prior" }> = {
    answerCount: 1,
    answers: [ANSWER],
    kind: "prior",
    ours: OURS,
    permalink: PERMALINK,
    readThroughTs: ANSWER.ts,
  };

  it("returns only answers newer than the recording's read", () => {
    const later = { text: "still expected", ts: "1789000300.000100", userId: "U0ADA" };
    const since = answersSinceRecording({
      judgement: { answers: [ANSWER, later], kind: "read", ours: OURS, readThroughTs: later.ts },
      priorAsk: recorded,
    });
    const none = answersSinceRecording({
      judgement: { answers: [ANSWER], kind: "read", ours: OURS, readThroughTs: ANSWER.ts },
      priorAsk: recorded,
    });
    expect([since, none]).toEqual([[later], []]);
  });
});
