/*
 * The page's watcher over two call failures, on plain fake seams: the voice's "fourteen cards" posted as a
 * grounding the server keeps as provenance, never handed back to the voice, retried only while the post is lost or the
 * page holds no plan call; and each starting turn posted the speech the thread has not had, kept when a post fails.
 */

import { describe, expect, it } from "vitest";

import type { PlanPost } from "../../components/voice/planCallClient";
import type { HeldPlanCall } from "../../components/voice/planWiringHeld";
import type { ToolLine } from "../../components/voice/voiceContext";
import { openCardReads, voiceRecordWatcher } from "../../components/voice/voiceRecordWiring";
import {
  GROUNDING_RETRY_MS,
  GROUNDING_TRIES,
  type VoiceRecordSeams,
} from "../../components/voice/voiceRecordWiringPoster";
import type { QueueShownCounts } from "../../lib/queueShownCounts";
import { type GateEntry, OPEN_CARD_DRAFT_READ } from "../../lib/relayGate";
import type { OpenCardDraft } from "../../lib/talkVoiceRecord";
import type { HeardStamp } from "../../lib/transcriptSinkContract";

/** The app's figures. */
const SHOWN: QueueShownCounts = {
  everything: 29,
  otherContext: { context: "slopweaver", count: 0 },
  view: "all",
  views: { all: 29, "check-in": 3, colleague: 0, finding: 0, fleet: 26, review: 0, slack: 0, urgent: 0 },
  waiting: 26,
};

const HELD: HeldPlanCall = { callId: "call-1", claimant: "page-1", follow: new AbortController() };

const FOURTEEN = { id: "v1", text: "That covers fourteen cards. That's the last one.", who: "voice" } as const;
const ASKED = { id: "h1", text: "Where did fourteen come from?", who: "owner" } as const;

/** Let every resolved post's `.then` run. */
async function settle(): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    await Promise.resolve();
  }
}

/**
 * A watcher on fake seams that answer each post from a script, in order, and hold every wait for the test to run.
 *
 * @param counts what each count grounding post answers
 * @param claims what each claim grounding post answers
 * @param records what each record post answers
 * @param held the plan call the page holds at first, none before one is minted
 * @returns the watcher and everything it posted, waited on and logged
 */
function watched({
  counts = [],
  claims = [],
  records = [],
  held,
  stamps = new Map(),
  drafts = new Map(),
}: {
  counts?: readonly PlanPost[];
  claims?: readonly PlanPost[];
  records?: readonly PlanPost[];
  held: HeldPlanCall | undefined;
  stamps?: ReadonlyMap<string, HeardStamp>;
  drafts?: ReadonlyMap<string, OpenCardDraft>;
}) {
  const counted: unknown[] = [];
  const claimed: unknown[] = [];
  const recorded: unknown[] = [];
  // Every read the gate was told of and every post made, in one order, so a read is seen to come first.
  const order: string[] = [];
  const waits: { ms: number; run: () => void }[] = [];
  const lines: ToolLine[] = [];
  let live = true;
  let holding = held;
  const seams: VoiceRecordSeams = {
    after: ({ ms, run }) => {
      waits.push({ ms, run });
      return () => undefined;
    },
    claimGrounding: (input) => {
      claimed.push(input);
      return Promise.resolve(claims[claimed.length - 1]);
    },
    countGrounding: (input) => {
      counted.push(input);
      return Promise.resolve(counts[counted.length - 1]);
    },
    record: (input) => {
      recorded.push(input);
      order.push("post");
      return Promise.resolve(records[recorded.length - 1]);
    },
  };
  const watcher = voiceRecordWatcher({
    current: () => live,
    heardStamp: ({ segmentId }) => stamps.get(segmentId),
    held: () => holding,
    note: ({ line }) => {
      lines.push(line);
    },
    openCardDraft: ({ key }) => (key === undefined ? undefined : drafts.get(key)),
    recordRead: () => {
      order.push("read");
    },
    seams,
    shownNow: () => SHOWN,
  });
  return {
    claimed,
    counted,
    end: () => {
      live = false;
    },
    hold: ({ call }: { call: HeldPlanCall }) => {
      holding = call;
    },
    lines,
    named: ({ name }: { name: string }) =>
      lines.filter((line) => line.name === name).map(({ detail, refused }) => [refused, detail]),
    order,
    recorded,
    waits,
    watcher,
  };
}

/** The held reply the owner's question was about. */
const REPLY: OpenCardDraft = { draft: "This is still open.", key: "post:sd-30e3b8b1", kind: "single" };

const LOST: PlanPost = { kind: "lost", why: "the post did not answer in time" };

const INCIDENT_GROUNDING = {
  callId: "call-1",
  grounding: {
    claimed: 14,
    expected: [{ count: 29, label: "Everything" }],
    fromThread: false,
    key: "v1:12",
    subject: "everything",
  },
};

const UNGROUNDED_FOURTEEN =
  'said "fourteen cards", which the app does not show: the app shows Everything 29; nothing the thinking model wrote said it';
const RECORDED_FOURTEEN = 'recorded where "fourteen cards" came from, for the thinking model; the voice was not told';

describe("voiceRecordWatcher — counts", () => {
  it("posts the incident's fourteen as one grounding with its key, logged ungrounded then recorded", async () => {
    const w = watched({ counts: [{ kind: "taken" }], held: HELD });
    w.watcher.speech({ final: false, speech: { ...FOURTEEN, text: "That covers fourteen" } });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    await settle();
    expect(w.counted).toEqual([INCIDENT_GROUNDING]);
    expect(w.named({ name: "count-grounding" })).toEqual([
      [true, UNGROUNDED_FOURTEEN],
      [false, RECORDED_FOURTEEN],
    ]);
    expect(w.waits).toEqual([]);
  });

  it("posts a lost grounding again after GROUNDING_RETRY_MS, the same body each time, then gives up after GROUNDING_TRIES", async () => {
    const w = watched({ counts: Array.from({ length: GROUNDING_TRIES }, () => LOST), held: HELD });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    for (let wait = 0; wait < GROUNDING_TRIES - 1; wait += 1) {
      await settle();
      w.waits[wait].run();
    }
    await settle();
    expect(w.counted).toEqual(Array.from({ length: GROUNDING_TRIES }, () => INCIDENT_GROUNDING));
    expect(w.waits.map(({ ms }) => ms)).toEqual(Array.from({ length: GROUNDING_TRIES - 1 }, () => GROUNDING_RETRY_MS));
    expect(w.named({ name: "count-grounding" })).toEqual([
      [true, UNGROUNDED_FOURTEEN],
      [
        true,
        `could not record where "fourteen cards" came from: the post did not answer in time, after ${String(GROUNDING_TRIES)} tries`,
      ],
    ]);
  });

  it("records a grounding a retry gets taken, with no further wait", async () => {
    const w = watched({ counts: [LOST, { kind: "taken" }], held: HELD });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    await settle();
    w.waits[0].run();
    await settle();
    expect([w.counted.length, w.waits.length, w.named({ name: "count-grounding" }).at(-1)]).toEqual([
      2,
      1,
      [false, RECORDED_FOURTEEN],
    ]);
  });

  it("never posts again a grounding the server refused", async () => {
    const w = watched({ counts: [{ kind: "refused", status: 410, why: "the call has ended" }], held: HELD });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    await settle();
    expect([w.counted.length, w.waits, w.named({ name: "count-grounding" }).at(-1)]).toEqual([
      1,
      [],
      [true, 'could not record where "fourteen cards" came from: the call has ended'],
    ]);
  });

  it("writes an unkept grounding down as the call ends, and a retry afterwards posts nothing", async () => {
    const w = watched({ counts: [LOST, { kind: "taken" }], held: HELD });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    await settle();
    w.watcher.end();
    w.waits[0].run();
    await settle();
    expect([w.counted.length, w.named({ name: "count-grounding" })]).toEqual([
      1,
      [
        [true, UNGROUNDED_FOURTEEN],
        [true, 'could not record where "fourteen cards" came from: the call ended first'],
      ],
    ]);
  });

  it("keeps a grounding owed while the page holds no plan call, and posts it once one is held", async () => {
    const w = watched({ counts: [{ kind: "taken" }], held: undefined });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    await settle();
    expect([w.counted, w.waits.map(({ ms }) => ms)]).toEqual([[], [GROUNDING_RETRY_MS]]);
    w.hold({ call: HELD });
    w.waits[0].run();
    await settle();
    expect([w.counted, w.named({ name: "count-grounding" }).at(-1)]).toEqual([
      [INCIDENT_GROUNDING],
      [false, RECORDED_FOURTEEN],
    ]);
  });
});

describe("voiceRecordWatcher — spoken record", () => {
  it("posts a starting turn the speech before it, and keeps it for the next turn when the post failed", async () => {
    const lost: PlanPost = { kind: "lost", why: "turn t1 did not answer the record in time" };
    const w = watched({ counts: [{ kind: "taken" }], held: HELD, records: [lost, { kind: "taken" }] });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "t1" } });
    w.watcher.speech({ final: true, speech: ASKED });
    await settle();
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "t2" } });
    await settle();
    expect(w.recorded).toEqual([
      { callId: "call-1", record: { lines: [FOURTEEN], openCard: undefined, turnId: "t1" } },
      { callId: "call-1", record: { lines: [FOURTEEN, ASKED], openCard: undefined, turnId: "t2" } },
    ]);
    expect(w.order).toEqual(["post", "post"]);
    expect(w.lines.filter(({ name }) => name === "spoken-record")).toEqual([
      {
        detail:
          "turn t1 did not take the record: turn t1 did not answer the record in time; its lines wait for the next turn",
        ms: undefined,
        name: "spoken-record",
        refused: true,
        usage: undefined,
      },
      {
        detail: "steered 2 line(s) of what was said into turn t2",
        ms: undefined,
        name: "spoken-record",
        refused: false,
        usage: undefined,
      },
    ]);
  });

  // "What is the reply?" — its turn starts before the owner's words are final.
  it("posts a turn the draft of the card the owner's words began over, before they are final, telling the gate first", async () => {
    const stamps = new Map<string, HeardStamp>([["h2", { open: "post:sd-30e3b8b1", openBy: undefined }]]);
    const drafts = new Map<string, OpenCardDraft>([["post:sd-30e3b8b1", REPLY]]);
    const w = watched({ drafts, held: HELD, records: [{ kind: "taken" }], stamps });
    w.watcher.speech({ final: false, speech: { id: "h2", text: "What is the", who: "owner" } });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "01a13346" } });
    await settle();
    expect(w.recorded).toEqual([{ callId: "call-1", record: { lines: [], openCard: REPLY, turnId: "01a13346" } }]);
    expect(w.order).toEqual(["read", "post"]);
    expect(w.lines.at(-1)!.detail).toBe(
      "steered 0 line(s) of what was said and post:sd-30e3b8b1's draft into turn 01a13346",
    );
  });

  // A sent reply leaves no row, so the draft is read as the owner's words are first heard.
  it("posts the draft the owner's words began over even when the card is sent before the turn starts", async () => {
    const stamps = new Map<string, HeardStamp>([["h2", { open: "post:sd-30e3b8b1", openBy: undefined }]]);
    const drafts = new Map<string, OpenCardDraft>([["post:sd-30e3b8b1", REPLY]]);
    const w = watched({ drafts, held: HELD, records: [{ kind: "taken" }], stamps });
    w.watcher.speech({ final: false, speech: { id: "h2", text: "What is the", who: "owner" } });
    drafts.delete("post:sd-30e3b8b1");
    w.watcher.speech({ final: false, speech: { id: "h2", text: "What is the reply", who: "owner" } });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "01a13346" } });
    await settle();
    expect(w.recorded).toEqual([{ callId: "call-1", record: { lines: [], openCard: REPLY, turnId: "01a13346" } }]);
  });

  it("keeps the card the owner's newest words began over when an older segment's final arrives late", async () => {
    const stamps = new Map<string, HeardStamp>([
      ["h1", { open: "post:sd-old", openBy: undefined }],
      ["h2", { open: "post:sd-30e3b8b1", openBy: undefined }],
    ]);
    const older: OpenCardDraft = { draft: "An older reply.", key: "post:sd-old", kind: "single" };
    const drafts = new Map<string, OpenCardDraft>([
      ["post:sd-old", older],
      ["post:sd-30e3b8b1", REPLY],
    ]);
    const w = watched({ drafts, held: HELD, records: [{ kind: "taken" }], stamps });
    w.watcher.speech({ final: false, speech: { id: "h1", text: "And", who: "owner" } });
    w.watcher.speech({ final: false, speech: { id: "h2", text: "What is the", who: "owner" } });
    w.watcher.speech({ final: true, speech: { id: "h1", text: "And that one.", who: "owner" } });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "t1" } });
    await settle();
    expect(w.recorded).toEqual([
      {
        callId: "call-1",
        record: { lines: [{ id: "h1", text: "And that one.", who: "owner" }], openCard: REPLY, turnId: "t1" },
      },
    ]);
  });

  // The voice's line finishes only after the turn answering the owner's question has started.
  it("posts a voice line finished after a turn started into that turn, and none once it completed", async () => {
    const w = watched({ counts: [{ kind: "taken" }], held: HELD, records: [{ kind: "taken" }], stamps: new Map() });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "t1" } });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    await settle();
    w.watcher.event({
      event: { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t1" },
    });
    w.watcher.speech({ final: true, speech: { id: "v9", text: "Done.", who: "voice" } });
    await settle();
    expect(w.recorded).toEqual([
      { callId: "call-1", record: { lines: [FOURTEEN], openCard: undefined, turnId: "t1" } },
    ]);
  });

  it("posts no draft when the owner's words began over no post card, nor when the voice spoke last", async () => {
    const stamps = new Map<string, HeardStamp>([["h3", { open: "ask:some-slug", openBy: undefined }]]);
    const w = watched({ counts: [{ kind: "taken" }], held: HELD, records: [{ kind: "taken" }], stamps });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "t0" } });
    w.watcher.event({
      event: { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t0" },
    });
    w.watcher.speech({ final: false, speech: { id: "h3", text: "And this one?", who: "owner" } });
    w.watcher.speech({ final: true, speech: FOURTEEN });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "t1" } });
    await settle();
    expect(w.recorded).toEqual([
      { callId: "call-1", record: { lines: [FOURTEEN], openCard: undefined, turnId: "t1" } },
    ]);
    expect(w.order).toEqual(["post"]);
  });

  it("on the page, writes the draft's read into the call's gate record, and finds no draft for a key on no row", () => {
    const gateLog: { current: GateEntry[] } = { current: [] };
    const reads = openCardReads({ cards: () => ({ recentlyLeft: [], rows: [] }), gateLog });
    reads.recordRead();
    expect(gateLog.current).toEqual([{ kind: "read", tool: OPEN_CARD_DRAFT_READ }]);
    expect(reads.openCardDraft({ key: "post:sd-30e3b8b1" })).toBeUndefined();
  });

  it("does nothing once its session is no longer the live one", async () => {
    const w = watched({ held: HELD });
    w.end();
    w.watcher.speech({ final: true, speech: { ...FOURTEEN, text: "That covers fourteen cards. Draft sent." } });
    w.watcher.event({ event: { kind: "codex-turn", phase: "started", turnId: "t1" } });
    await settle();
    expect([w.counted, w.claimed, w.recorded, w.lines]).toEqual([[], [], [], []]);
  });
});

/** The proposal, then an empty answer. */
const PROPOSAL = "We paused rapid triage on the draft asking Rosa. Send that bump, park it, or drop it?";
const DRAFT_SENT = { id: "v9", text: " Draft sent.", who: "voice" } as const;
const SENT_GROUNDING = { callId: "call-1", grounding: { act: "sent", key: "v9:7", kind: "outcome" } };
const UNGROUNDED_SENT =
  'said "Draft sent.": nothing the thinking model wrote said it was sent, and no send outcome confirmed it';

/**
 * Feed the watcher one completed message of the thread's.
 *
 * @returns nothing; the watcher keeps it
 */
function wrote({ w, text }: { w: ReturnType<typeof watched>; text: string }): void {
  w.watcher.event({ event: { final: true, itemId: `i-${text.length}`, kind: "written", text, turnId: "t1" } });
}

describe("voiceRecordWatcher — claims", () => {
  it("posts 'Draft sent.' once as the closed shape keyed by segment and offset, logged ungrounded then recorded", async () => {
    const w = watched({ claims: [{ kind: "taken" }], held: HELD });
    wrote({ text: PROPOSAL, w });
    wrote({ text: "", w });
    w.watcher.speech({ final: false, speech: { ...DRAFT_SENT, text: " Draft" } });
    w.watcher.speech({ final: true, speech: DRAFT_SENT });
    w.watcher.speech({ final: true, speech: DRAFT_SENT });
    await settle();
    expect(w.claimed).toEqual([SENT_GROUNDING]);
    expect(w.named({ name: "spoken-grounding" })).toEqual([
      [true, UNGROUNDED_SENT],
      [
        false,
        'recorded where "Draft sent." came from, for the thinking model; the call owes the voice a correction aloud',
      ],
    ]);
  });

  // The FINAL the owner answers with "you're saying it posted, but clearly it didn't".
  it("posts Tuesday's 'posted' as one outcome grounding, and grounds 'went up' on a send the page read as gone", async () => {
    const tuesday = watched({ claims: [{ kind: "taken" }], held: HELD });
    const text =
      "Your steered vuln fix top up for Acme admin posted and missed the deadline. The top up ran and raised the happy " +
      "dom bump. The fleet's still on it, and the note's on your screen if you want to steer it.";
    tuesday.watcher.speech({ final: true, speech: { id: "v3", text, who: "voice" } });
    const sent = watched({ held: HELD });
    sent.watcher.landed({ outcome: { permalink: "https://example.slack.com/p1", state: "sent" } });
    sent.watcher.speech({ final: true, speech: { id: "v4", text: "The post went up.", who: "voice" } });
    await settle();
    expect([tuesday.claimed, sent.claimed]).toEqual([
      [{ callId: "call-1", grounding: { act: "posted", key: "v3:44", kind: "outcome" } }],
      [],
    ]);
  });

  it("posts two claims from one sentence side by side, each keyed where it was said", async () => {
    const w = watched({ claims: [{ kind: "taken" }, { kind: "taken" }], held: HELD });
    w.watcher.speech({
      final: true,
      speech: { id: "v1", text: "Draft sent, and it's PR one two three.", who: "voice" },
    });
    await settle();
    expect(w.claimed).toEqual([
      { callId: "call-1", grounding: { act: "sent", key: "v1:6", kind: "outcome" } },
      { callId: "call-1", grounding: { claimed: 123, key: "v1:21", kind: "pr-number" } },
    ]);
  });

  it("posts a count and a claim owed by one segment, neither waiting on the other", async () => {
    const both = { id: "v1", text: "That covers fourteen cards. Draft sent.", who: "voice" } as const;
    const w = watched({ claims: [{ kind: "taken" }], counts: [{ kind: "taken" }], held: HELD });
    w.watcher.speech({ final: true, speech: both });
    await settle();
    expect([w.counted, w.claimed, w.waits]).toEqual([
      [INCIDENT_GROUNDING],
      [{ callId: "call-1", grounding: { act: "sent", key: "v1:34", kind: "outcome" } }],
      [],
    ]);
  });

  it("retries a lost claim grounding to the plan call the page holds by then", async () => {
    const w = watched({ claims: [LOST, { kind: "taken" }], held: HELD });
    w.watcher.speech({ final: true, speech: DRAFT_SENT });
    await settle();
    w.hold({ call: { ...HELD, callId: "call-2" } });
    w.waits[0].run();
    await settle();
    expect(w.claimed).toEqual([SENT_GROUNDING, { ...SENT_GROUNDING, callId: "call-2" }]);
  });

  it("never posts again a claim grounding the server refused", async () => {
    const w = watched({ claims: [{ kind: "refused", status: 424, why: "the write failed" }], held: HELD });
    w.watcher.speech({ final: true, speech: DRAFT_SENT });
    await settle();
    expect([w.claimed.length, w.waits, w.named({ name: "spoken-grounding" }).at(-1)]).toEqual([
      1,
      [],
      [true, 'could not record where "Draft sent." came from: the write failed'],
    ]);
  });

  it("never posts one for the owner's own words or the thread's, whatever they claim", async () => {
    const w = watched({ held: HELD });
    w.watcher.speech({ final: true, speech: { id: "h1", text: "Draft sent. It's PR one two three.", who: "owner" } });
    wrote({ text: "Draft sent. It's PR one two three.", w });
    await settle();
    expect([w.claimed, w.named({ name: "spoken-grounding" })]).toEqual([[], []]);
  });

  it("grounds 'sent' on a Slack send the page's watch read as gone, which is never said unasked", async () => {
    const unread = watched({ claims: [{ kind: "taken" }], held: HELD });
    unread.watcher.speech({ final: true, speech: DRAFT_SENT });
    await settle();
    const sent = watched({ held: HELD });
    sent.watcher.landed({ outcome: { permalink: "https://example.slack.com/p1", state: "sent" } });
    sent.watcher.speech({ final: true, speech: { id: "v2", text: "It's posted. Draft sent.", who: "voice" } });
    await settle();
    expect([unread.claimed, sent.claimed, sent.lines]).toEqual([[SENT_GROUNDING], [], []]);
  });

  it("grounds 'sent' on the owner's own FINAL words, until a completed message proposes another send", async () => {
    const said = { id: "h1", text: " All right, I've just sent that, tag Lockibot, thank you.", who: "owner" } as const;
    const echoed = watched({ held: HELD });
    echoed.watcher.speech({ final: false, speech: said });
    echoed.watcher.speech({ final: true, speech: said });
    echoed.watcher.speech({ final: true, speech: DRAFT_SENT });
    await settle();
    const proposed = watched({ claims: [{ kind: "taken" }], held: HELD });
    proposed.watcher.speech({ final: true, speech: said });
    wrote({ text: PROPOSAL, w: proposed });
    proposed.watcher.speech({ final: true, speech: DRAFT_SENT });
    await settle();
    expect([echoed.claimed, proposed.claimed]).toEqual([[], [SENT_GROUNDING]]);
  });

  it("records a question asked again over the same card after the owner spoke, with no answer asking it, as repeated-ask", async () => {
    const ask = "Upload now, get owners' review first, or wait for live checks?";
    const card: HeardStamp = { open: "ask:docs", openBy: undefined };
    const stamps = new Map<string, HeardStamp>([
      ["v1", card],
      ["v2", card],
      ["v3", { open: "ask:other", openBy: undefined }],
    ]);
    const w = watched({ claims: [{ kind: "taken" }], held: HELD, stamps });
    wrote({ text: ask, w });
    w.watcher.speech({ final: true, speech: { id: "v1", text: ask, who: "voice" } });
    w.watcher.speech({ final: true, speech: { id: "h1", text: "None of the above is my answer.", who: "owner" } });
    wrote({ text: "The briefing comes first.", w });
    w.watcher.speech({ final: true, speech: { id: "v3", text: `The briefing comes first. ${ask}`, who: "voice" } });
    w.watcher.speech({ final: true, speech: { id: "v2", text: `The briefing comes first. ${ask}`, who: "voice" } });
    await settle();
    expect([w.claimed, w.named({ name: "spoken-grounding" })]).toEqual([
      [{ callId: "call-1", grounding: { key: "v2:25", kind: "repeated-ask" } }],
      [
        [true, `said "${ask}": asked again after the owner spoke, and nothing the thinking model wrote since asked it`],
        [false, `recorded where "${ask}" came from, for the thinking model; the voice was not told`],
      ],
    ]);
  });

  it("writes an unkept claim grounding down as the call ends", async () => {
    const w = watched({ held: undefined });
    w.watcher.speech({ final: true, speech: DRAFT_SENT });
    await settle();
    w.watcher.end();
    expect([w.claimed, w.named({ name: "spoken-grounding" })]).toEqual([
      [],
      [
        [true, UNGROUNDED_SENT],
        [true, 'could not record where "Draft sent." came from: the call ended first'],
      ],
    ]);
  });
});

describe("voiceRecordWatcher — fleet promises", () => {
  // The FINAL the owner answers with: "you are not the fleet".
  it("posts 'I'll get you that briefing' as the closed fleet-promise shape, logged ungrounded then recorded", async () => {
    const w = watched({ claims: [{ kind: "taken" }], held: HELD });
    wrote({
      text: "The fleet will produce that separate briefing: what the rules enforce, how exceptions get through, and what you authorised.",
      w,
    });
    const text =
      " I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved them.";
    w.watcher.speech({ final: true, speech: { id: "v7", text, who: "voice" } });
    await settle();
    expect([w.claimed, w.named({ name: "spoken-grounding" })]).toEqual([
      [{ callId: "call-1", grounding: { key: "v7:1", kind: "fleet-promise" } }],
      [
        [
          true,
          "said \"I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved them.\": promised fleet work as the voice's own",
        ],
        [
          false,
          'recorded where "I\'ll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved them." came from, for the thinking model; the call owes the voice a correction aloud',
        ],
      ],
    ]);
  });

  it("posts nothing for a look the call takes now", async () => {
    const w = watched({ held: HELD });
    w.watcher.speech({ final: true, speech: { id: "v8", text: " I'll check.", who: "voice" } });
    await settle();
    expect([w.claimed, w.named({ name: "spoken-grounding" })]).toEqual([[], []]);
  });
});
