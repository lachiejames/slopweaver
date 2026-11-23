import { readdirSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { deps } from "./deps.js";
import { argv, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — --dry-run performs nothing at all", () => {
  it("does not call the API", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: argv({ extra: ["--dry-run"], home: freshHome() }),
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.sends.length).toBe(0);
  });

  it("leaves NO reservation behind, so a dry run cannot poison the next real send", async () => {
    const rec = recorder();
    const home = freshHome();

    await runSlackWrite({ argv: argv({ extra: ["--dry-run"], home }), deps: deps({ rec }), verb: "post" });

    expect(readdirSync(home)).toEqual([]);
  });
});
