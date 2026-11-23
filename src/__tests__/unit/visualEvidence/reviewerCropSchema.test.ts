/**
 * The framing arm only a REVIEWER can write, and the arm split that keeps it off a passing record.
 *
 * A reviewing session did not take the picture, so it cannot honestly describe how the picture was framed —
 * `already-framed` would be a lie whenever the composer cropped. The third arm says exactly that. Putting it
 * on the `failed` arm alone is what stops a record asserting "I never saw how this was framed" and "it is
 * fine to send" in the same breath.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { imageRecordSchema } from "../../../visualEvidence/schema.js";
import {
  appendImageRecord,
  imageRecordPath,
  imageRecordsDir,
  readImageRecords,
} from "../../../visualEvidence/store.js";
import type { ImageRecord } from "../../../visualEvidence/types.js";
import { IMAGE_POLICY_VERSION } from "../../../visualEvidence/types.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

const BASE = {
  artifact: { digest: DIGEST, heightPx: 2, widthPx: 2 },
  policyVersion: IMAGE_POLICY_VERSION,
  readBack: {
    contextRetained: true,
    observedAtIso: "2026-09-13T02:00:00.000Z",
    observedContent: "a flat block of colour",
    observerSession: "unit-test",
    targetState: "data",
  },
  receiptId: "img-1",
  schemaVersion: 1,
};

const REVIEWER_CROP = { kind: "reviewer-unobserved", reason: "recorded by the answer's reviewer" };
const PRODUCER_CROP = { kind: "already-framed", reason: "the capture was framed to the target" };
const FAILURE = { correction: "capture the target region and have the new bytes reviewed", reason: "illegible" };

describe("imageRecordSchema", () => {
  it("still parses a producer's passing record exactly as PR1 wrote it", () => {
    expect(imageRecordSchema.safeParse({ ...BASE, crop: PRODUCER_CROP, outcome: "passed" }).success).toBe(true);
  });

  it("still parses a producer's failed record exactly as PR1 wrote it", () => {
    expect(imageRecordSchema.safeParse({ ...BASE, ...FAILURE, crop: PRODUCER_CROP, outcome: "failed" }).success).toBe(
      true,
    );
  });

  it("parses a reviewer's failure, which describes no framing it saw", () => {
    expect(imageRecordSchema.safeParse({ ...BASE, ...FAILURE, crop: REVIEWER_CROP, outcome: "failed" }).success).toBe(
      true,
    );
  });

  it("REFUSES that same framing on a record that says the picture may be sent", () => {
    const parsed = imageRecordSchema.safeParse({ ...BASE, crop: REVIEWER_CROP, outcome: "passed" });

    expect(parsed.success).toBe(false);
  });

  it("REFUSES a reviewer's framing that argues nothing", () => {
    const blank = { kind: "reviewer-unobserved", reason: "" };

    expect(imageRecordSchema.safeParse({ ...BASE, ...FAILURE, crop: blank, outcome: "failed" }).success).toBe(false);
  });

  it("REFUSES a failed record with no crop at all", () => {
    expect(imageRecordSchema.safeParse({ ...BASE, ...FAILURE, outcome: "failed" }).success).toBe(false);
  });
});

describe("appendImageRecord separates rows", () => {
  it("does not join a new record onto a final line that had no newline", () => {
    // MEASURED by a Codex review, with its own Node reproduction: the append wrote `${encoded}\n` with no
    // leading separator, so a file whose last line lacked a trailing newline — which `readJsonlLines`
    // accepts and reads correctly — took the next record concatenated onto it as `}{`, and neither row
    // parsed afterwards. A `failed` record silently becoming unreadable is the worst shape this store has.
    const home = mkdtempSync(join(tmpdir(), "slopweaver-append-"));
    const first: ImageRecord = { ...BASE, crop: PRODUCER_CROP, outcome: "passed" } as ImageRecord;
    mkdirSync(imageRecordsDir({ home }), { recursive: true });
    writeFileSync(imageRecordPath({ digest: DIGEST, home }), JSON.stringify(first));

    unwrap(
      appendImageRecord({
        home,
        record: { ...BASE, ...FAILURE, crop: REVIEWER_CROP, outcome: "failed" } as ImageRecord,
      }),
    );

    const read = unwrap(readImageRecords({ digest: DIGEST, home }));
    expect(read.map((record) => record.outcome)).toEqual(["passed", "failed"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("writes the first record of a fresh file with no leading blank line", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-append-fresh-"));

    unwrap(appendImageRecord({ home, record: { ...BASE, crop: PRODUCER_CROP, outcome: "passed" } as ImageRecord }));

    expect(unwrap(readImageRecords({ digest: DIGEST, home })).length).toBe(1);
    expect(readFileSync(imageRecordPath({ digest: DIGEST, home }), "utf8").startsWith("{")).toBe(true);
    rmSync(home, { force: true, recursive: true });
  });
});
