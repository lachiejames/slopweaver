/*
 * The offer's body: only the desktop test instance's names an instance, which is what has the console refuse it beside
 * any conversation held (`lib/talkArbiter.ts`); the owner's own offer is unchanged.
 */
import { describe, expect, it } from "vitest";

import { offerBody } from "../../components/voice/mintOffer";

describe("offerBody", () => {
  it("carries no instance on the owner's own offer", () => {
    expect(JSON.parse(offerBody({ instance: undefined, mode: "fresh", offer: "v=0", voice: "sol" }))).toEqual({
      mode: "fresh",
      sdp: "v=0",
      voice: "sol",
    });
  });

  it("marks the desktop test instance's offer", () => {
    expect(JSON.parse(offerBody({ instance: "e2e", mode: "reconnect", offer: "v=0", voice: "sol" }))).toEqual({
      instance: "e2e",
      mode: "reconnect",
      sdp: "v=0",
      voice: "sol",
    });
  });
});
