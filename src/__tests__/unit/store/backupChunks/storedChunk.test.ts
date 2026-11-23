/**
 * The chunk store under the backup: a stored chunk's zstd round trip, and each way a stored chunk is refused rather
 * than decoded.
 */
import { createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { CHUNK_MAX_BYTES } from "../../../../store/backup/chunkBoundaries.js";
import { decodeChunk, encodeChunk } from "../../../../store/backup/chunks.js";

describe("a stored chunk", () => {
  const raw = Buffer.from('{"id":"a"}\n'.repeat(5000));
  const chunk = { bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") };

  it("round-trips through zstd, smaller than it went in, and is left alone as identity", () => {
    const stored = encodeChunk({ encoding: "zstd", raw });
    expect(stored.length).toBeLessThan(raw.length / 10);
    expect(unwrap(decodeChunk({ chunk, encoding: "zstd", objectName: "o", stored }))).toEqual(raw);
    expect(encodeChunk({ encoding: "identity", raw })).toBe(raw);
  });

  it("is refused when it decodes to other bytes than its name promises", () => {
    const other = encodeChunk({ encoding: "zstd", raw: Buffer.from("other bytes") });
    const refused = unwrapErr(decodeChunk({ chunk, encoding: "zstd", objectName: "o", stored: other }));
    expect(refused.code).toBe("CHUNK_CORRUPT");
    expect(refused.message).toContain("decodes to 11 byte(s)");
  });

  it("is refused when it is not zstd at all", () => {
    const refused = unwrapErr(decodeChunk({ chunk, encoding: "zstd", objectName: "o", stored: Buffer.from("junk") }));
    expect(refused.code).toBe("CHUNK_CORRUPT");
    expect(refused.message).toContain("will not decode as zstd");
  });

  it("is refused rather than inflated when it claims more than the largest chunk", () => {
    const bomb = zstdCompressSync(Buffer.alloc(CHUNK_MAX_BYTES + 1));
    const refused = unwrapErr(decodeChunk({ chunk, encoding: "zstd", objectName: "o", stored: bomb }));
    expect(refused.code).toBe("CHUNK_CORRUPT");
  });
});
