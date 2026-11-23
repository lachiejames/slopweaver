/*
 * The bronze-file pass over a scripted client (`../../scriptedStoreClient.ts`): an unreadable denylist refuses the
 * run before any statement, and a file whose one line will not parse reads to its end with that refusal counted and
 * nothing written beyond the person-index read. A file under a no-access protect-list path is refused before either.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { StoreErrors } from "../../../store/errors.js";
import { ingestJsonl } from "../../../store/ingestJsonl.js";
import { scriptedStoreClient } from "../../scriptedStoreClient.js";

describe("ingestJsonl", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ingest-jsonl-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a malformed denylist as STORE_QUERY_FAILED naming the ingest lane, before any statement", async () => {
    const denylist = join(home, "sync-author-denylist.txt");
    writeFileSync(denylist, "U0NOISE @\n");
    const { client, statements } = scriptedStoreClient({ answer: () => [] });

    const error = unwrapErr(
      await ingestJsonl({ client, home, limit: 10, path: join(home, "bronze.jsonl"), protection: [] }),
    );

    const reason = `${denylist}: "U0NOISE @" is not <id> @ <channel> — both sides must be non-empty`;
    expect(error).toEqual(StoreErrors.queryFailed({ cause: reason, what: "store ingest denylist" }));
    expect(statements()).toEqual([]);
  });

  it("reads a one-line file to its end, counting the line it could not store and writing nothing", async () => {
    const path = join(home, "bronze.jsonl");
    const line = "{not a record\n";
    writeFileSync(path, line);
    const { client, statements } = scriptedStoreClient({ answer: () => [] });

    const report = unwrap(await ingestJsonl({ client, home, limit: 10, path, protection: [] }));

    expect(report.reachedEnd).toBe(true);
    expect(report.slices).toBe(1);
    expect(report.linesRead).toBe(1);
    expect(report.recordsStored).toBe(0);
    expect(report.refusalsCounted).toBe(1);
    expect(report.refusals.map((refusal) => [refusal.source, refusal.sourceId])).toEqual([["unparsed", "line 1"]]);
    expect(report.bytesRead).toBe(Buffer.byteLength(line));
    expect(report.resumeByteOffset).toBe(Buffer.byteLength(line));
    expect(statements().length).toBe(1);
    expect(statements()[0]!.query).toContain('from "person"');
  });

  it("refuses a file under a no-access path before the denylist, the file or the store is touched", async () => {
    const dir = join(home, "corpus", "bronze", "chatgpt");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "2026-11-20_2026-11-21.jsonl");
    writeFileSync(path, "{not a record\n");
    // A malformed denylist would refuse FIRST if the protect list were consulted after it.
    writeFileSync(join(home, "sync-author-denylist.txt"), "U0NOISE @\n");
    const { client, statements } = scriptedStoreClient({ answer: () => [] });
    const protection = [
      { addedIso: "2026-11-21T10:42:00.000Z", mode: "no-access" as const, path: dir, why: "synthetic" },
    ];

    const error = unwrapErr(await ingestJsonl({ client, home, limit: 10, path, protection }));

    expect(error).toEqual(StoreErrors.bronzeProtected({ path, protectedPath: dir, why: "synthetic" }));
    expect(statements()).toEqual([]);
  });
});
