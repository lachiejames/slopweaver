/**
 * `TurnCommandErrors` — the typed failures the `turn` verb directory authors, and the lines each one prints.
 */
import { describe, expect, it } from "vitest";

import { TurnCommandErrors, turnCommandErrorLines } from "../../../../../cli/commands/turn/errors.js";
import { ROUND_CLOCK_HEADING } from "../../../../../live/turn/reviewThroughput.js";

describe("TurnCommandErrors.packetWithoutClock", () => {
  it("names the packet, the missing heading and the reviewer to close", () => {
    const error = TurnCommandErrors.packetWithoutClock({ packetPath: "/h/packet.md", workspaceRef: "workspace:9" });

    expect(error.code).toBe("PACKET_WITHOUT_CLOCK");
    expect(error.message).toContain(`the packet at /h/packet.md carries no clock block (${ROUND_CLOCK_HEADING})`);
    expect(error.message).toContain("slopweaver cmux close workspace:9");
  });
});

describe("TurnCommandErrors", () => {
  it("names every missing input flag on its own line, in the order given", () => {
    const error = TurnCommandErrors.inputsMissing({ flags: ["--brief", "--decision"] });

    expect(error).toEqual({
      code: "INPUTS_MISSING",
      message: "--brief is required; --decision is required",
      reasons: ["--brief is required", "--decision is required"],
    });
    expect(turnCommandErrorLines({ error })).toEqual(["--brief is required", "--decision is required"]);
  });

  it("prints a reviewer's unsent pickup as the four lines that say what to do", () => {
    const error = TurnCommandErrors.reviewerPickupUnsent({ cause: "socket closed", workspaceRef: "workspace:4" });

    expect(error.code).toBe("PICKUP_UNSENT");
    expect(turnCommandErrorLines({ error })).toEqual([
      "the reviewer booted and its record is saved, but its pickup line was not delivered: socket closed",
      "read the surface before doing anything else: slopweaver cmux read-screen --workspace workspace:4",
      "if it is genuinely empty, close it with slopweaver cmux close workspace:4 and run turn review again —",
      "hand-delivering into a session that failed its own readiness check is not a remedy this verb asks for",
    ]);
  });

  it("follows a missing review target with the verb's usage", () => {
    const error = TurnCommandErrors.reviewTargetMissing({ mode: "open", usage: "usage: turn review" });

    expect(turnCommandErrorLines({ error })).toEqual([
      "pass --dispatch <id>, or both --brief <file> and --decision <file>",
      "usage: turn review",
    ]);
  });

  it("keeps each contradicting mode flag on its own line after what the wait parser refused", () => {
    const error = TurnCommandErrors.reviewModeRefused({
      pollWithClose: true,
      upstream: ["--timeout must be a whole number of seconds"],
      waitWithoutPoll: true,
    });

    expect(turnCommandErrorLines({ error })).toEqual([
      "--timeout must be a whole number of seconds",
      "--poll and --close are separate acts: reading a verdict never closes a session",
      "--wait only means something with --poll",
    ]);
  });

  it("prints a single-message variant as its one line", () => {
    const error = TurnCommandErrors.dispatchTokenInvalid({ dispatchId: "nope" });

    expect(error).toEqual({
      code: "DISPATCH_TOKEN_INVALID",
      dispatchId: "nope",
      message: '--dispatch "nope" is not a token this build minted',
    });
    expect(turnCommandErrorLines({ error })).toEqual(['--dispatch "nope" is not a token this build minted']);
  });

  it("forwards another module's refusal as the lines it came as", () => {
    const error = TurnCommandErrors.upstreamRefused({ reasons: ["first", "second"] });

    expect(error.message).toBe("first; second");
    expect(turnCommandErrorLines({ error })).toEqual(["first", "second"]);
  });
});
