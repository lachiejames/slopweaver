/*
 * A desktop test instance's mint is built from its mode and instant alone, so nothing of the owner's can ride it: no
 * delegated context past the base instructions, an opener that is its mode's transport lines and nothing read, and the
 * pack and voice brief reported left out rather than unconfigured or broken.
 */
import { describe, expect, it } from "vitest";

import type { TalkContinuity } from "../../../talk/continuity.js";
import { TEST_INSTANCE_LEFT_OUT, testInstanceMint } from "../../../talk/mintContext.js";
import { reconnectOpener, rolloverOpener, testInstanceOpener } from "../../../talk/mintOpener.js";
import { talkInstructions } from "../../../talk/planSession.js";

const BUILT = "2026-11-27T11:00:00.000Z";

/** A read of the owner's that found nothing and read every half whole: what the owner's arm opens with on an empty home. */
const WHOLE_EMPTY: TalkContinuity = {
  builtIso: BUILT,
  calls: [],
  knowledge: [],
  rulings: [],
  sinceIso: "2026-11-24T11:00:00.000Z",
  steers: [],
  typed: [],
  unread: [],
};

describe("testInstanceMint", () => {
  it("carries no context, no opener on a fresh start, and reports the pack and the voice brief left out", () => {
    expect(testInstanceMint({ builtIso: BUILT, mode: "fresh" })).toEqual({
      builtIso: BUILT,
      context: undefined,
      kind: "test-instance",
      opener: undefined,
      pack: { kind: "left-out", why: TEST_INSTANCE_LEFT_OUT },
      voiceBrief: { bytes: 0, kind: "left-out", why: TEST_INSTANCE_LEFT_OUT },
    });
  });

  it("has no field a part of the owner's state could ride in on", () => {
    // A new field here is a new way in for the owner's state; it goes red until this list is changed on purpose.
    expect(Object.keys(testInstanceMint({ builtIso: BUILT, mode: "reconnect" })).toSorted()).toEqual([
      "builtIso",
      "context",
      "kind",
      "opener",
      "pack",
      "voiceBrief",
    ]);
  });

  it("composes to exactly the base instructions on both surfaces", () => {
    const mint = testInstanceMint({ builtIso: BUILT, mode: "fresh" });
    for (const surface of ["voice", "typed"] as const) {
      expect(talkInstructions({ context: mint.context, opener: mint.opener, surface })).toEqual(
        talkInstructions({ context: undefined, opener: undefined, surface }),
      );
    }
  });
});

describe("testInstanceOpener", () => {
  it("is nothing on a fresh start", () => {
    expect(testInstanceOpener({ mode: "fresh" })).toBe(undefined);
  });

  it("is a reconnect whose previous call left no file, quoting nothing", () => {
    const opener = testInstanceOpener({ mode: "reconnect" });
    expect(opener).toBe(reconnectOpener({ continuity: WHOLE_EMPTY }));
    expect(opener!.split("\n")[0]).toBe(
      "This call is an AUTOMATIC RECONNECT: the owner's last call with you dropped a moment ago and the console reopened it on",
    );
  });

  it("is a rollover whose previous call left no file, silent until spoken to", () => {
    const opener = testInstanceOpener({ mode: "rollover" });
    expect(opener).toBe(rolloverOpener({ continuity: WHOLE_EMPTY }));
    expect(opener!.split("\n").at(-1)).toBe("Say NOTHING until they speak.");
  });
});
