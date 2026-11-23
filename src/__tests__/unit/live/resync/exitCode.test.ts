/**
 * `resyncExitCode` — which recorded attempts give their slot back (`EXIT_DEFERRED`) and which fail it. A
 * collision or a sign-in wall is not the recipe failing, so neither may earn the retry floor and the failure
 * hold a genuine failure does.
 */
import { describe, expect, it } from "vitest";

import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../../../cli/exitCodes.js";
import { type ResyncAttempt, resyncExitCode } from "../../../../live/resync/outcome.js";

const COLLISION =
  "another browser walk is driving the owner's Chrome, so the hex walk may not start: held by pid 99021 since " +
  "2026-09-30T15:03:20.821Z";

const DEFERRED_STEP = "slopweaver refresh --source slack --store";

const attempt = ({
  outcome,
  signInWall,
  relayCollision,
  stepDeferred,
}: {
  outcome: "succeeded" | "failed";
  signInWall?: string;
  relayCollision?: string;
  stepDeferred?: string;
}): Pick<ResyncAttempt, "outcome" | "signInWall" | "relayCollision" | "stepDeferred"> => ({
  outcome,
  ...(signInWall === undefined ? {} : { signInWall }),
  ...(relayCollision === undefined ? {} : { relayCollision }),
  ...(stepDeferred === undefined ? {} : { stepDeferred }),
});

describe("resyncExitCode", () => {
  it("answers 0 for a recorded success", () => {
    expect(resyncExitCode({ attempt: attempt({ outcome: "succeeded" }), recorded: true })).toBe(EXIT_OK);
  });

  it("defers a recorded attempt whose walk lost the relay to another live walk", () => {
    expect(resyncExitCode({ attempt: attempt({ outcome: "failed", relayCollision: COLLISION }), recorded: true })).toBe(
      EXIT_DEFERRED,
    );
  });

  it("defers a recorded attempt that stopped at a sign-in page", () => {
    expect(
      resyncExitCode({ attempt: attempt({ outcome: "failed", signInWall: "https://go.xero.com" }), recorded: true }),
    ).toBe(EXIT_DEFERRED);
  });

  it("defers a recorded attempt whose step itself exited 4, as a refresh whose slot was held does", () => {
    expect(
      resyncExitCode({ attempt: attempt({ outcome: "failed", stepDeferred: DEFERRED_STEP }), recorded: true }),
    ).toBe(EXIT_DEFERRED);
  });

  it("fails a deferred step nothing recorded, since nothing could then say why it stopped", () => {
    expect(
      resyncExitCode({ attempt: attempt({ outcome: "failed", stepDeferred: DEFERRED_STEP }), recorded: false }),
    ).toBe(EXIT_ERROR);
  });

  it("fails a genuine failure, which keeps its retry floor and its hold", () => {
    expect(resyncExitCode({ attempt: attempt({ outcome: "failed" }), recorded: true })).toBe(EXIT_ERROR);
  });

  it("fails a collision nothing recorded, since nothing could then say why it stopped", () => {
    expect(
      resyncExitCode({ attempt: attempt({ outcome: "failed", relayCollision: COLLISION }), recorded: false }),
    ).toBe(EXIT_ERROR);
  });

  it("fails a sign-in wall nothing recorded, since the wait on the owner's card reads the wall off the record", () => {
    expect(
      resyncExitCode({ attempt: attempt({ outcome: "failed", signInWall: "https://go.xero.com" }), recorded: false }),
    ).toBe(EXIT_ERROR);
  });

  it("fails a success nothing recorded, since the freshness page cannot see it", () => {
    expect(resyncExitCode({ attempt: attempt({ outcome: "succeeded" }), recorded: false })).toBe(EXIT_ERROR);
  });
});
