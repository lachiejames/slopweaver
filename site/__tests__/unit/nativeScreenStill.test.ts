/*
 * The desktop app's own look at the owner's screen, as the console reads the shell's reply: a still with its size, or the
 * shell's refusal — marked when macOS Screen Recording caused it, so the relay names the permission rather than a
 * share. Split from `desktopShell.test.ts` by describe block.
 */
import { describe, expect, it } from "vitest";

import { nativeScreenStillOf } from "../../lib/desktopShellWire";

describe("nativeScreenStillOf", () => {
  /** The PNG signature and one byte past it — enough bytes for the parser, which never decodes. */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const MALFORMED = {
    kind: "refused",
    screenRecordingOff: false,
    why: "the desktop app answered the look with no picture the voice could read",
  };

  it("reads a still with its size", () => {
    expect(nativeScreenStillOf({ value: { height: 1280, png: PNG, width: 2048 } })).toEqual({
      height: 1280,
      kind: "frame",
      png: PNG,
      width: 2048,
    });
  });

  it("carries the shell's refusal as one line", () => {
    expect(nativeScreenStillOf({ value: { why: "Screen Recording is off\nfor Slopweaver" } })).toEqual({
      kind: "refused",
      screenRecordingOff: false,
      why: "Screen Recording is off for Slopweaver",
    });
  });

  it("marks a refusal Screen Recording caused, so the relay names the permission rather than a share", () => {
    expect(
      nativeScreenStillOf({ value: { cause: "screen-recording-off", why: "Screen Recording is off for Slopweaver" } }),
    ).toEqual({ kind: "refused", screenRecordingOff: true, why: "Screen Recording is off for Slopweaver" });
  });

  it("refuses a cause it does not know, or one beside a still", () => {
    expect(nativeScreenStillOf({ value: { cause: "other", why: "no" } })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: { cause: "screen-recording-off", height: 1, png: PNG, width: 1 } })).toEqual(
      MALFORMED,
    );
  });

  it("refuses a reply that is not an object", () => {
    expect(nativeScreenStillOf({ value: undefined })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: [] })).toEqual(MALFORMED);
  });

  it("refuses bytes that are not a PNG, or only its signature", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49]);
    expect(nativeScreenStillOf({ value: { height: 1, png: jpeg, width: 1 } })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: { height: 1, png: PNG.slice(0, 8), width: 1 } })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: { height: 1, png: "iVBORw0KGgo=", width: 1 } })).toEqual(MALFORMED);
  });

  it("refuses a size that is not whole pixels inside the shell's long edge", () => {
    expect(nativeScreenStillOf({ value: { height: 0, png: PNG, width: 1 } })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: { height: 1.5, png: PNG, width: 1 } })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: { height: 2049, png: PNG, width: 1 } })).toEqual(MALFORMED);
  });

  it("refuses a reply carrying anything beyond its own fields", () => {
    expect(nativeScreenStillOf({ value: { extra: 1, height: 1, png: PNG, width: 1 } })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: { height: 1, png: PNG, why: "both", width: 1 } })).toEqual(MALFORMED);
  });

  it("refuses a refusal with no reason, or a reason past one sentence", () => {
    expect(nativeScreenStillOf({ value: { why: " " } })).toEqual(MALFORMED);
    expect(nativeScreenStillOf({ value: { why: "x".repeat(513) } })).toEqual(MALFORMED);
  });
});
