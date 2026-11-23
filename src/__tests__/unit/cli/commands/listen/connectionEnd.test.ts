import { describe, expect, it } from "vitest";

import { connectionEndedReason } from "../../../../../cli/commands/listen/connectionEnd.js";

/** A connection whose close reason is fixed, counting how often it was asked. */
function closedWith({ reason }: { reason: string | undefined }): {
  asked: () => number;
  attempt: { endedBecause: () => string | undefined };
} {
  let asks = 0;
  return {
    asked: () => asks,
    attempt: {
      endedBecause: () => {
        asks += 1;
        return reason;
      },
    },
  };
}

describe("connectionEndedReason", () => {
  it("names Slack's own disconnect reason first, without asking the socket", () => {
    const socket = closedWith({ reason: "closed 1006" });

    expect(connectionEndedReason({ attempt: socket.attempt, outcome: { disconnectReason: "refresh_requested" } })).toBe(
      "refresh_requested",
    );
    expect(socket.asked()).toBe(0);
  });

  it("falls to the socket's close reason when Slack sent none", () => {
    const socket = closedWith({ reason: "closed 1006" });

    expect(connectionEndedReason({ attempt: socket.attempt, outcome: { disconnectReason: undefined } })).toBe(
      "closed 1006",
    );
  });

  it("states that no reason was given when neither source has one", () => {
    const socket = closedWith({ reason: undefined });

    expect(connectionEndedReason({ attempt: socket.attempt, outcome: { disconnectReason: undefined } })).toBe(
      "the socket ended without stating a reason",
    );
  });

  it("keeps an empty disconnect reason rather than substituting the socket's", () => {
    const socket = closedWith({ reason: "closed 1006" });

    expect(connectionEndedReason({ attempt: socket.attempt, outcome: { disconnectReason: "" } })).toBe("");
  });
});
