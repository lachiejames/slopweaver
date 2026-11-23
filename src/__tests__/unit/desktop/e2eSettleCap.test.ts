import { describe, expect, it } from "vitest";

import { E2E_SETTLE_CAP_DEFAULT_MS, e2eSettleCapOf } from "../../../desktop/e2eSettleCap.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("e2eSettleCapOf", () => {
  it("is the thirty-second default every walk has used when the flag is not passed", () => {
    expect([unwrap(e2eSettleCapOf({ text: undefined })), E2E_SETTLE_CAP_DEFAULT_MS]).toEqual([30_000, 30_000]);
  });

  it("reads whole seconds into milliseconds at both ends of the range", () => {
    expect([unwrap(e2eSettleCapOf({ text: "1" })), unwrap(e2eSettleCapOf({ text: "600" }))]).toEqual([1000, 600_000]);
  });

  it("refuses zero, past ten minutes, a fraction, a negative and a word, naming the value", () => {
    const refusals = ["0", "601", "1.5", "-5", "two"].map((text) => unwrapErr(e2eSettleCapOf({ text })).message);
    expect(refusals).toEqual([
      '--settle-cap must be whole seconds from 1 to 600, not "0"',
      '--settle-cap must be whole seconds from 1 to 600, not "601"',
      '--settle-cap must be whole seconds from 1 to 600, not "1.5"',
      '--settle-cap must be whole seconds from 1 to 600, not "-5"',
      '--settle-cap must be whole seconds from 1 to 600, not "two"',
    ]);
  });

  it("refuses with the flag error's code and the value it was given", () => {
    expect(unwrapErr(e2eSettleCapOf({ text: "0" }))).toEqual({
      code: "SETTLE_CAP_INVALID",
      message: '--settle-cap must be whole seconds from 1 to 600, not "0"',
      text: "0",
    });
  });
});
