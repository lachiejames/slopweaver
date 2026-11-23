/*
 * `call-reopen`'s read of its own calls off the call store: each call once, in the order the scenario placed them,
 * handed to the pure witness (`desktop/e2eCallReopen.test.ts` judges the calls themselves).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reopenWitnessFromCalls } from "../../../../../cli/commands/desktop/e2eCallReopenScenario.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CallEntry } from "../../../../../talk/callRecord.js";
import { appendCallEntries } from "../../../../../talk/callStore.js";

const A = "7d2e0f3a-4b5c-4e6f-9a01-2b3c4d5e6f01";
const B = "7d2e0f3a-4b5c-4e6f-9a01-2b3c4d5e6f02";
const C = "7d2e0f3a-4b5c-4e6f-9a01-2b3c4d5e6f03";

const SAID: CallEntry = {
  atIso: "2026-11-06T01:10:05.000Z",
  final: true,
  id: "voice-1",
  kind: "segment",
  text: "Hello.",
  who: "voice",
};

describe("reopenWitnessFromCalls", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-reopen-read-"));
    for (const callId of [A, B, C]) {
      unwrap(appendCallEntries({ callId, entries: [SAID], home }));
    }
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads each call once, in the order placed, and judges B second", () => {
    const witness = unwrap(reopenWitnessFromCalls({ callIds: [A, B, B, C], home }));
    expect([witness.held, witness.callIds, witness.problem]).toEqual([
      false,
      [A, B, C],
      `the silent reopen ${B} logged reopen steps [none], not [armed, handed]`,
    ]);
  });

  it("judges fewer than three calls short, naming how many it read", () => {
    const witness = unwrap(reopenWitnessFromCalls({ callIds: [A], home }));
    expect([witness.held, witness.callIds, witness.problem]).toEqual([
      false,
      [A],
      "the scenario wrote 1 call(s), not the three A, B and C",
    ]);
  });

  it("reports a call it cannot read, never judging the rest without it", () => {
    const refused = unwrapErr(reopenWitnessFromCalls({ callIds: [A, "not-a-call-id"], home }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      expect.stringContaining("call not-a-call-id"),
    ]);
  });
});
