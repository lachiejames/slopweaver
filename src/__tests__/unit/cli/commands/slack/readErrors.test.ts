/**
 * The `slack` read refusals: each factory raises the exact value a read used to author as a string, and the
 * lines helper prints the tokeniser's list one problem per line and every other refusal as its own message.
 */
import { describe, expect, it } from "vitest";

import { SlackReadErrors, slackReadErrorLines } from "../../../../../cli/commands/slack/readErrors.js";

describe("SlackReadErrors", () => {
  it("counts the permalinks it was given, and lists them", () => {
    expect(SlackReadErrors.permalinkCount({ permalinks: ["a", "b"] })).toEqual({
      code: "POSITIONAL_COUNT_INVALID",
      count: 2,
      kind: "permalink",
      message: "expected one permalink, got 2: a b",
    });
  });

  it("names the flag a value is missing from", () => {
    expect(SlackReadErrors.valueMissing({ flag: "--around" })).toEqual({
      code: "ARGUMENT_MISSING",
      message: "--around requires a value",
      name: "--around",
    });
  });

  it("refuses a size cap that is not a positive number, quoting it", () => {
    expect(SlackReadErrors.maxFileMbInvalid({ got: "0" })).toEqual({
      code: "INVALID_FLAG_VALUE",
      flag: "--max-file-mb",
      got: "0",
      message: "--max-file-mb must be a positive number, got 0",
    });
  });

  it("names the Web API method a probe could not call", () => {
    expect(SlackReadErrors.probeCallFailed({ method: "auth.test", reason: "socket hang up" })).toEqual({
      code: "PROBE_CALL_FAILED",
      message: "auth.test: socket hang up",
      method: "auth.test",
      reason: "socket hang up",
    });
  });

  it("names which wall-run read failed", () => {
    expect(SlackReadErrors.wallThreadUnread({ channel: "C1", reason: "ratelimited" })).toEqual({
      code: "WALL_RUN_UNCOUNTED",
      message: "could not read C1's thread to count the wall run: ratelimited",
      reason: "ratelimited",
      step: "thread",
    });
    expect(SlackReadErrors.wallWorkspaceUrlUnresolved()).toEqual({
      code: "WALL_RUN_UNCOUNTED",
      message: "could not resolve the workspace url to count the wall run",
      reason: undefined,
      step: "workspace-url",
    });
  });

  it("quotes the --markdown source it could not read", () => {
    expect(SlackReadErrors.markdownUnreadable({ reason: "ENOENT", source: "notes.md" }).message).toBe(
      'cannot read --markdown "notes.md": ENOENT',
    );
  });
});

describe("slackReadErrorLines", () => {
  it("prints the tokeniser's list one line per problem", () => {
    const error = SlackReadErrors.flagsInvalid({ reasons: ["unknown flag: --delta", "unexpected argument: abc"] });

    expect(slackReadErrorLines({ error })).toEqual(["unknown flag: --delta", "unexpected argument: abc"]);
  });

  it("prints a single refusal as its message alone", () => {
    expect(slackReadErrorLines({ error: SlackReadErrors.sinceContextConflict() })).toEqual([
      "--since cannot be combined with --around or --channel-around",
    ]);
  });
});
