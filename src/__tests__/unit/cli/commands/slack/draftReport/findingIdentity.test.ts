/*
 * A finding's identity: a finding shared in a channel posts as the bot, so a bot row releases `--as bot`, an
 * as-me top-level finding in a channel prints only the re-record, and as-me stays sendable where it may.
 */
import { describe, expect, it } from "vitest";

import { parseSlackWriteArgs } from "../../../../../../cli/commands/slack/coreArgs.js";
import { draftRelease, draftReleaseCommand, draftShowLines } from "../../../../../../cli/commands/slack/draftReport.js";
import { unwrap } from "../../../../../../lib/result.js";
import { item } from "./harness.js";

describe("a finding's identity (a finding shared in a channel posts as the bot)", () => {
  const finding = { kind: "finding" as const, why: "the checkout 500s the detective found" };

  it("prints a bot row's release as `--as bot`, and it parses as the bot's release", () => {
    const row = item({ over: { ...finding, actor: "bot" } });
    const [binary, noun, verb, ...rest] = draftReleaseCommand({ item: row }).split(" ");
    expect([binary, noun, verb]).toEqual(["slopweaver", "slack", "post"]);
    expect(unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "post" }))).toMatchObject({
      actor: "bot",
      release: { approve: row.draft.digest, draftId: "sd-11111111" },
    });
  });

  it("prints no send command for an as-me top-level finding in a channel — only the re-record as the bot", () => {
    const row = item({ over: finding });
    expect(draftRelease({ item: row })).toEqual({
      kind: "re-record",
      why:
        "a finding parked as them at the top level of a channel — the release refuses it: a finding shared in a " +
        "channel posts as the bot. Re-record it with --as bot, a finding form and " +
        "--supersedes sd-11111111, which drops this row as the bot's cut parks.",
    });
  });

  it("holds an undeclared channel row as a finding whatever its why says, and leaves one declared message alone", () => {
    const undeclared = item({ over: { kind: undefined, why: "share the checkout 500s" } });
    const message = item({ over: { kind: "message", why: "regression hunt: checkout 500s" } });
    expect(draftRelease({ item: message }).kind).toBe("send");
    expect(draftRelease({ item: undeclared })).toEqual({
      kind: "re-record",
      why: expect.stringContaining("it declares no --kind, so it is held as a finding"),
    });
  });

  it("keeps as-me sendable in a DM with a person, in a thread, and where the bot recorded it cannot post", () => {
    const rows = [
      item({ over: { ...finding, channel: "D0SYNSOMEONE" } }),
      item({ over: { ...finding, shape: "thread", threadTs: "1789407961.767649" } }),
      item({ over: { ...finding, botCannotPost: "not-in-channel" } }),
    ];
    expect(rows.map((row) => draftRelease({ item: row }).kind)).toEqual(["send", "send", "send"]);
  });

  it("shows a bot row's author as the bot", () => {
    expect(draftShowLines({ item: item({ over: { ...finding, actor: "bot", authorId: "U0BOT" } }) })).toContain(
      "as       the bot (U0BOT)",
    );
  });
});
