import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { slotDeliveryKey } from "../../../../../../live/automation/slotLedger.js";
import { deps } from "./deps.js";
import { argv, FORM, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — a SCHEDULED firing's card (owner turn 291-8x)", () => {
  /** A real slot delivery key, minted by the function the tick actually calls. */
  const SLOT_KEY = slotDeliveryKey({ recipeId: "iso-policy-acceptance-daily", slotIso: "2026-09-20T23:00:00.000Z" });

  it("REFUSES a scheduled card aimed at a channel nobody approved, and never calls the API", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: argv({ extra: ["--idempotency-key", SLOT_KEY], home: freshHome() }),
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("SENDS the same card when it is aimed at the owner's private conversation", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: [
        "--as",
        "bot",
        "--channel",
        "D0PROMPT",
        "--form",
        FORM,
        "--home",
        freshHome(),
        "--idempotency-key",
        SLOT_KEY,
        "--dm-purpose",
        "investigation-finding",
      ],
      deps: deps({ rec }),
      verb: "post",
    });

    expect(code).toBe(0);
    expect(rec.sends.length).toBe(1);
  });

  it("SENDS into the channel once a recipe row records the owner's approval for it", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: argv({ extra: ["--idempotency-key", SLOT_KEY], home: freshHome() }),
      deps: deps({ approvedScheduledChannels: ["C1"], rec }),
      verb: "post",
    });

    expect(code).toBe(0);
    expect(rec.sends.length).toBe(1);
  });

  it("leaves a HAND-TYPED send to the same channel alone — it carries no slot key", async () => {
    const rec = recorder();

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: deps({ rec }), verb: "post" });

    expect(code).toBe(0);
    expect(rec.sends.length).toBe(1);
  });
});
