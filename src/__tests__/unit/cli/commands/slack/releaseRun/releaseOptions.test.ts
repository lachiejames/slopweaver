import { describe, expect, it } from "vitest";
import { SlackArgumentErrors } from "../../../../../../cli/commands/slack/argumentErrors.js";
import { releaseOptions } from "../../../../../../cli/commands/slack/releaseArgs.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";

describe("releaseOptions", () => {
  it("takes --as bot for a bot row's release", () => {
    const parsed = releaseOptions({
      defaultHome: "/h",
      flags: new Set(),
      values: { approve: "abc", as: "bot", draft: "sd-1a2b3c4d" },
      verb: "post",
    });

    expect(unwrap(parsed).actor).toBe("bot");
  });

  it("pools every rejection, naming each flag the row already fixes", () => {
    const refused = releaseOptions({
      defaultHome: "/h",
      flags: new Set(["allow-unresolved-owner"]),
      values: { as: "robot", channel: "C1", draft: "sd-1a2b3c4d", shape: "thread" },
      verb: "reply",
    });

    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          "--draft needs `--as me` or `--as bot`, the identity the row was recorded under — " +
            "`slopweaver slack draft show <id>` prints its release command",
          "--draft needs --approve <digest>: the release sends only the exact bytes that digest binds — " +
            "`slopweaver slack draft show <id>` prints it",
          "--channel is not valid with --draft: the parked row already fixes it",
          "--shape is not valid with --draft: the parked row already fixes it",
          "--allow-unresolved-owner is not valid with --draft: it governs a bot digest's owner ping",
        ],
      }),
    );
  });

  it("refuses --dm-purpose by name, because a release is an as-me send and the purpose is the bot lane's", () => {
    const refused = releaseOptions({
      defaultHome: "/h",
      flags: new Set(),
      values: { approve: "abc", as: "me", "dm-purpose": "asked-for", draft: "sd-1a2b3c4d" },
      verb: "post",
    });

    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ["--dm-purpose is not valid with --draft: it declares what a BOT post to their DM is for"],
      }),
    );
  });
});
