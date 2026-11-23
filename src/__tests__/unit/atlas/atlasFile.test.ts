import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  digestOf,
  digestOfKindFile,
  readFileIfPresent,
  readKindEnvelopeIfPresent,
  readKindFileIfPresent,
  singleFileKindPath,
  sortDeep,
  stableJson,
  writeAtomic,
  writeAtomicKindFile,
} from "../../../atlas/atlasFile.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("sortDeep", () => {
  it("sorts object keys recursively", () => {
    expect(sortDeep({ value: { b: 1, a: { d: 2, c: 3 } } })).toEqual({ a: { c: 3, d: 2 }, b: 1 });
  });

  it("preserves array order", () => {
    expect(sortDeep({ value: [3, 1, 2] })).toEqual([3, 1, 2]);
  });

  it("passes through a primitive unchanged", () => {
    expect(sortDeep({ value: "x" })).toBe("x");
  });

  it("passes through null unchanged", () => {
    expect(sortDeep({ value: null })).toBeNull();
  });
});

describe("stableJson", () => {
  it("is newline-terminated and pretty-printed", () => {
    expect(stableJson({ value: { a: 1 } })).toBe('{\n  "a": 1\n}\n');
  });

  it("produces the same bytes regardless of input key order", () => {
    expect(stableJson({ value: { a: 1, b: 2 } })).toBe(stableJson({ value: { b: 2, a: 1 } }));
  });
});

describe("digestOf", () => {
  it("is a 64-character hex sha-256", () => {
    expect(digestOf({ value: { a: 1 } })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is identical for two key-order variants of the same document", () => {
    expect(digestOf({ value: { a: 1, b: 2 } })).toBe(digestOf({ value: { b: 2, a: 1 } }));
  });

  it("differs when the value differs", () => {
    expect(digestOf({ value: { a: 1 } })).not.toBe(digestOf({ value: { a: 2 } }));
  });
});

describe("readFileIfPresent / writeAtomic round trip", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vanta-atlasfile-"));
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("returns null for an absent file", () => {
    const result = readFileIfPresent({ path: join(dir, "nope.json") });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBeNull();
  });

  it("reports a dangling symlink as a failure, never as absence", () => {
    const path = join(dir, "dangling.json");
    symlinkSync(join(dir, "gone.json"), path);
    const result = readFileIfPresent({ path });
    expect(unwrapErr(result)[0]).toContain(`cannot read ${path}: ENOENT`);
    expect(unwrapErr(result)[1]).toBe(
      "a link on the way to it points at nothing — restore the link's target, or remove the link so the file reads as never written",
    );
  });

  it("names the way out for a path that is there but will not read as a file", () => {
    const path = join(dir, "a-directory.json");
    mkdirSync(path);
    const refusal = unwrapErr(readFileIfPresent({ path }));
    expect(refusal[0]).toContain(`cannot read ${path}: EISDIR`);
    expect(refusal[1]).toBe(
      "restore read access to it, or move whatever stands at that path aside so the file reads as never written",
    );
  });

  it("reports a file beneath a dangling DIRECTORY link as a failure, never as absence", () => {
    symlinkSync(join(dir, "gone-dir"), join(dir, "linked"));
    const path = join(dir, "linked", "doc.json");
    expect(unwrapErr(readFileIfPresent({ path }))[0]).toContain(`cannot read ${path}: ENOENT`);
  });

  it("never normalises a dangling component away, through `..` or a doubled slash", () => {
    symlinkSync(join(dir, "gone-dir"), join(dir, "linked"));
    const upAndBack = `${join(dir, "linked")}/../doc.json`;
    expect(unwrapErr(readFileIfPresent({ path: upAndBack }))[0]).toContain(`cannot read ${upAndBack}: ENOENT`);
    const doubled = `${join(dir, "linked")}//doc.json`;
    expect(unwrapErr(readFileIfPresent({ path: doubled }))[0]).toContain(`cannot read ${doubled}: ENOENT`);
  });

  it("reads a missing file beneath a live directory link as absence", () => {
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "live"));
    expect(unwrap(readFileIfPresent({ path: join(dir, "live", "doc.json") }))).toBeNull();
  });

  it("writes then reads back the same stable JSON bytes", () => {
    const path = join(dir, "sub", "doc.json");
    const written = writeAtomic({ path, value: { b: 2, a: 1 } });
    expect(written.isOk()).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(raw).toBe(stableJson({ value: { a: 1, b: 2 } }));
  });

  it("a later write replaces the file rather than appending", () => {
    const path = join(dir, "doc.json");
    writeAtomic({ path, value: { v: 1 } });
    writeAtomic({ path, value: { v: 2 } });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ v: 2 });
  });
});

describe("the kind-file JSONL layout", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atlas-kindfile-"));
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  const envelope = { entities: [], kind: "thing", schemaVersion: 1 };
  const entities = [{ id: "b", name: "second" }, { id: "a" }];

  it("writes the envelope first and then one line per entity", () => {
    const path = join(dir, "thing.jsonl");
    expect(writeAtomicKindFile({ entities, envelope, path }).isOk()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(
      '{"entities":[],"kind":"thing","schemaVersion":1}\n{"id":"b","name":"second"}\n{"id":"a"}\n',
    );
  });

  it("reads back the envelope and every entity, in the order written", () => {
    const path = join(dir, "thing.jsonl");
    writeAtomicKindFile({ entities, envelope, path });
    const parts = unwrap(readKindFileIfPresent({ path }))!;
    expect(parts.envelope).toEqual(envelope);
    expect(parts.entities).toEqual(entities);
  });

  it("reads the envelope alone, without materialising the entities after it", () => {
    const path = join(dir, "thing.jsonl");
    writeAtomicKindFile({ entities, envelope, path });
    expect(unwrap(readKindEnvelopeIfPresent({ path }))).toEqual(envelope);
  });

  it("returns null for an envelope read of a file that is not there", () => {
    expect(unwrap(readKindEnvelopeIfPresent({ path: join(dir, "absent.jsonl") }))).toBeNull();
  });

  it("refuses an envelope read of a file whose first line is not JSON", () => {
    const path = join(dir, "broken.jsonl");
    writeFileSync(path, 'not json\n{"id":"a"}\n', "utf8");
    expect(unwrapErr(readKindEnvelopeIfPresent({ path }))[0]).toContain("line 1 is not valid JSON");
  });

  it("refuses an envelope read of an empty file, which holds no envelope at all", () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "", "utf8");
    expect(unwrapErr(readKindEnvelopeIfPresent({ path }))[0]).toContain("holds no envelope line");
  });

  it("stops at the envelope even when the entities after it span many chunks", () => {
    // Falsifiable witness for the early exit: the read must not depend on the file being small. A whole-file
    // read of this would materialise every entity; the envelope read returns the first line regardless.
    const path = join(dir, "big.jsonl");
    const many = Array.from({ length: 20000 }, (_unused, index) => ({ id: `id-${String(index)}` }));
    writeAtomicKindFile({ entities: many, envelope, path });
    expect(statSync(path).size).toBeGreaterThan(200000);
    expect(unwrap(readKindEnvelopeIfPresent({ path }))).toEqual(envelope);
  });

  it("digests exactly the bytes that reached disk", () => {
    const path = join(dir, "thing.jsonl");
    writeAtomicKindFile({ entities, envelope, path });
    const onDisk = createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(digestOfKindFile({ entities, envelope })).toBe(onDisk);
  });

  it("digests the same document identically regardless of key order", () => {
    expect(digestOfKindFile({ entities: [{ id: "a", z: 1 }], envelope })).toBe(
      digestOfKindFile({ entities: [{ z: 1, id: "a" }], envelope }),
    );
  });

  it("digests differently when one entity differs", () => {
    expect(digestOfKindFile({ entities, envelope })).not.toBe(
      digestOfKindFile({ entities: [{ id: "b", name: "second" }, { id: "c" }], envelope }),
    );
  });

  it("returns null for an absent file rather than refusing", () => {
    expect(unwrap(readKindFileIfPresent({ path: join(dir, "nope.jsonl") }))).toBeNull();
  });

  it("names the line number of a record it cannot parse", () => {
    const path = join(dir, "corrupt.jsonl");
    writeFileSync(path, '{"entities":[],"kind":"thing","schemaVersion":1}\n{"id":"a"}\n{not json\n', "utf8");
    const failure = unwrapErr(readKindFileIfPresent({ path }));
    expect(failure[0]).toContain("line 3 is not valid JSON");
    expect(failure[1]).toBe("refusing rather than treating a corrupt atlas as an empty one");
  });

  it("refuses a file with no envelope line rather than reading it as empty", () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "", "utf8");
    expect(unwrapErr(readKindFileIfPresent({ path }))[0]).toContain("holds no envelope line");
  });

  it("a later write replaces the file rather than appending", () => {
    const path = join(dir, "thing.jsonl");
    writeAtomicKindFile({ entities, envelope, path });
    writeAtomicKindFile({ entities: [{ id: "only" }], envelope, path });
    expect(unwrap(readKindFileIfPresent({ path }))!.entities).toEqual([{ id: "only" }]);
  });

  // The regression this layout closes. One Cloudflare account's `pages-project` document
  // serialised past the cap `safeJsonStringify` refuses at, 100 MiB — so the whole-document seam is
  // asserted to REFUSE the same value this one writes, which is what makes the second half falsifiable
  // rather than a test that would pass on any payload. The 110 entities share ONE 1 MiB string, so the
  // heap holds a megabyte while the file on disk passes the cap.
  it("writes and reads back a generation the whole-document seam refuses", () => {
    const path = join(dir, "huge.jsonl");
    const blob = "x".repeat(1024 * 1024);
    const many = Array.from({ length: 110 }, (_unused, at) => ({ blob, id: `entity-${String(at)}` }));

    expect(() => stableJson({ value: { ...envelope, entities: many } })).toThrow(/over the 100 MiB cap/);

    expect(writeAtomicKindFile({ entities: many, envelope, path }).isOk()).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(100 * 1024 * 1024);
    const parts = unwrap(readKindFileIfPresent({ path }))!;
    expect(parts.entities.length).toBe(110);
    expect(parts.entities[109]).toEqual({ blob, id: "entity-109" });
  });
});

describe("the name the previous kind-file format wrote", () => {
  it("names the pre-`.jsonl` sibling of a kind file", () => {
    expect(singleFileKindPath({ path: "/state/atlas/vanta/controls.jsonl" })).toBe("/state/atlas/vanta/controls.json");
  });

  it("rewrites only the trailing extension, never a .jsonl earlier in the path", () => {
    expect(singleFileKindPath({ path: "/state/x.jsonl/atlas/vanta/people.jsonl" })).toBe(
      "/state/x.jsonl/atlas/vanta/people.json",
    );
  });
});
