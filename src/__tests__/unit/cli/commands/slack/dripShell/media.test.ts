import { afterEach, describe, expect, it } from "vitest";
import type { SlackDripReport } from "../../../../../../cli/commands/slack/dripCore.js";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { parseOwnJson } from "../../../../../parseOwnJson.js";
import { argv, freshHome, harness, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me — attaching evidence with --media", () => {
  it("attaches every file under the LAST message of the drip, and nothing under the first", async () => {
    const h = harness();

    const code = await runSlackWrite({
      argv: argv({ extra: ["--media", "a.png,b.png"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.filenames)).toEqual([[], ["a.png", "b.png"]]);
  });

  it("reads every file BEFORE the first message is posted", async () => {
    const h = harness({ unreadableMedia: "gone.png" });

    // The whole point of loading up front: an unreadable path leaves NOTHING published under the owner's name.
    // It raises rather than returning an exit code, exactly as the card lane's own media read does.
    await expect(
      runSlackWrite({ argv: argv({ extra: ["--media", "gone.png"], home: freshHome() }), deps: h.deps, verb: "post" }),
    ).rejects.toThrow('could not read the image at "gone.png"');
    expect(h.sends).toEqual([]);
    expect(h.mediaReads).toEqual(["gone.png"]);
  });

  it("never reads a file when the drip carries no --media", async () => {
    const h = harness();

    await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(h.mediaReads).toEqual([]);
  });

  it("re-sends the last message when the SAME words are re-run with screenshots added", async () => {
    const home = freshHome();
    await runSlackWrite({ argv: argv({ home }), deps: harness().deps, verb: "post" });

    const second = harness();
    const code = await runSlackWrite({
      argv: argv({ extra: ["--media", "shot.png"], home }),
      deps: second.deps,
      verb: "post",
    });

    // Message 1 is byte-identical and is correctly skipped; message 2 now carries a file, so its identity
    // moved and it goes out again WITH the evidence rather than being swallowed as an already-sent line.
    expect(code).toBe(EXIT_OK);
    expect(second.sends.map((send) => send.filenames)).toEqual([["shot.png"]]);
  });

  it("names the files and the message they land under in the dry run, sending nothing", async () => {
    const h = harness();

    const code = await runSlackWrite({
      argv: argv({ extra: ["--dry-run", "--media", "a.png"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends).toEqual([]);
    expect(h.mediaReads).toEqual([]);
    expect(h.out).toContain("media: 1 file(s) — a.png — attached UNDER message 2/2, the last one");
  });

  it("carries the media into the --json document, on the drip and on the message that holds it", async () => {
    const h = harness();

    await runSlackWrite({
      argv: argv({ extra: ["--dry-run", "--json", "--media", "a.png"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    const report = parseOwnJson<SlackDripReport>({ text: h.out.join("\n") });

    expect(report.media).toEqual(["a.png"]);
    expect(report.messages.map((message) => message.media)).toEqual([[], ["a.png"]]);
  });
});
