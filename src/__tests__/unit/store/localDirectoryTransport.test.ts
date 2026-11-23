/**
 * The local backup destination over a real temporary directory: round trips, the byte bound, containment,
 * symlink refusal and the modes it writes. No mocks — every call does the real thing to a real directory.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { LocalDestinationErrors } from "../../../store/backup/localDestinationErrors.js";
import { localDirectoryTransport, localObjectPath } from "../../../store/backup/localDirectoryTransport.js";

const made: string[] = [];

/**
 * A fresh temporary directory, removed after each test.
 *
 * @returns its path
 */
function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "sw-local-dest-"));
  made.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of made.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Write a source file and return its path.
 *
 * @param directory where it goes
 * @param body its contents
 * @returns the path
 */
function source({ directory, body }: { directory: string; body: string }): string {
  const path = join(directory, "source.bin");
  writeFileSync(path, body);
  return path;
}

describe("localDirectoryTransport", () => {
  it("refuses a listing that reaches a volume mounted inside the destination, rather than reading it as held", async () => {
    const parent = scratch();
    const root = join(parent, "dest");
    const work = scratch();
    const plain = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await plain.upload({ objectName: "slopweaver/blobs/ab/x", path: source({ body: "x", directory: work }) }));
    const nested = join(realpathSync(parent), "dest", "slopweaver", "blobs", "ab");
    const transport = localDirectoryTransport({
      deviceAt: ({ path }) => (path === nested ? 9 : statSync(path).dev),
      root,
      rootPolicy: "create",
    });
    const refused = unwrapErr(await transport.objectSizes({ prefix: "slopweaver/blobs/" }));
    expect(refused.code).toBe("LOCAL_MOUNT_CROSSED");
    expect(refused.message).toContain(`${nested} is on another volume than the backup destination`);
    expect(unwrapErr(await transport.list({ prefix: "" })).code).toBe("LOCAL_MOUNT_CROSSED");
    expect(unwrap(await plain.list({ prefix: "slopweaver/blobs/" }))).toEqual(["slopweaver/blobs/ab/x"]);
  });

  it("round-trips a nested object through upload, list, sizes, download and remove", async () => {
    const parent = scratch();
    const root = join(parent, "dest");
    const work = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    // The location names the pinned real place, the one every write actually lands in.
    expect(unwrap(await transport.probe()).location).toBe(join(realpathSync(parent), "dest"));
    const landed = unwrap(
      await transport.upload({
        objectName: "slopweaver/2026/manifest.json",
        path: source({ body: "hello", directory: work }),
      }),
    );
    expect(landed).toEqual({
      bytes: 5,
      name: "slopweaver/2026/manifest.json",
      sha256: createHash("sha256").update("hello").digest("hex"),
    });
    expect(unwrap(await transport.list({ prefix: "slopweaver/" }))).toEqual(["slopweaver/2026/manifest.json"]);
    expect([...unwrap(await transport.objectSizes({ prefix: "slopweaver/2026/" }))]).toEqual([
      ["slopweaver/2026/manifest.json", 5],
    ]);
    const back = join(work, "back.json");
    unwrap(await transport.download({ objectName: "slopweaver/2026/manifest.json", path: back }));
    expect(readFileSync(back, "utf8")).toBe("hello");
    unwrap(await transport.remove({ objectName: "slopweaver/2026/manifest.json" }));
    expect(unwrap(await transport.list({ prefix: "slopweaver/" }))).toEqual([]);
  });

  it("stores exactly the first n bytes when the upload is bounded", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    const landed = unwrap(
      await transport.upload({ bytes: 3, objectName: "a/b", path: source({ body: "abcdef", directory: scratch() }) }),
    );
    expect(landed.bytes).toBe(3);
    expect(readFileSync(join(root, "a/b"), "utf8")).toBe("abc");
  });

  it("stores an empty object for a zero bound and for an empty file", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(
      await transport.upload({ bytes: 0, objectName: "zero", path: source({ body: "abc", directory: scratch() }) }),
    );
    unwrap(await transport.upload({ objectName: "empty", path: source({ body: "", directory: scratch() }) }));
    expect(statSync(join(root, "zero")).size).toBe(0);
    expect(statSync(join(root, "empty")).size).toBe(0);
  });

  it("lists sorted names under a prefix and nothing outside it", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    const path = source({ body: "x", directory: scratch() });
    for (const name of ["p/chunks/b", "p/chunks/a", "p/blobs/c", "q/chunks/d"]) {
      unwrap(await transport.upload({ objectName: name, path }));
    }
    expect(unwrap(await transport.list({ prefix: "p/chunks/" }))).toEqual(["p/chunks/a", "p/chunks/b"]);
    expect(unwrap(await transport.list({ prefix: "p/" }))).toEqual(["p/blobs/c", "p/chunks/a", "p/chunks/b"]);
    expect(unwrap(await transport.list({ prefix: "absent/" }))).toEqual([]);
  });

  it("removes a missing object without failing", async () => {
    const transport = localDirectoryTransport({ root: scratch(), rootPolicy: "create" });
    expect((await transport.remove({ objectName: "never/there" })).isOk()).toBe(true);
  });

  it("replaces an object whole and leaves no temporary behind", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await transport.upload({ objectName: "o", path: source({ body: "old", directory: scratch() }) }));
    unwrap(await transport.upload({ objectName: "o", path: source({ body: "newer", directory: scratch() }) }));
    expect(readFileSync(join(root, "o"), "utf8")).toBe("newer");
    expect(readdirSync(root)).toEqual(["o"]);
  });

  it("writes objects 0600 and directories 0700", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await transport.upload({ objectName: "d/o", path: source({ body: "x", directory: scratch() }) }));
    expect(statSync(join(root, "d/o")).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "d")).mode & 0o777).toBe(0o700);
  });

  it.each([
    ["", "it is empty"],
    ["/etc/passwd", "it is absolute"],
    ["a/../../b", "it has an empty, '.' or '..' segment"],
    ["a/./b", "it has an empty, '.' or '..' segment"],
    ["a//b", "it has an empty, '.' or '..' segment"],
    ["a\\b", "it carries a backslash or a NUL"],
    ["a\0b", "it carries a backslash or a NUL"],
    ["a/.partial-x", "a segment starts with .partial-, which names an in-flight write"],
  ])("refuses the object name %j", (objectName, why) => {
    const refused = unwrapErr(localObjectPath({ objectName, root: "/dest" }));
    expect(refused.code).toBe("LOCAL_OBJECT_NAME_REFUSED");
    expect(refused.message).toContain(why);
  });

  it("refuses to write through a symbolic link below the root", async () => {
    const root = scratch();
    const elsewhere = scratch();
    symlinkSync(elsewhere, join(root, "linked"));
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    const refused = unwrapErr(
      await transport.upload({ objectName: "linked/o", path: source({ body: "x", directory: scratch() }) }),
    );
    expect(refused.code).toBe("LOCAL_SYMLINK_REFUSED");
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("refuses to list through a symbolic link planted in the tree", async () => {
    const root = scratch();
    mkdirSync(join(root, "p"));
    symlinkSync(scratch(), join(root, "p", "linked"));
    const refused = unwrapErr(await localDirectoryTransport({ root, rootPolicy: "create" }).list({ prefix: "p/" }));
    expect(refused.code).toBe("LOCAL_SYMLINK_REFUSED");
  });

  it("names a missing object when a download fails", async () => {
    const refused = unwrapErr(
      await localDirectoryTransport({ root: scratch(), rootPolicy: "create" }).download({
        objectName: "absent",
        path: join(scratch(), "x"),
      }),
    );
    expect(refused.code).toBe("LOCAL_OBJECT_READ_FAILED");
  });

  it("refuses a download onto the object's own stored path and leaves it unchanged", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await transport.upload({ objectName: "o", path: source({ body: "stored", directory: scratch() }) }));
    const refused = unwrapErr(await transport.download({ objectName: "o", path: join(root, "o") }));
    expect(refused).toEqual(LocalDestinationErrors.targetInside({ path: join(root, "o"), root: realpathSync(root) }));
    expect(refused.message).toBe(
      `${join(root, "o")} is inside the backup destination ${realpathSync(root)}; a download never writes there, or it would replace a stored object`,
    );
    expect(readFileSync(join(root, "o"), "utf8")).toBe("stored");
    expect(readdirSync(root)).toEqual(["o"]);
  });

  it("refuses a download onto a stored file whose name starts with two dots", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await transport.upload({ objectName: "source", path: source({ body: "attack", directory: scratch() }) }));
    writeFileSync(join(root, "..victim"), "keep");
    const refused = unwrapErr(await transport.download({ objectName: "source", path: join(root, "..victim") }));
    expect(refused.code).toBe("LOCAL_TARGET_INSIDE_DESTINATION");
    expect(readFileSync(join(root, "..victim"), "utf8")).toBe("keep");
  });

  it("refuses a download to a path that does not exist yet below the root", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await transport.upload({ objectName: "o", path: source({ body: "stored", directory: scratch() }) }));
    const refused = unwrapErr(await transport.download({ objectName: "o", path: join(root, "new", "deeper", "o") }));
    expect(refused.code).toBe("LOCAL_TARGET_INSIDE_DESTINATION");
    expect(readdirSync(root)).toEqual(["o"]);
  });

  it("refuses a download reaching the root through a symbolic link outside it", async () => {
    const root = scratch();
    const outside = scratch();
    symlinkSync(root, join(outside, "into"));
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await transport.upload({ objectName: "o", path: source({ body: "stored", directory: scratch() }) }));
    const refused = unwrapErr(await transport.download({ objectName: "o", path: join(outside, "into", "o") }));
    expect(refused.code).toBe("LOCAL_TARGET_INSIDE_DESTINATION");
    expect(readFileSync(join(root, "o"), "utf8")).toBe("stored");
  });

  it("refuses a download through a dangling link and holds such a path", async () => {
    const root = scratch();
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    unwrap(await transport.upload({ objectName: "o", path: source({ body: "stored", directory: scratch() }) }));
    const outside = scratch();
    symlinkSync(join(outside, "nothing-here"), join(outside, "link"));
    const target = join(outside, "link", "o");
    const refused = unwrapErr(await transport.download({ objectName: "o", path: target }));
    expect(refused.code).toBe("LOCAL_TARGET_UNRESOLVABLE");
    expect(transport.holds({ path: target })).toBe(true);
    expect(readdirSync(outside)).toEqual(["link"]);
  });

  it("refuses every operation when the root is a dangling link it cannot pin", async () => {
    const parent = scratch();
    const root = join(parent, "dest");
    symlinkSync(join(parent, "nothing-here"), root);
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    expect(unwrapErr(await transport.probe()).code).toBe("LOCAL_DESTINATION_UNREACHABLE");
    expect(
      unwrapErr(await transport.upload({ objectName: "o", path: source({ body: "x", directory: scratch() }) })).code,
    ).toBe("LOCAL_DESTINATION_UNREACHABLE");
    expect(transport.holds({ path: join(scratch(), "anywhere") })).toBe(true);
    expect(readdirSync(parent)).toEqual(["dest"]);
  });

  it("refuses every operation once a root absent at construction is created as a link", async () => {
    const parent = scratch();
    const root = join(parent, "dest");
    const transport = localDirectoryTransport({ root, rootPolicy: "create" });
    const other = scratch();
    const intoOther = localDirectoryTransport({ root: other, rootPolicy: "create" });
    unwrap(await intoOther.upload({ objectName: "o", path: source({ body: "attack", directory: scratch() }) }));
    unwrap(await intoOther.upload({ objectName: "victim", path: source({ body: "keep", directory: scratch() }) }));
    symlinkSync(other, root);
    const victim = join(other, "victim");
    expect(unwrapErr(await transport.download({ objectName: "o", path: victim })).code).toBe("LOCAL_SYMLINK_REFUSED");
    expect(unwrapErr(await transport.probe()).code).toBe("LOCAL_SYMLINK_REFUSED");
    expect(unwrapErr(await transport.list({ prefix: "" })).code).toBe("LOCAL_SYMLINK_REFUSED");
    expect(
      unwrapErr(await transport.upload({ objectName: "n", path: source({ body: "x", directory: scratch() }) })).code,
    ).toBe("LOCAL_SYMLINK_REFUSED");
    expect(unwrapErr(await transport.remove({ objectName: "victim" })).code).toBe("LOCAL_SYMLINK_REFUSED");
    expect(readFileSync(victim, "utf8")).toBe("keep");
    expect(readdirSync(other).toSorted()).toEqual(["o", "victim"]);
  });

  it("never makes an absent root under require-existing, and still makes one under create", async () => {
    const parent = scratch();
    const absent = join(parent, "unplugged");
    const refused = unwrapErr(await localDirectoryTransport({ root: absent, rootPolicy: "require-existing" }).probe());
    expect(refused.code).toBe("LOCAL_DESTINATION_UNREACHABLE");
    expect(readdirSync(parent)).toEqual([]);
    unwrap(await localDirectoryTransport({ root: absent, rootPolicy: "create" }).probe());
    expect(readdirSync(parent)).toEqual(["unplugged"]);
  });

  it("holds the root and below, never a sibling sharing its name as a prefix", () => {
    const parent = scratch();
    const transport = localDirectoryTransport({ root: join(parent, "dest"), rootPolicy: "create" });
    expect(transport.holds({ path: join(parent, "dest") })).toBe(true);
    expect(transport.holds({ path: join(parent, "dest", "a", "b") })).toBe(true);
    expect(transport.holds({ path: join(parent, "dest-other", "x") })).toBe(false);
    expect(transport.holds({ path: join(parent, "x") })).toBe(false);
  });
});
