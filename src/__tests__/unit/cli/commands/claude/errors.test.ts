/**
 * The `claude` verbs' refusal lines. The flag parser's own refusals are a list, and `claude signin` has always
 * printed each on its own line; the helper must keep giving them back one per line rather than as the joined
 * `message`.
 */
import { describe, expect, it } from "vitest";

import { ClaudeCommandErrors, claudeCommandErrorLines } from "../../../../../cli/commands/claude/errors.js";

describe("claudeCommandErrorLines", () => {
  it("prints each of the flag parser's refusals on its own line", () => {
    expect(
      claudeCommandErrorLines({
        error: ClaudeCommandErrors.flagsRefused({ reasons: ["unknown flag: --a", "unknown flag: --b"] }),
      }),
    ).toStrictEqual(["unknown flag: --a", "unknown flag: --b"]);
  });

  it("prints each problem of an arguments refusal on its own line, carrying the leaf errors", () => {
    const error = ClaudeCommandErrors.argumentsRefused({
      problems: [
        ClaudeCommandErrors.weeksOutOfRange({ got: "13", max: 12 }),
        ClaudeCommandErrors.nowNotIso({ got: "soon" }),
      ],
    });
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(error.problems.map((problem) => problem.code)).toStrictEqual(["INVALID_FLAG_VALUE", "INVALID_FLAG_VALUE"]);
    expect(error.message).toBe(
      "--weeks must be a whole number from 1 to 12, got 13; --now soon is not an ISO-8601 instant",
    );
    expect(claudeCommandErrorLines({ error })).toStrictEqual([
      "--weeks must be a whole number from 1 to 12, got 13",
      "--now soon is not an ISO-8601 instant",
    ]);
  });

  it("builds each leaf problem with its code and exact message", () => {
    expect(ClaudeCommandErrors.demandUnknown({ got: "mean" })).toMatchObject({
      code: "INVALID_FLAG_VALUE",
      message: "--demand is trailing or peak, got mean",
    });
    expect(ClaudeCommandErrors.extraPlans({ extra: ["a", "b"] })).toMatchObject({
      code: "FLAG_COMBINATION_REFUSED",
      message: "one plan at a time; also got a, b",
    });
    expect(ClaudeCommandErrors.seatSessionMissing()).toMatchObject({ code: "FLAG_MISSING", flag: "--session" });
    expect(ClaudeCommandErrors.aliasMissingForResume().message).toBe(
      "name the plan to resume: `slopweaver claude resume <alias>`",
    );
  });

  it("prints the seat payload refusals as their messages", () => {
    const notJson = ClaudeCommandErrors.seatPayloadNotJson({ cause: "boom" });
    expect(notJson.code).toBe("SEAT_PAYLOAD_NOT_JSON");
    expect(claudeCommandErrorLines({ error: notJson })).toStrictEqual(["the hook payload is not JSON (boom)"]);
    const missing = ClaudeCommandErrors.seatPayloadSessionMissing();
    expect(missing.code).toBe("SEAT_PAYLOAD_SESSION_MISSING");
    expect(claudeCommandErrorLines({ error: missing })).toStrictEqual(["the hook payload names no session_id"]);
  });

  it("prints a single-problem refusal as its message", () => {
    expect(claudeCommandErrorLines({ error: ClaudeCommandErrors.rotateTargetMissing() })).toStrictEqual([
      "name the plan with --to <alias>",
    ]);
  });
});
