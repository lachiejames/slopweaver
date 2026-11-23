/**
 * `completeAutonomyRecords`: a reader whose answer is an absence refuses rather than answer from part of a read.
 */
import { describe, expect, it } from "vitest";

import { AutonomyErrors } from "../../../autonomy/errors.js";
import { buildAutonomyAction } from "../../../autonomy/row.js";
import { completeAutonomyRecords } from "../../../autonomy/unparsed.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ACT = unwrap(
  buildAutonomyAction({
    actionId: "12-enqueue",
    bySession: "workspace:1 demo",
    doneIso: "2026-09-12T02:06:09Z",
    kind: "press-merge-when-ready",
    run: undefined,
    said: "Queued acme/acme-admin#12 to merge.",
    steer: undefined,
    subject: "https://github.com/acme/acme-admin/pull/12",
    why: "CI green and mergeable",
    witness: "slopweaver github enqueue --pr 12 -> queued",
  }),
);

describe("completeAutonomyRecords", () => {
  it("hands back every record when the read skipped nothing", () => {
    const records = unwrap(completeAutonomyRecords({ read: { records: [ACT], unparsed: [] } }));
    expect(records).toEqual([ACT]);
  });

  it("answers an empty ledger with no records, not a refusal", () => {
    expect(unwrap(completeAutonomyRecords({ read: { records: [], unparsed: [] } }))).toEqual([]);
  });

  it("refuses, naming every skipped line, even when some records decoded", () => {
    const refused = unwrapErr(
      completeAutonomyRecords({
        read: {
          records: [ACT],
          unparsed: [
            AutonomyErrors.corruptRow({ lineNumber: 3, why: "no actionId" }),
            AutonomyErrors.corruptRow({ lineNumber: 7, why: "not JSON" }),
          ],
        },
      }),
    );
    expect(refused.code).toBe("REGISTER_INCOMPLETE");
    expect(refused.lineNumbers).toEqual([3, 7]);
    expect(refused.message).toBe(AutonomyErrors.registerIncomplete({ lineNumbers: [3, 7] }).message);
  });
});
