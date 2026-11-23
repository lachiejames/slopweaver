/**
 * What `talk offer` says when no register row may pay for a call: a register with no Codex row (a Claude-only
 * install) gets the one plain line, and every other refusal is the shared decision's own words, so a paused or
 * capped row reads exactly as `cmux spawn --driver codex` would print it.
 */
import { describe, expect, it } from "vitest";

import { CodexSeatRouteErrors } from "../../../cmux/seatRouteErrors.js";
import { CodexSeatErrors } from "../../../codex/seatDecisionErrors.js";
import { TALK_NEEDS_CHATGPT_PLAN, talkPlanRefusal } from "../../../talk/planRoute.js";

const PAUSED = {
  destination: { alias: "codex-one", codexHome: "/stores/codex-one" },
  kind: "paused" as const,
  reason: "paused by the owner",
};

describe("talkPlanRefusal", () => {
  it("tells a register with no Codex row that the voice needs a ChatGPT plan", () => {
    const error = CodexSeatErrors.unrouted({ route: CodexSeatRouteErrors.noDestination() });
    expect(talkPlanRefusal({ error })).toBe(`refusing — ${TALK_NEEDS_CHATGPT_PLAN}`);
  });

  it("passes every other refusal through in the shared decision's own words", () => {
    const unavailable = CodexSeatErrors.unrouted({
      route: CodexSeatRouteErrors.everyDestinationUnavailable({ exclusions: [PAUSED] }),
    });
    const capped = CodexSeatErrors.seatRefused({ refusal: "codex-one is excluded (usage-limit): at 30%" });
    const unreadable = CodexSeatErrors.registerUnreadable({ detail: "the store refused" });
    expect([unavailable, capped, unreadable].map((error) => talkPlanRefusal({ error }))).toEqual([
      "refusing — no registered Codex destination can take this seat: codex-one (paused: paused by the owner)",
      "refusing — codex-one is excluded (usage-limit): at 30%",
      "the plan register could not be read — the store refused",
    ]);
  });
});
