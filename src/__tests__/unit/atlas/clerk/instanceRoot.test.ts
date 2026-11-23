/**
 * The remembered instance root — the third and last probe, and the one that makes a walk independent of
 * where the owner's browser was last pointed.
 *
 * Its validation is asserted on both sides, because the same rule governs a hand-edited file and a `--root`
 * somebody typed: nothing that is not a path may ever be interpolated into a URL the walk visits.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clerkInstanceRootPath,
  isClerkInstanceRoot,
  readClerkInstanceRoot,
  writeClerkInstanceRoot,
} from "../../../../atlas/clerk/instanceRoot.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T11:00:00.000Z";
const ROOT = "/apps/app_0SYNFIXTUREAPP0000000000000/instances/ins_0SYNFIXTUREINS0000000000000";

const directories: string[] = [];

/** A throwaway atlas directory, removed in `afterEach` so a long-lived dev machine does not accumulate them. */
function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "slopweaver-clerk-root-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("isClerkInstanceRoot", () => {
  it("accepts the shape the dashboard's own address carries", () => {
    expect(isClerkInstanceRoot({ root: ROOT })).toBe(true);
  });

  it("rejects a root that names an application and no instance", () => {
    expect(isClerkInstanceRoot({ root: "/apps/app_0SYNFIXTUREAPP0000000000000" })).toBe(false);
  });

  it("rejects a root carrying a page beneath the instance, which would double the path", () => {
    expect(isClerkInstanceRoot({ root: `${ROOT}/domains` })).toBe(false);
  });

  it("rejects an absolute URL, which is the most available way to get this wrong", () => {
    expect(isClerkInstanceRoot({ root: `https://dashboard.clerk.com${ROOT}` })).toBe(false);
  });

  it("rejects a traversal segment", () => {
    expect(isClerkInstanceRoot({ root: "/apps/../../etc/instances/x" })).toBe(false);
  });
});

describe("writeClerkInstanceRoot then readClerkInstanceRoot", () => {
  it("round-trips a well-formed root", () => {
    const directory = scratch();
    unwrap(writeClerkInstanceRoot({ at: AT, directory, root: ROOT }));
    expect(unwrap(readClerkInstanceRoot({ directory }))).toBe(ROOT);
  });

  it("refuses to write a malformed root, naming the shape it wanted", () => {
    const directory = scratch();
    const written = writeClerkInstanceRoot({ at: AT, directory, root: "not-a-root" });
    expect(unwrapErr(written)).toHaveLength(1);
    expect(unwrap(readClerkInstanceRoot({ directory }))).toBe(null);
  });

  it("says what a root must read when it refuses one", () => {
    const written = writeClerkInstanceRoot({ at: AT, directory: scratch(), root: "not-a-root" });
    expect(unwrapErr(written)).toEqual([
      '"not-a-root" is not a Clerk instance root — it must read /apps/<application>/instances/<instance>, exactly as the dashboard\'s own address does',
    ]);
  });

  it("says the root could not be remembered, and never which root, when the write fails", () => {
    const directory = join(scratch(), "a-file");
    writeFileSync(directory, "");
    const failure = unwrapErr(writeClerkInstanceRoot({ at: AT, directory, root: ROOT }));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toContain("the Clerk instance root could not be remembered: ");
    expect(failure[0]).not.toContain(ROOT);
  });

  it("replaces what was remembered, so a fresh probe always wins", () => {
    const directory = scratch();
    unwrap(writeClerkInstanceRoot({ at: AT, directory, root: ROOT }));
    const next = "/apps/app_other000000000000000/instances/ins_other000000000000000";
    unwrap(writeClerkInstanceRoot({ at: AT, directory, root: next }));
    expect(unwrap(readClerkInstanceRoot({ directory }))).toBe(next);
  });
});

describe("readClerkInstanceRoot", () => {
  it("answers null when nothing has ever been remembered", () => {
    expect(unwrap(readClerkInstanceRoot({ directory: scratch() }))).toBe(null);
  });

  it("refuses a file that is not JSON, rather than reading it as nothing remembered", () => {
    const directory = scratch();
    const path = clerkInstanceRootPath({ directory });
    writeFileSync(path, "{ not json");
    const failure = unwrapErr(readClerkInstanceRoot({ directory }));
    expect(failure.code).toBe("CLERK_REMEMBERED_ROOT_UNREADABLE");
    expect(failure.message).toBe(
      `the remembered Clerk instance root at ${path} is there but cannot be trusted (it is not JSON) — delete that file, or pass --root /apps/<application>/instances/<instance> to overwrite it`,
    );
  });

  it("refuses a hand-edited root that no longer has the shape, and never quotes what it found", () => {
    const directory = scratch();
    writeFileSync(clerkInstanceRootPath({ directory }), JSON.stringify({ root: "https://elsewhere.test/" }));
    const failure = unwrapErr(readClerkInstanceRoot({ directory }));
    expect(failure.code).toBe("CLERK_REMEMBERED_ROOT_UNREADABLE");
    expect(failure.message).toContain("(its root does not read /apps/<application>/instances/<instance>)");
    expect(failure.message).not.toContain("elsewhere.test");
  });

  it("refuses a JSON file carrying no root string", () => {
    const directory = scratch();
    writeFileSync(clerkInstanceRootPath({ directory }), JSON.stringify({ learnedAt: AT }));
    expect(unwrapErr(readClerkInstanceRoot({ directory })).message).toContain("(it carries no root string)");
  });

  it("refuses JSON that is not an object", () => {
    const directory = scratch();
    writeFileSync(clerkInstanceRootPath({ directory }), JSON.stringify([ROOT]));
    expect(unwrapErr(readClerkInstanceRoot({ directory })).message).toContain("(it is not a JSON object)");
  });

  it("refuses a dangling symlink, which reads ENOENT but is an entry that is there", () => {
    const directory = scratch();
    symlinkSync(join(directory, "gone.json"), clerkInstanceRootPath({ directory }));
    const failure = unwrapErr(readClerkInstanceRoot({ directory }));
    expect(failure.code).toBe("CLERK_REMEMBERED_ROOT_UNREADABLE");
    expect(failure.message).toContain("ENOENT");
  });

  it("refuses a path that is there but cannot be read as a file, quoting the filesystem's reason", () => {
    const directory = scratch();
    mkdirSync(clerkInstanceRootPath({ directory }));
    expect(unwrapErr(readClerkInstanceRoot({ directory })).message).toContain("EISDIR");
  });

  it("records when it was learned, so a reader can see how old the fallback is", () => {
    const directory = scratch();
    unwrap(writeClerkInstanceRoot({ at: AT, directory, root: ROOT }));
    expect(unwrap(readClerkInstanceRoot({ directory }))).toBe(ROOT);
  });
});
