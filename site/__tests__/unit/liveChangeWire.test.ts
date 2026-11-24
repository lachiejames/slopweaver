/**
 * The change stream's wire: every message the page acts on is read strictly, and one it cannot vouch for is dropped
 * whole rather than half-acted on.
 */
import { describe, expect, it } from "vitest";

import { liveChangeEventOf, liveChangeFrame } from "../../lib/liveChangeWire";

describe("liveChangeEventOf", () => {
  it("reads which signals are up", () => {
    expect(liveChangeEventOf({ value: { files: true, kind: "ready", store: false } })).toEqual({
      files: true,
      kind: "ready",
      store: false,
    });
  });

  it("refuses a ready message missing a signal", () => {
    expect(liveChangeEventOf({ value: { files: true, kind: "ready" } })).toBeUndefined();
  });

  it("reads the registers that changed, once each, in declared order", () => {
    expect(liveChangeEventOf({ value: { kind: "changed", slugs: ["workstreams", "board", "board"] } })).toEqual({
      kind: "changed",
      slugs: ["board", "workstreams"],
    });
  });

  it("drops a changed message whole when one register is unknown", () => {
    expect(liveChangeEventOf({ value: { kind: "changed", slugs: ["board", "bored"] } })).toBeUndefined();
  });

  it("drops a changed message naming nothing", () => {
    expect(liveChangeEventOf({ value: { kind: "changed", slugs: [] } })).toBeUndefined();
  });

  it("reads a heartbeat only with a real instant", () => {
    expect(liveChangeEventOf({ value: { atIso: "2026-11-18T06:30:00.000Z", kind: "heartbeat" } })).toEqual({
      atIso: "2026-11-18T06:30:00.000Z",
      kind: "heartbeat",
    });
    expect(liveChangeEventOf({ value: { atIso: "soon", kind: "heartbeat" } })).toBeUndefined();
  });

  it("drops anything that is not one of the three shapes", () => {
    expect(liveChangeEventOf({ value: "hello" })).toBeUndefined();
    expect(liveChangeEventOf({ value: ["changed"] })).toBeUndefined();
    expect(liveChangeEventOf({ value: { kind: "restart" } })).toBeUndefined();
  });
});

describe("liveChangeFrame", () => {
  it("names the event by its kind and carries its JSON", () => {
    expect(liveChangeFrame({ event: { kind: "changed", slugs: ["hands"] } })).toBe(
      'event: changed\ndata: {"kind":"changed","slugs":["hands"]}\n\n',
    );
  });

  it("reads back what it frames", () => {
    const frame = liveChangeFrame({ event: { files: false, kind: "ready", store: true } });
    const data = frame.split("\n")[1].slice("data: ".length);
    expect(liveChangeEventOf({ value: JSON.parse(data) })).toEqual({
      files: false,
      kind: "ready",
      store: true,
    });
  });
});
