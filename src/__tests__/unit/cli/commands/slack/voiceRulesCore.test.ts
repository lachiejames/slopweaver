import { describe, expect, it } from "vitest";

import { SlackArgumentErrors } from "../../../../../cli/commands/slack/argumentErrors.js";
import { parseSlackVoiceRulesArgs } from "../../../../../cli/commands/slack/voiceRulesCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseSlackVoiceRulesArgs", () => {
  it("defaults home and json when neither flag is given", () => {
    const parsed = parseSlackVoiceRulesArgs({ rest: [] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ checkStdin: false, home: undefined, json: false, slackDraft: false });
  });

  it("reads --home and --json when given", () => {
    const parsed = parseSlackVoiceRulesArgs({ rest: ["--home", "/tmp/state", "--json"] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ checkStdin: false, home: "/tmp/state", json: true, slackDraft: false });
  });

  it("reads --check-stdin, the running list's one-message check", () => {
    const parsed = parseSlackVoiceRulesArgs({ rest: ["--check-stdin", "--json"] });

    expect(unwrap(parsed)).toEqual({ checkStdin: true, home: undefined, json: true, slackDraft: false });
  });

  it("reads --slack-draft beside --check-stdin, a Slack message as the owner the shape binds too", () => {
    const parsed = parseSlackVoiceRulesArgs({ rest: ["--check-stdin", "--slack-draft", "--json"] });

    expect(unwrap(parsed)).toEqual({ checkStdin: true, home: undefined, json: true, slackDraft: true });
  });

  it("refuses --slack-draft without --check-stdin rather than ignoring it", () => {
    const parsed = parseSlackVoiceRulesArgs({ rest: ["--slack-draft"] });

    expect(unwrapErr(parsed)).toEqual(SlackArgumentErrors.slackDraftWithoutCheckStdin());
    expect(unwrapErr(parsed).message).toBe("--slack-draft requires --check-stdin: it says what stdin holds");
  });

  it("refuses a flag it does not declare", () => {
    const parsed = parseSlackVoiceRulesArgs({ rest: ["--as", "me"] });

    expect(unwrapErr(parsed)).toEqual(
      SlackArgumentErrors.flagsInvalid({ reasons: ["unknown flag: --as", "unexpected argument: me"] }),
    );
  });
});
