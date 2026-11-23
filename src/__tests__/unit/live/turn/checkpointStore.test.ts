/**
 * The draft half of the checkpoint set, round-tripped through a real throwaway home.
 *
 * Filesystem rather than a fake, because what is under test IS the on-disk contract: a fresh session opens
 * the file the log names, and a test that mocked the write would prove nothing about that. Every write goes
 * to a `mkdtempSync` directory passed explicitly as `home`, per `.claude/rules/testing.md`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHECKPOINT_LOG_FILE } from "../../../../live/turn/checkpoint.js";
import {
  checkpointDir,
  draftFileName,
  readDraftCheckpoints,
  writeDraftCheckpoint,
} from "../../../../live/turn/checkpointStore.js";

const askIdentity = { channel: "C0TEST", messageTs: "1789046247.801199", threadTs: "1788927159.102999" };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-checkpoint-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Checkpoint one draft into the test's own home.
 *
 * @param atIso when validate accepted it
 * @param digest the digest to key it by
 * @param leaseExpiresAt the generation token to record
 * @param text the draft's bytes
 * @returns the absolute path written
 */
function checkpoint({
  atIso = "2026-09-10T13:40:00.000Z",
  digest = "sha256:aaaa",
  leaseExpiresAt = "2026-09-10T15:00:00.000Z",
  text = '{"lead":"first"}',
}: {
  atIso?: string;
  digest?: string;
  leaseExpiresAt?: string;
  text?: string;
} = {}): string {
  return writeDraftCheckpoint({
    answerText: text,
    askIdentity,
    atIso,
    digest,
    dispatchId: '["C0TEST","1789046247.801199","1788927159.102999"]',
    home,
    leaseExpiresAt,
  })!;
}

describe("writeDraftCheckpoint", () => {
  it("stores the worker's own bytes verbatim, under the digest's own name", () => {
    const path = checkpoint({ text: '{"lead":"first","body":[]}' });

    expect(path).toBe(join(checkpointDir({ askIdentity, home }), "draft-sha256-aaaa.json"));
    expect(readDraftCheckpoints({ askIdentity, home })).toHaveLength(1);
    expect(readDraftCheckpoints({ askIdentity, home })[0]!.draftFile).toBe(draftFileName({ digest: "sha256:aaaa" }));
  });

  it("orders drafts oldest first, in the order they validated", () => {
    checkpoint({ atIso: "2026-09-10T13:40:00.000Z", digest: "sha256:aaaa" });
    checkpoint({ atIso: "2026-09-10T13:55:00.000Z", digest: "sha256:bbbb" });

    const drafts = readDraftCheckpoints({ askIdentity, home });

    expect(drafts.map((entry) => entry.answerDigest)).toEqual(["sha256:aaaa", "sha256:bbbb"]);
    expect(drafts.map((entry) => entry.recordedAtIso)).toEqual([
      "2026-09-10T13:40:00.000Z",
      "2026-09-10T13:55:00.000Z",
    ]);
  });

  it("carries the generation token a later session compares itself against", () => {
    checkpoint({ leaseExpiresAt: "2026-09-10T15:00:00.000Z" });

    expect(readDraftCheckpoints({ askIdentity, home })[0]!.leaseExpiresAt).toBe("2026-09-10T15:00:00.000Z");
  });

  it("re-checkpointing the same bytes writes the same file, so the directory does not grow per validate", () => {
    const first = checkpoint({ text: '{"lead":"same"}' });
    const second = checkpoint({ text: '{"lead":"same"}' });

    expect(second).toBe(first);
    expect(readDraftCheckpoints({ askIdentity, home }).map((entry) => entry.draftFile)).toEqual([
      "draft-sha256-aaaa.json",
      "draft-sha256-aaaa.json",
    ]);
  });
});

describe("readDraftCheckpoints", () => {
  it("is empty for an ask that never checkpointed one", () => {
    expect(readDraftCheckpoints({ askIdentity, home })).toEqual([]);
  });

  it("drops a row whose file is no longer on disk, rather than naming a path nothing can open", () => {
    const path = checkpoint();
    rmSync(path);

    expect(readDraftCheckpoints({ askIdentity, home })).toEqual([]);
  });

  it("skips a malformed row and keeps the sound ones around it", () => {
    checkpoint({ digest: "sha256:aaaa" });
    const dir = checkpointDir({ askIdentity, home });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CHECKPOINT_LOG_FILE), `{"not":"a row"}\nnot json at all\n`, { flag: "a" });
    checkpoint({ digest: "sha256:bbbb" });

    expect(readDraftCheckpoints({ askIdentity, home }).map((entry) => entry.answerDigest)).toEqual([
      "sha256:aaaa",
      "sha256:bbbb",
    ]);
  });
});
