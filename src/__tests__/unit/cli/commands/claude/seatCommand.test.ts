/**
 * `slopweaver claude seat`'s pure halves: its argument parse, the hook payload read, and the exit contract — a
 * refused turn is a stdout block decision with exit 0 to the `UserPromptSubmit` hook and exit 1 by hand, and a pass
 * prints nothing to the hook.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LOGOUT_COMMAND } from "../../../../../claude/seatAttest.js";
import { claudeCommandErrorLines } from "../../../../../cli/commands/claude/errors.js";
import {
  hookBlockLine,
  parseClaudeSeatArgs,
  parseSeatPayload,
  seatOutcome,
} from "../../../../../cli/commands/claude/seatRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseClaudeSeatArgs", () => {
  it("reads a named session as the by-hand mode", () => {
    expect(unwrap(parseClaudeSeatArgs({ rest: ["--session", "abc-123"] }))).toStrictEqual({
      mode: "hand",
      sessionId: "abc-123",
    });
  });

  it("reads --from-payload as the hook mode", () => {
    expect(unwrap(parseClaudeSeatArgs({ rest: ["--from-payload"] }))).toStrictEqual({ mode: "hook" });
  });

  it("refuses both at once, because the hook names its session in the payload", () => {
    const error = unwrapErr(parseClaudeSeatArgs({ rest: ["--from-payload", "--session", "abc"] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(claudeCommandErrorLines({ error })).toStrictEqual([
      "--session and --from-payload are exclusive: the hook names its session in the payload",
    ]);
  });

  it("refuses neither, and a blank session", () => {
    const expected = ["name the session to judge with --session <id>, or pass --from-payload as the hook does"];
    const neither = unwrapErr(parseClaudeSeatArgs({ rest: [] }));
    const blank = unwrapErr(parseClaudeSeatArgs({ rest: ["--session", "  "] }));
    expect(neither.code).toBe("ARGUMENTS_REFUSED");
    expect(claudeCommandErrorLines({ error: neither })).toStrictEqual(expected);
    expect(claudeCommandErrorLines({ error: blank })).toStrictEqual(expected);
  });
});

describe("parseSeatPayload", () => {
  it("reads the session id and its delivery context out of a UserPromptSubmit payload", () => {
    const raw =
      '{"session_id":"3d489207","hook_event_name":"UserPromptSubmit","prompt":"hello","transcript_path":"/t.jsonl"}';
    expect(unwrap(parseSeatPayload({ raw }))).toEqual({
      delivery: { awaitsBoundary: false, id: "3d489207", transcriptPath: "/t.jsonl" },
      sessionId: "3d489207",
    });
  });

  it("refuses a payload naming no session", () => {
    const error = unwrapErr(parseSeatPayload({ raw: '{"prompt":"hello"}' }));
    expect(error.code).toBe("SEAT_PAYLOAD_SESSION_MISSING");
    expect(claudeCommandErrorLines({ error })).toStrictEqual(["the hook payload names no session_id"]);
  });

  it("refuses a payload that is not JSON", () => {
    const error = unwrapErr(parseSeatPayload({ raw: "not json" }));
    expect(error.code).toBe("SEAT_PAYLOAD_NOT_JSON");
    expect(claudeCommandErrorLines({ error })[0]).toContain("the hook payload is not JSON");
  });
});

describe("seatOutcome", () => {
  const ON_PLAN = { alias: "plan-five", how: "token", kind: "on-plan" } as const;
  const OFF_PLAN = { kind: "off-plan", why: "no token and no store" } as const;

  it("passes an on-plan hook turn silently, since this event adds stdout to the model's context", () => {
    expect(seatOutcome({ hatchIsOpen: false, mode: "hook", verdict: ON_PLAN })).toStrictEqual({
      code: EXIT_OK,
      lines: [],
      stdout: [],
    });
  });

  it("prints the verdict by hand and exits 0", () => {
    expect(seatOutcome({ hatchIsOpen: false, mode: "hand", verdict: ON_PLAN })).toStrictEqual({
      code: EXIT_OK,
      lines: ["claude seat: ON plan-five, booted on its setup token"],
      stdout: [],
    });
  });

  it("passes an unmeasured seat, never refusing on its own blindness", () => {
    expect(seatOutcome({ hatchIsOpen: false, mode: "hook", verdict: { kind: "unmeasured", why: "x" } }).code).toBe(
      EXIT_OK,
    );
  });

  it("refuses an off-plan turn by hand with exit 1, the four-line refusal, then the logout", () => {
    const outcome = seatOutcome({ hatchIsOpen: false, mode: "hand", verdict: OFF_PLAN });
    expect(outcome.code).toBe(EXIT_ERROR);
    expect(outcome.stdout).toStrictEqual([]);
    expect(outcome.lines[0]).toContain("slopweaver claude seat blocked because");
    expect(outcome.lines[0]).toContain("no token and no store");
    expect(outcome.lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_UNROUTED_SEAT=1 slopweaver claude seat.",
    );
    expect(outcome.lines.join("\n")).toContain(DEFAULT_LOGOUT_COMMAND);
  });

  it("blocks the same turn in the hook by a stdout decision carrying that refusal, and exits 0, never 2", () => {
    const hand = seatOutcome({ hatchIsOpen: false, mode: "hand", verdict: OFF_PLAN });
    expect(seatOutcome({ hatchIsOpen: false, mode: "hook", verdict: OFF_PLAN })).toStrictEqual({
      code: EXIT_OK,
      lines: [],
      stdout: [hookBlockLine({ reason: hand.lines.join("\n") })],
    });
  });

  it("spells the block decision Claude Code reads on UserPromptSubmit", () => {
    expect(JSON.parse(hookBlockLine({ reason: "off plan" }))).toStrictEqual({ decision: "block", reason: "off plan" });
  });

  it("lets the turn proceed under the hatch, and says it was overridden", () => {
    expect(seatOutcome({ hatchIsOpen: true, mode: "hook", verdict: OFF_PLAN })).toStrictEqual({
      code: EXIT_OK,
      lines: [
        "claude seat: OFF every configured plan — no token and no store — OVERRIDDEN by " +
          "SLOPWEAVER_ALLOW_UNROUTED_SEAT, so this turn proceeds",
      ],
      stdout: [],
    });
  });
});
