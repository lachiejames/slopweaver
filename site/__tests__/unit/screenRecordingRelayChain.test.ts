/*
 * One desktop look refused by macOS Screen Recording, carried across the console's boundaries — the shell's reply,
 * the page's parse, the relay's screen field — to the `talk relay` argv the route spawns. Each module has its own
 * test; this one exists because each of those can pass while a field is accepted at one boundary and dropped at the
 * next, and the row goes back to blaming a share that never existed.
 *
 * The chain is cut at the argv on purpose: the verb's own parse lives in `src/cli`, which the site's typecheck
 * cannot hold, so `src/__tests__/unit/talk/screenRecordingRelayChain.test.ts` carries it on from these exact flags
 * to the words the row reads.
 */
import { describe, expect, it } from "vitest";

import { SCREEN_RECORDING_OFF, screenRecordingRefusal } from "../../../desktop/src/nativeCapture";
import { grabNativeScreenFrames } from "../../components/voice/screenGrab";
import { talkRelayArgv } from "../../lib/talkRelayArgv";
import type { ParsedTalkRelay } from "../../lib/talkRelayRequestWire";

const RELAY: Omit<ParsedTalkRelay, "screen"> = {
  about: "",
  alsoAnswers: [],
  candidateRuling: undefined,
  covers: undefined,
  discussFirst: undefined,
  heard: "what am I looking at",
  heardTail: undefined,
  offered: undefined,
  readsAfter: [],
  say: "I could not see your screen",
  triageRuling: undefined,
  turnId: "a0000017-0000-4000-8000-000000000019",
  wordsAlone: false,
  workspace: undefined,
};

/** The screen flags of the `talk relay` argv a reply from the shell ends as. */
async function screenFlagsFor({ reply }: { reply: unknown }): Promise<string[]> {
  return screenFlagsOfLook({ look: async () => reply });
}

/** The screen flags of the `talk relay` argv one look through the shell's `captureScreen` ends as. */
async function screenFlagsOfLook({ look }: { look: () => Promise<unknown> }): Promise<string[]> {
  const capture = await grabNativeScreenFrames({ capture: look, modelBudget: 1 });
  // Every reply here is a refusal, so the look carries a reason and never a frame for the route to stage.
  if (capture.relay.kind === "attached") {
    throw new Error("a refused look produced a picture");
  }
  const argv = talkRelayArgv({
    offeredPath: undefined,
    originArgv: [],
    relay: { ...RELAY, screen: capture.relay },
    screenPath: undefined,
  });
  return argv.filter((arg) => arg.startsWith("--screen"));
}

describe("a native look Screen Recording refused, from the shell to the argv", () => {
  it("reaches the verb as --screen-recording-off, never as a look that gave no frame", async () => {
    expect(await screenFlagsFor({ reply: screenRecordingRefusal({ status: "denied" }) })).toEqual([
      "--screen-recording-off",
    ]);
  });

  it("keeps an older shell's bare refusal, and any other refusal, as a look that gave no frame", async () => {
    expect(await screenFlagsFor({ reply: { why: SCREEN_RECORDING_OFF } })).toEqual(["--screen-failed"]);
    expect(
      await screenFlagsFor({ reply: { why: "the voice looks only during a call you started, and none is up" } }),
    ).toEqual(["--screen-failed"]);
  });

  it("relays a look a device policy restricted as one that gave no frame, never as a switch the owner can turn on", async () => {
    expect(await screenFlagsFor({ reply: screenRecordingRefusal({ status: "restricted" }) })).toEqual([
      "--screen-failed",
    ]);
  });

  it("relays a look the shell never answered as one that gave no frame, never as one not taken", async () => {
    const look = async (): Promise<unknown> => {
      throw new Error("IPC disconnected");
    };
    expect(await screenFlagsOfLook({ look })).toEqual(["--screen-failed"]);
  });
});
