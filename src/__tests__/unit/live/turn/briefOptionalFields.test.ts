/** The brief's optional fields — `live/turn/briefOptionalFields.ts`. Absent stays absent; malformed is refused. */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { briefOptionalFields } from "../../../../live/turn/briefOptionalFields.js";

describe("briefOptionalFields", () => {
  it("carries no key at all for a field the brief does not have", () => {
    expect(unwrap(briefOptionalFields({ raw: { messageTs: "1.1" } }))).toEqual({});
  });

  it("carries every present field through", () => {
    const raw = {
      messageTs: "1790141967.816599",
      otherActiveAsks: [{ channel: "C1", messageTs: "1.0", state: "dispatched", threadTs: "1.0", userId: "U1" }],
      ridesOn: "1790146101.489459",
      started: { turnId: "turn-1", workingTs: "1790146110.096759" },
      stoodDown: true,
      unprompted: true,
    };
    expect(unwrap(briefOptionalFields({ raw }))).toEqual({
      otherActiveAsks: raw.otherActiveAsks,
      ridesOn: "1790146101.489459",
      started: { turnId: "turn-1", workingTs: "1790146110.096759" },
      stoodDown: true,
      unprompted: true,
    });
  });

  it("refuses a malformed field by its own code", () => {
    expect(unwrapErr(briefOptionalFields({ raw: { started: { turnId: 7 } } })).code).toBe("BRIEF_INVALID_STARTED");
    expect(unwrapErr(briefOptionalFields({ raw: { messageTs: "1.1", ridesOn: "1.1" } })).code).toBe(
      "BRIEF_INVALID_RIDES_ON",
    );
    expect(unwrapErr(briefOptionalFields({ raw: { unprompted: false } })).message).toBe(
      "the brief's `unprompted` is `false`, which is not true — absent is the only other value",
    );
    const stoodDown = unwrapErr(briefOptionalFields({ raw: { stoodDown: "yes" } }));
    expect(stoodDown.code).toBe("BRIEF_INVALID_STOOD_DOWN");
    expect(stoodDown.message).toBe(
      "the brief's `stoodDown` is `yes`, which is not true — absent is the only other value",
    );
  });
});
