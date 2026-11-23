/*
 * A plan call's tool event runs only once the server says it is still waiting and unclaimed: an event that
 * reached the page after the server timed it out, or a replay of one already answered, is dropped with a line in
 * the call's log rather than run, and so is one whose claim came back a whole server wait after it was asked. A
 * claim that got no answer, or one answered too late to run, is settled as failed by the server's deadline rather
 * than left waiting. The claim is a plain fake seam; nothing is
 * mocked.
 */
import { describe, expect, it } from "vitest";

import type { PlanPost } from "../../components/voice/planCallClient";
import { planCallEventHandler } from "../../components/voice/planWiring";
import { typedInHandler } from "../../components/voice/planWiringEffects";
import type { HeldPlanCall } from "../../components/voice/planWiringHeld";
import { codexTurnLine, nudgeLine, resumeLine, transientResumeRefusal } from "../../components/voice/planWiringLines";
import { frameLine, framePoster, frameUrlOf, lookLine } from "../../components/voice/planWiringLook";
import type { Segment, ToolLine } from "../../components/voice/voiceContext";
import type { AnnounceCue } from "../../lib/announceCue";
import {
  type PlanCallEvent,
  type PlanTurnEvent,
  type PlanTypedInEvent,
  type PlanUsageEvent,
  type PlanWrittenEvent,
  ROLLOVER_REASON,
} from "../../lib/planCallContract";
import type { GateEntry } from "../../lib/relayGate";
import type { ActivityInput } from "../../lib/voiceActivity";

const TAKEN: PlanPost = { kind: "taken" };
const TOOL_EVENT: PlanCallEvent = {
  arguments: '{"say":"ship it"}',
  kind: "tool",
  token: "T.1",
  tool: "relay_steer",
  turnId: undefined,
};
const COUNTS = { cachedInputTokens: 30, inputTokens: 41, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 44 };
const USAGE_EVENT: PlanUsageEvent = { contextWindow: null, kind: "usage", last: COUNTS, total: COUNTS, turnId: "u1" };

// What the owner typed into a live call counts as their turn, in whichever window holds it.
describe("typedInHandler", () => {
  const typed: PlanTypedInEvent = { kind: "typed-in", messageId: "m-1", text: "read this thread" };

  it("hears the owner's typed turn at the gate and the fold, closes it there, and shows it once as a finished turn of theirs", () => {
    const gateLog: { current: GateEntry[] } = { current: [] };
    const acts: ActivityInput[] = [];
    const shown: { speech: Segment; final: boolean }[] = [];
    const on = typedInHandler({
      act: ({ input }) => {
        acts.push(input);
      },
      gateLog,
      show: (input) => {
        shown.push(input);
      },
    });
    on({ event: typed });
    on({ event: typed });
    expect([gateLog.current, acts, shown]).toEqual([
      [{ kind: "heard", text: "read this thread", typed: true }],
      [
        { kind: "heard", text: "read this thread", typed: true },
        { event: { kind: "typed" }, kind: "owner" },
      ],
      [{ final: true, speech: { id: "typed-in-m-1", text: "read this thread", who: "owner" } }],
    ]);
  });
});

describe("planCallEventHandler on token usage", () => {
  it("hands a usage event to the recorder and the fold as its Codex turn moving — nothing claimed, run or logged", async () => {
    const h = handler({});
    h.handle(USAGE_EVENT);
    await settle();
    expect([h.usages, h.acts, h.ran, h.failed, h.lines, h.journal]).toEqual([
      [USAGE_EVENT],
      [{ kind: "codex-turn", phase: "progress", step: null, turnId: "u1" }],
      [],
      [],
      [],
      [],
    ]);
  });

  it("drops a usage event reaching a page whose call has moved on", async () => {
    const h = handler({ stillCurrent: false });
    h.handle(USAGE_EVENT);
    await settle();
    expect(h.usages).toEqual([]);
  });
});

const STARTED: PlanTurnEvent = { kind: "codex-turn", phase: "started", turnId: "t-9" };
const FAILED: PlanTurnEvent = {
  failure: "usage limit reached",
  kind: "codex-turn",
  phase: "completed",
  status: "failed",
  turnId: "t-9",
};

describe("planCallEventHandler on a Codex turn", () => {
  it("feeds a turn's start to the fold and writes it to the call file, never the shown log", async () => {
    const h = handler({});
    h.handle(STARTED);
    await settle();
    expect([h.acts, h.journal, h.lines, h.ran]).toEqual([
      [STARTED],
      [{ detail: "turn t-9 started", ms: undefined, name: "codex", refused: false, usage: undefined }],
      [],
      [],
    ]);
  });

  it("tells the triage pass each turn that starts, before any tool call in it, and never one that ends", async () => {
    const h = handler({});
    h.handle(STARTED);
    h.handle(FAILED);
    h.handle({ ...STARTED, turnId: "t-10" });
    await settle();
    expect(h.started).toEqual(["t-9", "t-10"]);
  });

  it("writes a failed turn's end with its failure, marked refused", async () => {
    const h = handler({});
    h.handle(FAILED);
    await settle();
    expect(h.journal).toEqual([
      {
        detail: "turn t-9 failed: usage limit reached",
        ms: undefined,
        name: "codex",
        refused: true,
        usage: undefined,
      },
    ]);
  });

  it("feeds progress to the fold without a line anywhere", async () => {
    const h = handler({});
    const moved: PlanTurnEvent = { kind: "codex-turn", phase: "progress", step: { kind: "reasoning" }, turnId: "t-9" };
    h.handle(moved);
    await settle();
    expect([h.acts, h.journal, h.lines]).toEqual([[moved], [], []]);
  });

  it("drops a turn event reaching a page whose call has moved on", async () => {
    const h = handler({ stillCurrent: false });
    h.handle(STARTED);
    await settle();
    expect([h.acts, h.journal]).toEqual([[], []]);
  });
});

// The voice can answer a look ask itself; the call file has to count the console's starts.
describe("planCallEventHandler on a look the console started", () => {
  it("writes the start to the call file only — nothing claimed, run, shown or fed to the fold", async () => {
    const h = handler({});
    h.handle({ kind: "look-start" });
    await settle();
    expect([h.journal, h.lines, h.acts, h.ran, h.failed]).toEqual([
      [
        {
          detail: "started the thinking model's turn with the look's frame itself",
          ms: undefined,
          name: "look-start",
          refused: false,
          usage: undefined,
        },
      ],
      [],
      [],
      [],
      [],
    ]);
  });

  it("drops one reaching a page whose call has moved on", async () => {
    const h = handler({ stillCurrent: false });
    h.handle({ kind: "look-start" });
    await settle();
    expect(h.journal).toEqual([]);
  });
});

// A resume and a promise press can draw "On it." and no turn; the call file counts each start
// the console made in the voice's place.
describe("planCallEventHandler on an owed turn the console started", () => {
  it("writes the start to the call file only, naming what the voice took", async () => {
    const h = handler({});
    h.handle({ kind: "owed-start", why: "resume" });
    h.handle({ kind: "owed-start", why: "nudge" });
    h.handle({ kind: "owed-start", why: "promise" });
    h.handle({ kind: "owed-start", why: "triage" });
    await settle();
    const line = (why: string) => ({
      detail: `started the thinking model's turn itself: ${why}`,
      ms: undefined,
      name: "owed-start",
      refused: false,
      usage: undefined,
    });
    const took = (what: string) => line(`the voice took ${what} and handed nothing over`);
    expect([h.journal, h.lines, h.acts, h.ran, h.failed]).toEqual([
      [
        line("the resume made the answer the thinking model's"),
        took("the owner's nudge"),
        took("the page's promise press"),
        line("the triage card's clock was up, and the suggestion is the thinking model's"),
      ],
      [],
      [],
      [],
      [],
    ]);
  });

  it("drops one reaching a page whose call has moved on", async () => {
    const h = handler({ stillCurrent: false });
    h.handle({ kind: "owed-start", why: "resume" });
    await settle();
    expect(h.journal).toEqual([]);
  });
});

// The call file has to tell the server's "on it" from the voice's own words.
describe("planCallEventHandler on an acknowledgement", () => {
  it("writes it to the call file only — nothing claimed, run, shown or fed to the fold", async () => {
    const h = handler({});
    h.handle({ kind: "acknowledged" });
    await settle();
    expect([h.journal, h.lines, h.acts, h.ran, h.failed]).toEqual([
      [{ detail: "said it is on it", ms: undefined, name: "ack", refused: false, usage: undefined }],
      [],
      [],
      [],
      [],
    ]);
  });

  it("drops one reaching a page whose call has moved on", async () => {
    const h = handler({ stillCurrent: false });
    h.handle({ kind: "acknowledged" });
    await settle();
    expect(h.journal).toEqual([]);
  });
});

// The call file has to tell an answer held over the owner's words from one spoken over them.
describe("planCallEventHandler on a held answer", () => {
  // The rollover reads the fold, so each one is folded too; a failed one leaves only its error's line, and a handing
  // one none, its release or failure following. A dropped one has no error beside it, so it leaves its own line.
  it("writes the hold, the release and the drop to the call file, and folds all five for the rollover", async () => {
    const h = handler({});
    const base = { itemId: "a-1", kind: "held-answer", turnId: "t-1" } as const;
    const hold = { ...base, detail: "the owner is still talking", pending: true, phase: "held" } as const;
    const handing = { ...base, detail: "the owner's words went quiet", pending: true, phase: "handing" } as const;
    const release = { ...base, detail: "the owner's words went quiet", pending: false, phase: "released" } as const;
    const failure = { ...base, detail: "blank", pending: false, phase: "failed" } as const;
    const drop = {
      ...base,
      detail: "the owner's words since it reached turn t-1",
      pending: false,
      phase: "dropped",
    } as const;
    h.handle(hold);
    h.handle(handing);
    h.handle(release);
    h.handle(failure);
    h.handle(drop);
    await settle();
    const line = ({ detail }: { detail: string }) => ({
      detail,
      ms: undefined,
      name: "held-answer",
      refused: false,
      usage: undefined,
    });
    expect([h.journal, h.lines, h.acts, h.ran, h.failed]).toEqual([
      [
        line({ detail: "held a-1 of turn t-1: the owner is still talking" }),
        line({ detail: "handed the voice what turn t-1 wrote, through a-1: the owner's words went quiet" }),
        line({
          detail:
            "did not hand the voice what turn t-1 wrote, through a-1: the owner's words since it reached turn t-1",
        }),
      ],
      [],
      [hold, handing, release, failure, drop],
      [],
      [],
    ]);
  });
});

// A turn the voice said it was on can come back with nothing, and something has to say so.
describe("planCallEventHandler on a turn's outcome line", () => {
  it("writes each to the call file, a dropped one as refused, and folds neither", async () => {
    const h = handler({});
    const said = {
      detail: "said it came back with no answer",
      kind: "turn-outcome",
      phase: "said",
      turnId: "t-1",
    } as const;
    const dropped = { ...said, detail: "turn t-2 started after it", phase: "dropped" } as const;
    h.handle(said);
    h.handle(dropped);
    await settle();
    const line = ({ detail, refused }: { detail: string; refused: boolean }) => ({
      detail,
      ms: undefined,
      name: "turn-outcome",
      refused,
      usage: undefined,
    });
    expect([h.journal, h.lines, h.acts, h.ran, h.failed]).toEqual([
      [
        line({ detail: "turn t-1: said it came back with no answer", refused: false }),
        line({ detail: "turn t-1: turn t-2 started after it", refused: true }),
      ],
      [],
      [],
      [],
      [],
    ]);
  });
});

describe("codexTurnLine and nudgeLine", () => {
  it("writes no line for a turn's progress", () => {
    const event: PlanTurnEvent = { kind: "codex-turn", phase: "progress", step: null, turnId: "t-1" };
    expect(codexTurnLine({ event })).toBe(undefined);
  });

  it("writes an interrupted turn's end without a failure, not refused", () => {
    const event: PlanTurnEvent = {
      failure: null,
      kind: "codex-turn",
      phase: "completed",
      status: "interrupted",
      turnId: "t-1",
    };
    expect(codexTurnLine({ event })).toEqual({
      detail: "turn t-1 interrupted",
      ms: undefined,
      name: "codex",
      refused: false,
      usage: undefined,
    });
  });

  it("says a nudge the server took asked the voice to answer", () => {
    expect(nudgeLine({ posted: { kind: "taken" }, promised: false })).toEqual({
      detail: "asked it to answer",
      ms: undefined,
      name: "nudge",
      refused: false,
      usage: undefined,
    });
  });

  it("says the page pressed the nudge itself over a promise that started nothing", () => {
    expect(nudgeLine({ posted: { kind: "taken" }, promised: true })).toEqual({
      detail: "pressed it itself: it said it would do something and started nothing",
      ms: undefined,
      name: "nudge",
      refused: false,
      usage: undefined,
    });
  });

  it("says why a refused nudge was not sent, and that a lost one was lost, whoever pressed it", () => {
    const refused = nudgeLine({
      posted: { kind: "refused", status: 409, why: "it was nudged a moment ago" },
      promised: false,
    });
    const lost = nudgeLine({
      posted: { kind: "lost", why: "the console server did not take the nudge" },
      promised: false,
    });
    const kept = nudgeLine({
      posted: { kind: "refused", status: 409, why: "a Codex turn is already keeping the promise" },
      promised: true,
    });
    expect([refused.detail, refused.refused, lost.detail, lost.refused, kept.detail, kept.refused]).toEqual([
      "not sent: it was nudged a moment ago",
      true,
      "lost: the console server did not take the nudge",
      true,
      "not sent: a Codex turn is already keeping the promise",
      true,
    ]);
  });

  it("says a look line was said, why one was not, and that a lost one was lost", () => {
    const said = lookLine({ ask: "look", posted: { kind: "taken" } });
    const found = lookLine({ ask: "find", posted: { kind: "taken" } });
    const refused = lookLine({ ask: "find", posted: { kind: "refused", status: 409, why: "a nudge is being sent" } });
    const lost = lookLine({ ask: "look", posted: { kind: "lost", why: "no answer in time" } });
    expect([said, found.detail, refused.detail, refused.refused, lost.detail]).toEqual([
      { detail: "said it is having a look", ms: undefined, name: "look", refused: false, usage: undefined },
      "said it is finding it",
      "not said: a nudge is being sent",
      true,
      "lost: no answer in time",
    ]);
  });

  it("says the voice was asked only to acknowledge the owner, why it was not, and that a lost ask was lost", () => {
    const sent = resumeLine({ posted: { kind: "taken" } });
    const refused = resumeLine({
      posted: { kind: "refused", status: 409, why: "a Codex turn is still working on the owner's words" },
    });
    const lost = resumeLine({ posted: { kind: "lost", why: "no answer in time" } });
    expect([sent, refused.detail, refused.refused, lost.detail, lost.refused]).toEqual([
      {
        detail: "asked it to acknowledge the owner and let the thinking model answer",
        ms: undefined,
        name: "resume",
        refused: false,
        usage: undefined,
      },
      "not sent: a Codex turn is still working on the owner's words",
      true,
      "lost: no answer in time",
      true,
    ]);
  });

  // A resume refused with "not sent: someone is talking" is retried once the moment clears; a lost post and any other
  // refusal are not.
  it("retries only a refusal a moment clears, never a lost post or a refusal that would come again", () => {
    expect([
      transientResumeRefusal({ posted: { kind: "refused", status: 409, why: "someone is talking" } }),
      transientResumeRefusal({ posted: { kind: "refused", status: 409, why: "the owner's utterance is still open" } }),
      transientResumeRefusal({ posted: { kind: "lost", why: "someone is talking" } }),
      transientResumeRefusal({ posted: { kind: "taken" } }),
    ]).toEqual([true, false, false, false]);
  });
});

describe("frameUrlOf, frameLine and framePoster", () => {
  const FRAME = "data:image/webp;base64,UklGRg==";
  const OUTPUT = [
    { text: "The owner's screen right now", type: "input_text" as const },
    { detail: "high" as const, image_url: FRAME, type: "input_image" as const },
  ];

  it("finds the look's picture, and none in a look that took no frame or carried a remote URL", () => {
    expect(frameUrlOf({ output: OUTPUT })).toBe(FRAME);
    expect(frameUrlOf({ output: undefined })).toBeUndefined();
    expect(
      frameUrlOf({ output: [{ detail: "high", image_url: "https://example.com/x.png", type: "input_image" }] }),
    ).toBeUndefined();
  });

  it("logs a frame handed over with what was taken, and why one was not", () => {
    const took = "1183×768 of the owner's whole screen, 104 KiB";
    expect(frameLine({ posted: { kind: "taken" }, took })).toEqual({
      detail: "handed the answering turn 1183×768 of the owner's whole screen, 104 KiB",
      ms: undefined,
      name: "frame",
      refused: false,
      usage: undefined,
    });
    const refused = frameLine({ posted: { kind: "refused", status: 409, why: "no turn" }, took });
    const lost = frameLine({ posted: { kind: "lost", why: "no answer" }, took });
    expect([refused.detail, refused.refused, lost.detail]).toEqual([
      "not handed over: no turn",
      true,
      "lost: no answer",
    ]);
  });

  /** A poster over a fixed look and a recording post seam, on a page that holds `c-1`. */
  const poster = ({ output, detail }: { output: typeof OUTPUT | undefined; detail: string }) => {
    const posts: string[] = [];
    const lines: ToolLine[] = [];
    const held: HeldPlanCall = { callId: "c-1", claimant: "page-a", follow: new AbortController() };
    const post = async ({ callId, imageUrl }: { callId: string; imageUrl: string }) => {
      posts.push(`${callId}:${imageUrl}`);
      return TAKEN;
    };
    const run = framePoster({
      current: () => true,
      held: () => held,
      note: ({ line }) => lines.push(line),
      post,
      shoot: async () => ({ detail, output }),
    });
    return { lines, posts, run };
  };

  it("posts the look's picture on the held call and logs it", async () => {
    const { lines, posts, run } = poster({ detail: "1183×768 of the owner's whole screen", output: OUTPUT });
    await run();
    expect(posts).toEqual([`c-1:${FRAME}`]);
    expect(lines.map((line) => line.detail)).toEqual([
      "handed the answering turn 1183×768 of the owner's whole screen",
    ]);
  });

  it("logs a look that threw as one that took nothing, posting nothing and never rejecting", async () => {
    const posts: string[] = [];
    const lines: ToolLine[] = [];
    const held: HeldPlanCall = { callId: "c-1", claimant: "page-a", follow: new AbortController() };
    const run = framePoster({
      current: () => true,
      held: () => held,
      note: ({ line }) => lines.push(line),
      post: async ({ callId, imageUrl }) => {
        posts.push(`${callId}:${imageUrl}`);
        return TAKEN;
      },
      shoot: async () => {
        throw new Error("the encoder refused the frame");
      },
    });
    await run();
    expect([posts, lines.map((line) => [line.detail, line.refused])]).toEqual([
      [],
      [["not handed over: no frame was taken: the look threw: the encoder refused the frame", true]],
    ]);
  });

  it("posts nothing when the look took no frame, and says why", async () => {
    const { lines, posts, run } = poster({ detail: "no screen shared", output: undefined });
    await run();
    expect(posts).toEqual([]);
    expect(lines.map((line) => line.detail)).toEqual(["not handed over: no frame was taken: no screen shared"]);
  });
});

/**
 * A handler over fakes that record what it ran and logged.
 *
 * @param claimed what the server's claim answers — `taken` lets the tool run
 * @param claimTakesMs how long the claim takes to answer on the fake clock
 * @param unsettled what settling a call as failed answers — `undefined` once it is settled
 * @param stillCurrent whether the page's call is still the one the event belongs to
 * @returns the handler, the tools it ran, the calls it settled as failed, the lines it logged, the token usage it
 *   recorded, what it fed the activity fold, the lines it wrote to the call file alone, `hangUp`, which closes
 *   the call and clears the one the page holds, as `stop` does, and `reconnect`, which leaves the event's call no
 *   longer the page's current one, as a dropped call's reconnect does, the rollover reasons it passed on, the
 *   heralds it handed to the page's chime, and the owner's typed turns it handed over
 */
function handler({
  claimed = TAKEN,
  claimTakesMs = 5,
  stillCurrent = true,
  unsettled,
}: {
  claimed?: PlanPost;
  claimTakesMs?: number;
  stillCurrent?: boolean;
  unsettled?: string;
}): {
  readonly handle: (event: PlanCallEvent) => void;
  readonly ran: string[];
  readonly failed: string[];
  readonly lines: ToolLine[];
  readonly usages: PlanUsageEvent[];
  readonly acts: ActivityInput[];
  readonly journal: ToolLine[];
  readonly writtens: PlanWrittenEvent[];
  readonly hangUp: () => void;
  readonly reconnect: () => void;
  readonly rollovers: { reason: string; lifetimeRemainingMs: number | null; contextUrgent: boolean }[];
  readonly progresses: { count: number };
  readonly announced: AnnounceCue[];
  readonly started: string[];
  readonly typedIns: PlanTypedInEvent[];
} {
  const progresses = { count: 0 };
  const announced: AnnounceCue[] = [];
  const started: string[] = [];
  const typedIns: PlanTypedInEvent[] = [];
  const writtens: PlanWrittenEvent[] = [];
  const ran: string[] = [];
  const failed: string[] = [];
  const lines: ToolLine[] = [];
  const usages: PlanUsageEvent[] = [];
  const acts: ActivityInput[] = [];
  const journal: ToolLine[] = [];
  const rollovers: { reason: string; lifetimeRemainingMs: number | null; contextUrgent: boolean }[] = [];
  const closed = { current: false };
  const mine = { current: stillCurrent };
  const held: { current: HeldPlanCall | undefined } = {
    current: { callId: "c-1", claimant: "page-a", follow: new AbortController() },
  };
  const clock = { ms: 0 };
  const handle = planCallEventHandler({
    act: ({ input }) => {
      acts.push(input);
    },
    announce: ({ cue }) => {
      announced.push(cue);
    },
    answer: ({ tool, token }) => {
      ran.push(`${tool}:${token}`);
    },
    claim: async () => {
      clock.ms += claimTakesMs;
      return claimed;
    },
    claimed: { current: new Set<string>() },
    closing: () => closed.current,
    current: () => mine.current,
    ended: () => undefined,
    fail: async ({ held: on, token, deadlineMs }) => {
      failed.push(`${String(on?.callId)}/${token} by ${String(deadlineMs)}`);
      return unsettled;
    },
    held: () => held.current,
    journal: ({ line }) => {
      journal.push(line);
    },
    note: ({ line }) => {
      lines.push(line);
    },
    now: () => clock.ms,
    progress: () => {
      progresses.count += 1;
    },
    rollover: (ask) => {
      rollovers.push(ask);
    },
    typedIn: ({ event }) => {
      typedIns.push(event);
    },
    turnStarted: ({ turnId }) => {
      started.push(turnId);
    },
    usage: ({ usage }) => {
      usages.push(usage);
    },
    windowMs: 120_000,
    written: ({ event }) => {
      writtens.push(event);
    },
  });
  const hangUp = (): void => {
    closed.current = true;
    held.current = undefined;
  };
  const reconnect = (): void => {
    mine.current = false;
  };
  return {
    acts,
    announced,
    failed,
    handle,
    hangUp,
    journal,
    lines,
    progresses,
    ran,
    reconnect,
    rollovers,
    started,
    typedIns,
    usages,
    writtens,
  };
}

/** Let the claim's promise settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("planCallEventHandler", () => {
  it("hands each progress event to the page's cue, never as a tool call, a line or an activity, and drops it once the call is not current", async () => {
    const h = handler({});
    h.handle({ kind: "progress" });
    h.handle({ kind: "progress" });
    await settle();
    expect([h.progresses.count, h.ran, h.lines, h.journal, h.acts]).toEqual([2, [], [], [], []]);
    const stale = handler({ stillCurrent: false });
    stale.handle({ kind: "progress" });
    expect(stale.progresses.count).toBe(0);
  });

  it("hands each herald to the page's chime, twice for two of a kind, never as a tool call, a line or an activity, and drops it once the call is not current", async () => {
    const h = handler({});
    h.handle({ cue: "focus", kind: "announce" });
    h.handle({ cue: "focus", kind: "announce" });
    h.handle({ cue: "attention", kind: "announce" });
    await settle();
    expect([h.announced, h.progresses.count, h.ran, h.lines, h.journal, h.acts]).toEqual([
      ["focus", "focus", "attention"],
      0,
      [],
      [],
      [],
      [],
    ]);
    const stale = handler({ stillCurrent: false });
    stale.handle({ cue: "reminder", kind: "announce" });
    expect(stale.announced).toEqual([]);
  });

  it("hands what a typed thread wrote to the page, never as a tool call, and drops it once the call is not current", async () => {
    const written: PlanWrittenEvent = { final: false, itemId: "msg-1", kind: "written", text: "Kia", turnId: "t-1" };
    const h = handler({});
    h.handle(written);
    await settle();
    expect([h.writtens, h.ran, h.lines]).toEqual([[written], [], []]);
    const stale = handler({ stillCurrent: false });
    stale.handle(written);
    expect(stale.writtens).toEqual([]);
  });

  it("hands the owner's typed turn to the page, never as a tool call, and drops it once the call is not current", async () => {
    const typed: PlanTypedInEvent = { kind: "typed-in", messageId: "m-1", text: "https://x.slack.com/archives/C1/p1" };
    const h = handler({});
    h.handle(typed);
    await settle();
    expect([h.typedIns, h.ran, h.lines, h.acts]).toEqual([[typed], [], [], []]);
    const stale = handler({ stillCurrent: false });
    stale.handle(typed);
    expect(stale.typedIns).toEqual([]);
  });

  it("runs a tool call the server lets it claim, once however often the event arrives", async () => {
    const h = handler({});
    h.handle(TOOL_EVENT);
    h.handle(TOOL_EVENT);
    await settle();
    expect([h.ran, h.lines]).toEqual([["relay_steer:T.1"], []]);
  });

  it("drops a tool call the server already settled, and logs why rather than running it", async () => {
    const h = handler({
      claimed: {
        kind: "refused",
        status: 409,
        why: "no tool call is waiting on that token: answered already, timed out, or never made",
      },
    });
    h.handle(TOOL_EVENT);
    await settle();
    expect([h.ran, h.failed]).toEqual([[], []]);
    expect(h.lines).toEqual([
      {
        detail: "not run: no tool call is waiting on that token: answered already, timed out, or never made",
        ms: undefined,
        name: "relay_steer",
        refused: true,
        usage: undefined,
      },
    ]);
  });

  it("drops a claim answered a whole window after it was asked, since the server may have timed it out", async () => {
    const h = handler({ claimTakesMs: 121_000 });
    h.handle(TOOL_EVENT);
    await settle();
    expect([h.ran, h.failed]).toEqual([[], ["c-1/T.1 by 241000"]]);
    expect(h.lines.map((line) => line.detail)).toEqual([
      "not run: its claim was answered 121s after it was asked, past the server's wait",
    ]);
  });

  // A starved console answers a post late or with a 5xx, and a call left unanswered holds the thread.
  it("settles a tool call whose claim got no answer as failed, by a window from when it gave up, and never runs it", async () => {
    const h = handler({ claimTakesMs: 10_000, claimed: { kind: "lost", why: "the route answered HTTP 503" } });
    h.handle(TOOL_EVENT);
    await settle();
    expect([h.ran, h.failed, h.lines.map((line) => line.detail)]).toEqual([
      [],
      ["c-1/T.1 by 130000"],
      ["not run: the route answered HTTP 503"],
    ]);
  });

  it("still settles a lost claim as failed, on the call it was claimed on, when the owner hung up while it was in flight", async () => {
    const h = handler({ claimed: { kind: "lost", why: "the route answered HTTP 503" } });
    h.handle(TOOL_EVENT);
    h.hangUp();
    await settle();
    expect([h.ran, h.failed]).toEqual([[], ["c-1/T.1 by 120005"]]);
  });

  it("logs why a failure answer could not land", async () => {
    const h = handler({
      claimed: { kind: "lost", why: "the route answered HTTP 503" },
      unsettled: "no failure answer reached the call",
    });
    h.handle(TOOL_EVENT);
    await settle();
    expect(h.lines.map((line) => line.detail)).toEqual([
      "not run: the route answered HTTP 503",
      "no failure answer reached the call",
    ]);
  });

  it("runs a claim answered just inside the window", async () => {
    const h = handler({ claimTakesMs: 119_999 });
    h.handle(TOOL_EVENT);
    await settle();
    expect(h.ran).toEqual(["relay_steer:T.1"]);
  });

  it("runs nothing when the owner hung up while the claim was in flight, and settles what it claimed as failed", async () => {
    const h = handler({});
    h.handle(TOOL_EVENT);
    h.hangUp();
    await settle();
    expect([h.ran, h.failed]).toEqual([[], ["c-1/T.1 by 120005"]]);
  });

  // The dropped call's claim answering after the reconnect wrote its line into the new call.
  it("writes nothing into the call that reconnected in its place when a refused claim answers late", async () => {
    const h = handler({ claimed: { kind: "refused", status: 409, why: "the call ended" } });
    h.handle(TOOL_EVENT);
    h.reconnect();
    await settle();
    expect([h.ran, h.failed, h.lines]).toEqual([[], [], []]);
  });

  it("still settles a lost claim on the call it was claimed on after a reconnect, writing no line into the new one", async () => {
    const h = handler({
      claimed: { kind: "lost", why: "the route answered HTTP 503" },
      unsettled: "no failure answer reached the call",
    });
    h.handle(TOOL_EVENT);
    h.reconnect();
    await settle();
    expect([h.ran, h.failed, h.lines]).toEqual([[], ["c-1/T.1 by 120005"], []]);
  });

  it("writes nothing into the new call for a claim answered past the window after a reconnect", async () => {
    const h = handler({ claimTakesMs: 121_000 });
    h.handle(TOOL_EVENT);
    h.reconnect();
    await settle();
    expect([h.ran, h.failed, h.lines]).toEqual([[], ["c-1/T.1 by 241000"], []]);
  });
  it("passes a rollover on with its reason, deadline and context urgency, only while its call is current", async () => {
    const [live, moved] = [handler({}), handler({ stillCurrent: false })];
    const ask = { contextUrgent: true, lifetimeRemainingMs: 180_000, reason: ROLLOVER_REASON };
    live.handle({ kind: "rollover", ...ask });
    moved.handle({ kind: "rollover", ...ask });
    await settle();
    expect([live.rollovers, live.ran, live.lines, live.journal]).toEqual([[ask], [], [], []]);
    expect(moved.rollovers).toEqual([]);
  });
});
