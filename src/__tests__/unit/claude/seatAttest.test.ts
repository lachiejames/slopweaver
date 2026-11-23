/**
 * Whether a Claude session may take a turn, judged from the credential it booted on — the pure half of the
 * `UserPromptSubmit` seat check.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAmbientCredential } from "../../../claude/ambientCredential.js";
import {
  DEFAULT_LOGOUT_COMMAND,
  judgeSeat,
  refusesTurn,
  type SeatVerdict,
  seatRemedyLines,
  seatVerdictLine,
} from "../../../claude/seatAttest.js";

const SUBSCRIPTION: ClaudeAmbientCredential = { kind: "subscription", reason: "no credential outranks the store" };

const SHADOWED: ClaudeAmbientCredential = {
  kind: "shadowed",
  reason: "`ANTHROPIC_API_KEY` is set",
  source: "ANTHROPIC_API_KEY",
};

describe("judgeSeat", () => {
  it("passes a seat booted on a plan's setup token, naming the plan", () => {
    const verdict = judgeSeat({
      ambient: SUBSCRIPTION,
      reading: { kind: "read", plan: { alias: "plan-five", kind: "token" } },
    });
    expect(verdict).toEqual({ alias: "plan-five", how: "token", kind: "on-plan" });
  });

  it("passes a seat booted on a plan's own store", () => {
    const verdict = judgeSeat({
      ambient: SUBSCRIPTION,
      reading: { kind: "read", plan: { alias: "plan-one", kind: "store" } },
    });
    expect(verdict).toEqual({ alias: "plan-one", how: "store", kind: "on-plan" });
  });

  it("refuses a seat on the default login, carrying the reading's own reason", () => {
    const verdict = judgeSeat({
      ambient: SUBSCRIPTION,
      reading: { kind: "read", plan: { kind: "off-plan", why: "no token and no store" } },
    });
    expect(verdict).toEqual({ kind: "off-plan", why: "no token and no store" });
  });

  it("reads an API key as metered AHEAD of a plan token, because the key outranks every store", () => {
    const verdict = judgeSeat({
      ambient: SHADOWED,
      reading: { kind: "read", plan: { alias: "plan-five", kind: "token" } },
    });
    expect(verdict).toEqual({ kind: "metered", why: "`ANTHROPIC_API_KEY` is set" });
  });

  it("reads an API key as metered even when the session itself could not be read", () => {
    const verdict = judgeSeat({ ambient: SHADOWED, reading: { kind: "unread", why: "no session record" } });
    expect(verdict.kind).toBe("metered");
  });

  it("never refuses on its own blindness: an unresolved reading is unmeasured", () => {
    const verdict = judgeSeat({
      ambient: SUBSCRIPTION,
      reading: { kind: "read", plan: { kind: "unresolved", why: "ps failed" } },
    });
    expect(verdict).toEqual({ kind: "unmeasured", why: "ps failed" });
  });

  it("reads an unread session as unmeasured, carrying why", () => {
    const verdict = judgeSeat({ ambient: SUBSCRIPTION, reading: { kind: "unread", why: "two records carry it" } });
    expect(verdict).toEqual({ kind: "unmeasured", why: "two records carry it" });
  });

  it("reads an install with no plans as unmeasured, since there is no plan to be off", () => {
    const verdict = judgeSeat({ ambient: SUBSCRIPTION, reading: { kind: "unconfigured" } });
    expect(verdict).toEqual({
      kind: "unmeasured",
      why: "this install registers no Claude plan, so there is no plan to be off",
    });
  });
});

describe("refusesTurn", () => {
  const VERDICTS: readonly SeatVerdict[] = [
    { alias: "plan-five", how: "token", kind: "on-plan" },
    { kind: "metered", why: "key" },
    { kind: "off-plan", why: "default login" },
    { kind: "unmeasured", why: "ps failed" },
  ];

  it("refuses exactly the metered and off-plan verdicts", () => {
    expect(VERDICTS.length).toBeGreaterThan(0);
    expect(VERDICTS.filter((verdict) => refusesTurn(verdict)).map((verdict) => verdict.kind)).toEqual([
      "metered",
      "off-plan",
    ]);
  });
});

describe("seatVerdictLine", () => {
  it("names the plan and how the seat booted on it", () => {
    expect(seatVerdictLine({ verdict: { alias: "plan-five", how: "token", kind: "on-plan" } })).toBe(
      "claude seat: ON plan-five, booted on its setup token",
    );
    expect(seatVerdictLine({ verdict: { alias: "plan-one", how: "store", kind: "on-plan" } })).toBe(
      "claude seat: ON plan-one, booted on its own store",
    );
  });

  it("labels each other verdict with its reason", () => {
    expect(seatVerdictLine({ verdict: { kind: "metered", why: "key set" } })).toBe("claude seat: METERED — key set");
    expect(seatVerdictLine({ verdict: { kind: "off-plan", why: "default login" } })).toBe(
      "claude seat: OFF every configured plan — default login",
    );
    expect(seatVerdictLine({ verdict: { kind: "unmeasured", why: "ps failed" } })).toBe(
      "claude seat: UNMEASURED — ps failed",
    );
  });
});

describe("seatRemedyLines", () => {
  it("hands an off-plan seat the in-place reseat first, then the routed spawn and the fenced logout", () => {
    const lines = seatRemedyLines({ verdict: { kind: "off-plan", why: "default login" } });
    expect(lines[0]).toContain("slopweaver cmux reseat <workspace>");
    expect(lines.join("\n")).toContain("slopweaver cmux spawn <slug> --model <model>");
    expect(lines.join("\n")).toContain(`${DEFAULT_LOGOUT_COMMAND}\` — never after a restore`);
  });

  it("hands a metered seat the credential to unset, never the logout", () => {
    const lines = seatRemedyLines({ verdict: { kind: "metered", why: "key set" } });
    expect(lines.join("\n")).toContain("apiKeyHelper");
    expect(lines.join("\n")).not.toContain(DEFAULT_LOGOUT_COMMAND);
  });

  it("signs the default store out whatever store the shell it runs in names", () => {
    expect(DEFAULT_LOGOUT_COMMAND).toBe("env -u CLAUDE_SECURESTORAGE_CONFIG_DIR claude auth logout");
  });
});
