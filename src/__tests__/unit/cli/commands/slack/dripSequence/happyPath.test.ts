/*
 * `runDripSequence` on the happy path: every message sent in order, top-level or threaded, and each message's `ts`
 * recorded in its reservation for a resume to read.
 */
import { describe, expect, it } from "vitest";
import { dripFullyLanded } from "../../../../../../cli/commands/slack/dripCore.js";
import { runDripSequence } from "../../../../../../cli/commands/slack/dripRun.js";
import { peekSend } from "../../../../../../outbound/slack/sendReservation.js";
import { deps, freshHome, plan, recorder, useFreshHomes, WINDOW } from "./harness.js";

useFreshHomes();

describe("runDripSequence — the happy path", () => {
  it("sends every message IN ORDER and returns one `sent` outcome each", async () => {
    const home = freshHome();
    const rec = recorder();

    const outcomes = await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ texts: ["one", "two", "three"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls.map((call) => call.text)).toEqual(["one", "two", "three"]);
    expect(outcomes.map((outcome) => outcome.state)).toEqual(["sent", "sent", "sent"]);
    expect(dripFullyLanded({ outcomes })).toBe(true);
  });

  it("posts every message top-level under `--shape top-level`", async () => {
    const home = freshHome();
    const rec = recorder();

    await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ texts: ["one", "two"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls.map((call) => call.threadTs)).toEqual([undefined, undefined]);
  });

  it("makes message 1 the thread parent under `--shape thread`", async () => {
    const home = freshHome();
    const rec = recorder();

    const outcomes = await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ shape: "thread", texts: ["parent", "reply-a", "reply-b"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const first = outcomes[0]!;
    expect(first.state === "sent" ? first.ts : "").toBe("1700000001.000100");
    expect(rec.calls.map((call) => call.threadTs)).toEqual([undefined, "1700000001.000100", "1700000001.000100"]);
  });

  it("replies every message into the NAMED thread when the caller supplied one", async () => {
    const home = freshHome();
    const rec = recorder();

    await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ shape: "thread", texts: ["a", "b"], threadTs: "1699999999.000001" }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls.map((call) => call.threadTs)).toEqual(["1699999999.000001", "1699999999.000001"]);
  });

  it("records each message's `ts` in its reservation, which is what a resume reads", async () => {
    const home = freshHome();

    await runDripSequence({
      deps: deps({ api: recorder().api, home }),
      plan: plan({ texts: ["one"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const prior = peekSend({ duplicateKey: "key-one", home, nowIso: "2026-07-26T10:05:00.000Z", windowHours: WINDOW });
    expect(prior.kind).toBe("duplicate");
    expect(prior.kind === "duplicate" ? prior.sentTs : undefined).toBe("1700000001.000100");
  });
});
