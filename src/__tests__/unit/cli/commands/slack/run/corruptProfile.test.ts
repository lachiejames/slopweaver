import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import { readExactVoiceRules } from "../../../../../../profileStore.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { deps } from "./deps.js";
import { freshHome, recorder, removeFixtureDirs, replyArgv } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — a CORRUPT profile in the invocation's OWN home", () => {
  // The production shape: one home, read by both the above-the-fold admission and the door-side seam. The
  // verb reads it before admission and exits 1, since a corrupt install is a fact failure rather than a
  // refused form — the seam's own refusal is the second line of defence, pinned above with a second home.
  it.each([
    { dryRun: false, name: "a reply" },
    { dryRun: true, name: "a dry run" },
  ])("refuses $name with exit 1, before Slack is asked anything", async ({ dryRun }) => {
    const rec = recorder();
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const slackReads: string[] = [];
    const out: string[] = [];
    const door = memoryDoorLedger();

    const code = await runSlackWrite({
      argv: replyArgv({ extra: dryRun ? ["--dry-run"] : [], home }),
      deps: deps({
        door,
        conversationSurface: async () => {
          slackReads.push("conversationSurface");
          return "private-channel";
        },
        out,
        rec,
        voiceRules: readExactVoiceRules({ home }),
        wallRun: async () => {
          slackReads.push("wallRun");
          return ok({ length: 0 });
        },
      }),
      verb: "reply",
    });

    expect(code).toBe(EXIT_ERROR);
    expect(slackReads).toEqual([]);
    expect(out).toEqual([]);
    expect(rec.sends.length).toBe(0);
    expect(door.records()).toEqual([]);
  });
});
