/**
 * The poll gate's change token, over real files in a temp directory: an unchanged file keeps its token, a grown
 * one does not, and every target it cannot speak for whole answers `undefined`.
 */
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pollFingerprint, tokenUnchangedSince } from "../../../admit/pollFingerprint.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A fresh directory for one test's files, as its real path: darwin's temp root runs through the `/var` link, and a cwd
 * through a link vouches for no relative word.
 */
function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "slopweaver-poll-fp-")));
  dirs.push(dir);
  return dir;
}

/** A pinned mtime, in seconds, so a token is exact rather than read off the clock. */
const PINNED_S = 1_700_000_000;

/**
 * Write a file and pin its mtime.
 *
 * @param path where
 * @param text its contents
 * @returns the path
 */
function pinnedFile({ path, text }: { path: string; text: string }): string {
  writeFileSync(path, text, "utf8");
  utimesSync(path, PINNED_S, PINNED_S);
  return path;
}

/**
 * One file's token part, as the fingerprint writes it.
 *
 * @param path the file
 * @returns its path, real path, device and inode, size, mtime and ctime, NUL-joined
 */
function part({ path }: { path: string }): string {
  const { dev, ino, size, mtimeNs, ctimeNs } = lstatSync(path, { bigint: true });
  const identity = `${String(dev)}:${String(ino)}`;
  return [path, realpathSync.native(path), identity, String(size), String(mtimeNs), String(ctimeNs)].join("\u0000");
}

describe("pollFingerprint over one file", () => {
  it("is the path, the real path it resolves to, its device and inode, its size, mtime and ctime", () => {
    const file = pinnedFile({ path: join(tempDir(), "run.log"), text: "hello\n" });
    const { dev, ino, ctimeNs } = lstatSync(file, { bigint: true });
    // Nanoseconds, as bigints: the pinned mtime is whole seconds, so nine zeros follow it.
    const pinned = `${String(PINNED_S)}000000000`;
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [file] })).toBe(
      `${file}\u0000${realpathSync.native(file)}\u0000${String(dev)}:${String(ino)}\u00006\u0000${pinned}\u0000${String(ctimeNs)}`,
    );
  });

  it("moves when another file of the same size and mtime is renamed over it", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "hello\n" });
    const before = pollFingerprint({ cwd: "/", operands: [], paths: [file] });
    renameSync(pinnedFile({ path: join(dir, "next.log"), text: "world\n" }), file);
    const after = pollFingerprint({ cwd: "/", operands: [], paths: [file] });
    expect([before === undefined, after === before]).toEqual([false, false]);
  });

  it("is the same token on a second read of an untouched file", () => {
    const file = pinnedFile({ path: join(tempDir(), "run.log"), text: "hello\n" });
    const first = pollFingerprint({ cwd: "/", operands: [], paths: [file] });
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [file] })).toBe(first);
  });

  it("moves when the file grows, even with its mtime restored", () => {
    const file = pinnedFile({ path: join(tempDir(), "run.log"), text: "hello\n" });
    const before = pollFingerprint({ cwd: "/", operands: [], paths: [file] });
    appendFileSync(file, "more\n", "utf8");
    utimesSync(file, PINNED_S, PINNED_S);
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [file] })).not.toBe(before);
  });

  it("moves when only the mtime moves", () => {
    const file = pinnedFile({ path: join(tempDir(), "run.log"), text: "hello\n" });
    const before = pollFingerprint({ cwd: "/", operands: [], paths: [file] });
    utimesSync(file, PINNED_S + 5, PINNED_S + 5);
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [file] })).not.toBe(before);
  });

  it("resolves a relative path against the cwd it is given", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "hello\n" });
    expect(pollFingerprint({ cwd: dir, operands: [], paths: ["run.log"] })).toBe(
      pollFingerprint({ cwd: "/", operands: [], paths: [file] }),
    );
  });

  it("cannot vouch for a relative word when the cwd runs through a symbolic link, which may be repointed under the shell", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "a"));
    const file = pinnedFile({ path: join(dir, "a", "run.log"), text: "hello\n" });
    symlinkSync(join(dir, "a"), join(dir, "current"));
    expect(pollFingerprint({ cwd: join(dir, "current"), operands: [], paths: ["run.log"] })).toBeUndefined();
    expect(pollFingerprint({ cwd: join(dir, "current"), operands: [], paths: [file] })).toBe(part({ path: file }));
  });
});

describe("pollFingerprint over several files", () => {
  it("joins every named file in sorted order, whatever order they were named in", () => {
    const dir = tempDir();
    const a = pinnedFile({ path: join(dir, "a.log"), text: "a" });
    const b = pinnedFile({ path: join(dir, "b.log"), text: "bb" });
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [b, a] })).toBe(
      `${part({ path: a })}\n${part({ path: b })}`,
    );
  });

  it("cannot vouch when an earlier file grows while a later one is being held", () => {
    const dir = tempDir();
    const a = pinnedFile({ path: join(dir, "a.log"), text: "a" });
    const b = pinnedFile({ path: join(dir, "b.log"), text: "bb" });
    const growA = ({ file }: { file: string }): void => {
      if (file === b) {
        appendFileSync(a, "more", "utf8");
      }
    };
    expect(pollFingerprint({ cwd: "/", onHeld: growA, operands: [], paths: [a, b] })).toBeUndefined();
  });

  it("vouches for the same pair when nothing writes during the check", () => {
    const dir = tempDir();
    const a = pinnedFile({ path: join(dir, "a.log"), text: "a" });
    const b = pinnedFile({ path: join(dir, "b.log"), text: "bb" });
    const observed: string[] = [];
    const note = ({ file }: { file: string }): void => {
      observed.push(file);
    };
    expect(pollFingerprint({ cwd: "/", onHeld: note, operands: [], paths: [b, a] })).toBe(
      `${part({ path: a })}\n${part({ path: b })}`,
    );
    expect(observed).toEqual([a, b]);
  });
});

describe("pollFingerprint cannot vouch", () => {
  it("for no paths at all", () => {
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [] })).toBeUndefined();
  });

  it("for a path that does not exist", () => {
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [join(tempDir(), "absent.log")] })).toBeUndefined();
  });

  it("for a glob matching nothing", () => {
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [join(tempDir(), "*.log")] })).toBeUndefined();
  });

  it("for a directory, whose mtime says nothing about edits inside an existing child", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "handovers"));
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [join(dir, "handovers")] })).toBeUndefined();
  });

  it("for a set where one path exists and another does not", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "x" });
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [file, join(dir, "absent.log")] })).toBeUndefined();
  });

  it("for a symbolic link, even to a regular file — a repointed link can land on a same-sized file", () => {
    const dir = tempDir();
    const target = pinnedFile({ path: join(dir, "target.log"), text: "x" });
    symlinkSync(target, join(dir, "link.log"));
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [join(dir, "link.log")] })).toBeUndefined();
  });

  it("moves when a symbolic link to a parent directory is repointed at a same-sized file", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    pinnedFile({ path: join(dir, "a", "run.log"), text: "aaa" });
    pinnedFile({ path: join(dir, "b", "run.log"), text: "bbb" });
    symlinkSync(join(dir, "a"), join(dir, "current"));
    const before = pollFingerprint({ cwd: dir, operands: [], paths: ["current/run.log"] });
    rmSync(join(dir, "current"));
    symlinkSync(join(dir, "b"), join(dir, "current"));
    expect([
      before === undefined,
      pollFingerprint({ cwd: dir, operands: [], paths: ["current/run.log"] }) === before,
    ]).toEqual([false, false]);
  });

  it("follows a symbolic link before `..`, as the shell does, rather than collapsing the path as text", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "other", "child"), { recursive: true });
    pinnedFile({ path: join(dir, "run.log"), text: "base" });
    const opened = pinnedFile({ path: join(dir, "other", "run.log"), text: "other" });
    symlinkSync(join(dir, "other", "child"), join(dir, "link"));
    const token = pollFingerprint({ cwd: dir, operands: [], paths: ["link/../run.log"] })!;
    expect(token.split("\u0000")[1]).toBe(realpathSync.native(opened));
  });

  it("for a regular file this process cannot read, since the read itself fails", () => {
    const file = pinnedFile({ path: join(tempDir(), "secret.log"), text: "x" });
    chmodSync(file, 0o000);
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [file] })).toBeUndefined();
  });

  it("for an operand that exists but cannot be read", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "x" });
    chmodSync(pinnedFile({ path: join(dir, "notes"), text: "n" }), 0o000);
    expect(pollFingerprint({ cwd: dir, operands: ["notes"], paths: [file] })).toBeUndefined();
  });

  it("for an operand the lstat cannot answer for, behind a directory this process may not search", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "x" });
    const locked = join(dir, "locked");
    mkdirSync(locked);
    pinnedFile({ path: join(locked, "notes"), text: "n" });
    chmodSync(locked, 0o000);
    try {
      expect(pollFingerprint({ cwd: locked, operands: ["notes"], paths: [file] })).toBeUndefined();
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});

describe("pollFingerprint over a read's other operands", () => {
  it("skips an operand that names no file, so a grep and a tail of one untouched file share a token", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "x" });
    expect(pollFingerprint({ cwd: dir, operands: ["decidePoll"], paths: [file] })).toBe(part({ path: file }));
  });

  it("moves when a skipped operand appears, so `cat missing run.log` is not vouched for once `missing` exists", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "x" });
    const before = pollFingerprint({ cwd: dir, operands: ["missing"], paths: [file] });
    pinnedFile({ path: join(dir, "missing"), text: "m" });
    expect(pollFingerprint({ cwd: dir, operands: ["missing"], paths: [file] })).not.toBe(before);
  });

  it("includes an operand that exists as a file, so a change to it moves the token", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "x" });
    pinnedFile({ path: join(dir, "notes"), text: "n" });
    const before = pollFingerprint({ cwd: dir, operands: ["notes"], paths: [file] });
    appendFileSync(join(dir, "notes"), "more", "utf8");
    expect(pollFingerprint({ cwd: dir, operands: ["notes"], paths: [file] })).not.toBe(before);
  });

  it("cannot vouch when an operand exists as a directory", () => {
    const dir = tempDir();
    const file = pinnedFile({ path: join(dir, "run.log"), text: "x" });
    mkdirSync(join(dir, "logs"));
    expect(pollFingerprint({ cwd: dir, operands: ["logs"], paths: [file] })).toBeUndefined();
  });
});

describe("pollFingerprint never expands a glob", () => {
  it("cannot vouch for a glob, even one whose every match is static — expanding it reads a whole directory", () => {
    const dir = tempDir();
    pinnedFile({ path: join(dir, "a.md"), text: "a" });
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [join(dir, "*.md")] })).toBeUndefined();
  });

  it("vouches for a file whose literal name carries a glob character", () => {
    const file = pinnedFile({ path: join(tempDir(), "odd[1].log"), text: "x" });
    expect(pollFingerprint({ cwd: "/", operands: [], paths: [file] })).toBe(part({ path: file }));
  });

  it("cannot vouch for a file whose name holds a newline, which would split its part in two", () => {
    const dir = tempDir();
    const plain = pinnedFile({ path: join(dir, "plain.log"), text: "x" });
    const split = pinnedFile({ path: join(dir, "a\nb.log"), text: "x" });
    // The witness: the same call over the plain file alone does carry a token.
    expect([
      pollFingerprint({ cwd: "/", operands: [], paths: [plain] }),
      pollFingerprint({ cwd: "/", operands: [], paths: [plain, split] }),
    ]).toEqual([part({ path: plain }), undefined]);
  });
});

describe("tokenUnchangedSince", () => {
  it("holds for an equal token, and for a re-read naming fewer of the same untouched files", () => {
    const dir = tempDir();
    const first = pinnedFile({ path: join(dir, "a.log"), text: "a" });
    const second = pinnedFile({ path: join(dir, "b.log"), text: "b" });
    const both = pollFingerprint({ cwd: "/", operands: [], paths: [first, second] })!;
    const one = pollFingerprint({ cwd: "/", operands: [], paths: [first] })!;
    expect([tokenUnchangedSince({ last: both, token: both }), tokenUnchangedSince({ last: both, token: one })]).toEqual(
      [true, true],
    );
  });

  it("fails for a re-read naming a file the last read did not", () => {
    const dir = tempDir();
    const first = pinnedFile({ path: join(dir, "a.log"), text: "a" });
    const second = pinnedFile({ path: join(dir, "b.log"), text: "b" });
    const one = pollFingerprint({ cwd: "/", operands: [], paths: [first] })!;
    const both = pollFingerprint({ cwd: "/", operands: [], paths: [first, second] })!;
    expect(tokenUnchangedSince({ last: one, token: both })).toBe(false);
  });

  it("fails for a subset whose one file grew since the last read", () => {
    const dir = tempDir();
    const first = pinnedFile({ path: join(dir, "a.log"), text: "a" });
    const second = pinnedFile({ path: join(dir, "b.log"), text: "b" });
    const both = pollFingerprint({ cwd: "/", operands: [], paths: [first, second] })!;
    appendFileSync(first, "more", "utf8");
    utimesSync(first, PINNED_S, PINNED_S);
    const grown = pollFingerprint({ cwd: "/", operands: [], paths: [first] })!;
    expect(tokenUnchangedSince({ last: both, token: grown })).toBe(false);
  });
});
