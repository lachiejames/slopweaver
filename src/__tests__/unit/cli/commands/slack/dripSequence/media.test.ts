/*
 * `runDripSequence` and the media a drip carries: the uploads ride the last message only, their file ids come back
 * on its outcome, and a missing upload halts as a failure rather than a send with fewer files.
 */
import { describe, expect, it } from "vitest";
import { runDripSequence } from "../../../../../../cli/commands/slack/dripRun.js";
import type { SlackUpload } from "../../../../../../corpus/slack/writeTransport.js";
import { deps, freshHome, plan, recorder, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("runDripSequence — the media it carries", () => {
  function loaded({ names }: { names: readonly string[] }): ReadonlyMap<string, SlackUpload> {
    return new Map(names.map((name) => [name, { bytes: new Uint8Array([1]), filename: name }]));
  }

  it("hands the loaded uploads to the LAST message only, in the caller's order", async () => {
    const home = freshHome();
    const rec = recorder();

    await runDripSequence({
      deps: deps({ api: rec.api, home, uploads: loaded({ names: ["a.png", "b.png"] }) }),
      plan: plan({ media: ["a.png", "b.png"], texts: ["one", "two"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls.map((call) => call.filenames)).toEqual([[], ["a.png", "b.png"]]);
  });

  it("returns the attached file ids on that message's outcome, and an empty list on the others", async () => {
    const home = freshHome();
    const rec = recorder();

    const outcomes = await runDripSequence({
      deps: deps({ api: rec.api, home, uploads: loaded({ names: ["a.png"] }) }),
      plan: plan({ media: ["a.png"], texts: ["one", "two"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(outcomes.map((outcome) => (outcome.state === "sent" ? outcome.fileIds : null))).toEqual([[], ["F-a.png"]]);
  });

  it("passes an EMPTY upload list on every message of a drip that carries no media", async () => {
    const home = freshHome();
    const rec = recorder();

    await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ texts: ["one", "two"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls.map((call) => call.filenames)).toEqual([[], []]);
  });

  it("HALTS with a failed outcome rather than posting fewer files than were asked for", async () => {
    const home = freshHome();
    const rec = recorder();

    const outcomes = await runDripSequence({
      // The shell loads exactly the plan's paths, so an empty map here is the programming error that
      // must surface as this message's failure instead of a silently attachment-free send.
      deps: deps({ api: rec.api, home, uploads: new Map() }),
      plan: plan({ media: ["a.png"], texts: ["one", "two"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(outcomes[0]!.state).toBe("sent");
    expect(outcomes[1]).toEqual({ error: 'no loaded bytes for media path "a.png"', index: 1, state: "failed" });
    expect(rec.calls).toHaveLength(1);
  });
});
