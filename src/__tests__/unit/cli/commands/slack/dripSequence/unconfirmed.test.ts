/*
 * `runDripSequence` over a message reserved but never confirmed: it stops rather than guessing, names when the
 * reservation was made, and sends it only once `--resend-unconfirmed` says the operator checked.
 */
import { describe, expect, it } from "vitest";
import { runDripSequence } from "../../../../../../cli/commands/slack/dripRun.js";
import { reserveSend } from "../../../../../../outbound/slack/sendReservation.js";
import { deps, freshHome, plan, recorder, useFreshHomes, WINDOW } from "./harness.js";

useFreshHomes();

describe("runDripSequence — an UNCONFIRMED message is never guessed at", () => {
  /** Reserve without confirming: exactly the trace a send that reserved and then died leaves behind. */
  function seedUnconfirmed({ home, key }: { home: string; key: string }): void {
    reserveSend({ duplicateKey: key, home, nowIso: "2026-07-26T09:00:00.000Z", windowHours: WINDOW });
  }

  it("STOPS rather than skipping a message that may or may not have landed", async () => {
    const home = freshHome();
    seedUnconfirmed({ home, key: "key-two" });
    const rec = recorder();

    const outcomes = await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ texts: ["one", "two", "three"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls.map((call) => call.text)).toEqual(["one"]);
    expect(outcomes.map((outcome) => outcome.state)).toEqual(["sent", "unconfirmed", "not-attempted"]);
  });

  it("reports WHEN the unresolved message was reserved, so the operator can find it", async () => {
    const home = freshHome();
    seedUnconfirmed({ home, key: "key-one" });

    const outcomes = await runDripSequence({
      deps: deps({ api: recorder().api, home }),
      plan: plan({ texts: ["one"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const first = outcomes[0]!;
    expect(first.state === "unconfirmed" ? first.reservedIso : "").toBe("2026-07-26T09:00:00.000Z");
  });

  it("sends it once --resend-unconfirmed says the operator checked and it is not there", async () => {
    const home = freshHome();
    seedUnconfirmed({ home, key: "key-one" });
    const rec = recorder();

    const outcomes = await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ texts: ["one"] }),
      resend: { landed: false, unconfirmed: true },
    });

    expect(rec.calls.map((call) => call.text)).toEqual(["one"]);
    expect(outcomes.map((outcome) => outcome.state)).toEqual(["sent"]);
  });

  it("clears the unconfirmed record, so the NEXT run does not halt on it all over again", async () => {
    const home = freshHome();
    seedUnconfirmed({ home, key: "key-one" });
    await runDripSequence({
      deps: deps({ api: recorder().api, home }),
      plan: plan({ texts: ["one"] }),
      resend: { landed: false, unconfirmed: true },
    });

    const outcomes = await runDripSequence({
      deps: deps({ api: recorder().api, home }),
      plan: plan({ texts: ["one"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(outcomes.map((outcome) => outcome.state)).toEqual(["already-sent"]);
  });

  it("leaves a FAILED message unconfirmed rather than releasing it — a lost response may have landed", async () => {
    const home = freshHome();
    await runDripSequence({
      deps: deps({ api: recorder({ failOn: "one" }).api, home }),
      plan: plan({ texts: ["one"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const rec = recorder();
    const outcomes = await runDripSequence({
      deps: deps({ api: rec.api, home }),
      plan: plan({ texts: ["one"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(rec.calls).toEqual([]);
    expect(outcomes.map((outcome) => outcome.state)).toEqual(["unconfirmed"]);
  });
});
