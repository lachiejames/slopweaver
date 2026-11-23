/**
 * The chunk store under the backup: a send-then-rebuild over a directory standing in for the destination, and the
 * refusals that keep a changed source or a corrupt chunk from landing.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { ChunkErrors } from "../../../../store/backup/chunkErrors.js";
import { chunkObjectName } from "../../../../store/backup/chunkPlan.js";
import { rebuildChunkedFile } from "../../../../store/backup/chunkRestore.js";
import { planFileChunks } from "../../../../store/backup/chunks.js";
import { chunkInventory, sendContentChunks } from "../../../../store/backup/chunkUpload.js";
import { SUPABASE_PROJECT_ID } from "../../../../store/backup/plan.js";

import { directoryTransport } from "../directoryTransport.js";
import { MIB, NO_BACKOFF, noise, scratchDirectory, useScratchDirectories } from "./harness.js";

useScratchDirectories();

describe("sending and rebuilding a chunked file", () => {
  it("sends every chunk once, holds them all the next night, and rebuilds the file byte for byte", async () => {
    const directory = scratchDirectory();
    const transport = directoryTransport({ root: join(directory, "bucket") });
    const scratch = join(directory, "scratch");
    mkdirSync(scratch);
    const path = join(directory, "compact.jsonl");
    writeFileSync(path, noise({ bytes: 12 * MIB, seed: 6 }));
    const { content } = unwrap(planFileChunks({ encoding: "zstd", path }));
    const stored = unwrap(await chunkInventory({ encoding: "zstd", project: SUPABASE_PROJECT_ID, transport }));
    const first = unwrap(
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
    expect(first.sent).toBe(content.chunks.length);
    expect(first.held).toBe(0);
    expect(first.sentRawBytes).toBe(12 * MIB);
    const again = unwrap(await chunkInventory({ encoding: "zstd", project: SUPABASE_PROJECT_ID, transport }));
    const second = unwrap(
      await sendContentChunks({
        content,
        path,
        project: SUPABASE_PROJECT_ID,
        retry: NO_BACKOFF,
        scratch,
        stored: again,
        transport,
      }),
    );
    expect(second).toEqual({
      chunks: content.chunks.length,
      held: content.chunks.length,
      sent: 0,
      sentRawBytes: 0,
      sentStoredBytes: 0,
    });
    const target = join(directory, "rebuilt.jsonl");
    unwrap(await rebuildChunkedFile({ content, project: SUPABASE_PROJECT_ID, scratch, target, transport }));
    expect(readFileSync(target).equals(readFileSync(path))).toBe(true);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it("never writes through a link left at the partial path into the file it points at", async () => {
    const directory = scratchDirectory();
    const transport = directoryTransport({ root: join(directory, "bucket") });
    const scratch = join(directory, "scratch");
    mkdirSync(scratch);
    const path = join(directory, "source.jsonl");
    writeFileSync(path, noise({ bytes: 2 * MIB, seed: 9 }));
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
    const victim = join(directory, "already-restored");
    writeFileSync(victim, "the bytes an earlier entry restored");
    const target = join(directory, "rebuilt.jsonl");
    symlinkSync(victim, `${target}.partial`);
    unwrap(await rebuildChunkedFile({ content, project: SUPABASE_PROJECT_ID, scratch, target, transport }));
    expect(readFileSync(victim, "utf8")).toBe("the bytes an earlier entry restored");
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(readFileSync(target).equals(readFileSync(path))).toBe(true);
  });

  it("refuses to send a chunk whose bytes changed since the plan", async () => {
    const directory = scratchDirectory();
    const transport = directoryTransport({ root: join(directory, "bucket") });
    const path = join(directory, "file");
    writeFileSync(path, noise({ bytes: 3 * MIB, seed: 8 }));
    const { content } = unwrap(planFileChunks({ encoding: "identity", path }));
    writeFileSync(path, noise({ bytes: 3 * MIB, seed: 9 }));
    const refused = unwrapErr(
      await sendContentChunks({
        content,
        path,
        project: SUPABASE_PROJECT_ID,
        retry: NO_BACKOFF,
        scratch: directory,
        stored: new Map(),
        transport,
      }),
    );
    expect(refused[0]).toBe(ChunkErrors.changed({ offset: 0, path }).message);
    expect(transport.uploaded).toEqual([]);
  });

  it("leaves no file under the target name when a stored chunk is corrupt", async () => {
    const directory = scratchDirectory();
    const transport = directoryTransport({ root: join(directory, "bucket") });
    const path = join(directory, "file");
    writeFileSync(path, noise({ bytes: 2 * MIB, seed: 10 }));
    const { content } = unwrap(planFileChunks({ encoding: "identity", path }));
    unwrap(
      await sendContentChunks({
        content,
        path,
        project: SUPABASE_PROJECT_ID,
        retry: NO_BACKOFF,
        scratch: directory,
        stored: new Map(),
        transport,
      }),
    );
    const first = content.chunks[0]!;
    writeFileSync(
      join(
        directory,
        "bucket",
        chunkObjectName({ encoding: "identity", project: SUPABASE_PROJECT_ID, sha256: first.sha256 }),
      ),
      "x",
    );
    const target = join(directory, "rebuilt");
    const refused = unwrapErr(
      await rebuildChunkedFile({ content, project: SUPABASE_PROJECT_ID, scratch: directory, target, transport }),
    );
    expect(refused[0]).toContain("decodes to 1 byte(s)");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });
});
