/*
 * `runDripSequence` over a half-sent drip: it halts at the failure, names it, and a re-run skips the messages that
 * already landed, a thread drip resuming under its original parent.
 */
import { describe, expect, it } from "vitest";
import { dripFullyLanded } from "../../../../../../cli/commands/slack/dripCore.js";
import { runDripSequence } from "../../../../../../cli/commands/slack/dripRun.js";
import { deps, freshHome, plan, recorder, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("runDripSequence — a half-sent drip", () => {
  it("HALTS at the failure and reports every message: landed, failed, never attempted", async () => {
    const home = freshHome();
    const rec = recorder({ failOn: "three" });

    const outcomes = await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ texts: ["one", "two", "three", "four", "five"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls.map((call) => call.text)).toEqual(["one", "two", "three"]);
    expect(outcomes.map((outcome) => `${String(outcome.index)}:${outcome.state}`)).toEqual([
      "0:sent",
      "1:sent",
      "2:failed",
      "3:not-attempted",
      "4:not-attempted",
    ]);
    expect(dripFullyLanded({ outcomes })).toBe(false);
  });

  it("names the failure rather than swallowing it", async () => {
    const home = freshHome();

    const outcomes = await runDripSequence({
      deps: deps({ api: recorder({ failOn: "one" }).api, home }),
      plan: plan({ texts: ["one", "two"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const failure = outcomes[0]!;
    expect(failure.state === "failed" ? failure.error : "").toBe("slack said no");
  });

  it("does NOT repost the messages that already landed when the drip is re-run", async () => {
    const home = freshHome();
    const first = recorder({ failOn: "three" });
    const sequence = plan({ texts: ["one", "two", "three"] });
    await runDripSequence({
      deps: deps({ api: first.api, home }),
      plan: sequence,
      resend: { landed: false, unconfirmed: false },
    });

    // The operator checked Slack, saw message 3 was not there, and said so.
    const second = recorder();
    const outcomes = await runDripSequence({
      deps: deps({ api: second.api, home }),
      plan: sequence,
      resend: { landed: false, unconfirmed: true },
    });

    expect(second.calls.map((call) => call.text)).toEqual(["three"]);
    expect(outcomes.map((outcome) => outcome.state)).toEqual(["already-sent", "already-sent", "sent"]);
  });

  it("still sends a genuinely NEW final message while skipping the ones that landed", async () => {
    const home = freshHome();
    await runDripSequence({
      deps: deps({ api: recorder().api, home }),
      plan: plan({ texts: ["one", "two"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const second = recorder();
    const outcomes = await runDripSequence({
      deps: deps({ api: second.api, home }),
      plan: plan({ texts: ["one", "two", "three"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(second.calls.map((call) => call.text)).toEqual(["three"]);
    expect(outcomes.map((outcome) => outcome.state)).toEqual(["already-sent", "already-sent", "sent"]);
  });

  it("resumes a THREAD drip under the original parent, from the skipped message's recorded ts", async () => {
    const home = freshHome();
    const sequence = plan({ shape: "thread", texts: ["parent", "reply"] });
    await runDripSequence({
      deps: deps({ api: recorder({ failOn: "reply" }).api, home }),
      plan: sequence,
      resend: { landed: false, unconfirmed: false },
    });

    const second = recorder();
    await runDripSequence({
      deps: deps({ api: second.api, home }),
      plan: sequence,
      resend: { landed: false, unconfirmed: true },
    });

    expect(second.calls).toEqual([{ filenames: [], text: "reply", threadTs: "1700000001.000100" }]);
  });
});
