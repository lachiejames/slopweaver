import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import type { ReviewedImage } from "../../../../admit/reviewVerdict.js";
import type { SlackUpload } from "../../../../corpus/slack/writeTransport.js";
import {
  attachedReviewImages,
  bindAnswerUploads,
  ownedUploads,
  persistUnfitImageObservations,
} from "../../../../live/turn/answerImageObservations.js";
import { TurnErrors, turnErrorLines } from "../../../../live/turn/turnErrors.js";
import { imageDigestOf } from "../../../../visualEvidence/imageIo.js";
import { appendImageRecord, imageRecordPath, readImageRecords } from "../../../../visualEvidence/store.js";
import type { ImageRecord } from "../../../../visualEvidence/types.js";
import { IMAGE_POLICY_VERSION } from "../../../../visualEvidence/types.js";

/** A real 2x2 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
  "base64",
);
/** A second, different real PNG — 3x3 — so a test can tell two attachments apart by their bytes. */
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAF0lEQVR4AWNkYPj/nwEKmBiQABMDEgAAR1UCBM8FsaoAAAAASUVORK5CYII=",
  "base64",
);

const NOW = "2026-09-13T02:00:00.000Z";
const DIGEST_A = imageDigestOf({ bytes: PNG });
const DIGEST_B = imageDigestOf({ bytes: PNG_B });

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-obs-home-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const upload = ({ bytes, filename }: { bytes: Buffer; filename: string }): SlackUpload => ({
  bytes: Uint8Array.from(bytes),
  filename,
});

/** An observation of the 2x2 PNG that names no reason at all — what a typed caller may legally build. */
const reasonless = (over: Partial<ReviewedImage> = {}): ReviewedImage => ({
  artifactDigest: DIGEST_A,
  contextRetained: true,
  legible: false,
  observedContent: "a 4032px-wide full page; the axis labels are a smear at preview size",
  path: "/shots/pool.png",
  targetState: "data",
  ...over,
});

/** The same observation, with the reason a verdict file would have to carry. */
const unfit = (over: Partial<ReviewedImage> = {}): ReviewedImage => ({
  ...reasonless(),
  unfitReason: "illegible",
  ...over,
});

/** Bind the answer's paths to this module's own copies of the uploads — what `offerAnswer` does. */
const boundFor = ({ paths, uploads }: { paths: readonly string[]; uploads: readonly SlackUpload[] }) =>
  bindAnswerUploads({ owned: ownedUploads({ uploads }), paths });

describe("bindAnswerUploads", () => {
  it("pairs each path with the upload in the same position", () => {
    const bound = unwrap(
      boundFor({
        paths: ["/shots/pool.png", "/shots/errors.png"],
        uploads: [upload({ bytes: PNG, filename: "pool.png" }), upload({ bytes: PNG_B, filename: "errors.png" })],
      }),
    );
    expect(attachedReviewImages({ bound })).toEqual([
      { digest: DIGEST_A, path: "/shots/pool.png" },
      { digest: DIGEST_B, path: "/shots/errors.png" },
    ]);
  });

  it("keeps two attachments with the same basename distinct", () => {
    const bound = unwrap(
      boundFor({
        paths: ["/a/shot.png", "/b/shot.png"],
        uploads: [upload({ bytes: PNG, filename: "shot.png" }), upload({ bytes: PNG_B, filename: "shot.png" })],
      }),
    );
    expect(attachedReviewImages({ bound })).toEqual([
      { digest: DIGEST_A, path: "/a/shot.png" },
      { digest: DIGEST_B, path: "/b/shot.png" },
    ]);
  });

  it("refuses when the answer names more images than the send carries", () => {
    const bound = boundFor({
      paths: ["/shots/pool.png", "/shots/errors.png"],
      uploads: [upload({ bytes: PNG, filename: "pool.png" })],
    });
    expect(bound.isErr()).toBe(true);
    expect(bound._unsafeUnwrapErr()).toEqual(TurnErrors.uploadCountMismatch({ paths: 2, uploads: 1 }));
    expect(bound._unsafeUnwrapErr().message).toBe(
      "this answer names 2 image(s) but carries 1 upload(s), so no attachment can be matched to the path it came from",
    );
  });

  it("refuses an upload whose filename is not the basename of its path", () => {
    const bound = boundFor({
      paths: ["/shots/pool.png"],
      uploads: [upload({ bytes: PNG, filename: "errors.png" })],
    });
    expect(bound.isErr()).toBe(true);
    expect(turnErrorLines({ error: bound._unsafeUnwrapErr() })).toEqual([
      `attachment 1 is named "errors.png" but its path is "/shots/pool.png" — the uploads are not in the answer's own image order`,
    ]);
  });

  it("hashes its own copy, so mutating the caller's bytes afterwards changes nothing", () => {
    const original = upload({ bytes: PNG, filename: "pool.png" });
    const owned = ownedUploads({ uploads: [original] });
    original.bytes[0] = 0;
    expect(owned[0]!.digest).toBe(DIGEST_A);
    expect(owned[0]!.upload.bytes[0]).toBe(PNG[0]);
  });
});

/** Narrow a record to the failed arm, so an assertion about `reason` needs no conditional. */
const isFailed = (record: ImageRecord): record is Extract<ImageRecord, { outcome: "failed" }> =>
  record.outcome === "failed";

describe("persistUnfitImageObservations", () => {
  const boundA = () =>
    unwrap(boundFor({ paths: ["/shots/pool.png"], uploads: [upload({ bytes: PNG, filename: "pool.png" })] }));

  /** Every failed record the store holds for the 2x2 PNG. */
  const failures = () => unwrap(readImageRecords({ digest: DIGEST_A, home })).filter(isFailed);

  it("writes nothing when every observation says the picture is fit", async () => {
    const written = await persistUnfitImageObservations({
      attached: boundA(),
      home,
      nowIso: NOW,
      observations: [reasonless({ legible: true })],
      reviewerSession: "reviewer-1",
    });
    expect(written.isOk()).toBe(true);
    expect(unwrap(readImageRecords({ digest: DIGEST_A, home }))).toEqual([]);
  });

  it("records the reviewer's failure against the exact bytes, with what it saw", async () => {
    unwrap(
      await persistUnfitImageObservations({
        attached: boundA(),
        home,
        nowIso: NOW,
        observations: [unfit()],
        reviewerSession: "reviewer-1",
      }),
    );
    const records = unwrap(readImageRecords({ digest: DIGEST_A, home }));
    expect(records.length).toBe(1);
    const record = records[0]!;
    expect(record.outcome).toBe("failed");
    expect(record.artifact).toEqual({ digest: DIGEST_A, heightPx: 2, widthPx: 2 });
    expect(record.crop.kind).toBe("reviewer-unobserved");
    expect(record.readBack.observerSession).toBe("reviewer-1");
    expect(record.readBack.observedAtIso).toBe(NOW);
    expect(record.readBack.observedContent).toBe(unfit().observedContent);
    expect(record.policyVersion).toBe(IMAGE_POLICY_VERSION);
  });

  it("carries the reason the reviewer named, and a correction naming what to do", async () => {
    unwrap(
      await persistUnfitImageObservations({
        attached: boundA(),
        home,
        nowIso: NOW,
        observations: [unfit({ targetState: "empty-panel", unfitReason: "empty-panel" })],
        reviewerSession: "reviewer-1",
      }),
    );
    expect(failures()[0]!.reason).toBe("empty-panel");
    expect(failures()[0]!.correction).toContain("once the panel");
  });

  it("falls back to what it observed when a typed caller supplied no reason", async () => {
    unwrap(
      await persistUnfitImageObservations({
        attached: boundA(),
        home,
        nowIso: NOW,
        observations: [reasonless()],
        reviewerSession: "reviewer-1",
      }),
    );
    expect(failures()[0]!.reason).toBe("illegible");
  });

  it("records the failure for attached BYTES even when the observation names another path", async () => {
    // Found by a Codex review of this change: matching the (path, digest) PAIR here meant the same
    // unreadable PNG, re-attached from a second path, was held once and left with no durable record — so
    // it was admissible again the next time anybody quoted the right path. Coverage asks whether the
    // reviewer looked at the picture the answer NAMES; this asks whether it looked at these BYTES.
    unwrap(
      await persistUnfitImageObservations({
        attached: boundA(),
        home,
        nowIso: NOW,
        observations: [unfit({ path: "/shots/an-older-name.png" })],
        reviewerSession: "reviewer-1",
      }),
    );
    expect(failures().length).toBe(1);
    expect(failures()[0]!.reason).toBe("illegible");
  });

  it("records nothing about bytes this send does not carry, even under a reviewed path", async () => {
    // The picture at `/shots/pool.png` was replaced after review. The observation is about the OLD bytes;
    // the new ones are a different picture that nobody has looked at, and condemning them would be a lie.
    const swapped = unwrap(
      boundFor({ paths: ["/shots/pool.png"], uploads: [upload({ bytes: PNG_B, filename: "pool.png" })] }),
    );
    unwrap(
      await persistUnfitImageObservations({
        attached: swapped,
        home,
        nowIso: NOW,
        observations: [unfit()],
        reviewerSession: "reviewer-1",
      }),
    );
    expect(unwrap(readImageRecords({ digest: DIGEST_B, home }))).toEqual([]);
    expect(unwrap(readImageRecords({ digest: DIGEST_A, home }))).toEqual([]);
  });

  it("does not pile a second row on a digest that already carries a failure", async () => {
    const args = { attached: boundA(), home, nowIso: NOW, observations: [unfit()], reviewerSession: "reviewer-1" };
    unwrap(await persistUnfitImageObservations(args));
    unwrap(await persistUnfitImageObservations(args));
    expect(unwrap(readImageRecords({ digest: DIGEST_A, home })).length).toBe(1);
  });

  it("writes one row for a picture observed unfit twice in one verdict", async () => {
    unwrap(
      await persistUnfitImageObservations({
        attached: boundA(),
        home,
        nowIso: NOW,
        observations: [unfit(), unfit({ unfitReason: "context-lost", contextRetained: false })],
        reviewerSession: "reviewer-1",
      }),
    );
    expect(unwrap(readImageRecords({ digest: DIGEST_A, home })).length).toBe(1);
  });

  it("still condemns the second picture when the FIRST one's record file is unreadable", async () => {
    // Found by a Codex review of this change: returning on the first error left every later unfit picture
    // unrecorded even where its own store was fine, so one corrupt file decided whether an unrelated
    // picture was condemned. Both errors come back, and the send is still refused.
    const bound = unwrap(
      boundFor({
        paths: ["/shots/pool.png", "/shots/errors.png"],
        uploads: [upload({ bytes: PNG, filename: "pool.png" }), upload({ bytes: PNG_B, filename: "errors.png" })],
      }),
    );
    mkdirSync(join(home, "visual-evidence", "records"), { recursive: true });
    writeFileSync(join(home, "visual-evidence", "records", `${DIGEST_A.replace("sha256:", "")}.jsonl`), "{ not json\n");

    const written = await persistUnfitImageObservations({
      attached: bound,
      home,
      nowIso: NOW,
      observations: [unfit(), unfit({ artifactDigest: DIGEST_B, path: "/shots/errors.png" })],
      reviewerSession: "reviewer-1",
    });

    expect(written.isErr()).toBe(true);
    expect(written._unsafeUnwrapErr().code).toBe("IMAGE_OBSERVATIONS_UNRECORDED");
    expect(written._unsafeUnwrapErr().message).toContain("could not read the image records for pool.png");
    expect(unwrap(readImageRecords({ digest: DIGEST_B, home })).filter(isFailed).length).toBe(1);
  });

  it("reports the store's own failure rather than claiming the bytes were refused", async () => {
    // A plain FILE where the records DIRECTORY has to be: the append cannot succeed and must say so.
    writeFileSync(join(home, "visual-evidence"), "not a directory");
    const written = await persistUnfitImageObservations({
      attached: boundA(),
      home,
      nowIso: NOW,
      observations: [unfit()],
      reviewerSession: "reviewer-1",
    });
    expect(written.isErr()).toBe(true);
    expect(written._unsafeUnwrapErr().code).toBe("IMAGE_OBSERVATIONS_UNRECORDED");
    expect(turnErrorLines({ error: written._unsafeUnwrapErr() })[0]).toContain("pool.png");
  });

  it("skips a digest an earlier look already failed, and leaves that row exactly as it was", async () => {
    const existing: ImageRecord = {
      artifact: { digest: DIGEST_A, heightPx: 2, widthPx: 2 },
      correction: "re-capture once the panel has rendered",
      crop: { kind: "already-framed", reason: "a tiny test artifact has nothing to crop" },
      outcome: "failed",
      policyVersion: IMAGE_POLICY_VERSION,
      readBack: {
        contextRetained: true,
        observedAtIso: NOW,
        observedContent: "an empty panel",
        observerSession: "the composer",
        targetState: "empty-panel",
      },
      reason: "empty-panel",
      receiptId: "img-existing",
      schemaVersion: 1,
    };
    unwrap(appendImageRecord({ home, record: existing }));
    unwrap(
      await persistUnfitImageObservations({
        attached: boundA(),
        home,
        nowIso: NOW,
        observations: [unfit()],
        reviewerSession: "reviewer-1",
      }),
    );
    expect(unwrap(readImageRecords({ digest: DIGEST_A, home }))).toEqual([existing]);
    expect(imageRecordPath({ digest: DIGEST_A, home })).toContain(DIGEST_A.replace("sha256:", ""));
  });
});

describe("persistUnfitImageObservations needs no path binding", () => {
  it("condemns the bytes even when the answer's paths and its uploads have come apart", async () => {
    // Found by a Codex review of this change: persisting used to run only AFTER `bindAnswerUploads`
    // succeeded, so the one case where the bytes are certainly real and the paths certainly are not left
    // an unreadable picture unrecorded. Which bytes these are needs no path at all.
    const home2 = mkdtempSync(join(tmpdir(), "slopweaver-obs-nopath-"));
    const mismatched = boundFor({
      paths: ["/shots/pool.png"],
      uploads: [upload({ bytes: PNG, filename: "renamed.png" })],
    });
    expect(mismatched.isErr()).toBe(true);

    unwrap(
      await persistUnfitImageObservations({
        attached: ownedUploads({ uploads: [upload({ bytes: PNG, filename: "renamed.png" })] }),
        home: home2,
        nowIso: NOW,
        observations: [unfit()],
        reviewerSession: "reviewer-1",
      }),
    );

    expect(unwrap(readImageRecords({ digest: DIGEST_A, home: home2 })).filter(isFailed).length).toBe(1);
    rmSync(home2, { force: true, recursive: true });
  });
});

describe("persistUnfitImageObservations reads the row's own digest", () => {
  it("still records the failure when the digest's file holds a record about OTHER bytes", async () => {
    // Found by a Codex review of this change: the skip asked only whether SOME row in the file had failed,
    // and `readImageRecords` validates a row against the schema rather than against the filename — so a
    // misfiled record read as "these bytes already failed" and suppressed the append.
    const misfiled: ImageRecord = {
      artifact: { digest: DIGEST_B, heightPx: 3, widthPx: 3 },
      correction: "re-capture",
      crop: { kind: "already-framed", reason: "a tiny test artifact has nothing to crop" },
      outcome: "failed",
      policyVersion: IMAGE_POLICY_VERSION,
      readBack: {
        contextRetained: true,
        observedAtIso: NOW,
        observedContent: "a different picture entirely",
        observerSession: "someone-else",
        targetState: "empty-panel",
      },
      reason: "empty-panel",
      receiptId: "img-misfiled",
      schemaVersion: 1,
    };
    mkdirSync(join(home, "visual-evidence", "records"), { recursive: true });
    writeFileSync(
      join(home, "visual-evidence", "records", `${DIGEST_A.replace("sha256:", "")}.jsonl`),
      `${JSON.stringify(misfiled)}\n`,
    );

    unwrap(
      await persistUnfitImageObservations({
        attached: ownedUploads({ uploads: [upload({ bytes: PNG, filename: "pool.png" })] }),
        home,
        nowIso: NOW,
        observations: [unfit()],
        reviewerSession: "reviewer-1",
      }),
    );

    const failed = unwrap(readImageRecords({ digest: DIGEST_A, home })).filter(isFailed);
    expect(failed.map((record) => record.artifact.digest)).toEqual([DIGEST_B, DIGEST_A]);
  });
});
