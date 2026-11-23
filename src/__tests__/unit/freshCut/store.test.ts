/**
 * The fresh-cut store: a record round-trips through its owner-only file, a missing or mismatched record refuses, and
 * a verification report lands beside its record named for the instant it ran.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FreshCutRecord } from "../../../freshCut/core.js";
import { readFreshCutRecord, writeFreshCutRecord, writeFreshCutVerification } from "../../../freshCut/store.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const RECORD_ID = "0b7e7f8e-1f4a-4c2b-9d3e-5a6b7c8d9e0f";
const OTHER_ID = "1c8f8f9f-2a5b-4d3c-8e4f-6b7c8d9e0f1a";

const RECORD: FreshCutRecord = {
  destination: "/cuts/acme",
  login: "acme-bot",
  producedAtIso: "2026-11-20T01:02:03.000Z",
  recordId: RECORD_ID,
  rootSha: "c".repeat(40),
  schemaVersion: 1,
  source: "/src/acme",
  sourceCommitterDate: "1763600523 +1100",
  sourceSha: "a".repeat(40),
  treeSha: "b".repeat(40),
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fresh-cut-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("writeFreshCutRecord and readFreshCutRecord", () => {
  it("round-trips a record through an owner-only file under the cut's own directory", () => {
    const path = unwrap(writeFreshCutRecord({ home, record: RECORD }));

    expect(path).toBe(join(home, "fresh-cuts", RECORD_ID, "record.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(unwrap(readFreshCutRecord({ home, recordId: RECORD_ID }))).toEqual(RECORD);
  });

  it("refuses a record nobody wrote", () => {
    const error = unwrapErr(readFreshCutRecord({ home, recordId: RECORD_ID }));

    expect(error.code).toBe("RECORD_UNREADABLE");
    expect(error.message).toContain(join(home, "fresh-cuts", RECORD_ID, "record.json"));
  });

  it("refuses a record whose id is not the one asked for", () => {
    const misplaced = join(home, "fresh-cuts", OTHER_ID);
    unwrap(writeFreshCutRecord({ home, record: { ...RECORD, recordId: OTHER_ID } }));
    writeFileSync(join(misplaced, "record.json"), `${JSON.stringify(RECORD)}\n`);

    expect(unwrapErr(readFreshCutRecord({ home, recordId: OTHER_ID })).message).toBe(
      `the cut record ${join(misplaced, "record.json")} could not be read: it is not a fresh-cut record for that id`,
    );
  });
});

describe("writeFreshCutVerification", () => {
  it("writes the report beside its record, named for the instant with colons replaced", () => {
    const path = unwrap(
      writeFreshCutVerification({
        home,
        verification: {
          destinationTreeSha: "b".repeat(40),
          exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
          filesScanned: 2,
          findings: [],
          recordId: RECORD_ID,
          reviewedAccepted: 0,
          reviewedResidueSha256: "c".repeat(64),
          schemaVersion: 2,
          sourceTreeSha: "b".repeat(40),
          status: "clear",
          verifiedAtIso: "2026-11-20T01:02:03.000Z",
        },
      }),
    );

    expect(path).toBe(join(home, "fresh-cuts", RECORD_ID, "verify-2026-11-20T01-02-03.000Z.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
