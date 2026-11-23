import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isPruneArchiveName, prunedArchiveDir, readPrunedImportKeys } from "../../../knowledge/prunedImportKeys.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const dirs: string[] = [];

/** A throwaway state home, removed after the test that minted it. */
function scratchHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pruned-keys-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** One archived recording, as `knowledge prune` writes it in `knowledge export` format. */
const archivedLine = ({ importKey, recordingId }: { importKey: string | null; recordingId: string }): string =>
  JSON.stringify({
    behaviourChange: null,
    caveat: null,
    claim: `claim of ${recordingId}`,
    createdAt: "2026-09-12T11:00:00.000Z",
    domain: "datadog",
    evidence: "measured",
    id: `l-${recordingId}`,
    importKey,
    kind: "lesson",
    learner: null,
    recordedAt: "2026-09-07T22:23:24.368Z",
    recordingId,
    repro: null,
    retrievalCue: null,
    run: "ad-hoc",
    seq: 7,
    surface: null,
    tier: null,
    verdict: "confirmed",
  });

/** Write `lines` as one archive under the home's prune directory, returning the archive's path. */
function writeArchive({ home, name, lines }: { home: string; name: string; lines: readonly string[] }): string {
  const dir = prunedArchiveDir({ home });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

describe("isPruneArchiveName", () => {
  it("accepts the archive a prune names for its instant", () => {
    expect(isPruneArchiveName({ name: "2026-09-29T03-09-08.732Z.jsonl" })).toBe(true);
  });

  it("rejects the plan written beside it", () => {
    expect(isPruneArchiveName({ name: "2026-09-29T03-09-08.732Z.jsonl.plan.jsonl" })).toBe(false);
  });

  it("rejects the recall ledger written beside it", () => {
    expect(isPruneArchiveName({ name: "2026-09-29T03-09-08.732Z.jsonl.recalls.jsonl" })).toBe(false);
  });

  it("rejects anything that is not jsonl", () => {
    expect(isPruneArchiveName({ name: "notes.md" })).toBe(false);
  });
});

describe("readPrunedImportKeys", () => {
  it("reads an empty set for a home that never pruned", () => {
    expect(unwrap(readPrunedImportKeys({ home: scratchHome() })).size).toBe(0);
  });

  it("collects every archived import key across archives, skipping rows recorded after the cutover", () => {
    const home = scratchHome();
    writeArchive({
      home,
      lines: [
        archivedLine({ importKey: "aaa:0000000001", recordingId: "r1" }),
        archivedLine({ importKey: null, recordingId: "r2" }),
      ],
      name: "2026-09-29T03-09-08.732Z.jsonl",
    });
    writeArchive({
      home,
      lines: [archivedLine({ importKey: "bbb:0000000007", recordingId: "r3" })],
      name: "2026-09-29T03-27-34.503Z.jsonl",
    });

    expect([...unwrap(readPrunedImportKeys({ home }))].toSorted()).toEqual(["aaa:0000000001", "bbb:0000000007"]);
  });

  it("never reads a plan or recall sibling as an archive", () => {
    const home = scratchHome();
    writeArchive({
      home,
      lines: [archivedLine({ importKey: "aaa:0000000001", recordingId: "r1" })],
      name: "2026-09-29T03-09-08.732Z.jsonl",
    });
    // Neither sibling is a recording, so either one read as an archive would refuse as corrupt.
    writeArchive({ home, lines: ['{"op":"retire","id":"l-r1"}'], name: "2026-09-29T03-09-08.732Z.jsonl.plan.jsonl" });
    writeArchive({ home, lines: ['{"recallId":"x"}'], name: "2026-09-29T03-09-08.732Z.jsonl.recalls.jsonl" });

    expect([...unwrap(readPrunedImportKeys({ home }))]).toEqual(["aaa:0000000001"]);
  });

  it("refuses an archive line that does not decode, naming the archive, rather than dropping its key", () => {
    const home = scratchHome();
    const path = writeArchive({
      home,
      lines: [archivedLine({ importKey: "aaa:0000000001", recordingId: "r1" }), "{not json"],
      name: "2026-09-29T03-09-08.732Z.jsonl",
    });

    const error = unwrapErr(readPrunedImportKeys({ home }));
    expect(error.code).toBe("STORE_UNREADABLE");
    expect(error.message).toBe(
      `could not read the knowledge register at ${path} — refusing rather than reporting it empty`,
    );
  });
});
