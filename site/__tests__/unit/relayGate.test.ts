/*
 * The relay gate: a `relay_steer` call writes only when the owner has spoken since the last relay, and the voice's
 * own reading travels only when nothing third-party reached the model after the owner last spoke.
 *
 * Each heard-only case carries the words that WOULD have gone in full mode, so dropping the read check from
 * `relayVerdict` turns its case red; the shut cases carry a read too, so a gate that forgot the "since the
 * last relay" clause opens on them.
 */
import { describe, expect, it } from "vitest";

import {
  type GateEntry,
  heardSince,
  heardTailOf,
  mintCarriesStandingData,
  offeredSince,
  relayVerdict,
  speechStepOf,
} from "../../lib/relayGate";
import { RELAY_HEARD_MAX } from "../../lib/talkRelayRequestWire";

const HIS_STEER: readonly GateEntry[] = [
  { kind: "heard", text: "okay cool, let's go with " },
  { kind: "heard", text: "notes only, pruned by my steer" },
];

describe("offeredSince", () => {
  const offer = ({ made, text }: { made: string; text: string }): GateEntry => ({
    kind: "offered",
    offer: { id: `offer-${made}`, made, text },
  });

  it("names no offer when none landed since the last relay, however many landed before it", () => {
    const log: readonly GateEntry[] = [
      offer({ made: "1", text: "old" }),
      { kind: "heard", text: "send it" },
      { kind: "relayed" },
    ];
    expect(offeredSince({ log })).toBe(undefined);
    expect(offeredSince({ log: [] })).toBe(undefined);
  });

  it("names the newest offer by when it was asked, not by where it sits in the log", () => {
    const log: readonly GateEntry[] = [
      offer({ made: "1", text: "before the relay" }),
      { kind: "relayed" },
      offer({ made: "10", text: "asked last, landed first" }),
      offer({ made: "9", text: "asked first, landed last" }),
      { kind: "heard", text: "send that" },
    ];
    expect(offeredSince({ log })).toEqual({ id: "offer-10", made: "10", text: "asked last, landed first" });
  });

  it("leaves the gate's verdict as it was: an offer is neither the owner's words nor a read", () => {
    const log: readonly GateEntry[] = [{ kind: "heard", text: "send it" }, offer({ made: "2", text: "Merged" })];
    expect(relayVerdict({ log, standing: [] })).toEqual({
      heard: "send it",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "full" },
    });
  });
});

describe("relayVerdict", () => {
  it("keeps a plan relay heard-only when a late speech fragment lands after a read", () => {
    const log: readonly GateEntry[] = [
      { kind: "heard", text: "fix" },
      { kind: "read", tool: "read_page" },
      { kind: "heard", text: " it" },
    ];
    expect(relayVerdict({ log, standing: ["web_search", "code_mode"] })).toEqual({
      heard: "fix it",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "heard-only", readsAfter: ["web_search", "code_mode"] },
    });
  });

  it("opens in full mode on the owner's words when nothing was read after them", () => {
    expect(relayVerdict({ log: HIS_STEER, standing: [] })).toEqual({
      heard: "okay cool, let's go with notes only, pruned by my steer",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "full" },
    });
  });

  it("opens words-only when a row was read after the owner last spoke — the row's text could be the reading", () => {
    expect(relayVerdict({ log: [...HIS_STEER, { kind: "read", tool: "board_row" }], standing: [] })).toEqual({
      heard: "okay cool, let's go with notes only, pruned by my steer",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "heard-only", readsAfter: ["board_row"] },
    });
  });

  it("opens words-only for a session carrying the context pack, even with no read after the owner spoke", () => {
    expect(relayVerdict({ log: HIS_STEER, standing: ["context_pack"] })).toEqual({
      heard: "okay cool, let's go with notes only, pruned by my steer",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "heard-only", readsAfter: ["context_pack"] },
    });
  });

  it("still shuts a session carrying the pack when the owner has said nothing since the last relay", () => {
    expect(relayVerdict({ log: [...HIS_STEER, { kind: "relayed" }], standing: ["context_pack"] }).kind).toBe("shut");
  });

  it("names each read after the owner once, first seen first — a page read and a screen read included", () => {
    const log: GateEntry[] = [
      ...HIS_STEER,
      { kind: "read", tool: "read_screen" },
      { kind: "read", tool: "read_page" },
      { kind: "read", tool: "read_screen" },
    ];
    expect(relayVerdict({ log, standing: [] })).toEqual({
      heard: "okay cool, let's go with notes only, pruned by my steer",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "heard-only", readsAfter: ["read_screen", "read_page"] },
    });
  });

  it("returns to full mode once the owner speaks after the read, carrying everything said since the last relay", () => {
    const log: GateEntry[] = [
      ...HIS_STEER,
      { kind: "read", tool: "read_page" },
      { kind: "heard", text: " yes, send that" },
    ];
    expect(relayVerdict({ log, standing: [] })).toEqual({
      heard: "okay cool, let's go with notes only, pruned by my steer yes, send that",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "full" },
    });
  });

  it("shuts a second relay off the same words", () => {
    const verdict = relayVerdict({
      log: [...HIS_STEER, { kind: "relayed" }, { kind: "read", tool: "read_page" }],
      standing: [],
    });
    expect(verdict).toEqual({
      kind: "shut",
      why: "Not relayed: the owner has said nothing since the last relay. Relay only a steer they have just given you out loud.",
    });
  });

  it("shuts when the owner has said nothing at all", () => {
    expect(relayVerdict({ log: [{ kind: "read", tool: "action_items" }], standing: [] }).kind).toBe("shut");
  });

  it("does not count a blank fragment as the owner speaking after a read", () => {
    const log: GateEntry[] = [...HIS_STEER, { kind: "read", tool: "code_read" }, { kind: "heard", text: "  " }];
    expect(relayVerdict({ log, standing: [] })).toEqual({
      heard: "okay cool, let's go with notes only, pruned by my steer",
      heardTail: "cut",
      kind: "open",
      mode: { kind: "heard-only", readsAfter: ["code_read"] },
    });
  });
});

// A relay made while the owner's stretch was still open was read as whole words.
describe("heardTailOf", () => {
  const said = ({ text }: { text: string }): GateEntry => ({ kind: "heard", text });
  const segment = ({ final, id }: { final: boolean; id: string }): GateEntry => ({ final, id, kind: "speech-segment" });
  const at = ({ ms }: { ms: number }) => ({ endMs: ms + 200, startMs: ms });
  const heardAt = ({ ms, text }: { ms: number; text: string }): GateEntry => ({
    kind: "heard",
    span: at({ ms }),
    text,
  });
  const grew = ({ id, ms, text }: { id: string; ms: number; text: string }): GateEntry => ({
    final: false,
    grew: text,
    id,
    kind: "speech-segment",
    span: at({ ms }),
  });

  it("reads a relay made after the stretch grew by its words over its audio and closed as whole", () => {
    const log = [
      heardAt({ ms: 1000, text: " send it" }),
      grew({ id: "s1", ms: 1000, text: " send it" }),
      segment({ final: true, id: "s1" }),
    ];
    expect(heardTailOf({ log })).toBe("whole");
  });

  it("never matches a fragment to the same words over other audio, nor one carrying no span", () => {
    const logs = [
      [
        heardAt({ ms: 3000, text: " yes" }),
        grew({ id: "a", ms: 1000, text: " yes" }),
        segment({ final: true, id: "a" }),
      ],
      [said({ text: " yes" }), grew({ id: "a", ms: 1000, text: " yes" }), segment({ final: true, id: "a" })],
    ];
    expect(logs.map((log) => heardTailOf({ log }))).toEqual(["cut", "cut"]);
  });

  it("never lets a stretch's final pair a fragment no growth matched", () => {
    const log = [segment({ final: false, id: "s1" }), said({ text: "no wait" }), segment({ final: true, id: "s1" })];
    expect(heardTailOf({ log })).toBe("cut");
  });

  it("never lets an older stretch's growth by other words vouch for a newer fragment", () => {
    const log: GateEntry[] = [
      grew({ id: "a", ms: 1000, text: " send" }),
      { kind: "relayed" },
      heardAt({ ms: 3000, text: " no wait" }),
      grew({ id: "a", ms: 1200, text: " it" }),
      segment({ final: true, id: "a" }),
    ];
    expect(heardTailOf({ log })).toBe("cut");
  });

  it("matches one growth to one fragment, so two equal fragments need two growths", () => {
    const log = [
      heardAt({ ms: 1000, text: " yes" }),
      heardAt({ ms: 1000, text: " yes" }),
      grew({ id: "a", ms: 1000, text: " yes" }),
      segment({ final: true, id: "a" }),
    ];
    expect(heardTailOf({ log })).toBe("cut");
  });

  it("reads a relay made while the stretch is still open as cut", () => {
    const log = [segment({ final: false, id: "s1" }), said({ text: "send it but" })];
    expect(heardTailOf({ log })).toBe("cut");
  });

  it("reads a heard fragment that landed after every segment event as cut, its stretch not yet seen to close", () => {
    const log = [segment({ final: false, id: "s1" }), segment({ final: true, id: "s1" }), said({ text: "and also" })];
    expect(heardTailOf({ log })).toBe("cut");
  });

  it("keeps a stretch open across a relay cut on the next relay too", () => {
    const log: GateEntry[] = [
      segment({ final: false, id: "s1" }),
      said({ text: "send it" }),
      { kind: "relayed" },
      segment({ final: true, id: "s0" }),
    ];
    expect(heardTailOf({ log })).toBe("cut");
  });

  it("does not count typed words or a blank fragment as the owner still speaking", () => {
    const log: GateEntry[] = [
      segment({ final: false, id: "s1" }),
      segment({ final: true, id: "s1" }),
      { kind: "heard", text: "typed this", typed: true },
      said({ text: "  " }),
    ];
    expect(heardTailOf({ log })).toBe("whole");
  });

  it("reads spoken words with no segment events at all as cut, never as whole", () => {
    expect(heardTailOf({ log: HIS_STEER })).toBe("cut");
  });
});

describe("speechStepOf", () => {
  it("records an opening step as growing by its whole text", () => {
    expect(
      speechStepOf({ before: undefined, final: false, id: "a", span: { endMs: 1200, startMs: 1000 }, text: " send" }),
    ).toEqual({
      final: false,
      grew: " send",
      id: "a",
      kind: "speech-segment",
      span: { endMs: 1200, startMs: 1000 },
    });
  });

  it("records an open step as growing by what it added, and nothing when it added nothing", () => {
    const steps = [
      speechStepOf({ before: " send", final: false, id: "a", span: undefined, text: " send it" }),
      speechStepOf({ before: " send it", final: false, id: "a", span: undefined, text: " send it" }),
    ];
    expect(steps).toEqual([{ final: false, grew: " it", id: "a", kind: "speech-segment" }, undefined]);
  });

  it("records a rewrite as an open step that grew by nothing it can match, and a final with no growth", () => {
    const steps = [
      speechStepOf({ before: " send it", final: false, id: "a", span: undefined, text: " sent it" }),
      speechStepOf({ before: " send it", final: true, id: "a", span: undefined, text: " send it now" }),
    ];
    expect(steps).toEqual([
      { final: false, id: "a", kind: "speech-segment" },
      { final: true, id: "a", kind: "speech-segment" },
    ]);
  });
});

describe("mintCarriesStandingData", () => {
  it("reads a session with the where-you-left-off block as carrying data, even with the pack left out", () => {
    expect(mintCarriesStandingData({ continuity: { bytes: 900, steers: 2 }, pack: { leftOut: "stale" } })).toBe(true);
  });

  it("reads a session with neither the pack nor the block as carrying nothing", () => {
    expect(mintCarriesStandingData({ continuity: undefined, pack: { leftOut: "stale" } })).toBe(false);
  });

  it("reads a pack that rode in as carrying data", () => {
    expect(mintCarriesStandingData({ continuity: undefined, pack: { ageMinutes: 3, builtIso: "x", bytes: 10 } })).toBe(
      true,
    );
  });
});

describe("heardSince", () => {
  it("reads only what the owner said after the last relay", () => {
    const log: GateEntry[] = [
      { kind: "heard", text: "first" },
      { kind: "relayed" },
      { kind: "heard", text: " second " },
    ];
    expect(heardSince({ log })).toBe("second");
  });

  // A stretch of 15,357 characters was refused outright, then cut to its newest 8,000.
  it("carries every word of a stretch the size the route once refused", () => {
    const text = `start ${"word ".repeat(3_070)}end`;
    const heard = heardSince({ log: [{ kind: "heard", text }] });
    expect(heard.length).toBe(15_359);
    expect(heard).toBe(text);
  });

  it("carries every word of an 89-minute call of long words at 75 a minute, a counterexample", () => {
    const text = "counterexample ".repeat(6_700).trim();
    const heard = heardSince({ log: [{ kind: "heard", text }] });
    expect(heard.length).toBe(100_499);
    expect(heard).toBe(text);
  });

  it("carries every word of 80 minutes of one short word at 350 a minute, a counterexample", () => {
    const text = "through ".repeat(28_126).trim();
    const heard = heardSince({ log: [{ kind: "heard", text }] });
    expect(heard.length).toBe(225_007);
    expect(heard).toBe(text);
  });

  it("past RELAY_HEARD_MAX keeps the newest, cut forward to a whole word", () => {
    const steer = "send it in drip feed style";
    const log: GateEntry[] = [{ kind: "heard", text: `start ${"abcd ".repeat(RELAY_HEARD_MAX / 5)}${steer}` }];
    const heard = heardSince({ log });
    // RELAY_HEARD_MAX + 32 characters; the newest RELAY_HEARD_MAX open on "bcd ", cut back to the next whole word.
    expect(heard.length).toBe(RELAY_HEARD_MAX - 4);
    expect(heard.startsWith("abcd abcd")).toBe(true);
    expect(heard.endsWith(steer)).toBe(true);
    expect(heard).not.toContain("start");
  });

  it("keeps words of exactly RELAY_HEARD_MAX whole", () => {
    const text = "a".repeat(RELAY_HEARD_MAX);
    expect(heardSince({ log: [{ kind: "heard", text }] })).toBe(text);
  });
});
