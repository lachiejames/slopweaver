/*
 * Which of a call's completed speech each starting Codex turn is handed — a denial, as an ordering: a
 * turn answering "where did fourteen come from" started BEFORE the owner's final words arrived, so the
 * record it gets is what came before, the voice's fourteen included.
 */

import { describe, expect, it } from "vitest";

import {
  foldSpokenRecord,
  KEPT_LINES,
  NO_SPOKEN_RECORD,
  type SpokenRecordInput,
  type SpokenRecordQueue,
  type SpokenRecordStep,
} from "../../lib/spokenRecordQueue";
import { MAX_RECORD_LINE_CHARS } from "../../lib/talkVoiceRecord";

/**
 * Fold a run of inputs from an empty call.
 *
 * @returns the final state, every post made, and every note
 */
function run({ inputs }: { inputs: readonly SpokenRecordInput[] }): {
  state: SpokenRecordQueue;
  posts: NonNullable<SpokenRecordStep["post"]>[];
  notes: string[];
} {
  let state = NO_SPOKEN_RECORD;
  const posts: NonNullable<SpokenRecordStep["post"]>[] = [];
  const notes: string[] = [];
  for (const input of inputs) {
    const step = foldSpokenRecord({ input, state });
    state = step.state;
    if (step.post !== undefined) {
      posts.push(step.post);
    }
    notes.push(...step.notes);
  }
  return { notes, posts, state };
}

const final = ({ id, who, text }: { id: string; who: "owner" | "voice"; text: string }): SpokenRecordInput => ({
  kind: "final",
  line: { id, text, who },
});

const FOURTEEN = final({ id: "v1", text: "That covers fourteen cards. That's the last one.", who: "voice" });
const ASKED = final({ id: "h1", text: "Where did fourteen come from?", who: "owner" });

describe("foldSpokenRecord", () => {
  it("hands the incident's denial turn the voice's fourteen, though the owner's question came after it started", () => {
    const { posts, state } = run({
      inputs: [
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "01a12091" },
        ASKED,
        { kind: "posted", post: 1, taken: true, turnId: "01a12091", why: undefined },
      ],
    });
    expect(posts).toEqual([
      {
        lines: [{ id: "v1", text: "That covers fourteen cards. That's the last one.", who: "voice" }],
        turnId: "01a12091",
      },
    ]);
    expect(state.undelivered.map((line) => line.id)).toEqual(["h1"]);
  });

  // The owner's words after the turn began are closed by a resume over it, and the "Mm-hm."
  // it draws is the voice final that hands them to that running turn (`site/lib/talkPlanResumeOverTurn.ts`).
  it("hands a running turn the owner's later words only once the voice's acknowledgement final follows them", () => {
    const laterLine = { id: "h2", text: "Slopweaver still runs while cmux is closed.", who: "owner" } as const;
    const ackLine = { id: "v2", text: "Mm-hm.", who: "voice" } as const;
    const later = final(laterLine);
    const ack = final(ackLine);
    const started: SpokenRecordInput = { kind: "turn-started", openCard: undefined, turnId: "01a1bb44" };
    const beforeAck = run({ inputs: [started, later] });
    const afterAck = run({ inputs: [started, later, ack] });
    expect([beforeAck.posts, afterAck.posts]).toEqual([[], [{ lines: [laterLine, ackLine], turnId: "01a1bb44" }]]);
  });

  // "Everything's eighty-six" cut off as the owner asks "what was eighty-six?" finishes after the owner's turn started.
  it("hands the running turn a voice line finished after it started, once its first post is answered", () => {
    const late = final({ id: "v2", text: "Everything's eighty-six.", who: "voice" });
    const { posts, state } = run({
      inputs: [
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        late,
        { kind: "posted", post: 1, taken: true, turnId: "t1", why: undefined },
        { kind: "posted", post: 2, taken: true, turnId: "t1", why: undefined },
        final({ id: "v3", text: "Pulling up the board.", who: "voice" }),
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([
      ["t1", ["v1"]],
      ["t1", ["v2"]],
      ["t1", ["v3"]],
    ]);
    expect(state.undelivered.map((line) => line.id)).toEqual(["v3"]);
  });

  it("hands a late line to no turn that completed, or for the owner's words alone", () => {
    const { posts } = run({
      inputs: [
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        ASKED,
        { kind: "turn-completed", turnId: "t1" },
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
        { kind: "posted", post: 1, taken: false, turnId: "t2", why: "turn t2 is not running" },
        final({ id: "h2", text: "And the other one?", who: "owner" }),
        { kind: "turn-completed", turnId: "t2" },
        final({ id: "v2", text: "Everything's eighty-six.", who: "voice" }),
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([["t2", ["h1", "v1"]]]);
  });

  // A lost post says nothing of whether the turn still runs, so the next voice line still reaches it.
  it("hands the running turn a late voice line after a post to it was lost", () => {
    const { posts, state } = run({
      inputs: [
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        { kind: "posted", post: 1, taken: false, turnId: "t1", why: "the console server did not answer" },
        final({ id: "v2", text: "Everything's eighty-six.", who: "voice" }),
        { kind: "posted", post: 2, taken: true, turnId: "t1", why: undefined },
        { kind: "turn-completed", turnId: "t1" },
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([
      ["t1", ["v1"]],
      ["t1", ["v1", "v2"]],
    ]);
    expect(state.undelivered).toEqual([]);
  });

  // Turns overlap, and the newer one completing first leaves the older still running.
  it("hands a late voice line to an older turn still running after a newer one completed", () => {
    const { posts } = run({
      inputs: [
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
        { kind: "turn-completed", turnId: "t2" },
        final({ id: "v1", text: "Everything's eighty-six.", who: "voice" }),
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([["t1", ["v1"]]]);
  });

  // A completed turn cannot be steered, so a line its post was answered too late for goes to the next.
  it("hands the next turn a voice line still waiting when its own turn completed", () => {
    const { posts } = run({
      inputs: [
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        final({ id: "v2", text: "Everything's eighty-six.", who: "voice" }),
        { kind: "turn-completed", turnId: "t1" },
        { kind: "posted", post: 1, taken: true, turnId: "t1", why: undefined },
        ASKED,
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([
      ["t1", ["v1"]],
      ["t2", ["v2", "h1"]],
    ]);
  });

  // The late line finished while the first post was out, and that post then failed.
  it("offers the running turn a voice line finished while a post that then failed was out, and only once", () => {
    const { posts } = run({
      inputs: [
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        final({ id: "v2", text: "Everything's eighty-six.", who: "voice" }),
        { kind: "posted", post: 1, taken: false, turnId: "t1", why: "the console server did not answer" },
        { kind: "posted", post: 2, taken: false, turnId: "t1", why: "turn t1 is not running" },
        { kind: "turn-completed", turnId: "t1" },
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([
      ["t1", ["v1"]],
      ["t1", ["v1", "v2"]],
    ]);
  });

  // A replayed start posted to t1 again, and the first post's answer, naming only t1, settled the
  // second's lines, the late voice line among them, though that post was then refused.
  it("reads an answer as the post it numbers, so an older post to the same turn settles none of a newer one's lines", () => {
    const { posts, state } = run({
      inputs: [
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
        final({ id: "v2", text: "Everything's eighty-six.", who: "voice" }),
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        { kind: "posted", post: 1, taken: true, turnId: "t1", why: undefined },
        { kind: "posted", post: 2, taken: false, turnId: "t2", why: "the console server did not answer" },
        { kind: "posted", post: 3, taken: false, turnId: "t1", why: "turn t1 is not running" },
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([
      ["t1", ["v1"]],
      ["t2", ["v1"]],
      ["t1", ["v1", "v2"]],
    ]);
    expect(state.undelivered.map((line) => line.id)).toEqual(["v1", "v2"]);
  });

  it("keeps the lines when a turn refused, timed out or was stale, and hands them to the next", () => {
    const { posts, notes } = run({
      inputs: [
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        { kind: "posted", post: 1, taken: false, turnId: "t1", why: "turn t1 is not running" },
        ASKED,
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
        { kind: "posted", post: 2, taken: false, turnId: "t2", why: "turn t2 did not answer the record in time" },
        { kind: "turn-started", openCard: undefined, turnId: "t3" },
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([
      ["t1", ["v1"]],
      ["t2", ["v1", "h1"]],
      ["t3", ["v1", "h1"]],
    ]);
    expect(notes[0]).toBe("turn t1 did not take the record: turn t1 is not running; its lines wait for the next turn");
  });

  it("never posts an empty record, queues a line once, and drops it once the newest turn took it", () => {
    const { posts, state } = run({
      inputs: [
        { kind: "turn-started", openCard: undefined, turnId: "t0" },
        { kind: "turn-completed", turnId: "t0" },
        FOURTEEN,
        FOURTEEN,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        { kind: "posted", post: 1, taken: true, turnId: "t1", why: undefined },
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.length])).toEqual([["t1", 1]]);
    expect(state.undelivered).toEqual([]);
  });

  it("hands every turn that starts mid-post everything at once, reading only the newest post's answer", () => {
    const later = final({ id: "v2", text: "That covers fourteen cards.", who: "voice" });
    const { posts, state } = run({
      inputs: [
        ASKED,
        { kind: "turn-started", openCard: undefined, turnId: "t0" },
        later,
        { kind: "turn-started", openCard: undefined, turnId: "t1" },
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
        { kind: "posted", post: 1, taken: true, turnId: "t0", why: undefined },
        { kind: "posted", post: 3, taken: true, turnId: "t2", why: undefined },
      ],
    });
    expect(posts.map(({ lines, turnId }) => [turnId, lines.map((line) => line.id)])).toEqual([
      ["t0", ["h1"]],
      ["t1", ["h1", "v2"]],
      ["t2", ["h1", "v2"]],
    ]);
    expect(state.undelivered).toEqual([]);
  });

  it("says when a line too long for a post is cut, so the cut is never silent", () => {
    const long = final({ id: "v9", text: `${"m".repeat(MAX_RECORD_LINE_CHARS)} fourteen cards`, who: "voice" });
    const { notes } = run({ inputs: [long, { kind: "turn-started", openCard: undefined, turnId: "t1" }] });
    expect(notes).toEqual([`1 line(s) were cut to ${String(MAX_RECORD_LINE_CHARS)} characters in turn t1's record`]);
  });

  // The turn answering "What is the reply?" started before the owner's words were final.
  it("posts a turn the card's draft with no line to go with it, and says it steered the draft", () => {
    const openCard = { draft: "This is still open.", key: "post:sd-30e3b8b1", kind: "single" } as const;
    const { posts, notes } = run({
      inputs: [
        { kind: "turn-started", openCard, turnId: "01a13346" },
        { kind: "posted", post: 1, taken: true, turnId: "01a13346", why: undefined },
      ],
    });
    expect(posts).toEqual([{ lines: [], openCard, turnId: "01a13346" }]);
    expect(notes).toEqual(["steered 0 line(s) of what was said and post:sd-30e3b8b1's draft into turn 01a13346"]);
  });

  it("hands each turn its own card's draft with the lines, never a card an earlier turn was handed", () => {
    const first = { draft: "This is still open.", key: "post:sd-30e3b8b1", kind: "single" } as const;
    const { posts } = run({
      inputs: [
        ASKED,
        { kind: "turn-started", openCard: first, turnId: "t1" },
        { kind: "posted", post: 1, taken: false, turnId: "t1", why: "turn t1 is not running" },
        { kind: "turn-started", openCard: undefined, turnId: "t2" },
      ],
    });
    expect(posts).toEqual([
      { lines: [{ id: "h1", text: "Where did fourteen come from?", who: "owner" }], openCard: first, turnId: "t1" },
      { lines: [{ id: "h1", text: "Where did fourteen come from?", who: "owner" }], openCard: undefined, turnId: "t2" },
    ]);
  });

  it("keeps the newest lines past its bound, and says how many it dropped", () => {
    const lines = Array.from({ length: KEPT_LINES + 1 }, (_, index) =>
      final({ id: `s${String(index)}`, text: "mm", who: "owner" }),
    );
    const { state, notes } = run({ inputs: lines });
    expect([state.undelivered.length, state.undelivered[0].id]).toEqual([KEPT_LINES, "s1"]);
    expect(notes).toEqual(["1 older line(s) dropped from the record no turn took"]);
  });
});
