/**
 * A store export written to a throwaway directory and read back: the round trip, the file modes, every
 * refusal that guards a forged or damaged export, and the unmanifested directory an export made before manifests is.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { importedSteerEventId } from "../../../../profile/steerMeasurementRecords.js";
import {
  publishStagedExport,
  settlePublishedExport,
  writeStoreExport,
} from "../../../../store/transfer/bundlePublish.js";
import {
  contentDigest,
  fileFingerprint,
  measurePart,
  readExportBundle,
} from "../../../../store/transfer/bundleRead.js";
import { StoreTransferErrors } from "../../../../store/transfer/errors.js";

import { CONTENTS, MEMORY_LINE, STEER_LINE } from "./fixtures.js";

const cleanups: (() => void)[] = [];

/** Removals owed once the whole file has run: the shared export's directory. */
const fileCleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

afterAll(() => {
  fileCleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/**
 * A throwaway directory this test may write into.
 *
 * @param owed where its removal is queued: after this case, unless the caller owns it for longer
 */
function scratch({ owed = cleanups }: { owed?: (() => void)[] } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "sw-transfer-"));
  owed.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/**
 * The fixture export as the writer left it, written ONCE in its own directory, and only ever READ. A write fsyncs
 * every part and measured ~100ms a case here; the cases that judge the writer's own output read this one, and a case
 * that edits an export edits its own copy from {@link exported}.
 */
let pristine = "";

beforeAll(() => {
  pristine = join(scratch({ owed: fileCleanups }), "export");
  unwrap(
    writeStoreExport({
      contents: CONTENTS,
      createdAtIso: "2026-10-31T00:00:00.000Z",
      out: pristine,
      producerVersion: "0.2.0",
    }),
  );
});

/**
 * A private byte-for-byte copy of the fixture export, modes included, in a fresh directory — for a case that edits,
 * replaces or removes what it was handed.
 *
 * @returns the copy's path
 */
function exported(): string {
  const out = join(scratch(), "export");
  cpSync(pristine, out, { recursive: true });
  return out;
}

describe("settlePublishedExport", () => {
  it("keeps a published export whose after-publishing checks still hold", () => {
    const out = exported();

    expect(unwrap(settlePublishedExport({ out, recheck: ok(undefined) }))).toBe(undefined);
    expect(readdirSync(out).length).toBeGreaterThan(0);
  });

  it("removes a published export once a journal changed after its snapshot, passing the refusal on", () => {
    const out = exported();
    const changed = StoreTransferErrors.sourceUnreadable({ cause: "the journal changed", what: "steer-verdicts" });

    expect(unwrapErr(settlePublishedExport({ out, recheck: err(changed) }))).toEqual(changed);
    expect(existsSync(out)).toBe(false);
  });
});

describe("writeStoreExport then readExportBundle", () => {
  it("reads back every part's rows, against the manifest, with the digest the writer saw", () => {
    const out = join(scratch(), "export");
    const written = unwrap(
      writeStoreExport({ contents: CONTENTS, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }),
    );
    const read = unwrap(readExportBundle({ dir: out, unmanifested: false }));
    expect(read.parts.map((part) => [part.kind, part.status === "read" ? part.rows : -1])).toEqual([
      ["memories", 1],
      ["memory-recalls", 1],
      ["owner-profile", 1],
      ["owner-voice", 1],
      ["owner-directives", 2],
      ["standing-asks", 0],
      ["steer-verdicts", 2],
    ]);
    expect(contentDigest({ parts: read.parts })).toBe(contentDigest({ parts: written.parts }));
    expect(read.manifest!.producer).toEqual({ name: "slopweaver", version: "0.2.0" });
  });

  it("hashes exactly the bytes on disk", () => {
    const out = pristine;
    const onDisk = createHash("sha256")
      .update(readFileSync(join(out, "steer-kinds.jsonl")))
      .digest("hex");
    const path = join(out, "steer-kinds.jsonl");
    const { measure: measured } = unwrap(measurePart({ kind: "steer-verdicts", path, schemaVersion: 2 }));
    expect(measured.sha256).toBe(onDisk);
    expect(measured.bytes).toBe(`${CONTENTS.steerMeasurementLines.join("\n")}\n`.length);
  });

  it("writes the steer part at v2, and still reads an export whose manifest names it v1 over journal lines", () => {
    const out = exported();
    const manifestPath = join(out, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { parts: Record<string, unknown>[] };
    const v1Text = `${STEER_LINE}\n\nnot json\n`;
    writeFileSync(join(out, "steer-kinds.jsonl"), v1Text);
    const parts = manifest.parts.map((part) => ({
      ...part,
      ...(part["kind"] === "steer-verdicts"
        ? {
            bytes: Buffer.byteLength(v1Text),
            rows: 1,
            schemaVersion: 1,
            sha256: createHash("sha256").update(v1Text).digest("hex"),
          }
        : {}),
    }));
    const steerVersion = manifest.parts.find((part) => part["kind"] === "steer-verdicts")!["schemaVersion"];
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, parts }));

    const read = unwrap(readExportBundle({ dir: out, unmanifested: false }));
    const steer = read.parts.find((part) => part.kind === "steer-verdicts")!;
    expect(steerVersion).toBe(2);
    expect([steer.status, steer.status === "read" ? steer.rows : -1]).toEqual(["read", 1]);
  });

  it("writes an owner-only directory, leaves no staging directory, and writes the manifest", () => {
    const out = pristine;
    expect(statSync(out).mode & 0o777).toBe(0o700);
    expect(statSync(join(out, "memories.jsonl")).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(out, ".."))).toEqual(["export"]);
    expect(readdirSync(out).toSorted()).toEqual([
      "manifest.json",
      "memories.jsonl",
      "memories.jsonl.recalls.jsonl",
      "owner-directives.json",
      "owner-profile.json",
      "owner-voice.jsonl",
      "standing-asks.jsonl",
      "steer-kinds.jsonl",
    ]);
  });

  it("refuses a target that already exists and leaves it untouched", () => {
    const out = join(scratch(), "export");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "mine");
    const refused = unwrapErr(
      writeStoreExport({ contents: CONTENTS, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }),
    );
    expect(refused.code).toBe("TARGET_EXISTS");
    expect(readdirSync(out)).toEqual(["keep.txt"]);
  });

  it("never renames over an empty directory that appeared after the first check", () => {
    const root = scratch();
    const staging = join(root, "staging");
    const out = join(root, "export");
    mkdirSync(staging);
    writeFileSync(join(staging, "manifest.json"), "{}");
    mkdirSync(out);
    expect(unwrapErr(publishStagedExport({ out, staging })).code).toBe("TARGET_EXISTS");
    expect(readdirSync(out)).toEqual([]);
    expect(readdirSync(staging)).toEqual(["manifest.json"]);
  });

  it("publishes a staged directory onto a free path", () => {
    const root = scratch();
    const staging = join(root, "staging");
    const out = join(root, "export");
    mkdirSync(staging);
    writeFileSync(join(staging, "manifest.json"), "{}");
    expect(unwrap(publishStagedExport({ out, staging }))).toBe(true);
    expect(readdirSync(root)).toEqual(["export"]);
    expect(readdirSync(out)).toEqual(["manifest.json"]);
  });

  it("publishes nothing when a part would not decode on the re-read", () => {
    const out = join(scratch(), "export");
    const refused = unwrapErr(
      writeStoreExport({
        contents: { ...CONTENTS, memoryLines: ['{"claim":"half a row"}'] },
        createdAtIso: "2026-10-31T00:00:00.000Z",
        out,
        producerVersion: "0.2.0",
      }),
    );
    expect(refused.code).toBe("PART_UNDECODABLE");
    expect(readdirSync(join(out, ".."))).toEqual([]);
  });
});

describe("readExportBundle refusals", () => {
  it("refuses a part whose bytes changed after the manifest was written, naming bytes first", () => {
    const out = exported();
    appendFileSync(join(out, "memories.jsonl"), `${MEMORY_LINE}\n`);
    const refused = unwrapErr(readExportBundle({ dir: out, unmanifested: false }));
    expect(refused.code).toBe("PART_MISMATCH");
    expect(refused.message).toContain("memories: the manifest promises bytes");
  });

  it("refuses a same-length edit on its hash", () => {
    const out = exported();
    const path = join(out, "owner-profile.json");
    writeFileSync(path, readFileSync(path, "utf8").replace("Acme Owner", "Acme Ownex"));
    expect(unwrapErr(readExportBundle({ dir: out, unmanifested: false })).message).toContain("promises sha256");
  });

  it("refuses a part that is a symlink, even to a genuine copy", () => {
    const out = exported();
    const elsewhere = join(scratch(), "memories.jsonl");
    writeFileSync(elsewhere, readFileSync(join(out, "memories.jsonl")));
    rmSync(join(out, "memories.jsonl"));
    symlinkSync(elsewhere, join(out, "memories.jsonl"));
    const refused = unwrapErr(readExportBundle({ dir: out, unmanifested: false }));
    expect(refused.code).toBe("PART_UNREADABLE");
    expect(refused.message).toContain("not a regular file");
  });

  it("refuses a manifest that points a part anywhere but its own name", () => {
    const out = exported();
    const path = join(out, "manifest.json");
    writeFileSync(path, readFileSync(path, "utf8").replace('"path": "memories.jsonl"', '"path": "../memories.jsonl"'));
    const refused = unwrapErr(readExportBundle({ dir: out, unmanifested: false }));
    expect(refused.code).toBe("MANIFEST_INVALID");
    expect(refused.message).toContain("it is only ever memories.jsonl");
  });

  it("refuses a directory with no manifest unless told it has none", () => {
    const dir = scratch();
    writeFileSync(join(dir, "memories.jsonl"), `${MEMORY_LINE}\n`);
    expect(unwrapErr(readExportBundle({ dir, unmanifested: false })).code).toBe("MANIFEST_ABSENT");
  });

  it("refuses the unmanifested reading of a directory that has a manifest", () => {
    expect(unwrapErr(readExportBundle({ dir: pristine, unmanifested: true })).code).toBe("MANIFEST_PRESENT");
  });

  it("refuses an undecodable byte rather than hashing text the file does not hold", () => {
    const dir = scratch();
    writeFileSync(join(dir, "memories.jsonl"), Buffer.concat([Buffer.from([0xff]), Buffer.from(`${MEMORY_LINE}\n`)]));
    const refused = unwrapErr(readExportBundle({ dir, unmanifested: true }));
    expect(refused.code).toBe("PART_UNDECODABLE");
    expect(refused.message).toContain("line 1 is not plain UTF-8");
  });

  it("refuses three invalid bytes, which are as long as the placeholder the reader returns for them", () => {
    const dir = scratch();
    writeFileSync(join(dir, "steer-kinds.jsonl"), Buffer.from([0xff, 0xff, 0xff]));
    const refused = unwrapErr(readExportBundle({ dir, unmanifested: true }));
    expect(refused.code).toBe("PART_UNDECODABLE");
    expect(refused.message).toContain("line 1 is not plain UTF-8");
  });

  it("reads a v1 line that really is one U+FFFD, which is the placeholder's text but not an undecodable line", () => {
    const dir = scratch();
    const path = join(dir, "steer-kinds.jsonl");
    const bytes = Buffer.from([0xef, 0xbf, 0xbd]);
    writeFileSync(path, bytes);
    const { measure, retained } = unwrap(measurePart({ kind: "steer-verdicts", path, schemaVersion: 1 }));
    // A v1 part's rows are its parsed lines, so this unparsed one is retained without being counted.
    expect(measure).toEqual({ bytes: 3, rows: 0, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(retained.map((entry) => entry.key)).toEqual([importedSteerEventId({ exactLine: "�", sourceOrdinal: 1 })]);
  });
});

describe("readExportBundle over an unmanifested directory", () => {
  it("reports a part it does not hold as unavailable, never as empty, and ignores every other file", () => {
    const dir = scratch();
    writeFileSync(join(dir, "memories.jsonl"), `${MEMORY_LINE}\n`);
    writeFileSync(join(dir, "steer-kinds.jsonl"), `${STEER_LINE}\n`);
    writeFileSync(join(dir, "owner-tables.sql"), "insert into owner_profile values (1);\n");
    const read = unwrap(readExportBundle({ dir, unmanifested: true }));
    expect(read.manifest).toBeNull();
    expect(read.parts.map((part) => `${part.kind}:${part.status}`)).toEqual([
      "memories:read",
      "memory-recalls:unavailable",
      "owner-profile:unavailable",
      "owner-voice:unavailable",
      "owner-directives:unavailable",
      "standing-asks:unavailable",
      "steer-verdicts:read",
    ]);
  });

  it("refuses a directory holding none of the part files", () => {
    const dir = scratch();
    writeFileSync(join(dir, "context.json"), "{}");
    expect(unwrapErr(readExportBundle({ dir, unmanifested: true })).code).toBe("NOTHING_RECOGNISED");
  });
});

describe("fileFingerprint", () => {
  it("moves when a file appears or is replaced with bytes of the same length", () => {
    const path = join(scratch(), "memories.jsonl");
    const absent = fileFingerprint({ path });
    writeFileSync(path, "aaaa\n");
    const first = fileFingerprint({ path });
    const replacement = `${path}.next`;
    writeFileSync(replacement, "bbbb\n");
    renameSync(replacement, path);
    expect(absent).toBe("error:ENOENT");
    expect(first).not.toBe(absent);
    expect(fileFingerprint({ path })).not.toBe(first);
  });
});

describe("contentDigest", () => {
  it("tells an absent part from an empty one", () => {
    const empty = contentDigest({
      parts: [{ bytes: 0, kind: "owner-voice", rows: 0, sha256: createHash("sha256").digest("hex"), status: "read" }],
    });
    const absent = contentDigest({ parts: [{ kind: "owner-voice", status: "unavailable" }] });
    expect(empty).not.toBe(absent);
  });
});
