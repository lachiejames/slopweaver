/**
 * `PlanCall`'s read coverage: a cut tool answer reaches the thread with the server's coverage line, and an answer
 * claiming the whole of a read still cut is held back from the voice and sent back to read on.
 */

import { describe, expect, it } from "vitest";
import { CANDID_ANSWER, MAX_REPAIRS } from "../../../lib/coverageHold";
import { PLAN_CALL_LIMITS } from "../../../lib/planCallContract";
import {
  eventsOf,
  failure,
  heardDoneLine,
  listening,
  NUDGES,
  result,
  type Script,
  settle,
  spokenAfter,
  turnLine,
} from "./harness";

const PAGE = "/h/pages/b/index.html";

/** A child that also takes the turn a held answer sends back. */
const READS_ON = { ...NUDGES, "turn/start": result({ turn: { id: "t-2" } }) };

/** A `file_read` of the briefing page the thread made in turn `t-1`, which the page answers under `token-1.1`. */
const READ_REQUEST = `${JSON.stringify({
  id: 79,
  method: "item/tool/call",
  params: {
    arguments: { path: PAGE, words: true },
    callId: "c-read",
    namespace: null,
    threadId: "thread-1",
    tool: "file_read",
    turnId: "t-1",
  },
})}\n`;

/** The `file_read` in turn `t-1` reading the briefing page on from where {@link READ_REQUEST}'s answer was cut. */
const READ_ON_REQUEST = `${JSON.stringify({
  id: 80,
  method: "item/tool/call",
  params: {
    arguments: { from: 4096, path: PAGE, words: true },
    callId: "c-read-on",
    namespace: null,
    threadId: "thread-1",
    tool: "file_read",
    turnId: "t-1",
  },
})}\n`;

/** The page's answer: the first 4096 bytes of 9000. */
const CUT_WINDOW = { kind: "text", nextFrom: 4096, path: PAGE, size: 9000, start: 0, text: "…", truncated: true };

/** The same page read to its end. */
const WHOLE_WINDOW = { kind: "text", nextFrom: null, path: PAGE, size: 9000, start: 0, text: "…", truncated: false };

const CLAIM = "I've read the whole briefing.";

/**
 * An `item/completed` agent message, of turn `t-1` unless another is named.
 *
 * @returns the line, newline-terminated
 */
const answerLine = ({ itemId, text, turnId = "t-1" }: { itemId: string; text: string; turnId?: string }): string =>
  `${JSON.stringify({ method: "item/completed", params: { item: { id: itemId, text, type: "agentMessage" }, threadId: "thread-1", turnId } })}\n`;

/**
 * A call that read the briefing page and got `window` back.
 *
 * @param script how the child answers, the send-back's `turn/start` included
 * @returns the harness, its stream attached
 */
async function readThePage({
  window,
  script = READS_ON,
}: {
  window: object;
  script?: Script;
}): Promise<Awaited<ReturnType<typeof listening>>> {
  const h = await listening({ script });
  h.call.receive({ chunk: READ_REQUEST });
  h.call.claim({ claimant: "page-a", token: "token-1.1" });
  const answered = h.call.answer({
    claimant: "page-a",
    contentItems: [{ text: JSON.stringify(window), type: "inputText" }],
    success: true,
    token: "token-1.1",
  });
  expect(answered.kind).toBe("answered");
  return h;
}

/** The text of every `turn/start` input written after `before`. */
const turnStartsAfter = ({ h, before }: { h: Awaited<ReturnType<typeof listening>>; before: number }): unknown[] =>
  h.written
    .slice(before)
    .filter((line) => line["method"] === "turn/start")
    .map((line) => line["params"]);

describe("PlanCall read coverage", () => {
  it("answers a cut read with the coverage line naming the call that reads on, and a whole one as it came", async () => {
    const cut = await readThePage({ window: CUT_WINDOW });
    const response = cut.written.find((line) => line["id"] === 79)!;
    expect(response["result"]).toEqual({
      contentItems: [
        { text: JSON.stringify(CUT_WINDOW), type: "inputText" },
        {
          text: expect.stringContaining(
            `bytes 0 to 4096 of 9000 of ${PAGE} (read on with file_read {"path":"${PAGE}","words":true,"from":4096})`,
          ),
          type: "inputText",
        },
      ],
      success: true,
    });
    const whole = await readThePage({ window: WHOLE_WINDOW });
    expect(whole.written.find((line) => line["id"] === 79)!["result"]).toEqual({
      contentItems: [{ text: JSON.stringify(WHOLE_WINDOW), type: "inputText" }],
      success: true,
    });
  });

  it("holds a whole-read claim over the cut read back from the voice and sends the thread back to read on", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: `${CLAIM} It says the pool ran dry.` }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    const sent = turnStartsAfter({ before, h });
    expect(sent).toEqual([
      { input: [{ text: expect.stringContaining(`it says "${CLAIM}"`), type: "text" }], threadId: "thread-1" },
    ]);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "held-answer")).toEqual([
      {
        detail: `held back from the voice: it claims ${CLAIM} over a read still cut`,
        itemId: "m-1",
        kind: "held-answer",
        pending: false,
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
  });

  // Another turn's start must not drop a cut whose own answer comes later.
  it("still holds the claim when its turn's answer lands after another ask's turn started", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-other" }) });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(1);
  });

  // A turn that joined the reading turn's ask must keep its cut once a newer ask's turn starts before the joined
  // turn's answer lands.
  it("still holds a claim from a turn that joined the reading turn's ask, after a newer ask began", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-joined" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-joined" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-new" }) });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM, turnId: "t-joined" }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(1);
  });

  // A sibling's start landing before the reading turn's own must not begin a new ask and strand the cut.
  it("still holds a sibling turn's claim when its start lands before the reading turn's own", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-sibling" }) });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM, turnId: "t-sibling" }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(1);
  });

  // A cut carried in a failed answer must not skip the hold.
  it("holds a whole-read claim over a cut the page answered as a failure", async () => {
    const h = await listening({ script: READS_ON });
    h.call.receive({ chunk: READ_REQUEST });
    h.call.claim({ claimant: "page-a", token: "token-1.1" });
    const answered = h.call.answer({
      claimant: "page-a",
      contentItems: [{ text: JSON.stringify(CUT_WINDOW), type: "inputText" }],
      success: false,
      token: "token-1.1",
    });
    expect(answered.kind).toBe("answered");
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(1);
  });

  // A read-on that failed, reading nothing, must not close the cut it named.
  it("still holds the claim when the read-on from the cut failed", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    h.call.receive({ chunk: READ_ON_REQUEST });
    h.call.claim({ claimant: "page-a", token: "token-2.2" });
    const failed = h.call.answer({ claimant: "page-a", contentItems: [], success: false, token: "token-2.2" });
    expect(failed.kind).toBe("answered");
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(1);
  });

  it("hands an answer that says it read only part, over the same cut read", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    const before = h.written.length;
    const honest = "I've only read the first part of the briefing so far.";
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: honest }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([honest]);
    expect(turnStartsAfter({ before, h })).toEqual([]);
  });

  // A send-back that never started must not leave the held claim with nothing in its place.
  it("speaks the candid line and says the error when the send-back is refused", async () => {
    const h = await readThePage({ script: { ...NUDGES, "turn/start": failure("busy") }, window: CUT_WINDOW });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([CANDID_ANSWER]);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "error")).toEqual([
      { kind: "error", message: expect.stringContaining("was not sent back to read on") },
    ]);
  });

  // A `turn/start` error can still start the turn.
  it("still holds the claim when a refused send-back's turn starts anyway", async () => {
    const h = await readThePage({ script: { ...NUDGES, "turn/start": failure("busy") }, window: CUT_WINDOW });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-repair" }) });
    h.call.receive({ chunk: answerLine({ itemId: "m-2", text: CLAIM, turnId: "t-repair" }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([CANDID_ANSWER, CANDID_ANSWER]);
    expect(turnStartsAfter({ before, h }).length).toBe(2);
  });

  it("speaks the candid line when the send-back is never answered", async () => {
    const h = await readThePage({ script: NUDGES, window: CUT_WINDOW });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([CANDID_ANSWER]);
  });

  // A start notice landing after its own turn read must not wipe that turn's cut.
  it("still holds the claim when the turn's start notice lands after its own cut read", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(1);
  });

  // `done` often lands after the turn it started has read, and it must not clear the cuts.
  it("still holds the claim when the owner's closing transcript lands after the cut read it asked for", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    h.call.receive({ chunk: heardDoneLine({ text: "Read me the briefing" }) });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(1);
  });

  // The timeout sends no cancel, so the send-back can start after the candid line.
  it("still holds the claim when a send-back the console stopped waiting for starts late", async () => {
    const h = await readThePage({ script: NUDGES, window: CUT_WINDOW });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    await settle();
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-late" }) });
    h.call.receive({ chunk: answerLine({ itemId: "m-2", text: CLAIM, turnId: "t-late" }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([CANDID_ANSWER]);
    expect(turnStartsAfter({ before, h }).length).toBe(2);
  });

  // Another turn can take the owed count, and the send-back's own start must not reset its cuts.
  it("still holds the claim when another turn starts and ends before the unanswered send-back's own turn", async () => {
    const h = await readThePage({ script: NUDGES, window: CUT_WINDOW });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-foreign" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-foreign" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-repair" }) });
    h.call.receive({ chunk: answerLine({ itemId: "m-2", text: CLAIM, turnId: "t-repair" }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(2);
  });

  // The answer names the turn before it starts, and another start can come between.
  it("still holds the claim when another turn starts between the send-back's answer and its own turn", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    const before = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-foreign" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-foreign" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.call.receive({ chunk: answerLine({ itemId: "m-2", text: CLAIM, turnId: "t-2" }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(turnStartsAfter({ before, h }).length).toBe(2);
  });

  it("keeps the cut through the send-back's own turn, and drops it when the next ask's turn starts", async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    h.call.receive({ chunk: answerLine({ itemId: "m-1", text: CLAIM }) });
    await settle();
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    const resent = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-2", text: CLAIM, turnId: "t-2" }) });
    await settle();
    expect(turnStartsAfter({ before: resent, h }).length).toBe(1);
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-2" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-3" }) });
    const asked = h.written.length;
    h.call.receive({ chunk: answerLine({ itemId: "m-3", text: CLAIM, turnId: "t-3" }) });
    await settle();
    expect(turnStartsAfter({ before: asked, h })).toEqual([]);
  });

  it(`speaks the candid line once the claim survives ${String(MAX_REPAIRS)} sends back`, async () => {
    const h = await readThePage({ window: CUT_WINDOW });
    const before = h.written.length;
    for (let held = 1; held <= MAX_REPAIRS + 1; held += 1) {
      h.call.receive({ chunk: answerLine({ itemId: `m-${String(held)}`, text: CLAIM }) });
      await settle();
    }
    expect(spokenAfter({ before, h })).toEqual([CANDID_ANSWER]);
    expect(turnStartsAfter({ before, h }).length).toBe(MAX_REPAIRS);
  });
});
