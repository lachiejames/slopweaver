import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fidelityRecordOf } from "../../../../../cli/commands/desktop/e2eTranscriptFidelityTrial.js";
import { callsDir } from "../../../../../talk/callStore.js";

const HEARD = "a0000101-0000-4000-8000-000000000112";
const ABSENT = "7a2d3c0f-2e3b-4d4c-9f50-6b7c8d9e0f1a";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e2e-fidelity-trial-"));
  mkdirSync(callsDir({ home: dir }), { recursive: true });
  const segment = {
    atIso: "2026-11-06T03:16:52.000Z",
    final: true,
    id: "h1",
    kind: "segment",
    text: "Hello.",
    who: "owner",
  };
  writeFileSync(join(callsDir({ home: dir }), `${HEARD}.jsonl`), `${JSON.stringify(segment)}\n`);
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("fidelityRecordOf", () => {
  it("folds the one call file the session opened", () => {
    expect(fidelityRecordOf({ callIds: [HEARD], home: dir })).toMatchObject({ callId: HEARD });
  });

  it("refuses a session that opened no call file, or more than one", () => {
    expect([
      fidelityRecordOf({ callIds: [], home: dir }),
      fidelityRecordOf({ callIds: [HEARD, ABSENT], home: dir }),
    ]).toEqual(["expected one call file, the session opened 0", "expected one call file, the session opened 2"]);
  });

  it("names a call file that holds no call", () => {
    expect(fidelityRecordOf({ callIds: [ABSENT], home: dir })).toBe(`call file ${ABSENT} holds no call`);
  });
});
