/*
 * One relay, from the model's call to the lines the page journals: the gate's verdict, the hand-off the model is
 * answered with before any post runs, and the posts queued behind it — every seam is a plain fake that records what
 * it was handed, and a queued post runs only when the test runs it.
 */
import { describe, expect, it } from "vitest";

import { type DiscussFirstLedger, discussFirstLedger } from "../../components/voice/discussFirstLedger";
import {
  freshTurnWindow,
  handOffRelay,
  keptRelayLines,
  type RelayHandOffSeams,
  relayPictureFor,
  type TurnWindow,
} from "../../components/voice/relayAttempt";
import { HEARD_ONLY_SAY } from "../../components/voice/relayAttemptAccept";
import { type RelayPosted, relayJournalDetail } from "../../components/voice/relayAttemptPost";
import type { RelayLine } from "../../components/voice/voiceContext";
import type { DiscussFirstDecision } from "../../lib/discussFirst";
import { type CheckSend, handedOffAnswer, type RelayOutward } from "../../lib/relayAnswer";
import type { GateEntry } from "../../lib/relayGate";
import { type PlacedQueueRow, type RelayWorkspace, relayWorkspace } from "../../lib/relayWorkspace";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";
import { CARD, CUT, HEARD, NOT_TAKEN, SHUT_NOTHING_NEW, TURN, WHOLE_STRETCH } from "./relayAttemptFixture";

const LOOKED: TalkRelayWire["screen"] = { dataUrl: "data:image/webp;base64,AAAA", kind: "attached" };

const HEARD_ONLY: TalkRelayWire = {
  about: CARD,
  heard: "fix the tab",
  readsAfter: ["context_pack"],
  screen: { kind: "none", reason: "screen-not-shared" },
  turnId: TURN,
};

const NO_REPORT = {
  candidateRuling: undefined,
  deliveryDetail: undefined,
  deliveryKind: undefined,
  ruling: undefined,
  slug: undefined,
};

const post = ({
  outcome,
  detail,
  wordsAloneRetry = false,
  shownOutcome,
}: {
  outcome: RelayPosted["outcome"];
  detail: string;
  wordsAloneRetry?: boolean;
  shownOutcome?: RelayLine["outcome"];
}): RelayPosted => ({ detail, outcome, report: NO_REPORT, shownOutcome, wordsAloneRetry });

const PRE_CLAIM = post({ detail: "--read-after names context_pack", outcome: "refused", wordsAloneRetry: true });
const LANDED = post({ detail: "relayed as talk-a00000170000", outcome: "relayed" });
const TIMED_OUT = post({ detail: "the relay timed out", outcome: "unknown" });

/**
 * A page whose seams record what they are handed. Each post answers from `answers` in order; a queued post runs only
 * when the test calls its task; `events` orders the reads of the card the owner spoke over against the boundary.
 */
const page = ({
  answers = [],
  spokenOver = CARD,
  judgeable = CARD,
  log = [HEARD],
  micAhead = false,
  placed,
  standing = [],
  window = freshTurnWindow(),
  workspace,
}: {
  answers?: readonly (() => Promise<RelayPosted>)[];
  /** What `lines.about()` answers: the card the owner's words since the last relay were said over. */
  spokenOver?: string;
  /** What `lines.judgeable()` answers: the card the voice's judgement may land on. */
  judgeable?: string;
  log?: readonly GateEntry[];
  micAhead?: boolean;
  placed?: RelayWorkspace;
  standing?: readonly string[];
  window?: TurnWindow;
  workspace?: RelayHandOffSeams["workspace"];
}): {
  ledger: DiscussFirstLedger;
  seams: RelayHandOffSeams;
  state: { live: boolean };
  sent: TalkRelayWire[];
  lines: RelayLine[];
  tasks: (() => Promise<void>)[];
  events: string[];
  watched: CheckSend[];
} => {
  const sent: TalkRelayWire[] = [];
  const lines: RelayLine[] = [];
  const tasks: (() => Promise<void>)[] = [];
  const events: string[] = [];
  const watched: CheckSend[] = [];
  const state = { live: true };
  const ledger = discussFirstLedger();
  let minted = 0;
  const seams: RelayHandOffSeams = {
    discussFirst: ledger,
    enqueue: (task) => {
      tasks.push(task);
    },
    gateLog: { current: [...log] },
    lines: {
      about: () => {
        events.push("about");
        return spokenOver;
      },
      judgeable: () => judgeable,
      record: ({ line }) => {
        lines.push(line);
      },
      spokenIn: () => "work",
    },
    live: () => state.live,
    micAhead: () => {
      events.push("mic");
      return micAhead;
    },
    mintTurnId: () => {
      events.push("mint");
      minted += 1;
      return `turn-${String(minted)}`;
    },
    post: (wire) => {
      sent.push(wire);
      return answers[sent.length - 1]();
    },
    nowIso: () => {
      events.push("now");
      return SINCE;
    },
    relayed: () => {
      events.push("boundary");
    },
    standing: () => standing,
    turnWindow: { current: window },
    watchSend: (send) => {
      events.push("watch");
      watched.push(send);
    },
    workspace: (input) => {
      if (workspace !== undefined) {
        return workspace(input);
      }
      return input.about === CARD ? placed : undefined;
    },
  };
  return { events, ledger, lines, seams, sent, state, tasks, watched };
};

const resolved = (posted: RelayPosted) => () => Promise.resolve(posted);

/** The instant every relay here is accepted at. */
const SINCE = "2026-10-07T05:52:56.000Z";

/** The thread a reply to a colleague went to. */
const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";

const NONE: RelayOutward = { kind: "none" };

const NO_FIX: DiscussFirstDecision = { kind: "none" };

const PLAIN = {
  alsoAnswers: [],
  answersOpenCard: true,
  candidateRuling: undefined,
  checkIn: undefined,
  fix: undefined,
  outward: NONE,
  say: "ship the fix",
  triage: undefined,
};

const HANDED_OFF = {
  answer: handedOffAnswer({ discussFirst: NO_FIX, outward: NONE, ruling: undefined, sinceIso: SINCE }),
  detail: "handed off, posting in the background",
  refused: false,
};

const shown = (lines: readonly RelayLine[]) =>
  lines.map((line) => `${String(line.turnId)}:${line.outcome}:${line.say}:${line.detail}`);

describe("handOffRelay", () => {
  // A short acknowledgement, then onto the next thing. The post takes 4–8s; the model is answered before it settles.
  it("answers with the hand-off while its post has not settled, and shows the relay as sending", () => {
    const ran = page({ answers: [() => new Promise<RelayPosted>(() => undefined)] });
    const answered = handOffRelay({ ...PLAIN, seams: ran.seams });
    void ran.tasks[0]();
    expect(answered).toEqual(HANDED_OFF);
    expect(ran.sent.map((wire) => wire.turnId)).toEqual(["turn-1"]);
    expect(shown(ran.lines)).toEqual(["turn-1:sending:ship the fix:running talk relay"]);
  });

  it("takes the boundary when the relay is accepted, and leaves a fresh window", () => {
    const ran = page({ window: { availableScreen: LOOKED, looksRunning: 0 } });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    expect(ran.seams.gateLog.current).toEqual([HEARD, { kind: "relayed" }]);
    expect(ran.events).toEqual(["about", "mic", "mint", "now", "boundary"]);
    expect(ran.seams.turnWindow.current).toEqual(freshTurnWindow());
    expect(ran.tasks.length).toBe(1);
  });

  // A "Yes" can be accepted and the next stretch's first fragment land 136 ms later. The microphone, read once as
  // the relay is accepted, is what stamps such a relay cut.
  it("posts a finished stretch cut when the microphone ran ahead of the owner's words at hand-off, and whole when not", async () => {
    const posted = await Promise.all(
      [true, false].map(async (micAhead) => {
        const ran = page({ answers: [resolved(LANDED)], log: WHOLE_STRETCH, micAhead });
        handOffRelay({ ...PLAIN, seams: ran.seams });
        await ran.tasks[0]();
        return ran.sent;
      }),
    );
    const wire = {
      about: CARD,
      heard: "fix the tab",
      readsAfter: [],
      say: "ship the fix",
      screen: NOT_TAKEN,
      turnId: "turn-1",
    };
    expect(posted).toEqual([[{ ...wire, heardTail: "cut" }], [{ ...wire, heardTail: "whole" }]]);
  });

  it("posts the wire the gate formed, with the frame the window held", async () => {
    const ran = page({ answers: [resolved(LANDED)], window: { availableScreen: LOOKED, looksRunning: 0 } });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.sent).toEqual([{ ...CUT, readsAfter: [], say: "ship the fix", screen: LOOKED, turnId: "turn-1" }]);
    expect(shown(ran.lines)).toEqual([
      "turn-1:sending:ship the fix:running talk relay",
      "turn-1:relayed:ship the fix:relayed as talk-a00000170000",
    ]);
  });

  // A greeting is no answer to the open hand step. Measured: "Uh, good morning", relayed about the open Twilio hand
  // step, hid it.
  it("makes a relay about no card when the voice judged the owner's words no answer to it, still placed by the card", async () => {
    const placed = { because: `the owner's words answer ${CARD}, which is placed in team`, workspace: "team" } as const;
    const ran = page({ answers: [resolved(LANDED)], placed });
    handOffRelay({ ...PLAIN, answersOpenCard: false, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.sent.map((wire) => [wire.about, wire.workspace])).toEqual([["", placed]]);
    expect(ran.lines.map((line) => [line.about, line.answersCard])).toEqual([
      ["", undefined],
      ["", undefined],
    ]);
  });

  it("marks the lines of a relay the voice judged the open card's answer, and none about a hand step", async () => {
    const answered = page({ answers: [resolved(LANDED)] });
    handOffRelay({ ...PLAIN, seams: answered.seams });
    await answered.tasks[0]();
    const step = "hand:twilio-and-knock-read-only-keys";
    const hand = page({ answers: [resolved(LANDED)], judgeable: step, spokenOver: step });
    handOffRelay({ ...PLAIN, seams: hand.seams });
    await hand.tasks[0]();
    expect([...answered.lines, ...hand.lines].map((line) => [line.about, line.answersCard])).toEqual([
      [CARD, true],
      [CARD, true],
      ["", undefined],
      ["", undefined],
    ]);
  });

  // Measured: "Next card, please" over one card, the owner's answer over the next; the relay spanned both.
  it("lands a relay spoken over two cards on the open one the voice judged it answers, placed by that card", async () => {
    const placed = { because: `the owner's words answer ${CARD}, which is placed in self`, workspace: "self" } as const;
    const ran = page({ answers: [resolved(LANDED)], placed, spokenOver: "" });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.sent.map((wire) => [wire.about, wire.workspace])).toEqual([[CARD, placed]]);
    expect(ran.lines.map((line) => [line.about, line.answersCard])).toEqual([
      [CARD, true],
      [CARD, true],
    ]);
  });

  it("keeps a relay spoken over two cards about none when the voice judged it no answer to the open one", async () => {
    const placed = { because: `the owner's words answer ${CARD}, which is placed in self`, workspace: "self" } as const;
    const ran = page({ answers: [resolved(LANDED)], placed, spokenOver: "" });
    handOffRelay({ ...PLAIN, answersOpenCard: false, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.sent.map((wire) => [wire.about, wire.workspace])).toEqual([["", undefined]]);
    expect(ran.lines.map((line) => [line.about, line.answersCard])).toEqual([
      ["", undefined],
      ["", undefined],
    ]);
  });

  it("states the workspace the page placed the card in, and keeps it on the words-alone retry", async () => {
    const placed = { because: `the owner's words answer ${CARD}, which is placed in team`, workspace: "team" } as const;
    const ran = page({ answers: [resolved(PRE_CLAIM), resolved(LANDED)], placed });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.sent.map((wire) => [wire.wordsAlone, wire.workspace])).toEqual([
      [undefined, placed],
      [true, placed],
    ]);
  });

  // The card key is stamped as the owner speaks; where that card is placed is read once, at hand-off, so a card re-placed
  // in between carries the relay with it, and nothing after the hand-off moves it again.
  it("states the card's placement at hand-off, and keeps it while the post waits", async () => {
    const placedIn = ({ workspace }: { workspace: "team" | "self" }): PlacedQueueRow => ({
      key: CARD,
      placement: { by: [{ source: "stated", value: workspace, workspace }], kind: "placed", workspace },
    });
    const queue = { rows: [placedIn({ workspace: "team" })] };
    const ran = page({
      answers: [resolved(LANDED)],
      workspace: ({ about, spokenIn }) => relayWorkspace({ about, rows: queue.rows, spokenIn }),
    });
    queue.rows = [placedIn({ workspace: "self" })];
    handOffRelay({ ...PLAIN, seams: ran.seams });
    queue.rows = [placedIn({ workspace: "team" })];
    await ran.tasks[0]();
    expect(ran.sent.map((wire) => [wire.about, wire.workspace])).toEqual([
      [CARD, { because: `the owner's words answer ${CARD}, which is placed in self`, workspace: "self" }],
    ]);
  });

  it("sends what the owner says while a post runs on the next relay, never swallowed by the one in flight", async () => {
    const ran = page({ answers: [resolved(LANDED), resolved(LANDED)] });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    ran.seams.gateLog.current.push({ kind: "heard", text: "and the other tab" });
    const second = handOffRelay({ ...PLAIN, say: "the other tab too", seams: ran.seams });
    await ran.tasks[0]();
    await ran.tasks[1]();
    expect(second).toEqual(HANDED_OFF);
    expect(ran.sent.map((wire) => `${wire.turnId}:${wire.heard}`)).toEqual([
      "turn-1:fix the tab",
      "turn-2:and the other tab",
    ]);
  });

  // The one literal pin on each shipped sentence the accept tests read through a constant: the gate's shut sentence
  // and the line a heard-only relay shows, so a changed production string fails here rather than passing everywhere.
  it("shuts with the gate's exact nothing-new sentence, and shows a heard-only relay's exact line", () => {
    expect([SHUT_NOTHING_NEW, HEARD_ONLY_SAY]).toEqual([
      "Not relayed: the owner has said nothing since the last relay. Relay only a steer they have just given you out loud.",
      "(dropped: only the owner's words were sent)",
    ]);
  });

  it("shuts a re-call when the owner has said nothing since the last relay, and queues no post", () => {
    const ran = page({});
    handOffRelay({ ...PLAIN, seams: ran.seams });
    const again = handOffRelay({ ...PLAIN, seams: ran.seams });
    expect(again).toEqual({
      answer: { relayed: false, why: SHUT_NOTHING_NEW },
      detail: "the gate shut",
      refused: true,
    });
    expect(ran.tasks.length).toBe(1);
    expect(shown(ran.lines).at(-1)).toBe(`undefined:shut:ship the fix:${SHUT_NOTHING_NEW}`);
  });

  it("shuts once the owner has hung up, before the gate is asked or a turn is minted", () => {
    const ran = page({});
    ran.state.live = false;
    const answered = handOffRelay({ ...PLAIN, seams: ran.seams });
    expect(answered).toEqual({
      answer: { relayed: false, why: "the owner hung up before the relay was sent" },
      detail: "the gate shut",
      refused: true,
    });
    expect([ran.seams.gateLog.current, ran.events, ran.tasks.length]).toEqual([[HEARD], ["about"], 0]);
  });

  // An accepted post is the owner's words said on the call; the voice already went on, so hanging up does not take it back.
  it("still posts an accepted relay when the owner hangs up before it runs", async () => {
    const ran = page({ answers: [resolved(LANDED)] });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    ran.state.live = false;
    await ran.tasks[0]();
    expect([ran.sent.length, ran.lines.at(-1)!.outcome]).toEqual([1, "relayed"]);
  });

  it("retries a pre-claim refusal once with the owner's words alone, behind the answer", async () => {
    const ran = page({ answers: [resolved(PRE_CLAIM), resolved(LANDED)] });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.sent.map((wire) => [wire.say, wire.wordsAlone])).toEqual([
      ["ship the fix", undefined],
      [undefined, true],
    ]);
    expect(shown(ran.lines)).toEqual([
      "turn-1:sending:ship the fix:running talk relay",
      "turn-1:sending:(dropped: the first relay was refused):refused; retrying with the owner's words alone",
      "turn-1:relayed:(dropped: the first relay was refused):relayed as talk-a00000170000, in the owner's words alone after the first was refused",
    ]);
    // The first refusal rides apart from both lines' own sentences, so the viewer folds it.
    expect(ran.lines.map((line) => line.firstRefusal)).toEqual([
      undefined,
      "--read-after names context_pack",
      "--read-after names context_pack",
    ]);
  });

  // A relay failure is not reported to the owner — it is journalled instead.
  it("journals a post refused twice on its final line, the reason from both attempts", async () => {
    const SECOND = post({ detail: "the board is locked", outcome: "refused" });
    const ran = page({ answers: [resolved(PRE_CLAIM), resolved(SECOND)] });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    await ran.tasks[0]();
    const last = ran.lines.at(-1)!;
    // Each refusal rides on its own field, so the viewer folds each; the call file journals them joined.
    expect([last.outcome, last.detail, last.firstRefusal, relayJournalDetail({ line: last })]).toEqual([
      "refused",
      "the board is locked",
      "--read-after names context_pack",
      "refused twice: --read-after names context_pack; then the board is locked",
    ]);
  });

  it("journals a post whose outcome is unknown beside one that landed, each on its own turn's line", async () => {
    const ran = page({ answers: [resolved(TIMED_OUT), resolved(LANDED)] });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    ran.seams.gateLog.current.push({ kind: "heard", text: "and again" });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    await ran.tasks[0]();
    await ran.tasks[1]();
    expect(
      ran.lines.filter((one) => one.outcome !== "sending").map((one) => `${String(one.turnId)}:${one.outcome}`),
    ).toEqual(["turn-1:unknown", "turn-2:relayed"]);
  });

  it("ends a post that rejects on an unknown line, and moves neither the gate nor the window", async () => {
    const ran = page({ answers: [() => Promise.reject(new Error("the relay route answered HTTP 502"))] });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    const window = ran.seams.turnWindow.current;
    await ran.tasks[0]();
    expect(ran.lines.at(-1)!).toEqual({
      about: CARD,
      answersCard: true,
      detail: "the relay route answered HTTP 502",
      heard: "fix the tab",
      outcome: "unknown",
      say: "ship the fix",
      turnId: "turn-1",
    });
    expect([ran.seams.gateLog.current, ran.seams.turnWindow.current]).toEqual([[HEARD, { kind: "relayed" }], window]);
  });

  it("names a check-in verdict by the act it answers, never the card that is open, and says how the walk goes on", async () => {
    const ran = page({ answers: [resolved(LANDED)] });
    const answered = handOffRelay({
      alsoAnswers: [],
      answersOpenCard: false,
      candidateRuling: undefined,
      checkIn: { covers: "rule", key: "act:ev-2" },
      fix: undefined,
      outward: NONE,
      say: "that was right",
      seams: ran.seams,
      triage: undefined,
    });
    await ran.tasks[0]();
    expect(answered.answer).toEqual(
      handedOffAnswer({
        discussFirst: NO_FIX,
        outward: NONE,
        ruling: { covers: "rule", kind: "check-in" },
        sinceIso: SINCE,
      }),
    );
    expect(ran.events).toEqual(["mic", "mint", "now", "boundary"]);
    expect([ran.sent[0].about, ran.sent[0].covers]).toEqual(["act:ev-2", "rule"]);
  });

  it("carries a candidate ruling on the wire, and tells the model it counts as ruled", async () => {
    const ran = page({ answers: [resolved(LANDED)] });
    const answered = handOffRelay({
      alsoAnswers: [],
      answersOpenCard: false,
      candidateRuling: { candidate: "c-105", reaction: "no" },
      checkIn: undefined,
      fix: undefined,
      outward: NONE,
      say: "not a workstream",
      seams: ran.seams,
      triage: undefined,
    });
    await ran.tasks[0]();
    expect(answered.answer).toEqual(
      handedOffAnswer({ discussFirst: NO_FIX, outward: NONE, ruling: { kind: "candidate" }, sinceIso: SINCE }),
    );
    expect([ran.sent[0].candidate, ran.sent[0].reaction]).toEqual(["c-105", "no"]);
  });

  it("names a triage ruling by the card the pass has open, and carries its verdict and label on the wire", async () => {
    const ran = page({ answers: [resolved(LANDED), resolved(LANDED)] });
    const answered = handOffRelay({
      ...PLAIN,
      say: "park it for the slow hour, waiting on them",
      seams: ran.seams,
      triage: { key: "act:ev-9", ruling: { label: "waiting-on-them", verdict: "park-slow-triage" } },
    });
    await ran.tasks[0]();
    expect(answered.answer).toEqual(
      handedOffAnswer({
        discussFirst: NO_FIX,
        outward: NONE,
        ruling: { kind: "triage", rewrite: false },
        sinceIso: SINCE,
      }),
    );
    expect(ran.events).toEqual(["mic", "mint", "now", "boundary"]);
    expect([ran.sent[0].about, ran.sent[0].triage, ran.sent[0].label, ran.sent[0].feedback]).toEqual([
      "act:ev-9",
      "park-slow-triage",
      "waiting-on-them",
      undefined,
    ]);
  });

  it("records the owner's triage verdict on every line the relay shows, the sending one and the settled one", async () => {
    const ran = page({ answers: [resolved(LANDED)] });
    handOffRelay({
      ...PLAIN,
      say: "park it for the slow hour",
      seams: ran.seams,
      triage: { key: "act:ev-9", ruling: { label: undefined, verdict: "park-slow-triage" } },
    });
    await ran.tasks[0]();
    expect(ran.lines.map((line) => [line.outcome, line.triageVerdict])).toEqual([
      ["sending", "park-slow-triage"],
      ["relayed", "park-slow-triage"],
    ]);
  });

  // The owner's words answering a card other than the open one must take it off the Queue too.
  it("carries the other cards the owner's words answer on the wire and every line, never the card it is about", async () => {
    const ran = page({ answers: [resolved(LANDED)] });
    handOffRelay({
      ...PLAIN,
      alsoAnswers: ["ask:split-files", "act:ev-9"],
      seams: ran.seams,
      triage: { key: "act:ev-9", ruling: { label: undefined, verdict: "send-it" } },
    });
    await ran.tasks[0]();
    expect([ran.sent[0].about, ran.sent[0].alsoAnswers]).toEqual(["act:ev-9", ["ask:split-files"]]);
    expect(ran.lines.map((line) => line.alsoAnswers)).toEqual([["ask:split-files"], ["ask:split-files"]]);
  });

  it("records no triageVerdict key on a line when the relay carried no triage ruling", async () => {
    const ran = page({ answers: [resolved(LANDED)] });
    handOffRelay({ ...PLAIN, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.lines.map((line) => line.outcome)).toEqual(["sending", "relayed"]);
    expect(ran.lines.map((line) => Object.keys(line).includes("triageVerdict"))).toEqual([false, false]);
  });

  it("carries the owner's named feedback on the wire beside the verdict that sent the card back", async () => {
    const ran = page({ answers: [resolved(LANDED), resolved(LANDED)] });
    handOffRelay({
      ...PLAIN,
      say: "no proof on this one, send it back",
      seams: ran.seams,
      triage: { key: "act:ev-9", ruling: { feedback: "no-receipts", label: undefined, verdict: "needs-more-info" } },
    });
    await ran.tasks[0]();
    expect([ran.sent[0].triage, ran.sent[0].label, ran.sent[0].feedback]).toEqual([
      "needs-more-info",
      undefined,
      "no-receipts",
    ]);
  });

  // An approval to send is watched until it settles. Measured: "Love it. Send it", and nothing ever told the owner
  // the reply was held.
  it("watches a Slack send from the instant it was accepted, after its post is queued, without waiting on it", () => {
    const ran = page({ answers: [() => new Promise<RelayPosted>(() => undefined)] });
    const answered = handOffRelay({ ...PLAIN, outward: { kind: "slack-send", url: THREAD }, seams: ran.seams });
    expect(answered).toEqual({
      answer: handedOffAnswer({
        discussFirst: NO_FIX,
        outward: { kind: "slack-send", url: THREAD },
        ruling: undefined,
        sinceIso: SINCE,
      }),
      detail: "handed off, posting in the background; watching the Slack send",
      refused: false,
    });
    expect(ran.watched).toEqual([{ since: SINCE, url: THREAD }]);
    expect(ran.events).toEqual(["about", "mic", "mint", "now", "boundary", "watch"]);
    expect(ran.tasks.length).toBe(1);
  });

  it("keeps the send's thread page-side, off the wire to `talk relay`, even when only the owner's words travel", async () => {
    const ran = page({ answers: [resolved(LANDED)], standing: ["context_pack"] });
    handOffRelay({ ...PLAIN, outward: { kind: "slack-send", url: THREAD }, seams: ran.seams });
    await ran.tasks[0]();
    expect(ran.sent).toEqual([{ ...CUT, readsAfter: ["context_pack"], screen: NOT_TAKEN, turnId: "turn-1" }]);
    expect(ran.watched).toEqual([{ since: SINCE, url: THREAD }]);
  });

  // The discuss-first question is put once, and the owner can say if it gets annoying.
  it("puts the discuss-first question once per repository a call, and carries the owner's next ask past it", async () => {
    const ran = page({ answers: [resolved(LANDED), resolved(LANDED), resolved(LANDED)] });
    const adminFix = { repository: "acme/acme-admin", thread: undefined };
    const first = handOffRelay({ ...PLAIN, fix: adminFix, seams: ran.seams });
    ran.seams.gateLog.current.push({ kind: "heard", text: "yeah we did, go" });
    const second = handOffRelay({ ...PLAIN, fix: adminFix, say: "we did, go", seams: ran.seams });
    ran.seams.gateLog.current.push({ kind: "heard", text: "and fix acme-app too" });
    handOffRelay({ ...PLAIN, fix: { repository: "acme/acme-app", thread: undefined }, seams: ran.seams });
    for (const task of ran.tasks) {
      await task();
    }
    expect(ran.sent.map((wire) => wire.discussFirst)).toEqual([
      { repository: "acme/acme-admin", status: "put" },
      { priorTurnId: "turn-1", repository: "acme/acme-admin", status: "override" },
      { repository: "acme/acme-app", status: "put" },
    ]);
    expect([first.answer, second.answer]).toEqual([
      handedOffAnswer({
        discussFirst: { kind: "put", repository: "acme/acme-admin", thread: undefined },
        outward: NONE,
        ruling: undefined,
        sinceIso: SINCE,
      }),
      HANDED_OFF.answer,
    ]);
  });

  // A put whose post threw left the owner's answer naming a turn not on record, and the go-ahead held.
  it("posts a put that did not land again before the owner's answer, under the same turn, once", async () => {
    const thrown = () => Promise.reject(new Error("fetch failed"));
    const ran = page({ answers: [thrown, resolved(LANDED), resolved(LANDED), resolved(LANDED)] });
    const fix = { repository: "acme/acme-admin", thread: undefined };
    handOffRelay({ ...PLAIN, fix, seams: ran.seams });
    ran.seams.gateLog.current.push({ kind: "heard", text: "yeah we did, go" });
    handOffRelay({ ...PLAIN, fix, say: "we did, go", seams: ran.seams });
    ran.seams.gateLog.current.push({ kind: "heard", text: "and the tests" });
    handOffRelay({ ...PLAIN, fix, say: "and the tests", seams: ran.seams });
    for (const task of ran.tasks) {
      await task();
    }
    expect(ran.sent.map((wire) => [wire.turnId, wire.discussFirst?.status])).toEqual([
      ["turn-1", "put"],
      ["turn-1", "put"],
      ["turn-2", "override"],
      ["turn-3", "override"],
    ]);
    const answered = ran.lines.at(-2)!;
    expect([answered.detail, answered.replay]).toEqual([
      LANDED.detail,
      { said: "the question's relay posted again first: relayed", why: undefined },
    ]);
    expect(relayJournalDetail({ line: answered })).toBe(
      `${LANDED.detail} (the question's relay posted again first: relayed)`,
    );
  });

  it("posts again the words-alone put its retry last sent, when that one did not land either", async () => {
    const ran = page({ answers: [resolved(PRE_CLAIM), resolved(TIMED_OUT), resolved(LANDED), resolved(LANDED)] });
    const fix = { repository: "acme/acme-admin", thread: undefined };
    handOffRelay({ ...PLAIN, fix, seams: ran.seams });
    ran.seams.gateLog.current.push(HEARD);
    handOffRelay({ ...PLAIN, fix, seams: ran.seams });
    for (const task of ran.tasks) {
      await task();
    }
    expect(ran.sent.map((wire) => [wire.turnId, wire.wordsAlone === true, wire.discussFirst?.status])).toEqual([
      ["turn-1", false, "put"],
      ["turn-1", true, "put"],
      ["turn-1", true, "put"],
      ["turn-2", false, "override"],
    ]);
  });

  it("puts the question again on a fresh call, once the ledger is reset", async () => {
    const ran = page({ answers: [resolved(LANDED), resolved(LANDED)] });
    const fix = { repository: "acme/acme-admin", thread: undefined };
    handOffRelay({ ...PLAIN, fix, seams: ran.seams });
    ran.ledger.reset();
    ran.seams.gateLog.current.push(HEARD);
    handOffRelay({ ...PLAIN, fix, seams: ran.seams });
    await ran.tasks[0]();
    await ran.tasks[1]();
    expect(ran.sent.map((wire) => wire.discussFirst?.status)).toEqual(["put", "put"]);
  });

  it("claims no question for a relay the gate shut, so the next ask still puts it", async () => {
    const ran = page({ answers: [resolved(LANDED)], log: [] });
    const fix = { repository: "acme/acme-admin", thread: undefined };
    const shutOne = handOffRelay({ ...PLAIN, fix, seams: ran.seams });
    ran.seams.gateLog.current.push(HEARD);
    handOffRelay({ ...PLAIN, fix, seams: ran.seams });
    await ran.tasks[0]();
    expect([shutOne.refused, ran.sent.map((wire) => wire.discussFirst)]).toEqual([
      true,
      [{ repository: "acme/acme-admin", status: "put" }],
    ]);
  });

  it("watches nothing for a steer that asks for no Slack send, nor for one the gate shut", () => {
    const ran = page({});
    handOffRelay({ ...PLAIN, outward: { kind: "other-outward" }, seams: ran.seams });
    handOffRelay({ ...PLAIN, outward: { kind: "slack-send", url: THREAD }, seams: ran.seams });
    expect(ran.watched).toEqual([]);
  });
});

describe("relayPictureFor", () => {
  it("says no frame was taken this turn when no look took one, rather than grabbing one", () => {
    expect(relayPictureFor({ available: undefined, looking: false })).toEqual(NOT_TAKEN);
  });

  it("carries the frame the look took on the owner's word", () => {
    expect(relayPictureFor({ available: LOOKED, looking: false })).toEqual(LOOKED);
  });

  it("carries a look's own no-picture reason, never a stale frame in its place", () => {
    expect(relayPictureFor({ available: { kind: "none", reason: "capture-failed" }, looking: false })).toEqual({
      kind: "none",
      reason: "capture-failed",
    });
  });

  it("carries no picture while any look is still running", () => {
    expect(relayPictureFor({ available: LOOKED, looking: true })).toEqual(NOT_TAKEN);
  });

  it("opens each window with no frame available and no look running", () => {
    expect(freshTurnWindow()).toEqual({ availableScreen: undefined, looksRunning: 0 });
  });
});

describe("keptRelayLines", () => {
  const line = ({ turnId, outcome }: { turnId: string | undefined; outcome: RelayLine["outcome"] }): RelayLine => ({
    about: "",
    detail: "",
    heard: "ship it",
    outcome,
    say: "",
    turnId,
  });

  it("replaces a relay's earlier line in place, and puts a new relay's line on the end", () => {
    const first = line({ outcome: "sending", turnId: "a" });
    const other = line({ outcome: "relayed", turnId: "b" });
    const held = keptRelayLines({
      held: [first, other],
      kept: 5,
      line: line({ outcome: "relayed", turnId: "a" }),
      overtaken: false,
    });
    expect(held.map((entry) => `${String(entry.turnId)}:${entry.outcome}`)).toEqual(["a:relayed", "b:relayed"]);
  });

  it("drops the oldest line past the bound, and never merges two lines with no turn", () => {
    const shut = line({ outcome: "shut", turnId: undefined });
    const held = keptRelayLines({
      held: [shut, line({ outcome: "relayed", turnId: "a" })],
      kept: 2,
      line: shut,
      overtaken: false,
    });
    expect(held.map((entry) => `${String(entry.turnId)}:${entry.outcome}`)).toEqual(["a:relayed", "undefined:shut"]);
  });

  // A relay of the call before can finish capturing after the next call began, with that call's lines full.
  it("lets a relay of a call the owner has left update its own line, and never push out a line of the call they are on", () => {
    const earlier = line({ outcome: "sending", turnId: "a" });
    const now = [earlier, line({ outcome: "relayed", turnId: "b" })];
    const late = [
      keptRelayLines({ held: now, kept: 2, line: line({ outcome: "shut", turnId: undefined }), overtaken: true }),
      keptRelayLines({ held: now, kept: 2, line: line({ outcome: "relayed", turnId: "c" }), overtaken: true }),
      keptRelayLines({ held: now, kept: 2, line: line({ outcome: "relayed", turnId: "a" }), overtaken: true }),
    ];
    expect(late.map((held) => held.map((entry) => `${String(entry.turnId)}:${entry.outcome}`))).toEqual([
      ["a:sending", "b:relayed"],
      ["a:sending", "b:relayed"],
      ["a:relayed", "b:relayed"],
    ]);
  });
});
