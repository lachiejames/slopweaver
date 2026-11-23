import { describe, expect, it } from "vitest";

import {
  heldOnCall,
  isOnCallHold,
  ON_CALL_RULING,
  OnCallHoldErrors,
  onCallHold,
  parseMicDevices,
} from "../../../desktop/onCallHold.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const RULING_WORDS = "e2e testing the desktop app holds while the owner is on a call, and only then";
const NO_HATCH =
  "This hold has no hatch: being on a call is never overridden. Nothing more is launched and no further test call is placed; re-run unchanged once the call has ended.";

describe("onCallHold", () => {
  it("does not hold when no lease is live and no microphone is in use — e2e is not refused by default", () => {
    const mics = [
      { inUse: false, name: "MacBook Pro Microphone" },
      { inUse: false, name: "Headset" },
    ];
    expect(onCallHold({ liveCalls: 0, mics })).toBe(undefined);
  });

  it("does not hold with no capture device at all", () => {
    expect(onCallHold({ liveCalls: 0, mics: [] })).toBe(undefined);
  });

  it("holds on a live voice call lease, naming the ruling and that there is no hatch", () => {
    const held = onCallHold({ liveCalls: 1, mics: [{ inUse: false, name: "MacBook Pro Microphone" }] })!;
    expect([held.code, held.message]).toEqual([
      "ON_CALL",
      `desktop e2e held: the owner is on a call — 1 voice call lease(s) live on this machine. ${ON_CALL_RULING}. ${NO_HATCH}`,
    ]);
  });

  it("holds on a microphone another app holds, naming only the device in use", () => {
    const held = onCallHold({
      liveCalls: 0,
      mics: [
        { inUse: false, name: "MacBook Pro Microphone" },
        { inUse: true, name: "Headset" },
      ],
    })!;
    expect([held.code, held.message]).toEqual([
      "ON_CALL",
      `desktop e2e held: the owner is on a call — microphone(s) in use by another app: Headset (a headset playing audio can read in use too). ${ON_CALL_RULING}. ${NO_HATCH}`,
    ]);
  });

  it("names both a live lease and a microphone in use", () => {
    const held = onCallHold({ liveCalls: 2, mics: [{ inUse: true, name: "Headset" }] })!;
    expect(held.message).toContain("2 voice call lease(s) live on this machine; microphone(s) in use by another app");
  });

  it("states the ruling and names no escape hatch variable", () => {
    const held = onCallHold({ liveCalls: 1, mics: [] })!;
    expect(held.message).toContain(RULING_WORDS);
    expect(held.message).not.toContain("SLOPWEAVER_ALLOW_");
  });
});

describe("OnCallHoldErrors.onCallUnknown", () => {
  it("reads an unknowable call state as a call, naming why and the ruling", () => {
    const held = OnCallHoldErrors.onCallUnknown({ detail: "the microphone read failed: timed out" });
    expect([held.code, held.message]).toEqual([
      "ON_CALL_UNKNOWN",
      `desktop e2e held: whether the owner is on a call cannot be told (the microphone read failed: timed out), so it is read as a call. ${ON_CALL_RULING}. ${NO_HATCH}`,
    ]);
  });
});

describe("heldOnCall — a call seen, versus a fault", () => {
  it("is a hold for a call seen by either check", () => {
    expect([heldOnCall({ code: "ON_CALL" }), heldOnCall({ code: "CALL_ALREADY_LIVE" })]).toEqual([true, true]);
  });

  it("is not a hold for a read that failed, or any other stop", () => {
    const codes = ["ON_CALL_UNKNOWN", "LEASES_UNREADABLE", "CALL_LOCK_HELD", "CALL_CLEANUP_FAILED"];
    expect(codes.map((code) => heldOnCall({ code }))).toEqual([false, false, false, false]);
  });
});

describe("isOnCallHold — the hold's own stop, told apart from a launch failure", () => {
  it("is the hold for both of its codes", () => {
    const held = [
      OnCallHoldErrors.onCall({ liveCalls: 1, micsInUse: [] }),
      OnCallHoldErrors.onCallUnknown({ detail: "x" }),
    ];
    expect(held.map((error) => isOnCallHold(error))).toEqual([true, true]);
  });

  it("is not the hold for the call leg's own refusals", () => {
    expect([isOnCallHold({ code: "CALL_ALREADY_LIVE" }), isOnCallHold({ code: "CALL_LAUNCH_FAILED" })]).toEqual([
      false,
      false,
    ]);
  });
});

describe("parseMicDevices", () => {
  it("reads each device and whether another app holds it", () => {
    const text = "MacBook Pro Microphone\tfalse\nArctis Nova 7\ttrue\n";
    expect(unwrap(parseMicDevices({ text }))).toEqual([
      { inUse: false, name: "MacBook Pro Microphone" },
      { inUse: true, name: "Arctis Nova 7" },
    ]);
  });

  it("reads CRLF line endings", () => {
    expect(unwrap(parseMicDevices({ text: "Mic\ttrue\r\nOther\tfalse\r\n" }))).toEqual([
      { inUse: true, name: "Mic" },
      { inUse: false, name: "Other" },
    ]);
  });

  it("holds on a row with an empty name", () => {
    expect(unwrapErr(parseMicDevices({ text: "\tfalse" })).code).toBe("ON_CALL_UNKNOWN");
  });

  it("reads empty output as no devices", () => {
    expect(unwrap(parseMicDevices({ text: "" }))).toEqual([]);
  });

  it("keeps a tab inside a device name, splitting on the last one", () => {
    expect(unwrap(parseMicDevices({ text: "Odd\tName\tfalse" }))).toEqual([{ inUse: false, name: "Odd\tName" }]);
  });

  it("holds on a line it does not write, rather than reading it as no call", () => {
    const held = unwrapErr(parseMicDevices({ text: "MacBook Pro Microphone\tmaybe" }));
    expect([held.code, held.message]).toEqual([
      "ON_CALL_UNKNOWN",
      `desktop e2e held: whether the owner is on a call cannot be told (the microphone read printed "MacBook Pro Microphone\\tmaybe"), so it is read as a call. ${ON_CALL_RULING}. ${NO_HATCH}`,
    ]);
  });

  it("holds on a line with no tab", () => {
    expect(unwrapErr(parseMicDevices({ text: "true" })).code).toBe("ON_CALL_UNKNOWN");
  });
});
