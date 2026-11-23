/**
 * The three reasons a Codex seat will not open — each message the exact line `cmux spawn` prints after its prefix,
 * so the typed union changed nothing the operator reads.
 */
import { describe, expect, it } from "vitest";

import { CodexSeatRouteErrors } from "../../../cmux/seatRouteErrors.js";
import { CodexSeatErrors } from "../../../codex/seatDecisionErrors.js";

describe("CodexSeatErrors", () => {
  it("names an unreadable register as a store fault", () => {
    expect(CodexSeatErrors.registerUnreadable({ detail: "the store refused" })).toStrictEqual({
      code: "REGISTER_UNREADABLE",
      message: "the plan register could not be read — the store refused",
    });
  });

  it("names a ranking with no destination as unrouted, and keeps the router's own reason", () => {
    const route = CodexSeatRouteErrors.noDestination();
    expect(CodexSeatErrors.unrouted({ route })).toStrictEqual({
      code: "UNROUTED",
      message: `refusing — ${route.message}`,
      route,
    });
  });

  it("names a policy or cap refusal as a refused seat", () => {
    expect(CodexSeatErrors.seatRefused({ refusal: "codex-work is at its weekly limit" })).toStrictEqual({
      code: "SEAT_REFUSED",
      message: "refusing — codex-work is at its weekly limit",
    });
  });
});
