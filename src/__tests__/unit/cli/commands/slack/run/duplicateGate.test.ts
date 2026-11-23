import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { deps } from "./deps.js";
import { argv, FORM, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — the duplicate gate stops a second identical send", () => {
  it("performs NOTHING when the door warns, and says so", async () => {
    const rec = recorder();
    const home = freshHome();

    // Establish the prior send by reserving the very key this invocation will compute.
    const first = await runSlackWrite({ argv: argv({ home }), deps: deps({ rec }), verb: "post" });
    expect(first).toBe(EXIT_OK);

    const second = await runSlackWrite({ argv: argv({ home }), deps: deps({ rec }), verb: "post" });

    expect(second).toBe(EXIT_EXPECTED_EMPTY);
    expect(rec.sends.length).toBe(1);
  });

  it("treats a different channel as a different message, not a duplicate", async () => {
    const rec = recorder();
    const home = freshHome();

    await runSlackWrite({ argv: argv({ home }), deps: deps({ rec }), verb: "post" });
    const other = await runSlackWrite({
      argv: ["--as", "bot", "--channel", "C2", "--form", FORM, "--home", home],
      deps: deps({ rec }),
      verb: "post",
    });

    expect(other).toBe(EXIT_OK);
    expect(rec.sends.length).toBe(2);
  });
});
