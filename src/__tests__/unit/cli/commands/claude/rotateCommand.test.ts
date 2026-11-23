import { describe, expect, it } from "vitest";

import { ClaudeCommandErrors } from "../../../../../cli/commands/claude/errors.js";
import { claudeRotateCommand, parseClaudeRotateArgs } from "../../../../../cli/commands/claude/rotate.js";
import { claudeManifest } from "../../../../../cli/manifests/claude.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("claudeRotateCommand", () => {
  it("takes the one argv parameter the CLI verb contract dispatches with", () => {
    expect(claudeRotateCommand.length).toBe(1);
  });

  it("no longer advertises the discard flag, which guarded a write that no longer exists", () => {
    // `--discard-unreturnable` accepted the loss of a credential the check-in could not return to a store. The
    // check-in is gone with the copy it protected, so the flag is REJECTED rather than ignored: silently
    // accepting it would tell a caller their accepted risk had been applied to an act nothing performs.
    expect(claudeManifest["rotate"]!.meta.usage).toBe("usage: slopweaver claude rotate --to <alias> [--commit]");
  });

  it("says in its own summary that the copy is retired, so a reader of the catalog is not misled", () => {
    expect(claudeManifest["rotate"]!.meta.summary).toBe(
      "Report which plan was named; the credential copy this used to perform is retired",
    );
  });
});

describe("parseClaudeRotateArgs", () => {
  it("defaults to the report, which writes nothing", () => {
    expect(unwrap(parseClaudeRotateArgs({ rest: ["--to", "plan-one"] }))).toStrictEqual({
      commit: false,
      to: "plan-one",
    });
  });

  it("reads --commit and the equals spelling of --to", () => {
    expect(unwrap(parseClaudeRotateArgs({ rest: ["--to=plan-two", "--commit"] }))).toStrictEqual({
      commit: true,
      to: "plan-two",
    });
  });

  it("REJECTS the retired discard flag rather than accepting it for an act nothing performs", () => {
    expect(unwrapErr(parseClaudeRotateArgs({ rest: ["--to", "plan-one", "--discard-unreturnable"] }))).toStrictEqual(
      ClaudeCommandErrors.flagsRefused({ reasons: ["unknown flag: --discard-unreturnable"] }),
    );
  });

  it("requires a plan, before any configuration is read", () => {
    expect(unwrapErr(parseClaudeRotateArgs({ rest: [] }))).toStrictEqual(ClaudeCommandErrors.rotateTargetMissing());
    expect(unwrapErr(parseClaudeRotateArgs({ rest: ["--to="] })).message).toBe("name the plan with --to <alias>");
  });

  it("refuses --to with no value", () => {
    expect(unwrapErr(parseClaudeRotateArgs({ rest: ["--to"] }))).toStrictEqual(
      ClaudeCommandErrors.flagsRefused({ reasons: ["--to requires a value"] }),
    );
  });

  // Still strict after the retirement: a mistyped `--comit` silently ignored would report a success where the
  // caller expected the registered retirement refusal, which is the one thing `--commit` now produces.
  it("refuses a mistyped --commit rather than silently running dry", () => {
    expect(unwrapErr(parseClaudeRotateArgs({ rest: ["--to", "plan-one", "--comit"] }))).toStrictEqual(
      ClaudeCommandErrors.flagsRefused({ reasons: ["unknown flag: --comit"] }),
    );
  });
});
