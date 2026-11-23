/*
 * A plan call's data-channel vocabulary, folded over a synthetic 0.157.1 session (`fixtures/talkPlanSession.jsonl`:
 * a fake microphone reading a scripted question with two pauses, every id synthetic): the transcript comes out
 * whole and once per turn, every heard fragment reaches the gate, and the hand-offs are named.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TYPED_MESSAGE_ID_MAX_CHARS, TYPED_TEXT_MAX_CHARS } from "../../lib/planCallContract";
import { foldPlanEvent, type PlanEffect, type PlanTurn, planContentOf } from "../../lib/talkPlanEvents";
import { planStreamEntryOf } from "../../lib/talkPlanEventsStream";

describe("planStreamEntryOf on a written event", () => {
  const event = { final: false, itemId: "msg-1", kind: "written", text: "The thread", turnId: "t-1" };

  it("reads a partial and a whole one", () => {
    expect(planStreamEntryOf({ line: JSON.stringify({ event, seq: 3 }) })).toEqual({ event, kind: "event", seq: 3 });
    const whole = { ...event, final: true, text: "The thread says yes." };
    expect(planStreamEntryOf({ line: JSON.stringify({ event: whole, seq: 4 }) })).toEqual({
      event: whole,
      kind: "event",
      seq: 4,
    });
  });

  it("reads one missing its item, text or finality as unreadable", () => {
    for (const broken of [
      { ...event, itemId: "" },
      { ...event, text: 7 },
      { ...event, final: "no" },
      { ...event, turnId: "" },
    ]) {
      const line = JSON.stringify({ event: broken, seq: 5 });
      expect(planStreamEntryOf({ line })).toEqual({ kind: "unreadable", line });
    }
  });
});

describe("planStreamEntryOf on a usage event", () => {
  const last = { cachedInputTokens: 30, inputTokens: 41, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 44 };
  const event = { contextWindow: null, kind: "usage", last, total: last, turnId: "u1" };

  it("reads a whole one, its window unknown", () => {
    expect(planStreamEntryOf({ line: JSON.stringify({ event, seq: 7 }) })).toEqual({ event, kind: "event", seq: 7 });
  });

  it("reads a partly readable one as unreadable, never filling it in", () => {
    const line = JSON.stringify({ event: { ...event, total: { inputTokens: 41 } }, seq: 8 });
    expect(planStreamEntryOf({ line })).toEqual({ kind: "unreadable", line });
    const noTurn = JSON.stringify({ event: { ...event, turnId: "" }, seq: 9 });
    expect(planStreamEntryOf({ line: noTurn })).toEqual({ kind: "unreadable", line: noTurn });
  });
});

describe("planStreamEntryOf on a rollover", () => {
  it("reads one with its reason, a remainder or an explicit null and its context urgency, and one missing any as unreadable", () => {
    const event = {
      contextUrgent: false,
      kind: "rollover",
      lifetimeRemainingMs: 180_000,
      reason: "rolled over in a pause",
    };
    const far = { ...event, lifetimeRemainingMs: null };
    const urgent = { ...far, contextUrgent: true };
    const read = [event, far, urgent].map((e) => planStreamEntryOf({ line: JSON.stringify({ event: e, seq: 3 }) }));
    expect(read).toEqual([
      { event, kind: "event", seq: 3 },
      { event: far, kind: "event", seq: 3 },
      { event: urgent, kind: "event", seq: 3 },
    ]);
    const { contextUrgent: _dropped, ...unmarked } = event;
    const unreadable = [
      { contextUrgent: false, kind: "rollover", lifetimeRemainingMs: 180_000 },
      { contextUrgent: false, kind: "rollover", reason: "rolled over in a pause" },
      { ...event, lifetimeRemainingMs: "soon" },
      { ...event, lifetimeRemainingMs: -1 },
      unmarked,
      { ...event, contextUrgent: null },
      { ...event, contextUrgent: "true" },
      { ...event, contextUrgent: 1 },
    ].map((bad, seq) => JSON.stringify({ event: bad, seq }));
    expect(unreadable.map((line) => planStreamEntryOf({ line }))).toEqual(
      unreadable.map((line) => ({ kind: "unreadable", line })),
    );
  });
});

describe("planStreamEntryOf on a tool call", () => {
  it("keeps the turn it was made in, reads none as undefined, and one off type as unreadable", () => {
    const event = { arguments: "{}", kind: "tool", token: "T.1", tool: "triage_next", turnId: "turn-9" };
    expect(planStreamEntryOf({ line: JSON.stringify({ event, seq: 2 }) })).toEqual({ event, kind: "event", seq: 2 });
    const { turnId: _dropped, ...none } = event;
    const read = planStreamEntryOf({ line: JSON.stringify({ event: none, seq: 3 }) });
    expect(read).toEqual({ event: { ...none, turnId: undefined }, kind: "event", seq: 3 });
    const odd = JSON.stringify({ event: { ...event, turnId: 9 }, seq: 4 });
    expect(planStreamEntryOf({ line: odd })).toEqual({ kind: "unreadable", line: odd });
  });
});

describe("planStreamEntryOf on a look the console started", () => {
  it("reads one as the bare event, whatever else the line carries", () => {
    const line = JSON.stringify({ event: { kind: "look-start", text: "page words" }, seq: 5 });
    expect(planStreamEntryOf({ line })).toEqual({ event: { kind: "look-start" }, kind: "event", seq: 5 });
  });

  it("reads the retired hand-off kind as unreadable", () => {
    const line = JSON.stringify({ event: { kind: "look-handoff" }, seq: 5 });
    expect(planStreamEntryOf({ line })).toEqual({ kind: "unreadable", line });
  });
});

describe("planStreamEntryOf on an owed turn the console started", () => {
  it("reads each reason, dropping whatever else the line carries", () => {
    const read = (["resume", "nudge", "promise"] as const).map((why) =>
      planStreamEntryOf({ line: JSON.stringify({ event: { kind: "owed-start", text: "x", why }, seq: 6 }) }),
    );
    expect(read).toEqual([
      { event: { kind: "owed-start", why: "resume" }, kind: "event", seq: 6 },
      { event: { kind: "owed-start", why: "nudge" }, kind: "event", seq: 6 },
      { event: { kind: "owed-start", why: "promise" }, kind: "event", seq: 6 },
    ]);
  });

  it("reads an unknown or missing reason as unreadable", () => {
    const odd = JSON.stringify({ event: { kind: "owed-start", why: "look" }, seq: 6 });
    const bare = JSON.stringify({ event: { kind: "owed-start" }, seq: 6 });
    expect([planStreamEntryOf({ line: odd }), planStreamEntryOf({ line: bare })]).toEqual([
      { kind: "unreadable", line: odd },
      { kind: "unreadable", line: bare },
    ]);
  });
});

describe("planStreamEntryOf on the owner's typed turn", () => {
  const event = { kind: "typed-in", messageId: "m-1", text: "https://x.slack.com/archives/C1/p1" };

  it("reads one with its id and words", () => {
    expect(planStreamEntryOf({ line: JSON.stringify({ event, seq: 4 }) })).toEqual({ event, kind: "event", seq: 4 });
  });

  it("reads one with no id, an over-long id, blank or over-long words as unreadable", () => {
    for (const broken of [
      { ...event, messageId: "" },
      { ...event, messageId: "m".repeat(TYPED_MESSAGE_ID_MAX_CHARS + 1) },
      { ...event, text: "  " },
      { ...event, text: "x".repeat(TYPED_TEXT_MAX_CHARS + 1) },
    ]) {
      const line = JSON.stringify({ event: broken, seq: 5 });
      expect(planStreamEntryOf({ line })).toEqual({ kind: "unreadable", line });
    }
  });
});

describe("planStreamEntryOf on an acknowledgement", () => {
  it("reads one as the bare event, whatever else the line carries", () => {
    const line = JSON.stringify({ event: { kind: "acknowledged", text: "On it." }, seq: 6 });
    expect(planStreamEntryOf({ line })).toEqual({ event: { kind: "acknowledged" }, kind: "event", seq: 6 });
  });
});

describe("planStreamEntryOf on a held answer", () => {
  const held = {
    detail: "the owner is still talking",
    itemId: "a-1",
    kind: "held-answer",
    pending: true,
    phase: "held",
    turnId: "t-1",
  };

  it("reads one whole, held, handing, released, failed or dropped", () => {
    const handing = { ...held, detail: "the floor was free", phase: "handing" };
    const released = { ...held, detail: "the owner's words went quiet", pending: false, phase: "released" };
    const failed = { ...held, detail: "blank", pending: false, phase: "failed" };
    const dropped = {
      ...held,
      detail: "the owner's words since it reached turn t-1",
      pending: false,
      phase: "dropped",
    };
    expect([
      planStreamEntryOf({ line: JSON.stringify({ event: held, seq: 8 }) }),
      planStreamEntryOf({ line: JSON.stringify({ event: released, seq: 9 }) }),
      planStreamEntryOf({ line: JSON.stringify({ event: failed, seq: 10 }) }),
      planStreamEntryOf({ line: JSON.stringify({ event: handing, seq: 11 }) }),
      planStreamEntryOf({ line: JSON.stringify({ event: dropped, seq: 12 }) }),
    ]).toEqual([
      { event: held, kind: "event", seq: 8 },
      { event: released, kind: "event", seq: 9 },
      { event: failed, kind: "event", seq: 10 },
      { event: handing, kind: "event", seq: 11 },
      { event: dropped, kind: "event", seq: 12 },
    ]);
  });

  it("reads none missing a field, naming another phase, or not saying whether an answer is still owed", () => {
    const { detail: _detail, ...noDetail } = held;
    const { pending: _pending, ...noPending } = held;
    const brokens = [
      noDetail,
      noPending,
      { ...held, pending: "yes" },
      { ...held, phase: "discarded" },
      { ...held, turnId: 4 },
    ];
    for (const broken of brokens) {
      const line = JSON.stringify({ event: broken, seq: 10 });
      expect(planStreamEntryOf({ line })).toEqual({ kind: "unreadable", line });
    }
  });
});

describe("planStreamEntryOf on a turn's outcome line", () => {
  const said = { detail: "said it came back with no answer", kind: "turn-outcome", phase: "said", turnId: "t-1" };

  it("reads one said and one dropped whole", () => {
    const dropped = { ...said, detail: "turn t-2 started after it", phase: "dropped" };
    expect([
      planStreamEntryOf({ line: JSON.stringify({ event: said, seq: 3 }) }),
      planStreamEntryOf({ line: JSON.stringify({ event: dropped, seq: 4 }) }),
    ]).toEqual([
      { event: said, kind: "event", seq: 3 },
      { event: dropped, kind: "event", seq: 4 },
    ]);
  });

  it("reads none missing a field or naming another phase", () => {
    const { detail: _detail, ...noDetail } = said;
    const { turnId: _turnId, ...noTurn } = said;
    for (const broken of [noDetail, noTurn, { ...said, phase: "held" }, { ...said, detail: 7 }]) {
      const line = JSON.stringify({ event: broken, seq: 5 });
      expect(planStreamEntryOf({ line })).toEqual({ kind: "unreadable", line });
    }
  });
});

describe("planStreamEntryOf on a progress cue", () => {
  it("reads one as the bare event, so words a stream carries beside it are never something to say", () => {
    const line = JSON.stringify({ event: { kind: "progress", text: "Still with you." }, seq: 7 });
    expect(planStreamEntryOf({ line })).toEqual({ event: { kind: "progress" }, kind: "event", seq: 7 });
  });
});

describe("planStreamEntryOf on a herald", () => {
  it("reads each of the four chimes, and nothing else carried beside one", () => {
    const lines = ["focus", "reminder", "done", "attention"].map((cue, seq) =>
      JSON.stringify({ event: { cue, kind: "announce", text: "say this" }, seq }),
    );
    expect(lines.map((line) => planStreamEntryOf({ line }))).toEqual([
      { event: { cue: "focus", kind: "announce" }, kind: "event", seq: 0 },
      { event: { cue: "reminder", kind: "announce" }, kind: "event", seq: 1 },
      { event: { cue: "done", kind: "announce" }, kind: "event", seq: 2 },
      { event: { cue: "attention", kind: "announce" }, kind: "event", seq: 3 },
    ]);
  });

  it("reads a chime it does not know, or none, as unreadable rather than guessing one", () => {
    const odd = JSON.stringify({ event: { cue: "fanfare", kind: "announce" }, seq: 4 });
    const bare = JSON.stringify({ event: { kind: "announce" }, seq: 5 });
    expect([planStreamEntryOf({ line: odd }), planStreamEntryOf({ line: bare })]).toEqual([
      { kind: "unreadable", line: odd },
      { kind: "unreadable", line: bare },
    ]);
  });
});

describe("planStreamEntryOf on a Codex turn event", () => {
  it("reads a start, a step and an end", () => {
    const started = { kind: "codex-turn", phase: "started", turnId: "t-1" };
    const progress = {
      kind: "codex-turn",
      phase: "progress",
      step: { kind: "tool", name: "relay_steer" },
      turnId: "t-1",
    };
    const compacting = { kind: "codex-turn", phase: "progress", step: { kind: "compacting" }, turnId: "t-1" };
    const ended = { failure: "boom", kind: "codex-turn", phase: "completed", status: "failed", turnId: "t-1" };
    expect(
      [started, progress, compacting, ended].map((event, seq) =>
        planStreamEntryOf({ line: JSON.stringify({ event, seq }) }),
      ),
    ).toEqual([
      { event: started, kind: "event", seq: 0 },
      { event: progress, kind: "event", seq: 1 },
      { event: compacting, kind: "event", seq: 2 },
      { event: ended, kind: "event", seq: 3 },
    ]);
  });

  it("reads an end still in progress, an unknown step or an empty turn id as unreadable", () => {
    const lines = [
      { failure: null, kind: "codex-turn", phase: "completed", status: "inProgress", turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: { kind: "dreaming" }, turnId: "t-1" },
      { kind: "codex-turn", phase: "started", turnId: "" },
    ].map((event) => JSON.stringify({ event, seq: 3 }));
    expect(lines.map((line) => planStreamEntryOf({ line }))).toEqual(
      lines.map((line) => ({ kind: "unreadable", line })),
    );
  });
});

/** The synthetic session, one event per line, in arrival order. */
const SYNTHETIC: readonly unknown[] = readFileSync(join(__dirname, "fixtures", "talkPlanSession.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as unknown);

/**
 * Fold a whole event list from no open turns.
 *
 * @param events the events, in order
 * @returns every effect, in order, and the turns left open
 */
function foldAll({ events }: { events: readonly unknown[] }): {
  effects: readonly PlanEffect[];
  open: ReadonlyMap<string, PlanTurn>;
} {
  let turns: ReadonlyMap<string, PlanTurn> = new Map();
  const effects: PlanEffect[] = [];
  for (const event of events) {
    const next = foldPlanEvent({ event, turns });
    turns = next.turns;
    effects.push(...next.effects);
  }
  return { effects, open: turns };
}

describe("foldPlanEvent over a synthetic session", () => {
  const { effects, open } = foldAll({ events: SYNTHETIC });

  it("finishes every turn once, in order, with the done turn's own text", () => {
    const finals = effects.filter((effect) => effect.kind === "segment" && effect.final);
    expect(finals).toEqual([
      {
        final: true,
        id: "turn_synthetic01",
        kind: "segment",
        text: " So I was looking at the board this morning, and I was wondering",
        who: "owner",
      },
      { final: true, id: "turn_synthetic02", kind: "segment", text: " Yeah? Go on.", who: "voice" },
      { final: true, id: "turn_synthetic03", kind: "segment", text: " whether the relay gate", who: "owner" },
      { final: true, id: "turn_synthetic04", kind: "segment", text: " Uh-huh. Mm.", who: "voice" },
      {
        final: true,
        id: "turn_synthetic05",
        kind: "segment",
        text: " records what I say twice. What do you think",
        who: "owner",
      },
      {
        final: true,
        id: "turn_synthetic06",
        kind: "segment",
        text: " Could be, but seeing the words twice doesn't prove that. Where are you seeing the duplication?",
        who: "voice",
      },
    ]);
    expect(open.size).toBe(0);
  });

  it("builds each open turn from its deltas to exactly what its done event says", () => {
    const shown = effects.filter(
      (effect) => effect.kind === "segment" && !effect.final && effect.id === "turn_synthetic06",
    );
    expect(shown.at(-1)).toEqual({
      final: false,
      id: "turn_synthetic06",
      kind: "segment",
      text: " Could be, but seeing the words twice doesn't prove that. Where are you seeing the duplication?",
      who: "voice",
    });
  });

  it("hands every heard fragment to the gate, and they spell what the owner said", () => {
    const heard = effects.flatMap((effect) => (effect.kind === "heard" ? [effect.text] : []));
    expect(heard.join("")).toBe(
      " So I was looking at the board this morning, and I was wondering whether the relay gate records what I say" +
        " twice. What do you think",
    );
  });

  it("names the session, the hand-offs to Codex and the usage", () => {
    expect(effects[0]).toEqual({ kind: "started", sessionId: "rtc_synthetic01" });
    expect(effects.filter((effect) => effect.kind === "delegated")).toEqual([
      { id: "item_synthetic18", kind: "delegated", target: "client", turnId: "turn_synthetic03" },
      { id: "item_synthetic30", kind: "delegated", target: "client", turnId: "turn_synthetic05" },
    ]);
    expect(effects.filter((effect) => effect.kind === "usage")).toEqual([
      { audioSeconds: 14.4, kind: "usage", limitStatus: undefined, resetSeconds: undefined },
      { audioSeconds: 29.4, kind: "usage", limitStatus: undefined, resetSeconds: undefined },
    ]);
  });
});

describe("foldPlanEvent at its edges", () => {
  it("drops a delta for a turn it never saw open, and ignores what it does not know", () => {
    expect(foldAll({ events: [{ delta: "x", turn_id: "turn_x", type: "turn.delta" }] }).effects).toEqual([]);
    expect(foldAll({ events: [{ type: "delegation.context.appended" }, "not an event", null] }).effects).toEqual([]);
  });

  it("refuses a turn with a role it does not know", () => {
    const event = { turn: { id: "t", role: "system", transcript: "x" }, type: "turn.created" };
    expect(foldAll({ events: [event] }).effects).toEqual([]);
  });

  it("carries the plan limit's state when the session reports one", () => {
    const event = {
      type: "session.usage.updated",
      usage: { audio_duration_ms: 1500 },
      usage_limit: { reset_seconds: 3600, status: "reached" },
    };
    expect(foldAll({ events: [event] }).effects).toEqual([
      { audioSeconds: 1.5, kind: "usage", limitStatus: "reached", resetSeconds: 3600 },
    ]);
  });
});

describe("planContentOf", () => {
  it("carries a text answer and a screen frame across in the app-server's shape", () => {
    expect(planContentOf({ output: '{"ok":true}' })).toEqual([{ text: '{"ok":true}', type: "inputText" }]);
    expect(
      planContentOf({
        output: [
          { text: "The owner's screen", type: "input_text" },
          { detail: "high", image_url: "data:image/jpeg;base64,AAAA", type: "input_image" },
        ],
      }),
    ).toEqual([
      { text: "The owner's screen", type: "inputText" },
      { imageUrl: "data:image/jpeg;base64,AAAA", type: "inputImage" },
    ]);
  });

  it("answers with a refusal rather than an empty list", () => {
    expect(planContentOf({ output: [{ file_id: "f", type: "input_image" }] })).toEqual([
      { text: '{"refused":"the answer carried nothing the plan call can take"}', type: "inputText" },
    ]);
  });
});

// A held rollover reads `spoke` as the voice answering the owner, so a wordless one is not one.
describe("foldPlanEvent on a fragment of the voice's", () => {
  it("reads one carrying words as spoken, and one carrying none or no item as nothing", () => {
    const of = ({ item }: { item: unknown }): readonly PlanEffect[] =>
      foldPlanEvent({ event: { item, type: "output_transcript.added" }, turns: new Map() }).effects;
    expect([
      of({ item: { text: " Mm." } }),
      of({ item: { text: " 42" } }),
      of({ item: { text: "" } }),
      of({ item: { text: " " } }),
      of({ item: { text: "." } }),
      of({ item: {} }),
      of({ item: undefined }),
    ]).toEqual([[{ kind: "spoke" }], [{ kind: "spoke" }], [], [], [], [], []]);
  });
});
