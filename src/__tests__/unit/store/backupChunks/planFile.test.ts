/**
 * The chunk store under the backup: cutting a file on disk the way the whole-buffer rule cuts it, and naming the file
 * it could not read.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { chunkLengths } from "../../../../store/backup/chunkBoundaries.js";
import { planFileChunks } from "../../../../store/backup/chunks.js";

import { chunkDigests, MIB, noise, scratchDirectory, useScratchDirectories } from "./harness.js";

useScratchDirectories();

describe("cutting a file on disk", () => {
  it("cuts a file exactly as the whole-buffer rule does, and digests it whole on the way", () => {
    const data = noise({ bytes: 20 * MIB + 17, seed: 5 });
    const path = join(scratchDirectory(), "file");
    writeFileSync(path, data);
    const planned = unwrap(planFileChunks({ encoding: "zstd", path }));
    expect(planned.bytes).toBe(data.length);
    expect(planned.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(planned.content.chunks.map((chunk) => chunk.sha256)).toEqual(chunkDigests({ data }));
    expect(planned.content.chunks.map((chunk) => chunk.bytes)).toEqual(chunkLengths({ data }));
    expect(planned.content.encoding).toBe("zstd");
  });

  it("names the file it could not read", () => {
    const path = join(scratchDirectory(), "absent");
    const failed = unwrapErr(planFileChunks({ encoding: "identity", path }));
    expect(failed.code).toBe("CHUNK_PLAN_FAILED");
    expect(failed.message).toContain(path);
  });
});
