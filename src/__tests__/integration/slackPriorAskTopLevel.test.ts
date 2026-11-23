/**
 * INTEGRATION test: an earlier ask whose ONLY answer was posted at the top level of the channel, read through the
 * REAL `readPriorAsk` against the real Slack Web API, recorded + replayed via a Polly cassette (see
 * `setup-polly.ts` + `cassetteRedact.ts`).
 *
 * The two asks are the incident itself: two of the owner's questions in one
 * channel, each answered as the very next top-level post and never in its thread, and each still
 * offered back to the owner as a bump. The recorder and the release read the channel's top level; every
 * test of that is a unit test over a hand-built fake, so this file is what pins it to the shapes Slack really
 * returns — a `conversations.replies` holding the ask alone, and a `conversations.history` window after it.
 *
 * Each case also judges the SAME read with its channel half emptied, which is exactly the read without the top-level half: the
 * ask then reads unanswered and no refusal fires. So the top-level read is shown to be what carries the answer,
 * rather than assumed to be.
 *
 * ## What a redacted cassette cannot show, stated
 *
 * The allowlist redactor blanks every message's text, keeps every `ts` verbatim and maps every user id to a stable
 * synthetic one. So the mention tags in our ask are gone at replay, and `topLevelAnswer.ts`'s `askedBy` reads each
 * ask as OPEN (it tagged nobody, so whoever posts next was asked): these replays drive the "answers" arm through
 * that branch, not through the group-tag and named-tag branches the real asks took, so any other person posting
 * next would read as the answer here just the same. Those branches, and the
 * "may-answer" arm a redacted cassette can never produce, stay pinned by `unit/outbound/slack/topLevelAnswer.test.ts`
 * and `unit/outbound/slack/priorAsk.test.ts`. Our own synthetic user id is read off the addressed message, since the
 * cassette is the only place it exists, so this proves the top-level tie and not that the ask is the owner's; the test
 * asserts the answer's author is a different person.
 *
 * Recorded against a REAL workspace under the asker's own user token, so every assertion is STRUCTURAL (counts,
 * `ts`, kinds), never on content. Run:
 *   yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/slackPriorAskTopLevel.test.ts
 *   POLLY_MODE=record SLOPWEAVER_HOME=… SLOPWEAVER_RECORD_SLACK_TOKEN=… SLOPWEAVER_RECORD_SLACK_WORKSPACE=… \
 *     SLOPWEAVER_RECORD_SLACK_CHANNEL_TOPLEVEL=… yarn vitest run --config config/vitest/integration.ts \
 *     src/__tests__/integration/slackPriorAskTopLevel.test.ts
 */
import { describe, expect, it } from "vitest";

import { makeSlackApi } from "../../corpus/slack/api.js";
import { unwrap } from "../../lib/result.js";
import { readPriorAsk } from "../../live/slack/priorAskRead.js";
import { judgePriorAsk, type PriorJudgement, priorAskRefusal } from "../../outbound/slack/priorAsk.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/**
 * One value only a recording needs. REPLAY takes the stand-in, since a cassette is matched on method + path; RECORD
 * refuses to start without the real value rather than recording against the stand-in.
 *
 * @param name the environment variable a recording command sets
 * @param replay the stand-in every replay uses
 * @param what what the value is, for the refusal
 * @returns the stand-in in replay, the environment's value in record
 */
function recordValue({ name, replay, what }: { name: string; replay: string; what: string }): string {
  if (!RECORD) {
    return replay;
  }
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`set ${name} (${what}) to record the top-level cassette`);
  }
  return value;
}

function slackToken(): string {
  return recordValue({
    name: "SLOPWEAVER_RECORD_SLACK_TOKEN",
    replay: "dummy-replay-token-not-real",
    what: "the asker's user token",
  });
}

/** The workspace host. Recorded requests are matched on path, so the host never gates replay. */
const WS = recordValue({
  name: "SLOPWEAVER_RECORD_SLACK_WORKSPACE",
  replay: "https://example.slack.com",
  what: "the workspace host",
});

/**
 * The channel both asks sit in. RECORD needs the real id; REPLAY matches on method + path and the channel travels
 * in the body, so the real id lives in the recording command and never in this committed file.
 */
const CHANNEL = recordValue({
  name: "SLOPWEAVER_RECORD_SLACK_CHANNEL_TOPLEVEL",
  replay: "C910",
  what: "the channel both asks sit in",
});

/**
 * The clock the channel read is bounded by: well past both asks, so `latest` is the read's own four-day cap in
 * record and replay alike, and the read never depends on when it ran.
 */
const NOW_MS = Date.parse("2026-10-20T00:00:00.000Z");

function permalinkOf({ ts }: { ts: string }): string {
  return `${WS}/archives/${CHANNEL}/p${ts.replace(".", "")}`;
}

/** The judgement of one read, narrowed to the `read` kind every case here expects. */
function readJudgement({ judgement }: { judgement: PriorJudgement }): Extract<PriorJudgement, { kind: "read" }> {
  if (judgement.kind !== "read") {
    throw new Error(`expected the earlier ask to read as ours, got ${judgement.kind}`);
  }
  return judgement;
}

/**
 * Read one ask through the real read, and judge it whole and with its channel half emptied.
 *
 * @param askTs our ask's Slack ts
 * @param answerTs the ts of the top-level post that answered it
 * @returns what the read held and what each judgement made of it, every field exact
 */
async function observe({ askTs, answerTs }: { askTs: string; answerTs: string }) {
  const permalink = permalinkOf({ ts: askTs });
  const read = unwrap(
    await readPriorAsk({ deps: { api: makeSlackApi({ token: slackToken() }), nowMs: () => NOW_MS }, permalink }),
  );
  const selfUserId = read.messages.find((message) => message.ts === askTs)!.userId!;
  const answer = read.channelTopLevel.find((message) => message.ts === answerTs)!;
  const declared = { changedMedia: [], kind: "prior", permalink } as const;
  const whole = readJudgement({ judgement: judgePriorAsk({ read, selfUserId }) });
  const threadOnly = readJudgement({
    judgement: judgePriorAsk({ read: { ...read, channelTopLevel: [] }, selfUserId }),
  });
  // Our own follow-up a second after the ask, the oldest post in the window: the tie has to skip it to reach the
  // answer, so a judge taking the oldest post rather than the next person's fails here.
  const [askSeconds, askFraction] = askTs.split(".");
  const selfFollowUp = { ...answer, ts: `${String(Number(askSeconds) + 1)}.${askFraction!}`, userId: selfUserId };
  const withSelfFollowUp = readJudgement({
    judgement: judgePriorAsk({
      read: { ...read, channelTopLevel: [...read.channelTopLevel, selfFollowUp] },
      selfUserId,
    }),
  });
  return {
    addressedTs: read.addressedTs,
    // Two different people: the redactor maps one person to one synthetic id, and neither may be missing.
    answerAuthorIsAnotherPerson: answer.userId !== undefined && selfUserId.length > 0 && answer.userId !== selfUserId,
    channelTopLevelTs: read.channelTopLevel.map((message) => message.ts),
    refusal: priorAskRefusal({ declared, judgement: whole }),
    threadOnly: {
      answers: threadOnly.answers.map((kept) => kept.ts),
      refusal: priorAskRefusal({ declared, judgement: threadOnly }),
      tie: threadOnly.topLevelTie,
    },
    threadTs: read.messages.map((message) => message.ts),
    whole: {
      answers: whole.answers.map((kept) => kept.ts),
      tie: { kind: whole.topLevelTie!.kind, ts: whole.topLevelTie!.post.ts },
    },
    withSelfFollowUp: { kind: withSelfFollowUp.topLevelTie!.kind, ts: withSelfFollowUp.topLevelTie!.post.ts },
  };
}

/** The opening of the ANSWERED refusal when the only answer is the next top-level post. */
const ANSWERED_AT_TOP = "It was posted at the top of the channel, the next person's message after ours.";

describe("slack prior ask answered at the top level (integration — real Slack via Polly cassette)", () => {
  it("reads the platform-coordination ask's only answer, a top-level post four minutes on, as ANSWERED", async () => {
    const askTs = "1791348182.111109";
    const answerTs = "1791348424.792829";
    const seen = await observe({ answerTs, askTs });

    // FIRST: the thread holds our ask alone, so any answer is top-level — and the read is a real payload rather
    // than a recorded auth failure, which could never name the ask's own ts.
    expect(seen.addressedTs).toBe(askTs);
    expect(seen.threadTs).toEqual([askTs]);
    // The whole top-level window after the ask, newest first, so a read that kept only the answer would fail here.
    expect(seen.channelTopLevelTs).toEqual([
      "1791518958.770049",
      "1791509229.699809",
      "1791509218.981649",
      "1791509072.020669",
      "1791508155.944289",
      "1791508077.725749",
      "1791507977.091769",
      "1791351441.819519",
      answerTs,
    ]);
    expect(seen.answerAuthorIsAnotherPerson).toBe(true);
    expect(seen.whole).toEqual({ answers: [answerTs], tie: { kind: "answers", ts: answerTs } });
    expect(seen.withSelfFollowUp).toEqual({ kind: "answers", ts: answerTs });
    expect(seen.refusal[0]).toContain("that question was ANSWERED");
    expect(seen.refusal[0]).toContain(ANSWERED_AT_TOP);
    // The read without the top-level half: the thread alone, which holds no answer, so the bump would have parked.
    expect(seen.threadOnly).toEqual({ answers: [], refusal: [], tie: undefined });
  });

  it("reads the policy-acceptance ask's only answer, a top-level post 27 seconds on, as ANSWERED", async () => {
    const askTs = "1791341338.708319";
    const answerTs = "1791341365.637399";
    const seen = await observe({ answerTs, askTs });

    expect(seen.addressedTs).toBe(askTs);
    expect(seen.threadTs).toEqual([askTs]);
    // Holds the other ask and its answer too, so the window is the channel's and not one ask's.
    expect(seen.channelTopLevelTs).toEqual([
      "1791518958.770049",
      "1791509229.699809",
      "1791509218.981649",
      "1791509072.020669",
      "1791508155.944289",
      "1791508077.725749",
      "1791507977.091769",
      "1791351441.819519",
      "1791348424.792829",
      "1791348182.111109",
      "1791345380.689019",
      "1791341368.229299",
      answerTs,
    ]);
    expect(seen.answerAuthorIsAnotherPerson).toBe(true);
    expect(seen.whole).toEqual({ answers: [answerTs], tie: { kind: "answers", ts: answerTs } });
    expect(seen.withSelfFollowUp).toEqual({ kind: "answers", ts: answerTs });
    expect(seen.refusal[0]).toContain("that question was ANSWERED");
    expect(seen.refusal[0]).toContain(ANSWERED_AT_TOP);
    expect(seen.threadOnly).toEqual({ answers: [], refusal: [], tie: undefined });
  });
});
