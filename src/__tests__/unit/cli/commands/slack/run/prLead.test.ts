import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { NOTHING_PROVEN, PROMPT_DM, PROMPT_DM_IS_OWNERS, recordingOwnDm } from "../ownDmFakes.js";
import { deps } from "./deps.js";
import { argv, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — a fresh card leads with the discussion, never a pull request", () => {
  it("refuses a card whose TL;DR asks the owner to approve the fix PR, sending nothing", async () => {
    const rec = recorder();
    const form = JSON.stringify({
      detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
      kind: "update",
      tldr: "Approve the fix PR for the gateway outage, so events recover.",
    });

    const code = await runSlackWrite({ argv: argv({ form, home: freshHome() }), deps: deps({ rec }), verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends).toEqual([]);
  });

  // The configured prompt channel is exempt only when the bot-token read proved it the owner's: a colleague's DM configured
  // there is refused exactly as a channel is.
  it.each([
    { code: EXIT_OK, name: "previews it in the owner's own bot DM", ownDm: PROMPT_DM_IS_OWNERS },
    { code: EXIT_USAGE, name: "refuses it in a colleague's DM configured as the owner's", ownDm: NOTHING_PROVEN },
  ])("$name", async ({ code, ownDm }) => {
    const rec = recorder();
    const seam = recordingOwnDm({ answer: ownDm });
    const form = JSON.stringify({
      detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
      kind: "update",
      tldr: "Approve the fix PR for the gateway outage, so events recover.",
    });

    const exit = await runSlackWrite({
      argv: [
        "--as",
        "bot",
        "--channel",
        PROMPT_DM,
        "--dm-purpose",
        "asked-for",
        "--form",
        form,
        "--home",
        freshHome(),
        "--dry-run",
      ],
      deps: deps({ ownDm: seam.verify, rec }),
      verb: "post",
    });

    expect(exit).toBe(code);
    expect(seam.asked).toEqual([PROMPT_DM]);
    expect(rec.sends).toEqual([]);
  });
});
