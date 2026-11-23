import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../../doorLedgerFixture.js";
import { deps } from "./deps.js";
import { argv, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — the happy path", () => {
  it("sends exactly once and reports success", async () => {
    const rec = recorder();

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: deps({ rec }), verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(rec.sends.length).toBe(1);
    expect(rec.sends[0]!.channel).toBe("C1");
  });

  it("records the send's decision through the door ledger before it is sent", async () => {
    const rec = recorder();
    const door = memoryDoorLedger();

    await runSlackWrite({ argv: argv({ home: freshHome() }), deps: deps({ door, rec }), verb: "post" });

    expect(door.records().length).toBe(1);
  });

  it("sends nothing and exits with the error code when the door record cannot be written", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: argv({ home: freshHome() }),
      deps: deps({ door: { port: unreachableDoorLedger() }, rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.sends).toEqual([]);
  });

  it("sends the SIX-block card the renderer produced, wrapper and all", async () => {
    const rec = recorder();

    await runSlackWrite({ argv: argv({ home: freshHome() }), deps: deps({ rec }), verb: "post" });

    const payload = rec.sends[0]!.payload;
    expect(payload.text).toBe("");
    expect(payload.attachments.length).toBe(1);
    expect(payload.attachments[0].blocks.length).toBe(6);
  });

  it("passes media through in the caller's order", async () => {
    const rec = recorder();

    await runSlackWrite({
      argv: argv({ extra: ["--media", "b.pdf,a.png"], home: freshHome() }),
      deps: deps({ rec }),
      verb: "post",
    });

    expect(rec.sends[0]!.uploads.map((upload) => upload.filename)).toEqual(["b.pdf", "a.png"]);
  });
});
