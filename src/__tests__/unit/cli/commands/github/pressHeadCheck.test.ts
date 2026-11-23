/**
 * The press-time head check: a row presses only over the head this read judged, however GitHub cases it, and a
 * head that cannot be re-read refuses rather than presses.
 */

import { describe, expect, it } from "vitest";
import { headRefusalAtPressTime } from "../../../../../cli/commands/github/pressHeadCheck.js";
import type { MergeableRecheck } from "../../../../../live/github/mergeableRecheck.js";
import { landingRowFake } from "../../../../landingRowFake.js";

const JUDGED = "1111111111111111111111111111111111111111";

/**
 * A recheck answering one fixed head for every subject it is asked about.
 *
 * @param headOid the head GitHub reports
 * @returns the recheck seam
 */
function reporting({ headOid }: { headOid: string }): MergeableRecheck {
  return ({ subjects }) =>
    Promise.resolve(subjects.map(() => ({ kind: "read" as const, value: { headOid, mergeable: "MERGEABLE" } })));
}

describe("headRefusalAtPressTime", () => {
  it("allows the press when GitHub still reports the judged head", async () => {
    const refusal = await headRefusalAtPressTime({ recheck: reporting({ headOid: JUDGED }), row: landingRowFake() });
    expect(refusal).toBe(undefined);
  });

  it("allows the press when the same head comes back in another case", async () => {
    const lower = "abcdef0123456789abcdef0123456789abcdef01";
    const refusal = await headRefusalAtPressTime({
      recheck: reporting({ headOid: lower.toUpperCase() }),
      row: landingRowFake({ headOid: lower }),
    });
    expect(refusal).toBe(undefined);
  });

  it("refuses, naming both heads, when the head moved", async () => {
    const refusal = await headRefusalAtPressTime({
      recheck: reporting({ headOid: "2222222222222222222222222222222222222222" }),
      row: landingRowFake(),
    });
    expect(refusal).toBe(
      "not pressed: its head moved from 1111111 to 2222222 since this read judged it — run the read again",
    );
  });

  it("refuses when the head could not be re-read", async () => {
    const recheck: MergeableRecheck = () => Promise.resolve([{ kind: "unread", why: "rate limited" }]);
    const refusal = await headRefusalAtPressTime({ recheck, row: landingRowFake() });
    expect(refusal).toBe(
      "not pressed: its head could not be re-read, and a press over an unconfirmed head is not made",
    );
  });

  it("refuses when the recheck answers nothing at all", async () => {
    const recheck: MergeableRecheck = () => Promise.resolve([]);
    const refusal = await headRefusalAtPressTime({ recheck, row: landingRowFake() });
    expect(refusal).toBe(
      "not pressed: its head could not be re-read, and a press over an unconfirmed head is not made",
    );
  });
});
