import { describe, expect, it } from "vitest";

import { PLAN_CALL_LIMITS } from "../../../lib/planCallContract";
import {
  foldActivity,
  HEARING_LEVEL,
  HEARING_RMS,
  NO_ACTIVITY,
  RESUME_MS,
  RESUME_SOUND_QUIET_MS,
  resumeDueOf,
  UNANSWERED_FORGET_MS,
  UNANSWERED_MS,
} from "../../../lib/voiceActivity";
import { delegated, play, quietAt } from "./harness";
import { dueAt, mutedDueAt, QUIET_ROOM, SPOKEN_RMS, sounded, steered } from "./resumeHarness";

describe("resumeDueOf", () => {
  // Measured: 11s after the owner's words, with nothing resumed, the owner had to say they had stopped talking.
  it("is due five seconds after the owner's unanswered words, not a millisecond sooner, and before still waiting", () => {
    expect([
      RESUME_MS,
      dueAt({ activity: steered, nowMs: 2_000 + 4_999 }),
      dueAt({ activity: steered, nowMs: 2_000 + 5_000 }),
    ]).toEqual([5_000, false, true]);
    expect(RESUME_MS).toBeLessThan(UNANSWERED_MS);
  });

  // Words ending on the code word are answered even though nothing else followed them.
  const over = play({
    script: [
      [1_000, { kind: "spoke" }],
      [2_000, { kind: "heard", text: " Okay, um, well, ABC-1 is all set so I'm probably gonna drop now. Over" }],
    ],
  });

  it("is due two seconds after words ending on the owner's code word, the server's own quiet floor", () => {
    expect([
      RESUME_SOUND_QUIET_MS,
      dueAt({ activity: over, nowMs: 2_000 + 1_999 }),
      dueAt({ activity: over, nowMs: 2_000 + 2_000 }),
    ]).toEqual([PLAN_CALL_LIMITS.resumeQuietMs, false, true]);
  });

  it("takes the owner's code word over a wait said before it", () => {
    const waitThenOver = play({ script: [[2_000, { kind: "heard", text: "one sec. Over" }]] });
    const waitOnly = play({ script: [[2_000, { kind: "heard", text: "one sec" }]] });
    expect([dueAt({ activity: waitThenOver, nowMs: 4_000 }), dueAt({ activity: waitOnly, nowMs: 30_000 })]).toEqual([
      true,
      false,
    ]);
  });

  it("holds every other gate for the owner's code word: their microphone, a tool, a delegation, the voice's answer", () => {
    const nowMs = 2_000 + RESUME_SOUND_QUIET_MS;
    const tool = foldActivity({
      activity: over,
      input: { callId: "c1", kind: "tool-started", name: "read_card" },
      nowMs: 2_500,
    });
    const working = foldActivity({ activity: over, input: delegated({ id: "d1" }), nowMs: 2_500 });
    const finished = foldActivity({
      activity: over,
      input: { asked: false, kind: "voice-finished", promised: false },
      nowMs: 3_000,
    });
    expect([
      resumeDueOf({ activity: over, micLevel: HEARING_LEVEL, micRms: HEARING_RMS, muted: false, nowMs }),
      dueAt({ activity: tool, nowMs }),
      dueAt({ activity: working, nowMs }),
      dueAt({ activity: finished, nowMs: 3_000 + RESUME_SOUND_QUIET_MS }),
    ]).toEqual([false, false, false, false]);
  });

  it("is due once per silence for the owner's code word too", () => {
    const resumed = foldActivity({ activity: over, input: { kind: "resumed", post: 1 }, nowMs: 4_000 });
    expect([
      dueAt({ activity: resumed, nowMs: 4_080 }),
      dueAt({ activity: resumed, nowMs: 2_000 + RESUME_MS }),
    ]).toEqual([false, false]);
  });

  it("is due once per silence, and afresh once the owner speaks again", () => {
    const resumed = foldActivity({ activity: steered, input: { kind: "resumed", post: 1 }, nowMs: 2_000 + RESUME_MS });
    expect(dueAt({ activity: resumed, nowMs: 2_000 + RESUME_MS + 80 })).toBe(false);
    const spoke = sounded({ activity: resumed, micLevel: 0.5, micRms: SPOKEN_RMS, nowMs: 19_500, outputLevel: 0 });
    const again = foldActivity({ activity: spoke, input: { kind: "heard", text: " go on" }, nowMs: 20_000 });
    expect(dueAt({ activity: again, nowMs: 20_000 + RESUME_MS })).toBe(true);
  });

  // The final fragment of the owner's words can land 0.7s after the resume, with no new sound behind it.
  it("is not due again for a late fragment of the words it resumed, with no sound from the owner since", () => {
    const resumedAt = 2_000 + RESUME_MS;
    const before = sounded({ activity: steered, micLevel: 0.5, micRms: SPOKEN_RMS, nowMs: 1_900, outputLevel: 0 });
    const resumed = foldActivity({ activity: before, input: { kind: "resumed", post: 1 }, nowMs: resumedAt });
    const late = foldActivity({
      activity: resumed,
      input: { kind: "heard", text: " channel." },
      nowMs: resumedAt + 700,
    });
    expect(dueAt({ activity: late, nowMs: resumedAt + 700 + RESUME_MS })).toBe(false);
  });

  // ZZZ is valued because it reliably means nothing is coming, so a resume never hides it.
  it("leaves still waiting and its nudge to show at UNANSWERED_MS when the voice says nothing after it", () => {
    const resumed = foldActivity({ activity: steered, input: { kind: "resumed", post: 1 }, nowMs: 2_000 + RESUME_MS });
    const status = quietAt({ activity: resumed, nowMs: 2_000 + UNANSWERED_MS });
    expect([status.headline, status.nudge, status.phase]).toEqual(["still waiting", "ask", "stalled"]);
  });

  it("is never due after the owner's own nudge for the same words", () => {
    const nudged = foldActivity({ activity: steered, input: { kind: "nudged" }, nowMs: 2_500 });
    expect(dueAt({ activity: nudged, nowMs: 2_000 + RESUME_MS })).toBe(false);
  });

  it("is not due once the voice has answered the owner", () => {
    const answered = foldActivity({ activity: steered, input: { kind: "spoke" }, nowMs: 3_000 });
    expect(dueAt({ activity: answered, nowMs: 2_000 + RESUME_MS })).toBe(false);
  });

  it("is not due while the owner's microphone clears both bars, and is once either falls short", () => {
    const nowMs = 2_000 + RESUME_MS;
    const live = { activity: steered, muted: false, nowMs };
    expect([
      resumeDueOf({ ...live, micLevel: HEARING_LEVEL, micRms: HEARING_RMS }),
      resumeDueOf({ ...live, micLevel: HEARING_LEVEL / 2, micRms: HEARING_RMS }),
      resumeDueOf({ ...live, micLevel: HEARING_LEVEL, micRms: HEARING_RMS / 2 }),
    ]).toEqual([false, true, true]);
  });

  // A resume posts through a quiet room while the owner is silent. Measured: the orb drew ZZZ and no resume was
  // posted until the owner spoke again. Their quiet room read loud on the spectral level all through it, which
  // held the resume twice: the sample now, and a stretch of the owner's speech it never let end.
  it("is due through the owner's quiet room, sampled the whole silence, and held by their speech", () => {
    let room = steered;
    for (let atMs = 2_080; atMs <= 2_000 + RESUME_MS; atMs += 80) {
      room = sounded({ activity: room, ...QUIET_ROOM, nowMs: atMs, outputLevel: 0 });
    }
    const nowMs = 2_000 + RESUME_MS;
    expect([
      room.turn.owner,
      resumeDueOf({ activity: room, ...QUIET_ROOM, muted: false, nowMs }),
      resumeDueOf({ activity: room, micLevel: QUIET_ROOM.micLevel, micRms: SPOKEN_RMS, muted: false, nowMs }),
      quietAt({ activity: room, nowMs: 2_000 + UNANSWERED_MS }).phase,
    ]).toEqual([undefined, true, false, "stalled"]);
  });

  // Muted, the voice hears nothing, so the room the owner's meter still reads is not the owner talking.
  it("is due while muted whatever the owner's meter reads of the room", () => {
    const nowMs = 2_000 + RESUME_MS;
    expect(mutedDueAt({ activity: steered, micLevel: HEARING_LEVEL, micRms: SPOKEN_RMS, nowMs })).toBe(true);
  });

  // "Can you check the staging pool and", then muted, held the floor forever.
  it("ends a filler the owner trailed off on once they mute, and holds it while they stay live", () => {
    const trailed = play({ script: [[2_000, { kind: "heard", text: "Can you check the staging pool and" }]] });
    expect([
      dueAt({ activity: trailed, nowMs: 30_000 }),
      mutedDueAt({ activity: trailed, micLevel: 0, micRms: 0, nowMs: 2_000 + RESUME_MS - 1 }),
      mutedDueAt({ activity: trailed, micLevel: 0, micRms: 0, nowMs: 2_000 + RESUME_MS }),
    ]).toEqual([false, false, true]);
  });

  it("holds an explicit ask to wait even once the owner mutes", () => {
    const waiting = play({ script: [[2_000, { kind: "heard", text: "Let me check something, one sec" }]] });
    expect(mutedDueAt({ activity: waiting, micLevel: 0, micRms: 0, nowMs: 30_000 })).toBe(false);
  });

  // Saying they are still reading keeps the silence the owner's, live and muted. Measured: a hold to keep reading
  // was resumed five seconds on, and the console's turn re-pitched the card the owner was reading.
  it("never resumes on the owner's hold to keep reading, live or muted, and resumes once they add an act", () => {
    const reading = play({ script: [[2_000, { kind: "heard", text: "but um let me just keep reading" }]] });
    const thenAct = play({ script: [[2_000, { kind: "heard", text: "let me keep reading this, then send it" }]] });
    expect([
      dueAt({ activity: reading, nowMs: 2_000 + 60_000 }),
      mutedDueAt({ activity: reading, micLevel: 0, micRms: 0, nowMs: 2_000 + 60_000 }),
      dueAt({ activity: thenAct, nowMs: 2_000 + RESUME_MS }),
    ]).toEqual([false, false, true]);
  });

  // Told not to wait, the voice takes its turn five seconds into the owner's muted silence.
  it("is due five seconds after the owner's muted 'Don't sit there and wait'", () => {
    const told = play({ script: [[2_000, { kind: "heard", text: "Don't sit there and wait" }]] });
    expect(mutedDueAt({ activity: told, micLevel: 0, micRms: 0, nowMs: 2_000 + RESUME_MS })).toBe(true);
  });

  // Muting after words is how the owner ends their turn.
  it("is due five seconds after the owner's words when they muted after them", () => {
    const muted = foldActivity({
      activity: steered,
      input: { kind: "sounded", micLevel: 0.5, micRms: SPOKEN_RMS, muted: true, outputLevel: 0 },
      nowMs: 2_500,
    });
    expect([
      dueAt({ activity: muted, nowMs: 2_000 + RESUME_MS - 1 }),
      dueAt({ activity: muted, nowMs: 2_000 + RESUME_MS }),
    ]).toEqual([false, true]);
  });

  // The voice's audio arrives before its transcript, so the meter is what says it answered.
  it("is not due while the voice is audible, or once it has sounded since the owner's words with no transcript yet", () => {
    const nowMs = 2_000 + RESUME_MS;
    expect(
      dueAt({ activity: sounded({ activity: steered, micLevel: 0, micRms: 0, nowMs, outputLevel: 0.5 }), nowMs }),
    ).toBe(false);
    const earlier = sounded({ activity: steered, micLevel: 0, micRms: 0, nowMs: 5_000, outputLevel: 0.5 });
    const quietNow = sounded({ activity: earlier, micLevel: 0, micRms: 0, nowMs, outputLevel: 0 });
    expect(dueAt({ activity: quietNow, nowMs })).toBe(false);
  });

  // The last fragment of the owner's words can land after the voice answered them aloud.
  it("is not due when the voice sounded after the owner's last sound, though a late fragment of theirs came after it", () => {
    const owner = sounded({ activity: steered, micLevel: 0.5, micRms: SPOKEN_RMS, nowMs: 1_900, outputLevel: 0 });
    const voice = sounded({ activity: owner, micLevel: 0, micRms: 0, nowMs: 5_000, outputLevel: 0.5 });
    const late = foldActivity({ activity: voice, input: { kind: "heard", text: " channel." }, nowMs: 6_000 });
    expect(dueAt({ activity: late, nowMs: 6_000 + RESUME_MS })).toBe(false);
  });

  it("is not due when one sample heard both at the owner's last sound, then a late fragment of theirs came", () => {
    const both = sounded({ activity: steered, micLevel: 0.5, micRms: SPOKEN_RMS, nowMs: 3_000, outputLevel: 0.5 });
    const late = foldActivity({ activity: both, input: { kind: "heard", text: " channel." }, nowMs: 4_000 });
    expect(dueAt({ activity: late, nowMs: 4_000 + RESUME_MS })).toBe(false);
  });

  it("is still due when the voice last sounded before the owner's words", () => {
    const nowMs = 2_000 + RESUME_MS;
    const before = sounded({ activity: steered, micLevel: 0, micRms: 0, nowMs: 1_500, outputLevel: 0.5 });
    expect(
      dueAt({ activity: sounded({ activity: before, micLevel: 0, micRms: 0, nowMs, outputLevel: 0 }), nowMs }),
    ).toBe(true);
  });

  // An untranscribed cough just before the resume holds it, since the owner's words may be coming.
  it("is not due until RESUME_SOUND_QUIET_MS after any sound from the owner, transcribed or not", () => {
    const coughMs = 2_000 + 4_500;
    const cough = sounded({ activity: steered, micLevel: 0.5, micRms: SPOKEN_RMS, nowMs: coughMs, outputLevel: 0 });
    expect(dueAt({ activity: cough, nowMs: 2_000 + RESUME_MS })).toBe(false);
    expect(dueAt({ activity: cough, nowMs: coughMs + RESUME_SOUND_QUIET_MS - 1 })).toBe(false);
    expect(dueAt({ activity: cough, nowMs: coughMs + RESUME_SOUND_QUIET_MS })).toBe(true);
  });

  // A stray sound partway through the quiet does not push the resume back. Measured: "still waiting" showed 12s
  // after "Sounds exactly right" and no resume was posted.
  it("is due at RESUME_MS though a stray sound came halfway through the quiet", () => {
    const blip = sounded({
      activity: steered,
      micLevel: 0.5,
      micRms: SPOKEN_RMS,
      nowMs: 2_000 + 2_500,
      outputLevel: 0,
    });
    const quietNow = sounded({ activity: blip, micLevel: 0, micRms: 0, nowMs: 2_000 + RESUME_MS, outputLevel: 0 });
    expect(dueAt({ activity: quietNow, nowMs: 2_000 + RESUME_MS })).toBe(true);
    expect(RESUME_SOUND_QUIET_MS).toBeLessThan(RESUME_MS);
  });

  it("is not due while a tool or a delegation is in flight", () => {
    const tool = foldActivity({
      activity: steered,
      input: { callId: "c1", kind: "tool-started", name: "read_card" },
      nowMs: 2_500,
    });
    expect(dueAt({ activity: tool, nowMs: 2_000 + RESUME_MS })).toBe(false);
    const working = foldActivity({ activity: steered, input: delegated({ id: "d1" }), nowMs: 2_500 });
    expect(dueAt({ activity: working, nowMs: 2_000 + RESUME_MS })).toBe(false);
  });

  it("is not due once the silence is old enough to be the owner's as much as the voice's", () => {
    expect(dueAt({ activity: steered, nowMs: 2_000 + UNANSWERED_FORGET_MS })).toBe(false);
  });

  // The owner may carry on unprompted 24s after a wait, so a later steer talks past it.
  it("is not due when the owner's words end on a wait, and is when a later steer talks past it", () => {
    const waiting = play({
      script: [[2_000, { kind: "heard", text: "I could do the ABC-1 step myself, actually. One sec" }]],
    });
    expect(dueAt({ activity: waiting, nowMs: 2_000 + RESUME_MS })).toBe(false);
    const steer = " Okay, never mind. Send it in drip feed style and tag Ari when you post it.";
    const past = foldActivity({ activity: waiting, input: { kind: "heard", text: steer }, nowMs: 30_000 });
    expect(dueAt({ activity: past, nowMs: 30_000 + RESUME_MS })).toBe(true);
  });

  // A wait the voice has since answered says nothing of the owner's next words.
  it("is due for a short steer after the voice answered the owner's wait", () => {
    const waiting = play({
      script: [[2_000, { kind: "heard", text: "I could do the ABC-1 step myself, actually. One sec" }]],
    });
    const answered = foldActivity({ activity: waiting, input: { kind: "spoke" }, nowMs: 3_000 });
    const steer = foldActivity({
      activity: answered,
      input: { kind: "heard", text: " Send it in drip feed style" },
      nowMs: 30_000,
    });
    expect(dueAt({ activity: steer, nowMs: 30_000 + RESUME_MS })).toBe(true);
  });

  it("is never due before the owner has said anything", () => {
    expect(dueAt({ activity: NO_ACTIVITY, nowMs: RESUME_MS })).toBe(false);
  });
});
