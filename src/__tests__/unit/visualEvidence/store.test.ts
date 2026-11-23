import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { imageAdmissionVerdict } from "../../../visualEvidence/admission.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { identifyImageBytes, imageDigestOf } from "../../../visualEvidence/imageIo.js";
import {
  appendImageRecord,
  imageRecordPath,
  imageRecordsDir,
  readImageRecords,
  recordReadFailure,
} from "../../../visualEvidence/store.js";
import type { ImageRecord } from "../../../visualEvidence/types.js";
import { IMAGE_POLICY_VERSION } from "../../../visualEvidence/types.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-ve-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A 2x2 PNG, encoded here rather than fixtured so the decode under test is over real bytes. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
  "base64",
);

const recordFor = ({ digest, over = {} }: { digest: string; over?: Partial<ImageRecord> }): ImageRecord =>
  ({
    artifact: { digest, heightPx: 2, widthPx: 2 },
    crop: { kind: "already-framed", reason: "a 2x2 test artifact has nothing to crop" },
    outcome: "passed",
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: true,
      observedAtIso: "2026-09-13T01:00:00.000Z",
      observedContent: "four pixels",
      observerSession: "unit-test",
      targetState: "data",
    },
    receiptId: "rec-1",
    schemaVersion: 1,
    ...over,
  }) as ImageRecord;

describe("identifyImageBytes", () => {
  it("decodes real PNG bytes to their exact dimensions and digest", async () => {
    const identity = unwrap(await identifyImageBytes({ bytes: TINY_PNG }));
    expect(identity.widthPx).toBe(2);
    expect(identity.heightPx).toBe(2);
    expect(identity.digest).toBe(imageDigestOf({ bytes: TINY_PNG }));
    expect(identity.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses bytes that are not an image at all", async () => {
    const result = await identifyImageBytes({ bytes: Buffer.from("this is not a png", "utf8") });
    expect(visualEvidenceErrorLines({ error: unwrapErr(result) })).toEqual([
      "these 17 bytes could not be decoded as an image: Could not find MIME for Buffer",
    ]);
  });

  it("refuses a truncated PNG — the header alone is not a renderable image", async () => {
    const result = await identifyImageBytes({ bytes: TINY_PNG.subarray(0, 20) });
    // The decoder's own wording after the colon belongs to the image library, so only this module's half is pinned.
    const refusals = visualEvidenceErrorLines({ error: unwrapErr(result) });
    expect(refusals.length).toBe(1);
    expect(refusals[0]!.split(": ")[0]).toBe("these 20 bytes could not be decoded as an image");
  });

  it("decodes by CONTENT, so a PNG named .txt is still governed", async () => {
    const identity = unwrap(await identifyImageBytes({ bytes: TINY_PNG }));
    expect(identity.widthPx).toBe(2);
  });

  it("gives identical bytes an identical digest, and different bytes a different one", async () => {
    const a = unwrap(await identifyImageBytes({ bytes: TINY_PNG }));
    const b = unwrap(await identifyImageBytes({ bytes: Buffer.from(TINY_PNG) }));
    expect(b.digest).toBe(a.digest);
    expect(imageDigestOf({ bytes: Buffer.from("other", "utf8") })).not.toBe(a.digest);
  });
});

describe("the record store", () => {
  it("reads back nothing for a digest it has never seen", () => {
    expect(unwrap(readImageRecords({ digest: `sha256:${"0".repeat(64)}`, home }))).toEqual([]);
  });

  it("round-trips one record through a real file", () => {
    const digest = imageDigestOf({ bytes: TINY_PNG });
    const record = recordFor({ digest });
    expect(unwrap(appendImageRecord({ home, record }))).toBeNull();
    expect(unwrap(readImageRecords({ digest, home }))).toEqual([record]);
  });

  it("appends rather than replaces, keeping both looks in order", () => {
    const digest = imageDigestOf({ bytes: TINY_PNG });
    const first = recordFor({ digest });
    const second = recordFor({
      digest,
      over: { correction: "re-capture it", outcome: "failed", reason: "empty-panel" },
    });
    unwrap(appendImageRecord({ home, record: first }));
    unwrap(appendImageRecord({ home, record: second }));
    const held = unwrap(readImageRecords({ digest, home }));
    expect(held).toHaveLength(2);
    expect(held[0]!.outcome).toBe("passed");
    expect(held[1]!.outcome).toBe("failed");
  });

  it("files a record under its own digest, so the path carries no path or receipt", () => {
    const digest = `sha256:${"c".repeat(64)}`;
    expect(imageRecordPath({ digest, home })).toBe(join(imageRecordsDir({ home }), `${"c".repeat(64)}.jsonl`));
  });

  it("reports a malformed line as UNBELIEVABLE, never as absent", () => {
    const digest = `sha256:${"d".repeat(64)}`;
    mkdirSync(imageRecordsDir({ home }), { recursive: true });
    writeFileSync(imageRecordPath({ digest, home }), "{not json at all\n", "utf8");
    const result = readImageRecords({ digest, home });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_EVIDENCE_INVALID");
  });

  it("reports a record missing its observation as unbelievable — a strict schema, not a lenient one", () => {
    const digest = `sha256:${"e".repeat(64)}`;
    mkdirSync(imageRecordsDir({ home }), { recursive: true });
    const withoutReadBack = {
      artifact: { digest, heightPx: 2, widthPx: 2 },
      crop: { kind: "already-framed", reason: "x" },
      outcome: "passed",
      policyVersion: 1,
      receiptId: "rec-1",
      schemaVersion: 1,
    };
    writeFileSync(imageRecordPath({ digest, home }), `${JSON.stringify(withoutReadBack)}\n`, "utf8");
    const result = readImageRecords({ digest, home });
    expect(unwrapErr(result).code).toBe("IMAGE_EVIDENCE_INVALID");
    expect(unwrapErr(result).message).toContain("expected object, received undefined");
  });

  it("refuses to WRITE a record its own reader would not believe — the write edge runs the read schema", () => {
    // MEASURED: a bare hex `crop.sourceDigest` was written and printed `passed`, and the
    // read-back refused the whole file. `ImageRecord` types the digest as `string`, so the bad value has to
    // be cast in here — which is exactly why the type alone could not stop it.
    const digest = imageDigestOf({ bytes: TINY_PNG });
    const record = recordFor({
      digest,
      over: { crop: { kind: "cropped", rect: { height: 1, width: 1, x: 0, y: 0 }, sourceDigest: "39cc95c7" } },
    });
    const result = appendImageRecord({ home, record });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_EVIDENCE_INVALID");
    expect(result._unsafeUnwrapErr().message).toBe(
      "the read-back record for this image cannot be believed: crop.sourceDigest: expected sha256:<64 hex>",
    );
    expect(existsSync(imageRecordPath({ digest, home }))).toBe(false);
    expect(unwrap(readImageRecords({ digest, home }))).toEqual([]);
  });

  it("writes a cropped record whose sourceDigest is well-formed, and reads it back whole", () => {
    const digest = imageDigestOf({ bytes: TINY_PNG });
    const sourceDigest = `sha256:${"a".repeat(64)}`;
    const record = recordFor({
      digest,
      over: { crop: { kind: "cropped", rect: { height: 1, width: 1, x: 0, y: 0 }, sourceDigest } },
    });
    expect(unwrap(appendImageRecord({ home, record }))).toBeNull();
    expect(unwrap(readImageRecords({ digest, home }))).toEqual([record]);
  });

  it("ignores blank lines rather than calling them corrupt", () => {
    const digest = imageDigestOf({ bytes: TINY_PNG });
    unwrap(appendImageRecord({ home, record: recordFor({ digest }) }));
    const path = imageRecordPath({ digest, home });
    writeFileSync(path, `\n${JSON.stringify(recordFor({ digest }))}\n\n`, "utf8");
    expect(unwrap(readImageRecords({ digest, home }))).toHaveLength(1);
  });
});

describe("the store and admission together, over real bytes", () => {
  it("admits a PNG whose recorded pass matches its decoded identity", async () => {
    const identity = unwrap(await identifyImageBytes({ bytes: TINY_PNG }));
    unwrap(appendImageRecord({ home, record: recordFor({ digest: identity.digest }) }));
    const records = unwrap(readImageRecords({ digest: identity.digest, home }));
    const verdict = imageAdmissionVerdict({
      evidence: [{ artifact: identity, records, ref: { artifactDigest: identity.digest, path: "/tmp/tiny.png" } }],
    });
    expect(verdict).toEqual({ kind: "admitted" });
  });

  it("holds the same PNG once a look records it empty-panelled, with no override offered", async () => {
    const identity = unwrap(await identifyImageBytes({ bytes: TINY_PNG }));
    unwrap(
      appendImageRecord({
        home,
        record: recordFor({
          digest: identity.digest,
          over: { correction: "wait for the panel, then crop", outcome: "failed", reason: "empty-panel" },
        }),
      }),
    );
    const records = unwrap(readImageRecords({ digest: identity.digest, home }));
    const verdict = imageAdmissionVerdict({
      evidence: [{ artifact: identity, records, ref: { artifactDigest: identity.digest, path: "/tmp/tiny.png" } }],
    });
    expect(verdict.kind).toBe("known-bad");
    const findings = verdict.kind === "known-bad" ? verdict.findings : [];
    expect(findings[0]!.severity).toBe("hold");
    expect(Object.hasOwn(findings[0]!, "override")).toBe(false);
  });

  it("finds that same failure under a different filename and with no receipt cited", async () => {
    const identity = unwrap(await identifyImageBytes({ bytes: TINY_PNG }));
    unwrap(
      appendImageRecord({
        home,
        record: recordFor({
          digest: identity.digest,
          over: { correction: "wait for the panel", outcome: "failed", reason: "unloaded" },
        }),
      }),
    );
    const records = unwrap(readImageRecords({ digest: identity.digest, home }));
    const verdict = imageAdmissionVerdict({
      evidence: [
        { artifact: identity, records, ref: { artifactDigest: identity.digest, path: "/tmp/renamed-innocent.png" } },
      ],
    });
    expect(verdict.kind).toBe("known-bad");
  });
});

// The r3 finding: `existsSync` read an unreadable record as an absent one, handing a known-bad image the
// hatchable arm. Tested here as a pure classification rather than with `chmod 000`, because root ignores
// directory permissions and a permission test would pass silently in a container.
describe("recordReadFailure — only a genuine ENOENT is absence", () => {
  const errno = ({ code }: { code: string }): Error => Object.assign(new Error(code), { code });

  it("treats ENOENT as absent, the one case the hatch may apply to", () => {
    expect(recordReadFailure({ error: errno({ code: "ENOENT" }) })).toBe("absent");
  });

  it("fails closed on EACCES — a present record the process cannot search to", () => {
    expect(recordReadFailure({ error: errno({ code: "EACCES" }) })).toBe("unreadable");
  });

  it("fails closed on ENOTDIR — a file where the records directory should be", () => {
    expect(recordReadFailure({ error: errno({ code: "ENOTDIR" }) })).toBe("unreadable");
  });

  it("fails closed on EIO", () => {
    expect(recordReadFailure({ error: errno({ code: "EIO" }) })).toBe("unreadable");
  });

  it("fails closed on an error carrying no code at all", () => {
    expect(recordReadFailure({ error: new Error("something odd") })).toBe("unreadable");
  });

  it("fails closed on a thrown value that is not an error", () => {
    expect(recordReadFailure({ error: "a string" })).toBe("unreadable");
  });
});
