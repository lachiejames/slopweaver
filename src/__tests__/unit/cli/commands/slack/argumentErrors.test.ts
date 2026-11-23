/**
 * The `slack` argument refusals: each factory raises the exact value a parser used to author as a string, and
 * the lines helper prints a pooled list one problem per line and every single refusal as its own message.
 */
import { describe, expect, it } from "vitest";

import { SlackArgumentErrors, slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";

describe("SlackArgumentErrors", () => {
  it("names the --as value it refused, quoted", () => {
    expect(SlackArgumentErrors.actorInvalid({ got: "owner" })).toEqual({
      code: "INVALID_FLAG_VALUE",
      flag: "--as",
      got: "owner",
      message: '--as must be `bot` or `me` (got "owner")',
    });
  });

  it("names a required flag that was not given", () => {
    expect(SlackArgumentErrors.flagRequired({ flag: "--ts" })).toEqual({
      code: "ARGUMENT_MISSING",
      message: "--ts is required",
      name: "--ts",
    });
  });

  it("refuses --body on the bot lane by name", () => {
    expect(SlackArgumentErrors.bodyRefusedOnBot()).toEqual({
      code: "FLAG_REFUSED",
      flag: "--body",
      message: "--body is not valid with `--as bot` (or with no --as at all): pass --form instead",
    });
  });

  it("refuses the owner-ping flag on the as-me lane, saying why", () => {
    expect(SlackArgumentErrors.ownerPingFlagRefusedOnMe()).toEqual({
      code: "FLAG_REFUSED",
      flag: "--allow-unresolved-owner",
      message:
        "--allow-unresolved-owner is not valid with `--as me`: it governs a DIGEST's owner ping, and the as-me " +
        "lane has no card, no digest form and no owner field.",
    });
  });

  it("names the verb whose pooled parse could not narrow", () => {
    expect(SlackArgumentErrors.invocationIncoherent({ verb: "delete" })).toEqual({
      code: "INVOCATION_INCOHERENT",
      message: "invalid slack delete invocation",
      verb: "delete",
    });
  });

  it("lists the sub-commands a verb does have, and quotes the one it was given", () => {
    expect(SlackArgumentErrors.draftSubcommandUnknown({ got: "release", known: ["record", "list"] })).toEqual({
      code: "SUBCOMMAND_UNKNOWN",
      got: "release",
      message: 'slack draft takes a sub-command: record, list (got "release")',
      verb: "draft",
    });
  });

  it("keeps a missing sub-command distinct from an empty one", () => {
    expect(SlackArgumentErrors.dmSubcommandUnknown({ got: undefined }).message).toBe(
      "slack dm takes one sub-command: open (got undefined)",
    );
  });

  it("joins a pooled list into one message while keeping every reason", () => {
    expect(SlackArgumentErrors.argumentsRefused({ reasons: ["--channel is required", "--ts is required"] })).toEqual({
      code: "ARGUMENTS_REFUSED",
      message: "--channel is required; --ts is required",
      reasons: ["--channel is required", "--ts is required"],
    });
  });

  it("puts a shot target's own detail first, then what the verb takes", () => {
    expect(SlackArgumentErrors.shotTargetRefused({ detail: "not a Slack host: example.invalid" }).reasons).toEqual([
      "not a Slack host: example.invalid",
      "`slack shot` photographs ONE rendered message, so it takes a message permalink and nothing else — copy " +
        "the link from the message's own overflow menu. A channel, search, settings or admin page is refused " +
        "here by name.",
    ]);
  });

  it("states the settle ceiling it enforces", () => {
    expect(SlackArgumentErrors.settleTooLong({ got: "99999", max: 10_000 })).toEqual({
      code: "INVALID_FLAG_VALUE",
      flag: "--settle",
      got: "99999",
      message: "--settle may be at most 10000ms, got '99999'",
    });
  });
});

describe("slackArgumentErrorLines", () => {
  it("prints the tokeniser's list one line per problem", () => {
    const error = SlackArgumentErrors.flagsInvalid({ reasons: ["unknown flag: --form", "unexpected argument: {}"] });

    expect(slackArgumentErrorLines({ error })).toEqual(["unknown flag: --form", "unexpected argument: {}"]);
  });

  it("prints a pooled list one line per problem", () => {
    const error = SlackArgumentErrors.argumentsRefused({ reasons: ["a", "b", "c"] });

    expect(slackArgumentErrorLines({ error })).toEqual(["a", "b", "c"]);
  });

  it("prints a refused shot target as its two lines", () => {
    const error = SlackArgumentErrors.shotTargetRefused({ detail: "not a message" });

    expect(slackArgumentErrorLines({ error })).toHaveLength(2);
    expect(slackArgumentErrorLines({ error })[0]).toBe("not a message");
  });

  it("prints a single refusal as its message alone", () => {
    expect(slackArgumentErrorLines({ error: SlackArgumentErrors.whenInputMissing() })).toEqual([
      "slack when: name at least one Slack ts or permalink",
    ]);
  });
});
