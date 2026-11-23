/*
 * Whether a relay's words end mid-sentence, read off the gate record `planEffectHandler` really writes: the voice's own
 * wire events, in the orders it delivers them, are folded by `foldPlanEvent` into the handler, and `heardTailOf` reads
 * the record it left. Every seam is a plain recording fake; nothing is mocked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planEffectHandler } from "../../components/voice/planWiringEffects";
import { type GateEntry, heardTailOf } from "../../lib/relayGate";
import { foldPlanEvent, type PlanTurn } from "../../lib/talkPlanEvents";

/** The synthetic 0.157.1 session, one event per line, in arrival order. */
const SYNTHETIC: readonly unknown[] = readFileSync(join(__dirname, "fixtures", "talkPlanSession.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as unknown);

/** A call: wire events folded into a handler over a fresh gate record, with the record, as the page runs it. */
const call = () => {
  const gateLog: { current: GateEntry[] } = { current: [] };
  const handle = planEffectHandler({
    act: () => undefined,
    framing: () => undefined,
    gateLog,
    looking: () => undefined,
    note: () => undefined,
    show: () => undefined,
  });
  let turns: ReadonlyMap<string, PlanTurn> = new Map();
  const send = ({ event }: { event: unknown }): void => {
    const next = foldPlanEvent({ event, turns });
    turns = next.turns;
    next.effects.forEach(handle);
  };
  /** A fragment heard over 200ms of audio from `at`. */
  const heard = ({ at, text }: { at: number; text: string }): void =>
    send({ event: { end_ms: at + 200, item: { text }, start_ms: at, type: "input_transcript.added" } });
  /** A stretch of the owner's opening on its first words. */
  const opens = ({ at, id, text }: { at: number; id: string; text: string }): void =>
    send({
      event: { turn: { end_ms: at + 200, id, role: "user", start_ms: at, transcript: text }, type: "turn.created" },
    });
  /** A stretch growing by `delta`. */
  const grows = ({ at, delta, id }: { at: number; delta: string; id: string }): void =>
    send({ event: { delta, end_ms: at + 200, start_ms: at, turn_id: id, type: "turn.delta" } });
  /** A stretch finishing on its whole text. */
  const done = ({ id, text }: { id: string; text: string }): void =>
    send({ event: { turn: { end_ms: 9000, id, role: "user", start_ms: 0, transcript: text }, type: "turn.done" } });
  const relayed = (): void => {
    gateLog.current.push({ kind: "relayed" });
  };
  const tail = (): string => heardTailOf({ log: gateLog.current });
  return { done, gateLog, grows, heard, opens, relayed, send, tail };
};

describe("planEffectHandler's gate record, read by heardTailOf", () => {
  it("reads whole once the stretch grew by each fragment, over its audio, and then finished", () => {
    const voice = call();
    voice.heard({ at: 1000, text: " send" });
    voice.opens({ at: 1000, id: "a", text: " send" });
    voice.heard({ at: 1200, text: " it" });
    voice.grows({ at: 1200, delta: " it", id: "a" });
    voice.done({ id: "a", text: " send it" });
    expect(voice.tail()).toBe("whole");
  });

  it("reads cut when an older stretch's delayed final lands after a new stretch's first fragment", () => {
    const voice = call();
    voice.heard({ at: 1000, text: " send" });
    voice.opens({ at: 1000, id: "a", text: " send" });
    voice.relayed();
    voice.heard({ at: 3000, text: " no wait" });
    voice.done({ id: "a", text: " send" });
    expect(voice.tail()).toBe("cut");
  });

  it("reads cut when an older stretch grows by other words after a new stretch's first fragment", () => {
    const voice = call();
    voice.opens({ at: 1000, id: "a", text: " send" });
    voice.relayed();
    voice.heard({ at: 3000, text: " no wait" });
    voice.grows({ at: 1200, delta: " it", id: "a" });
    voice.done({ id: "a", text: " send it" });
    expect(voice.tail()).toBe("cut");
  });

  it("reads cut when an older stretch grows by the very same words over other audio", () => {
    const voice = call();
    voice.opens({ at: 1000, id: "a", text: " send" });
    voice.relayed();
    voice.heard({ at: 3000, text: " yes" });
    voice.grows({ at: 1200, delta: " yes", id: "a" });
    voice.done({ id: "a", text: " send yes" });
    expect(voice.tail()).toBe("cut");
  });

  it("logs each step with what it added over which audio, and no step for a repeat that added nothing", () => {
    const voice = call();
    voice.opens({ at: 1000, id: "a", text: " send" });
    voice.send({ event: { delta: "", end_ms: 1200, start_ms: 1200, turn_id: "a", type: "turn.delta" } });
    voice.heard({ at: 1200, text: " now" });
    voice.grows({ at: 1200, delta: " now", id: "a" });
    voice.done({ id: "a", text: " send now" });
    expect(voice.gateLog.current).toEqual([
      { final: false, grew: " send", id: "a", kind: "speech-segment", span: { endMs: 1200, startMs: 1000 } },
      { kind: "heard", span: { endMs: 1400, startMs: 1200 }, text: " now" },
      { final: false, grew: " now", id: "a", kind: "speech-segment", span: { endMs: 1400, startMs: 1200 } },
      { final: true, id: "a", kind: "speech-segment" },
    ]);
  });

  it("over the synthetic session, reads cut at each hand-off made mid-stretch and whole once every stretch finished", () => {
    const voice = call();
    const atHandOff: string[] = [];
    for (const event of SYNTHETIC) {
      voice.send({ event });
      if (typeof event === "object" && event !== null && "type" in event && event.type === "delegation.created") {
        atHandOff.push(voice.tail());
      }
    }
    expect(atHandOff).toEqual(["cut", "cut"]);
    expect(voice.tail()).toBe("whole");
  });
});
