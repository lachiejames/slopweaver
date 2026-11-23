import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { deps } from "./deps.js";
import { argv, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — the token is resolved under the invocation's own home", () => {
  it("asks the resolver for the SAME home the ledger and reservations use", async () => {
    // The shipped defect read `process.env.SLACK_BOT_TOKEN` directly, so `secrets set slack-bot-token`
    // was invisible to the write path. The resolver now takes a home, and this proves --home reaches it.
    const rec = recorder();
    const home = freshHome();
    const homes: string[] = [];

    await runSlackWrite({ argv: argv({ home }), deps: deps({ homes, rec }), verb: "post" });

    expect(homes).toEqual([home]);
  });
});
