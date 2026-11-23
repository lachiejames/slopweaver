/**
 * The live copy's snapshot store: the manifest names the body written whole under its own hash, a newer body replaces
 * the old one, and anything that does not stand as written refuses the whole copy rather than being passed over.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ChatgptSnapshotError,
  ChatgptSnapshotErrors,
} from "../../../../corpus/chatgpt/liveSnapshotStore.errors.js";
import {
  heldLiveManifests,
  heldLiveSnapshots,
  type LiveSnapshotManifest,
  readLiveManifest,
} from "../../../../corpus/chatgpt/liveSnapshotStore.js";
import { writeLiveSnapshot } from "../../../../corpus/chatgpt/liveSnapshotWrite.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { chatId } from "../../../chatgptFixture.js";
import { tempDir, useTempDirs } from "./ingest/harness.js";

useTempDirs();

const ID = chatId({ name: "conv-y" });

/** The problems an unreadable refusal names; any other refusal fails the test here, never a silent empty list. */
function problemsOf({ error }: { error: ChatgptSnapshotError }): readonly string[] {
  if (error.code !== "LIVE_SNAPSHOT_UNREADABLE") {
    throw new Error(`expected LIVE_SNAPSHOT_UNREADABLE, got ${error.code}: ${error.message}`);
  }
  return error.problems;
}

/** Hold one body for {@link ID} under `root`. */
function hold({ root, elementText }: { root: string; elementText: string }): LiveSnapshotManifest {
  return unwrap(
    writeLiveSnapshot({
      bodyUpdatedIso: "2026-11-17T00:00:00.000Z",
      conversationId: ID,
      elementText,
      fetchedAtIso: "2026-11-17T01:00:00.000Z",
      listedUpdatedIso: "2026-11-17T00:00:00.000Z",
      root,
    }),
  );
}

describe("writeLiveSnapshot and heldLiveSnapshots", () => {
  it("holds the body as a one-element array at 0600 under its hash, and reads it back", () => {
    const root = join(tempDir(), "live");
    const manifest = hold({ elementText: '{"a":1}', root });
    const file = join(root, "snapshots", ID, `${manifest.bodyHash}.json`);
    expect(readFileSync(file, "utf8")).toBe('[{"a":1}]\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(manifest.bytes).toBe(10);
    expect(unwrap(heldLiveSnapshots({ root }))).toEqual([{ file, manifest }]);
    expect(unwrap(readLiveManifest({ conversationId: ID, root }))).toEqual(manifest);
  });

  it("replaces the body a newer one supersedes and removes the old", () => {
    const root = join(tempDir(), "live");
    const first = hold({ elementText: '{"a":1}', root });
    const second = hold({ elementText: '{"a":2}', root });
    expect(second.bodyHash).not.toBe(first.bodyHash);
    expect(existsSync(join(root, "snapshots", ID, `${first.bodyHash}.json`))).toBe(false);
    expect(unwrap(heldLiveSnapshots({ root })).map((one) => one.manifest.bodyHash)).toEqual([second.bodyHash]);
  });

  it("reads nothing held as empty, and refuses an id that is not a conversation's", () => {
    const root = join(tempDir(), "live");
    expect(unwrap(heldLiveSnapshots({ root }))).toEqual([]);
    expect(unwrap(readLiveManifest({ conversationId: ID, root }))).toBe(undefined);
    const refused = unwrapErr(
      writeLiveSnapshot({
        bodyUpdatedIso: null,
        conversationId: "../escape",
        elementText: "{}",
        fetchedAtIso: "2026-11-17T01:00:00.000Z",
        listedUpdatedIso: null,
        root,
      }),
    );
    expect(refused.code).toBe("LIVE_SNAPSHOT_WRITE_FAILED");
    expect(existsSync(root)).toBe(false);
  });

  it("refuses a live copy it cannot list rather than reading it as none held", () => {
    const root = join(tempDir(), "live");
    hold({ elementText: '{"a":1}', root });
    chmodSync(root, 0o000);
    try {
      expect(unwrapErr(heldLiveSnapshots({ root })).code).toBe("LIVE_SNAPSHOT_UNREADABLE");
      expect(unwrapErr(heldLiveManifests({ root })).code).toBe("LIVE_SNAPSHOT_UNREADABLE");
      expect(unwrapErr(readLiveManifest({ conversationId: ID, root })).code).toBe("LIVE_SNAPSHOT_UNREADABLE");
    } finally {
      chmodSync(root, 0o700);
    }
  });

  it("reads every manifest without its body, and refuses a directory not named for a conversation", () => {
    const root = join(tempDir(), "live");
    const manifest = hold({ elementText: '{"a":1}', root });
    writeFileSync(join(root, "snapshots", ID, `${manifest.bodyHash}.json`), '[{"a":9}]\n');
    expect([...unwrap(heldLiveManifests({ root }))]).toEqual([[ID, manifest]]);
    mkdirSync(join(root, "snapshots", "not-a-chat"));
    const problems = [`${join(root, "snapshots", "not-a-chat")} is not named for a conversation`];
    expect(unwrapErr(heldLiveManifests({ root }))).toEqual(ChatgptSnapshotErrors.unreadable({ problems, root }));
  });

  it("refuses a manifest whose body is missing or resized, never reading that chat as held", () => {
    const root = join(tempDir(), "live");
    const manifest = hold({ elementText: '{"a":1}', root });
    const body = join(root, "snapshots", ID, `${manifest.bodyHash}.json`);
    writeFileSync(body, '[{"a":12345}]\n');
    expect(problemsOf({ error: unwrapErr(heldLiveManifests({ root })) })).toEqual([
      `${body} no longer holds the bytes its manifest names`,
    ]);
    unlinkSync(body);
    expect(problemsOf({ error: unwrapErr(heldLiveManifests({ root })) })).toEqual([
      `${body}, which its manifest names, will not read`,
    ]);
  });

  it("reads a directory whose first write died before its manifest as holding nothing, and a later write publishes", () => {
    const root = join(tempDir(), "live");
    mkdirSync(join(root, "snapshots", ID), { recursive: true });
    writeFileSync(join(root, "snapshots", ID, `${"a".repeat(64)}.json`), '[{"a":1}]\n');
    expect(unwrap(heldLiveManifests({ root })).size).toBe(0);
    expect(unwrap(heldLiveSnapshots({ root }))).toEqual([]);
    expect(unwrap(readLiveManifest({ conversationId: ID, root }))).toBe(undefined);
    const manifest = hold({ elementText: '{"a":1}', root });
    expect(unwrap(heldLiveSnapshots({ root })).map((one) => one.manifest)).toEqual([manifest]);
  });

  it("refuses the whole copy for a rewritten body, a manifest naming another chat, or a stray directory", () => {
    const root = join(tempDir(), "live");
    const manifest = hold({ elementText: '{"a":1}', root });
    writeFileSync(join(root, "snapshots", ID, `${manifest.bodyHash}.json`), '[{"a":9}]\n');
    expect(problemsOf({ error: unwrapErr(heldLiveSnapshots({ root })) })).toEqual([
      `${join(root, "snapshots", ID, `${manifest.bodyHash}.json`)} no longer holds the bytes its manifest names`,
    ]);
    const other = chatId({ name: "conv-z" });
    mkdirSync(join(root, "snapshots", other));
    writeFileSync(join(root, "snapshots", other, "manifest.json"), JSON.stringify(manifest));
    mkdirSync(join(root, "snapshots", "not-a-chat"));
    const problems = problemsOf({ error: unwrapErr(heldLiveSnapshots({ root })) });
    expect(problems.length).toBe(3);
    expect(problems.filter((line) => line.includes(`manifest names conversation ${ID}`)).length).toBe(1);
    expect(problems.filter((line) => line.includes("is not named for a conversation")).length).toBe(1);
  });
});
