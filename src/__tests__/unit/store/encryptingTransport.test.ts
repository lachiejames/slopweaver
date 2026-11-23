/**
 * The encrypting decorator over a real local destination: what lands on disk is ciphertext and nothing else,
 * what comes back is the plaintext, sizes read as plaintext lengths, and a plaintext object is refused.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { encryptingTransport } from "../../../store/backup/encryptingTransport.js";
import { localDirectoryTransport } from "../../../store/backup/localDirectoryTransport.js";
import { keyFingerprint, OBJECT_MAGIC, OBJECT_OVERHEAD_BYTES } from "../../../store/backup/objectCrypto.js";
import { ObjectCryptoErrors } from "../../../store/backup/objectCryptoErrors.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

const made: string[] = [];
const KEY = Buffer.alloc(32, 3);
const MARKER = "PLAINTEXT-MARKER-7f3a";

/**
 * A fresh temporary directory, removed after each test.
 *
 * @returns its path
 */
function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "sw-encrypting-"));
  made.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of made.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Every file under `root`, recursively, as paths relative to it.
 *
 * @param root the directory
 * @returns the relative paths, sorted
 */
function filesUnder({ root }: { root: string }): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .toSorted();
}

describe("encryptingTransport", () => {
  it("lands only ciphertext, reports plaintext facts and round-trips", async () => {
    const root = scratch();
    const work = scratch();
    const destination = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    expect(destination.scheme).toBe("aes-256-gcm-stream-v1");
    expect(destination.keyFingerprint).toBe(keyFingerprint({ key: KEY }));
    const plain = join(work, "plain");
    const body = `${MARKER} ${"x".repeat(1000)}`;
    writeFileSync(plain, body);
    for (const name of ["p/manifest.json", "p/chunks/0001", "p/blobs/abc"]) {
      const stored = unwrap(await destination.transport.upload({ objectName: name, path: plain }));
      expect(stored.bytes).toBe(body.length);
      expect(stored.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    }
    expect(filesUnder({ root })).toEqual(["p/blobs/abc", "p/chunks/0001", "p/manifest.json"]);
    for (const file of filesUnder({ root })) {
      const physical = readFileSync(join(root, file));
      expect(physical.subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC)).toBe(true);
      expect(physical.includes(Buffer.from(MARKER))).toBe(false);
    }
    const back = join(work, "back");
    unwrap(await destination.transport.download({ objectName: "p/chunks/0001", path: back }));
    expect(readFileSync(back, "utf8")).toBe(body);
  });

  it("refuses a landing the destination reports short, which the plaintext facts handed up would hide", async () => {
    const root = scratch();
    const inner = localDirectoryTransport({ root, rootPolicy: "create" });
    // A destination that stores the ciphertext but loses its last byte: the length it reports is honest.
    const lossy: BackupTransport = {
      ...inner,
      upload: async ({ objectName, path }) => {
        const whole = readFileSync(path);
        return inner.upload({ bytes: whole.length - 1, objectName, path });
      },
    };
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const refused = unwrapErr(
      await encryptingTransport({ inner: lossy, key: KEY }).transport.upload({ objectName: "p/o", path: plain }),
    );
    const sealedBytes = MARKER.length + OBJECT_OVERHEAD_BYTES;
    expect(refused).toEqual(
      ObjectCryptoErrors.landedWrong({ landedBytes: sealedBytes - 1, objectName: "p/o", sealedBytes }),
    );
  });

  it("writes a different ciphertext each time, because each IV is fresh", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, "same");
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    unwrap(await transport.upload({ objectName: "a", path: plain }));
    unwrap(await transport.upload({ objectName: "b", path: plain }));
    expect(readFileSync(join(root, "a")).equals(readFileSync(join(root, "b")))).toBe(false);
  });

  it("honours the byte bound on the plaintext", async () => {
    const root = scratch();
    const work = scratch();
    const plain = join(work, "plain");
    writeFileSync(plain, "abcdef");
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    expect(unwrap(await transport.upload({ bytes: 2, objectName: "o", path: plain })).bytes).toBe(2);
    const back = join(work, "back");
    unwrap(await transport.download({ objectName: "o", path: back }));
    expect(readFileSync(back, "utf8")).toBe("ab");
  });

  it("reports plaintext sizes and omits an object too short to be whole", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, "12345");
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    unwrap(await transport.upload({ objectName: "p/whole", path: plain }));
    writeFileSync(join(root, "p", "short"), "tiny");
    expect([...unwrap(await transport.objectSizes({ prefix: "p/" }))]).toEqual([["p/whole", 5]]);
  });

  it("refuses a plaintext object planted in the destination", async () => {
    const root = scratch();
    writeFileSync(join(root, "planted"), '{"version":3,"padding":"............................................"}');
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    const refused = unwrapErr(await transport.download({ objectName: "planted", path: join(scratch(), "back") }));
    expect(refused.code).toBe("OBJECT_NOT_ENCRYPTED");
  });

  it("refuses an object written under another key", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, "secret");
    unwrap(
      await encryptingTransport({
        inner: localDirectoryTransport({ root, rootPolicy: "create" }),
        key: Buffer.alloc(32, 4),
      }).transport.upload({
        objectName: "o",
        path: plain,
      }),
    );
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    expect(unwrapErr(await transport.download({ objectName: "o", path: join(scratch(), "back") })).code).toBe(
      "OBJECT_KEY_MISMATCH",
    );
  });

  it("refuses to decrypt an object onto its own stored path, which stays ciphertext", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    unwrap(await transport.upload({ objectName: "o", path: plain }));
    const before = readFileSync(join(root, "o"));
    const refused = unwrapErr(await transport.download({ objectName: "o", path: join(root, "o") }));
    expect(refused.code).toBe("OBJECT_TARGET_INSIDE_DESTINATION");
    expect(refused.message).toBe(
      `refused to decrypt o to ${join(root, "o")}: that path is inside the encrypted destination, so its plaintext would replace a stored object`,
    );
    const after = readFileSync(join(root, "o"));
    expect(after.equals(before)).toBe(true);
    expect(after.subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC)).toBe(true);
    expect(after.includes(Buffer.from(MARKER))).toBe(false);
    expect(filesUnder({ root })).toEqual(["o"]);
  });

  it("decrypts to the place resolved before the fetch, even when a link is re-pointed into the destination during it", async () => {
    const root = scratch();
    const safe = scratch();
    const outside = scratch();
    const link = join(outside, "link");
    symlinkSync(safe, link);
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const local = localDirectoryTransport({ root, rootPolicy: "create" });
    // A seam, not a mock: the real local download, after re-pointing the caller's link at the destination.
    const repointing: BackupTransport = {
      ...local,
      download: async (args) => {
        unlinkSync(link);
        symlinkSync(root, link);
        return local.download(args);
      },
    };
    const { transport } = encryptingTransport({ inner: repointing, key: KEY });
    unwrap(await transport.upload({ objectName: "o", path: plain }));
    const stored = readFileSync(join(root, "o"));
    unwrap(await transport.download({ objectName: "o", path: join(link, "o") }));
    expect(readFileSync(join(root, "o")).equals(stored)).toBe(true);
    expect(readFileSync(join(safe, "o"), "utf8")).toBe(MARKER);
    expect(filesUnder({ root })).toEqual(["o"]);
  });

  it("keeps the destination pinned when a link to its root is re-pointed after the containment check", async () => {
    const a = scratch();
    const b = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const intoB = encryptingTransport({
      inner: localDirectoryTransport({ root: b, rootPolicy: "create" }),
      key: KEY,
    }).transport;
    unwrap(await intoB.upload({ objectName: "o", path: plain }));
    unwrap(await intoB.upload({ objectName: "victim", path: plain }));
    const victim = readFileSync(join(b, "victim"));
    const rootLink = join(scratch(), "root");
    symlinkSync(a, rootLink);
    const local = localDirectoryTransport({ root: rootLink, rootPolicy: "create" });
    // A seam, not a mock: the real containment answer, then the root link re-pointed at the other tree.
    const repointing: BackupTransport = {
      ...local,
      holds: (args) => {
        const held = local.holds(args);
        unlinkSync(rootLink);
        symlinkSync(b, rootLink);
        return held;
      },
    };
    const { transport } = encryptingTransport({ inner: repointing, key: KEY });
    const refused = unwrapErr(await transport.download({ objectName: "o", path: join(b, "victim") }));
    expect(refused.code).toBe("LOCAL_OBJECT_READ_FAILED");
    expect(readFileSync(join(b, "victim")).equals(victim)).toBe(true);
    expect(filesUnder({ root: a })).toEqual([]);
  });

  it("refuses a target through a dangling link, which could be re-pointed into the destination during the fetch", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const local = localDirectoryTransport({ root, rootPolicy: "create" });
    const outside = scratch();
    const link = join(outside, "link");
    symlinkSync(join(outside, "nothing-here"), link);
    let fetched = 0;
    // A seam, not a mock: the real local download, after re-pointing the dangling link at the destination.
    const repointing: BackupTransport = {
      ...local,
      download: async (args) => {
        fetched += 1;
        unlinkSync(link);
        symlinkSync(root, link);
        return local.download(args);
      },
    };
    const { transport } = encryptingTransport({ inner: repointing, key: KEY });
    unwrap(await transport.upload({ objectName: "victim", path: plain }));
    const victim = readFileSync(join(root, "victim"));
    const refused = unwrapErr(await transport.download({ objectName: "victim", path: join(link, "victim") }));
    expect(refused.code).toBe("OBJECT_TARGET_UNRESOLVABLE");
    expect(fetched).toBe(0);
    expect(readFileSync(join(root, "victim")).equals(victim)).toBe(true);
    expect(filesUnder({ root })).toEqual(["victim"]);
  });

  it("refuses a target that is itself a link, so a planted one cannot carry plaintext to wherever it points", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    unwrap(await transport.upload({ objectName: "manifest.json", path: plain }));
    const victim = join(scratch(), "victim");
    writeFileSync(victim, "untouched");
    const retrieved = scratch();
    const planted = join(retrieved, "manifest.json");
    symlinkSync(victim, planted);
    const refused = unwrapErr(await transport.download({ objectName: "manifest.json", path: planted }));
    expect(refused).toEqual(
      ObjectCryptoErrors.targetUnresolvable({
        objectName: "manifest.json",
        path: planted,
        why: "it is a link, and a restore never writes through one",
      }),
    );
    expect(readFileSync(victim, "utf8")).toBe("untouched");
  });

  it("refuses a link to a directory spelled with a trailing slash, before fetching anything", async () => {
    const root = scratch();
    const local = localDirectoryTransport({ root, rootPolicy: "create" });
    let fetched = 0;
    // A seam, not a mock: the real local download, counted.
    const counting: BackupTransport = {
      ...local,
      download: async (args) => {
        fetched += 1;
        return local.download(args);
      },
    };
    const link = join(scratch(), "link");
    symlinkSync(scratch(), link);
    const { transport } = encryptingTransport({ inner: counting, key: KEY });
    const refused = unwrapErr(await transport.download({ objectName: "o", path: `${link}/` }));
    expect(refused).toEqual(
      ObjectCryptoErrors.targetUnresolvable({
        objectName: "o",
        path: `${link}/`,
        why: "it is a link, and a restore never writes through one",
      }),
    );
    expect(fetched).toBe(0);
  });

  it("refuses, rather than throws, a target under a directory it cannot search, before fetching anything", async () => {
    const root = scratch();
    const local = localDirectoryTransport({ root, rootPolicy: "create" });
    let fetched = 0;
    const counting: BackupTransport = {
      ...local,
      download: async (args) => {
        fetched += 1;
        return local.download(args);
      },
    };
    const sealed = scratch();
    const target = join(sealed, "manifest.json");
    const { transport } = encryptingTransport({ inner: counting, key: KEY });
    chmodSync(sealed, 0o000);
    const result = await transport.download({ objectName: "o", path: target });
    chmodSync(sealed, 0o700);
    const refused = unwrapErr(result);
    expect(refused.code).toBe("OBJECT_TARGET_UNRESOLVABLE");
    expect(refused.message).toContain("it could not be examined");
    expect(fetched).toBe(0);
  });

  it("refuses a target that steps through a dangling link with `..`, before fetching anything", async () => {
    const root = scratch();
    const local = localDirectoryTransport({ root, rootPolicy: "create" });
    let fetched = 0;
    const counting: BackupTransport = {
      ...local,
      download: async (args) => {
        fetched += 1;
        return local.download(args);
      },
    };
    const outside = scratch();
    symlinkSync(join(outside, "does-not-exist"), join(outside, "link"));
    const target = `${outside}/link/../out`;
    const { transport } = encryptingTransport({ inner: counting, key: KEY });
    const refused = unwrapErr(await transport.download({ objectName: "o", path: target }));
    expect(refused).toEqual(
      ObjectCryptoErrors.targetUnresolvable({
        objectName: "o",
        path: target,
        why: "it carries a . or .. segment, which a restore target never needs",
      }),
    );
    expect(fetched).toBe(0);
    expect(readdirSync(outside)).toEqual(["link"]);
  });

  it("refuses to decrypt onto a stored object whose name starts with two dots", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    unwrap(await transport.upload({ objectName: "source", path: plain }));
    unwrap(await transport.upload({ objectName: "..victim", path: plain }));
    const victim = readFileSync(join(root, "..victim"));
    const refused = unwrapErr(await transport.download({ objectName: "source", path: join(root, "..victim") }));
    expect(refused.code).toBe("OBJECT_TARGET_INSIDE_DESTINATION");
    expect(readFileSync(join(root, "..victim")).equals(victim)).toBe(true);
  });

  it("refuses to decrypt into a new path below the destination", async () => {
    const root = scratch();
    const plain = join(scratch(), "plain");
    writeFileSync(plain, MARKER);
    const { transport } = encryptingTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "create" }),
      key: KEY,
    });
    unwrap(await transport.upload({ objectName: "o", path: plain }));
    const refused = unwrapErr(await transport.download({ objectName: "o", path: join(root, "restored") }));
    expect(refused.code).toBe("OBJECT_TARGET_INSIDE_DESTINATION");
    expect(filesUnder({ root })).toEqual(["o"]);
  });
});
