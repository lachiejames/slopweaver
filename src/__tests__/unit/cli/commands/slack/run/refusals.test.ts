import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { readExactVoiceRules } from "../../../../../../profileStore.js";
import { IdentityRosterErrors } from "../../../../../../silver/identityRosterErrors.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { deps } from "./deps.js";
import { argv, freshHome, MENTION_FORM, recorder, removeFixtureDirs, replyArgv } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — refusals happen BEFORE anything is sent", () => {
  it("rejects a missing token with a usage exit and never calls the API", async () => {
    const rec = recorder();
    const home = freshHome();

    const code = await runSlackWrite({
      argv: argv({ home }),
      deps: deps({ rec, token: null }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("rejects a user token supplied for as-bot, and never calls the API", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: argv({ home: freshHome() }),
      deps: deps({ rec, token: "xoxp-user" }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("rejects an unresolvable mention rather than dropping the ping", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: argv({ form: MENTION_FORM, home: freshHome() }),
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("sends nothing when the store cannot say who a mention names", async () => {
    const rec = recorder();
    const outage = IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" });

    const code = await runSlackWrite({
      argv: argv({ form: MENTION_FORM, home: freshHome() }),
      deps: { ...deps({ rec }), resolveMentions: async () => err(outage) },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("rejects a form that violates the schema", async () => {
    const rec = recorder();
    const bad = JSON.stringify({ citations: [], detail: [], kind: "update", media: [], tldr: "x" });

    const code = await runSlackWrite({
      argv: argv({ form: bad, home: freshHome() }),
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  // A REPLY, so the wall check's thread read is on the path, and every Slack read is recorded: a profile read
  // after that read would show up here rather than pass for one read before it.
  it.each([
    { dryRun: false, name: "a reply" },
    { dryRun: true, name: "a dry run" },
  ])("stops $name whose voice-rule seam reads a CORRUPT profile before Slack is asked anything", async ({ dryRun }) => {
    // The admission above the door reads the invocation's own profile and already stops a corrupt one, so
    // the corrupt read is taken from a SECOND home: this pins the door-side seam on its own.
    const rec = recorder();
    const home = freshHome();
    const corrupt = freshHome();
    writeFileSync(join(corrupt, "profile.json"), "{", "utf8");
    const voiceRules = readExactVoiceRules({ home: corrupt });
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
        voiceRules,
        wallRun: async () => {
          slackReads.push("wallRun");
          return ok({ length: 0 });
        },
      }),
      verb: "reply",
    });

    expect(voiceRules.isErr()).toBe(true);
    expect(code).toBe(EXIT_ERROR);
    expect(slackReads).toEqual([]);
    expect(out).toEqual([]);
    expect(rec.sends.length).toBe(0);
    expect(door.records()).toEqual([]);
  });
});
