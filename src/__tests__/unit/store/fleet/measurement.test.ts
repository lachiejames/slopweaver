/**
 * One measurement file as its rows: which class a path is, where its body is placed, how a walk folds, what a
 * re-run still uploads, and where a restore may write.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import {
  foldMeasurements,
  INLINE_BODY_MAX_BYTES,
  isSkippedMeasurementName,
  locationsToRecord,
  MEASUREMENT_ROOT_PREFIXES,
  measurementClassOf,
  mediaTypeOf,
  projectMeasurementFile,
  restoreTarget,
  uploadsNeeded,
} from "../../../../store/fleet/measurement.js";
import { measurementRoots } from "../../../../store/fleet/measurementFiles.js";
import { MEASUREMENT_CLASSES } from "../../../../store/schema/measurement.js";

const MTIME = new Date("2026-09-25T01:02:03.000Z");

/** The hex sha-256 of some bytes. */
function sha({ bytes }: { bytes: Uint8Array }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Project one file, unwrapping a success. */
function project({ text, bytes, relativePath }: { text?: string; bytes?: Uint8Array; relativePath: string }) {
  if (bytes !== undefined) {
    return unwrap(projectMeasurementFile({ bytes, fileModifiedAt: MTIME, relativePath }));
  }
  return unwrap(projectMeasurementFile({ bytes: Buffer.from(text!, "utf8"), fileModifiedAt: MTIME, relativePath }));
}

describe("MEASUREMENT_ROOT_PREFIXES", () => {
  it("names the same roots the state-home contract resolves, class for class", () => {
    const home = "/h";
    const roots = measurementRoots({ home });

    expect(MEASUREMENT_CLASSES.length).toBeGreaterThan(0);
    expect(MEASUREMENT_CLASSES.map((c) => join(home, MEASUREMENT_ROOT_PREFIXES[c]))).toEqual(
      MEASUREMENT_CLASSES.map((c) => roots[c]),
    );
    expect(roots.evidence).toBe(stateHomePaths({ home }).evidenceDir);
  });
});

describe("measurementClassOf", () => {
  it("reads the class from the first segment", () => {
    expect(measurementClassOf({ relativePath: "proof/1263/gold.md" })).toBe("proof");
    expect(measurementClassOf({ relativePath: "datadog-shots/a.png" })).toBe("datadog-shots");
  });

  it("refuses a root on its own, another directory, and any dot segment", () => {
    expect(measurementClassOf({ relativePath: "proof" })).toBe(undefined);
    expect(measurementClassOf({ relativePath: "datadog/hits.jsonl" })).toBe(undefined);
    expect(measurementClassOf({ relativePath: "proof/../secrets/x" })).toBe(undefined);
    expect(measurementClassOf({ relativePath: "proof//x" })).toBe(undefined);
  });
});

describe("mediaTypeOf and isSkippedMeasurementName", () => {
  it("maps a known extension case-insensitively and anything else to octet-stream", () => {
    expect(mediaTypeOf({ relativePath: "evidence/a/Shot.PNG" })).toBe("image/png");
    expect(mediaTypeOf({ relativePath: "proof/x.md" })).toBe("text/markdown");
    expect(mediaTypeOf({ relativePath: "proof/x.bin" })).toBe("application/octet-stream");
    expect(mediaTypeOf({ relativePath: "proof/.hidden" })).toBe("application/octet-stream");
  });

  it("skips Finder's folder state and nothing else", () => {
    expect(isSkippedMeasurementName({ fileName: ".DS_Store" })).toBe(true);
    expect(isSkippedMeasurementName({ fileName: "gold.md" })).toBe(false);
  });
});

describe("projectMeasurementFile", () => {
  it("holds exact UTF-8 text inline, hashed as given", () => {
    const text = "gold\r\nwitness\n";
    const projected = project({ relativePath: "proof/1263/gold.md", text });

    expect(projected.blob).toEqual({
      body: text,
      bodySha256: sha({ bytes: Buffer.from(text, "utf8") }),
      byteLength: Buffer.byteLength(text),
      mediaType: "text/markdown",
      placement: "inline",
    });
    expect(projected.location).toEqual({
      bodySha256: projected.blob.bodySha256,
      fileModifiedAt: MTIME,
      measurementClass: "proof",
      relativePath: "proof/1263/gold.md",
    });
    expect(projected.upload).toBe(undefined);
  });

  it("sends bytes that are not UTF-8 to Storage whatever the extension says", () => {
    const bytes = Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]);
    const projected = project({ bytes, relativePath: "bakeoff/lap1/replies/a.json" });

    expect(projected.blob.placement).toBe("storage");
    expect(projected.blob.body).toBe(null);
    expect(projected.upload).toEqual({ bytes, contentType: "application/json", key: sha({ bytes }) });
  });

  it("sends a NUL-bearing body to Storage, since a text column refuses it", () => {
    const projected = project({ relativePath: "evidence/a.txt", text: "a\u0000b" });

    expect(projected.blob.placement).toBe("storage");
  });

  it("sends a body past the inline cap to Storage without decoding it", () => {
    const bytes = new Uint8Array(INLINE_BODY_MAX_BYTES + 1).fill(0x61);
    const projected = project({ bytes, relativePath: "evidence/big.txt" });

    expect(projected.blob.placement).toBe("storage");
    expect(projected.blob.byteLength).toBe(INLINE_BODY_MAX_BYTES + 1);
  });

  it("holds a body exactly AT the cap inline", () => {
    const bytes = new Uint8Array(INLINE_BODY_MAX_BYTES).fill(0x61);

    expect(project({ bytes, relativePath: "evidence/edge.txt" }).blob.placement).toBe("inline");
  });

  it("holds an empty file inline", () => {
    const projected = project({ relativePath: "proof/empty.txt", text: "" });

    expect(projected.blob.placement).toBe("inline");
    expect(projected.blob.body).toBe("");
    expect(projected.blob.byteLength).toBe(0);
  });

  it("refuses a path outside the four roots, naming it", () => {
    const refused = projectMeasurementFile({
      bytes: Buffer.from("x"),
      fileModifiedAt: MTIME,
      relativePath: "datadog/hits.jsonl",
    });

    expect(unwrapErr(refused).code).toBe("UNSTORABLE_MEASUREMENT");
    expect(unwrapErr(refused).message).toContain("datadog/hits.jsonl");
  });
});

describe("foldMeasurements and uploadsNeeded", () => {
  it("keeps each body and upload once and every location", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff]);
    const folded = foldMeasurements({
      projected: [
        project({ relativePath: "proof/a.md", text: "same" }),
        project({ relativePath: "evidence/b.md", text: "same" }),
        project({ bytes: png, relativePath: "evidence/s.png" }),
        project({ bytes: png, relativePath: "datadog-shots/s.png" }),
      ],
    });

    expect(folded.blobs.map((blob) => blob.placement)).toEqual(["inline", "storage"]);
    expect(folded.uploads.map((upload) => upload.key)).toEqual([sha({ bytes: png })]);
    expect(folded.locations.map((location) => location.relativePath)).toEqual([
      "proof/a.md",
      "evidence/b.md",
      "evidence/s.png",
      "datadog-shots/s.png",
    ]);
  });

  it("uploads nothing a re-run finds already held", () => {
    const png = Uint8Array.from([0xff, 0x00]);
    const other = Uint8Array.from([0xfe, 0x00]);
    const folded = foldMeasurements({
      projected: [
        project({ bytes: png, relativePath: "evidence/a.png" }),
        project({ bytes: other, relativePath: "evidence/b.png" }),
      ],
    });

    expect(uploadsNeeded({ folded, heldShas: new Set([sha({ bytes: png })]) }).map((u) => u.key)).toEqual([
      sha({ bytes: other }),
    ]);
    expect(uploadsNeeded({ folded, heldShas: new Set(folded.uploads.map((u) => u.key)) })).toEqual([]);
  });
});

describe("restoreTarget", () => {
  it("joins a stored path under the target directory", () => {
    expect(unwrap(restoreTarget({ into: "/tmp/r", relativePath: "proof/1263/gold.md" }))).toBe(
      join("/tmp/r", "proof", "1263", "gold.md"),
    );
  });

  it.each([["../x"], ["/etc/passwd"], ["proof/../../x"], ["proof/./x"], ["datadog/hits.jsonl"]])(
    "refuses %s — an escape, an absolute path, an unnormalised one, or one outside the roots",
    (relativePath) => {
      expect(unwrapErr(restoreTarget({ into: "/tmp/r", relativePath })).path).toBe(relativePath);
    },
  );
});

describe("locationsToRecord", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const at = ({ bodySha256 }: { bodySha256: string }) => ({
    bodySha256,
    fileModifiedAt: new Date("2026-09-25T00:00:00.000Z"),
    measurementClass: "proof",
    relativePath: "proof/gold.md",
  });

  it("records a path the store has never seen", () => {
    expect(locationsToRecord({ current: new Map(), locations: [at({ bodySha256: A })] })).toEqual([
      at({ bodySha256: A }),
    ]);
  });

  it("records nothing for a path already showing this body, so a re-run writes zero", () => {
    expect(locationsToRecord({ current: new Map([["proof/gold.md", A]]), locations: [at({ bodySha256: A })] })).toEqual(
      [],
    );
  });

  it("records a file that went back to an earlier body again, so it becomes the newest", () => {
    expect(locationsToRecord({ current: new Map([["proof/gold.md", B]]), locations: [at({ bodySha256: A })] })).toEqual(
      [at({ bodySha256: A })],
    );
  });
});
