import { afterEach, describe, expect, it } from "vitest";
import { SlackReadErrors } from "../../../../../../cli/commands/slack/readErrors.js";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { wallRefusalFor } from "../../../../../../cli/commands/slack/wallCheck.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { grantedEnv, grantSessionEnv } from "../../../../../hatchGrantFixture.js";
import { deps } from "./deps.js";
import { argv, freshHome, recorder, removeFixtureDirs, replyArgv } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — the wall gate (--as bot, a reply)", () => {
  it("REFUSES a reply that would take the run to 6, and never calls the API", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: replyArgv({ home: freshHome() }),
      deps: deps({ rec, wallRun: async () => ok({ length: 5 }) }),
      verb: "reply",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("tells the wall gate this lane sends as the BOT, so every earlier bot message counts", async () => {
    // The counterpart of the as-me witness in `dripShell/gates.test.ts`: this lane's identity IS this system, so
    // the as-me exclusion must NOT reach it.
    const rec = recorder();
    const actors: string[] = [];

    const code = await runSlackWrite({
      argv: replyArgv({ home: freshHome() }),
      deps: deps({
        rec,
        wallRun: async ({ actor }) => {
          actors.push(actor);
          return ok({ length: 0 });
        },
      }),
      verb: "reply",
    });

    expect(code).toBe(EXIT_OK);
    expect(actors).toEqual(["bot"]);
  });

  it("passes a SIX-message bot send when the read fails — the fail-open is the bot lane's alone", async () => {
    // The card lane always posts exactly one message, so through `runSlackWrite` both sides of the
    // fail-open branch answer identically and nothing can tell them apart. A Codex pass killed the branch
    // and the whole suite stayed green. Calling the check directly with a count of six is what fires it.
    const refusal = await wallRefusalFor({
      actor: "bot",
      channel: "C1",
      deps: deps({
        rec: recorder(),
        wallRun: async () =>
          err(SlackReadErrors.wallThreadUnread({ channel: "C1", reason: "thread walk hit its page ceiling" })),
      }),
      env: {},
      home: freshHome(),
      newMessageCount: 6,
      threadTs: "1699.0001",
      token: "xoxb-test",
    });

    expect(refusal).toEqual([]);
  });

  it("OPENS on a wall grant under the verb's own home when the ambient home is another one", async () => {
    // The counterexample: `hatch open wall --home B` while SLOPWEAVER_HOME names A. The grant lives
    // in B, so a read falling back to the environment's home would miss it and refuse the send.
    const verbHome = freshHome();
    grantedEnv({ hatchIds: ["wall"], home: verbHome });
    const refusal = await wallRefusalFor({
      actor: "me",
      channel: "C1",
      deps: deps({
        rec: recorder(),
        wallRun: async () =>
          err(SlackReadErrors.wallThreadUnread({ channel: "C1", reason: "thread walk hit its page ceiling" })),
      }),
      env: grantSessionEnv({ home: freshHome() }),
      home: verbHome,
      newMessageCount: 6,
      threadTs: "1699.0001",
      token: "xoxp-test",
    });

    expect(refusal).toEqual([]);
  });

  it("REFUSES the same six under the as-me actor — the identical failed read, the other lane", async () => {
    const refusal = await wallRefusalFor({
      actor: "me",
      channel: "C1",
      deps: deps({
        rec: recorder(),
        wallRun: async () =>
          err(SlackReadErrors.wallThreadUnread({ channel: "C1", reason: "thread walk hit its page ceiling" })),
      }),
      env: {},
      home: freshHome(),
      newMessageCount: 6,
      threadTs: "1699.0001",
      token: "xoxp-test",
    });

    expect(refusal).toEqual([
      "this send would take our unbroken run in this thread to 6 consecutive messages — nobody else has " +
        "ever replied in this thread. this send alone posts 6 consecutive messages — rewrite it as ONE " +
        "message carrying the whole thought, not a smaller number of them, or for one deliberate append " +
        'run slopweaver hatch open wall --reason "<why this one is a legitimate exception>", then re-run.',
    ]);
  });

  it("SENDS when the thread read FAILS — the bot lane cannot decide without it, so it passes", async () => {
    // The counterpart of the as-me no-fail-open test in `dripShell/gates.test.ts`. Here the standing run is the
    // whole question, so a failed read leaves nothing to judge and this check gets out of the way.
    const rec = recorder();

    const code = await runSlackWrite({
      argv: replyArgv({ home: freshHome() }),
      deps: deps({
        rec,
        wallRun: async () =>
          err(SlackReadErrors.wallThreadUnread({ channel: "C1", reason: "thread walk hit its page ceiling" })),
      }),
      verb: "reply",
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.sends.length).toBe(1);
  });

  it("SENDS a reply that would land the run at exactly 5", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: replyArgv({ home: freshHome() }),
      deps: deps({ rec, wallRun: async () => ok({ length: 4 }) }),
      verb: "reply",
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.sends.length).toBe(1);
  });

  it("never asks about the run at all for `slack post` — it never carries a thread", async () => {
    const rec = recorder();
    let asked = false;

    const code = await runSlackWrite({
      argv: argv({ home: freshHome() }),
      deps: deps({
        rec,
        wallRun: async () => {
          asked = true;
          return ok({ length: 0 });
        },
      }),
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(asked).toBe(false);
  });

  it("SENDS past the limit under a live wall grant, and says so happened only via a clean exit", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: replyArgv({ home: freshHome() }),
      deps: deps({
        rec,
        wallRun: async () => ok({ length: 9 }),
      }),
      verb: "reply",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);

    const home = freshHome();
    const env = grantedEnv({ hatchIds: ["wall"], home });
    const overridden = recorder();
    const overriddenCode = await runSlackWrite({
      argv: replyArgv({ home }),
      deps: {
        ...deps({ rec: overridden, wallRun: async () => ok({ length: 9 }) }),
        doorEnv: () => env,
      },
      verb: "reply",
    });
    expect(overriddenCode).toBe(EXIT_OK);
    expect(overridden.sends.length).toBe(1);
  });

  it("still REFUSES past the limit with only the retired wall variable set, because it opens nothing", async () => {
    const home = freshHome();
    const env = { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_WALL: "1" };
    const rec = recorder();
    const code = await runSlackWrite({
      argv: replyArgv({ home }),
      deps: {
        ...deps({ rec, wallRun: async () => ok({ length: 9 }) }),
        doorEnv: () => env,
      },
      verb: "reply",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("proceeds with the send when the run could not be established, rather than blocking every reply", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: replyArgv({ home: freshHome() }),
      deps: deps({
        rec,
        wallRun: async () =>
          err(SlackReadErrors.wallThreadUnread({ channel: "C1", reason: "conversations.replies said no" })),
      }),
      verb: "reply",
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.sends.length).toBe(1);
  });
});
