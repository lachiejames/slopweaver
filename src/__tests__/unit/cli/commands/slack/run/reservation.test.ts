import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { DUPLICATE_SEND_OVERRIDE } from "../../../../../../outbound/slack/duplicateGate.js";
import { peekSend } from "../../../../../../outbound/slack/sendReservation.js";
import { deps } from "./deps.js";
import { argv, freshHome, platformError, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — a send that fails at Slack's own boundary does not leave a dangling reservation", () => {
  it("RELEASES the reservation when Slack answered ok:false, so the very next attempt is fresh", async () => {
    // Measured: the first attempt died on channel_not_found, the reservation dangled, and neither the
    // override nor --resend-unconfirmed could clear it — only hand-deleting the ledger file let it through.
    const home = freshHome();
    const refused = recorder({ failWith: platformError({ error: "channel_not_found" }) });
    await expect(runSlackWrite({ argv: argv({ home }), deps: deps({ rec: refused }), verb: "post" })).rejects.toThrow(
      "channel_not_found",
    );
    expect(readdirSync(join(home, "ledgers", "slack-sends"))).toEqual([]);

    const again = recorder();
    const code = await runSlackWrite({ argv: argv({ home }), deps: deps({ rec: again }), verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(again.sends.length).toBe(1);
  });

  it("KEEPS the reservation when the failure was unread, and --resend-unconfirmed is the way through", async () => {
    const home = freshHome();
    const lost = recorder({ failWith: new Error("ETIMEDOUT") });
    await expect(runSlackWrite({ argv: argv({ home }), deps: deps({ rec: lost }), verb: "post" })).rejects.toThrow(
      "ETIMEDOUT",
    );
    const [key] = readdirSync(join(home, "ledgers", "slack-sends"));
    expect(peekSend({ duplicateKey: key!, home, nowIso: new Date().toISOString(), windowHours: 24 }).kind).toBe(
      "duplicate",
    );

    // A plain retry is refused: the outcome is unknown and nobody has vouched for the target being empty.
    const blind = recorder();
    expect(await runSlackWrite({ argv: argv({ home }), deps: deps({ rec: blind }), verb: "post" })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(blind.sends.length).toBe(0);

    // The operator read the target and it is not there: the flag alone, with NO override token, sends it.
    const vouched = recorder();
    const code = await runSlackWrite({
      argv: argv({ extra: ["--resend-unconfirmed"], home }),
      deps: deps({ rec: vouched }),
      verb: "post",
    });
    expect(code).toBe(EXIT_OK);
    expect(vouched.sends.length).toBe(1);
  });

  it("does NOT let --resend-unconfirmed repeat a card that LANDED — that still needs the override", async () => {
    const home = freshHome();
    const first = recorder();
    expect(await runSlackWrite({ argv: argv({ home }), deps: deps({ rec: first }), verb: "post" })).toBe(EXIT_OK);

    const repeat = recorder();
    const code = await runSlackWrite({
      argv: argv({ extra: ["--resend-unconfirmed"], home }),
      deps: deps({ rec: repeat }),
      verb: "post",
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(repeat.sends.length).toBe(0);
  });

  it("actually REPEATS a landed card under the override — admitted at the door and no longer refused after it", async () => {
    const home = freshHome();
    const first = recorder();
    expect(await runSlackWrite({ argv: argv({ home }), deps: deps({ rec: first }), verb: "post" })).toBe(EXIT_OK);

    const deliberate = recorder();
    const code = await runSlackWrite({
      argv: argv({ home }),
      deps: { ...deps({ rec: deliberate }), doorEnv: () => ({ SLOPWEAVER_DOOR_OVERRIDE: DUPLICATE_SEND_OVERRIDE }) },
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(deliberate.sends.length).toBe(1);
  });

  it("sends an UNCONFIRMED card under the override alone, as the drip lane always has", async () => {
    const home = freshHome();
    const lost = recorder({ failWith: new Error("socket hang up") });
    await expect(runSlackWrite({ argv: argv({ home }), deps: deps({ rec: lost }), verb: "post" })).rejects.toThrow(
      "socket hang up",
    );

    const deliberate = recorder();
    const code = await runSlackWrite({
      argv: argv({ home }),
      deps: { ...deps({ rec: deliberate }), doorEnv: () => ({ SLOPWEAVER_DOOR_OVERRIDE: DUPLICATE_SEND_OVERRIDE }) },
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(deliberate.sends.length).toBe(1);
  });
});
