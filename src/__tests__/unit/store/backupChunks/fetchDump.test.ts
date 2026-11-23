/**
 * The chunk store under the backup: fetching a backup's dump, whole for a version-1 manifest and rebuilt from its
 * chunks for a version-2 one, and the manifests it refuses rather than guesses at.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { CHUNK_MAX_BYTES, CHUNK_MIN_BYTES } from "../../../../store/backup/chunkBoundaries.js";
import { fetchDump } from "../../../../store/backup/chunkRestore.js";
import { planFileChunks } from "../../../../store/backup/chunks.js";
import { chunkInventory, sendContentChunks } from "../../../../store/backup/chunkUpload.js";
import { BACKUP_FILES, SUPABASE_PROJECT_ID } from "../../../../store/backup/plan.js";

import { directoryTransport } from "../directoryTransport.js";
import { NO_BACKOFF, noise, scratchDirectory, useScratchDirectories } from "./harness.js";

useScratchDirectories();

describe("fetching a backup's dump", () => {
  it("downloads a version-1 dump whole, as it was sent", async () => {
    const directory = scratchDirectory();
    const transport = directoryTransport({ root: join(directory, "bucket") });
    mkdirSync(join(directory, "bucket", "slopweaver", "x"), { recursive: true });
    writeFileSync(join(directory, "bucket", "slopweaver", "x", BACKUP_FILES.dump), "PGDMP whole");
    const local = join(directory, "local");
    mkdirSync(local);
    writeFileSync(
      join(local, BACKUP_FILES.manifest),
      JSON.stringify({ dump: { bytes: 11, sha256: "0".repeat(64) }, version: 1 }),
    );
    unwrap(await fetchDump({ directory: local, prefix: "slopweaver/x/", transport }));
    expect(readFileSync(join(local, BACKUP_FILES.dump), "utf8")).toBe("PGDMP whole");
  });

  it("rebuilds a version-2 dump from its chunks, and removes one whose chunk list is short of the dump", async () => {
    const directory = scratchDirectory();
    const transport = directoryTransport({ root: join(directory, "bucket") });
    const scratch = join(directory, "scratch");
    mkdirSync(scratch);
    const path = join(directory, "source.dump");
    const data = noise({ bytes: CHUNK_MAX_BYTES + CHUNK_MIN_BYTES, seed: 11 });
    writeFileSync(path, data);
    const { content } = unwrap(planFileChunks({ encoding: "zstd", path }));
    const stored = unwrap(await chunkInventory({ encoding: "zstd", project: SUPABASE_PROJECT_ID, transport }));
    unwrap(
      await sendContentChunks({
        content,
        path,
        project: SUPABASE_PROJECT_ID,
        retry: NO_BACKOFF,
        scratch,
        stored,
        transport,
      }),
    );
    const dump = { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    const whole = join(directory, "whole");
    mkdirSync(whole);
    writeFileSync(join(whole, BACKUP_FILES.manifest), JSON.stringify({ dump: { ...dump, chunked: content } }));
    unwrap(await fetchDump({ directory: whole, prefix: "slopweaver/x/", transport }));
    expect(readFileSync(join(whole, BACKUP_FILES.dump)).equals(data)).toBe(true);

    const short = join(directory, "short");
    mkdirSync(short);
    const truncated = { ...content, chunks: content.chunks.slice(0, 1) };
    expect(content.chunks.length).toBeGreaterThan(1);
    writeFileSync(join(short, BACKUP_FILES.manifest), JSON.stringify({ dump: { ...dump, chunked: truncated } }));
    const refused = unwrapErr(await fetchDump({ directory: short, prefix: "slopweaver/x/", transport }));
    expect(refused[0]).toContain("removed rather than left at its path");
    expect(existsSync(join(short, BACKUP_FILES.dump))).toBe(false);

    const missing = join(directory, "missing");
    mkdirSync(missing);
    writeFileSync(join(missing, BACKUP_FILES.dump), "an earlier restore's dump");
    const absent = { ...content, chunks: [{ bytes: 1, sha256: "f".repeat(64) }] };
    writeFileSync(join(missing, BACKUP_FILES.manifest), JSON.stringify({ dump: { ...dump, chunked: absent } }));
    expect(unwrapErr(await fetchDump({ directory: missing, prefix: "slopweaver/x/", transport })).length).toBe(1);
    expect(existsSync(join(missing, BACKUP_FILES.dump))).toBe(false);
  });

  it("names a manifest whose dump chunk list it cannot read, rather than guessing the dump is whole", async () => {
    const directory = scratchDirectory();
    writeFileSync(
      join(directory, BACKUP_FILES.manifest),
      JSON.stringify({ dump: { chunked: { chunking: "other", chunks: [], encoding: "identity" } } }),
    );
    const refused = unwrapErr(
      await fetchDump({
        directory,
        prefix: "slopweaver/x/",
        transport: directoryTransport({ root: join(directory, "bucket") }),
      }),
    );
    expect(refused[0]).toContain("names no readable dump");
  });
});
