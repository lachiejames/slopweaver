import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { deps } from "./deps.js";
import { freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — a post to the owner's own DM never asks them something", () => {
  // The ask sits in `detail`, below the fold, so this also witnesses that the hold reads the whole card.
  const ASKING_FORM = JSON.stringify({
    detail: [
      {
        runs: [{ text: "it is still held from 21 sep. reply yes and i will switch it on.", type: "text" }],
        type: "paragraph",
      },
    ],
    kind: "update",
    tldr: "The acme-admin vulnerability top-up is ready.",
  });

  it.each(["investigation-finding", "dogfood-case", "asked-for"])(
    "HOLDS an asking card declared %s and never calls the API",
    async (purpose) => {
      const rec = recorder();

      const code = await runSlackWrite({
        argv: [
          "--as",
          "bot",
          "--channel",
          "D0PROMPT",
          "--form",
          ASKING_FORM,
          "--home",
          freshHome(),
          "--dm-purpose",
          purpose,
        ],
        deps: deps({ rec }),
        verb: "post",
      });

      expect(code).toBe(EXIT_USAGE);
      expect(rec.sends.length).toBe(0);
    },
  );

  it("SENDS the same card to a team channel, which this hold never reads", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: ["--as", "bot", "--channel", "C1", "--form", ASKING_FORM, "--home", freshHome()],
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(0);
    expect(rec.sends.length).toBe(1);
  });
});
