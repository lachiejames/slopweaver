import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { deps } from "./deps.js";
import { FORM, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — a post to the owner's own DM declares what it is for", () => {
  it.each(["D0PROMPT", "U0OWNER"])("HOLDS a purposeless card aimed at %s and never calls the API", async (channel) => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: ["--as", "bot", "--channel", channel, "--form", FORM, "--home", freshHome()],
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("SENDS the same card once it declares a purpose on the allowlist", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: ["--as", "bot", "--channel", "U0OWNER", "--form", FORM, "--home", freshHome(), "--dm-purpose", "asked-for"],
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(0);
    expect(rec.sends.length).toBe(1);
  });

  it("REFUSES a purpose outside the allowlist before anything is sent", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: [
        "--as",
        "bot",
        "--channel",
        "U0OWNER",
        "--form",
        FORM,
        "--home",
        freshHome(),
        "--dm-purpose",
        "blocked-on-you",
      ],
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });
});
