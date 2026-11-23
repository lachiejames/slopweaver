import { afterEach, describe, expect, it } from "vitest";
import { reserveSend } from "../../../../../../outbound/slack/sendReservation.js";
import { freshHome, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("reserveSend — the atomic claim", () => {
  it("lets exactly one of two concurrent identical claims win", () => {
    const home = freshHome();
    const nowIso = "2026-07-26T00:00:00.000Z";

    const first = reserveSend({ duplicateKey: "same-key", home, nowIso, windowHours: 24 });
    const second = reserveSend({ duplicateKey: "same-key", home, nowIso, windowHours: 24 });

    expect(first.kind).toBe("fresh");
    expect(second.kind).toBe("duplicate");
  });
});
