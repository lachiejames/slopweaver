/**
 * Every voice call lease the consoles hold, read for the desktop install and for `fseventsd-bloated`: a missing
 * folder is no call, any other failure is an error, never "no call". The leases live under the cache root, and the
 * home's legacy docs-site directory is read too, for a console started before the move.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../cacheHome.js";
import {
  CallLeaseErrors,
  type CallLeaseSeams,
  readCallLeaseCopies,
  readCallLeases,
} from "../../../desktop/callLeases.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The real `node:fs` reads. */
const DISK: CallLeaseSeams = {
  names: ({ path }) => readdirSync(path),
  readText: ({ path }) => readFileSync(path, "utf8"),
};

/** A failure `node:fs` would throw, carrying its `code`. */
function coded({ code }: { code: string }): Error {
  return Object.assign(new Error(`${code}: refused`), { code });
}

/** Write one lease into `<docsSite>/<record>.hold/calls/`. */
function writeLease({ docsSite, name, text }: { docsSite: string; name: string; text: string }): void {
  const calls = join(docsSite, "slopweaver-1a2b3c4d.hold", "calls");
  mkdirSync(calls, { recursive: true });
  writeFileSync(join(calls, name), text);
}

let home: string;
let cacheRoot: string;
let docsSite: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-call-leases-"));
  cacheRoot = mkdtempSync(join(tmpdir(), "slop-call-leases-cache-"));
  docsSite = cachePaths({ root: cacheRoot }).docsSite;
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(cacheRoot, { force: true, recursive: true });
});

describe("readCallLeases", () => {
  it("reads no lease when no console has ever run", () => {
    expect(unwrap(readCallLeases({ cacheRoot, home, seams: DISK }))).toStrictEqual([]);
  });

  it("reads each console's `.json` leases under the cache root, and nothing else in its hold", () => {
    writeLease({ docsSite, name: "call-1.json", text: '{"callId":"c1","untilMs":2}' });
    writeLease({ docsSite, name: "call-1.json.tmp", text: "half a heartbeat" });
    mkdirSync(join(docsSite, "not-a-hold"));
    expect(unwrap(readCallLeases({ cacheRoot, home, seams: DISK }))).toStrictEqual(['{"callId":"c1","untilMs":2}']);
  });

  it("still reads a lease a console started before the move writes under the home", () => {
    writeLease({ docsSite: join(home, "docs-site"), name: "call-old.json", text: '{"callId":"old","untilMs":3}' });
    writeLease({ docsSite, name: "call-new.json", text: '{"callId":"new","untilMs":4}' });
    expect(unwrap(readCallLeases({ cacheRoot, home, seams: DISK }))).toStrictEqual([
      '{"callId":"old","untilMs":3}',
      '{"callId":"new","untilMs":4}',
    ]);
  });

  it("still reads a lease the migration moves from the home to the cache root between the two scans", () => {
    const legacy = join(home, "docs-site");
    writeLease({ docsSite: legacy, name: "call-1.json", text: '{"callId":"c1","untilMs":2}' });
    mkdirSync(docsSite, { recursive: true });
    let moved = false;
    const seams: CallLeaseSeams = {
      names: ({ path }) => {
        const names = readdirSync(path);
        if (!moved) {
          moved = true;
          mkdirSync(join(docsSite, "slopweaver-1a2b3c4d.hold"), { recursive: true });
          renameSync(
            join(legacy, "slopweaver-1a2b3c4d.hold", "calls"),
            join(docsSite, "slopweaver-1a2b3c4d.hold", "calls"),
          );
        }
        return names;
      },
      readText: ({ path }) => readFileSync(path, "utf8"),
    };
    expect(unwrap(readCallLeases({ cacheRoot, home, seams }))).toStrictEqual(['{"callId":"c1","untilMs":2}']);
  });

  it("reads a lease once when the migration's symlink lists it under both roots", () => {
    writeLease({ docsSite, name: "call-1.json", text: '{"callId":"c1","untilMs":2}' });
    symlinkSync(docsSite, join(home, "docs-site"));
    expect(unwrap(readCallLeases({ cacheRoot, home, seams: DISK }))).toStrictEqual(['{"callId":"c1","untilMs":2}']);
  });

  it("reads a lease once, the copy holding longer, when its heartbeat lands between the two scans of the symlink", () => {
    writeLease({ docsSite, name: "call-1.json", text: '{"callId":"c1","untilMs":2}' });
    symlinkSync(docsSite, join(home, "docs-site"));
    const lease = join(docsSite, "slopweaver-1a2b3c4d.hold", "calls", "call-1.json");
    let reads = 0;
    const seams: CallLeaseSeams = {
      names: ({ path }) => readdirSync(path),
      readText: ({ path }) => {
        const text = readFileSync(path, "utf8");
        reads += 1;
        if (reads === 1) {
          writeFileSync(lease, '{"callId":"c1","untilMs":9}');
        }
        return text;
      },
    };
    expect(unwrap(readCallLeases({ cacheRoot, home, seams }))).toStrictEqual(['{"callId":"c1","untilMs":9}']);
  });

  it("keeps the copy holding longer whichever root it is under, and a lease that parses over one that does not", () => {
    writeLease({ docsSite: join(home, "docs-site"), name: "call-1.json", text: '{"callId":"c1","untilMs":9}' });
    writeLease({ docsSite, name: "call-1.json", text: '{"callId":"c1","untilMs":2}' });
    writeLease({ docsSite: join(home, "docs-site"), name: "call-2.json", text: "torn" });
    writeLease({ docsSite, name: "call-2.json", text: '{"callId":"c2","untilMs":5}' });
    expect(unwrap(readCallLeases({ cacheRoot, home, seams: DISK }))).toStrictEqual([
      '{"callId":"c1","untilMs":9}',
      '{"callId":"c2","untilMs":5}',
    ]);
  });

  it("reads a lease swept between the listing and the read as no lease", () => {
    const seams: CallLeaseSeams = {
      names: ({ path }) => (path.endsWith("calls") ? ["call-1.json"] : ["x.hold"]),
      readText: () => {
        throw coded({ code: "ENOENT" });
      },
    };
    expect(unwrap(readCallLeases({ cacheRoot, home, seams }))).toStrictEqual([]);
  });

  it("refuses, never reading no call, when a listing fails for any reason but absence", () => {
    const seams: CallLeaseSeams = {
      names: () => {
        throw coded({ code: "EACCES" });
      },
      readText: () => "",
    };
    expect(unwrapErr(readCallLeases({ cacheRoot, home, seams }))).toStrictEqual(
      CallLeaseErrors.leaseUnreadable({ cause: coded({ code: "EACCES" }), path: join(home, "docs-site") }),
    );
    expect(unwrapErr(readCallLeases({ cacheRoot, home, seams })).detail).toBe("EACCES: refused");
  });
});

describe("readCallLeaseCopies — every copy, for the e2e on-call hold", () => {
  it("keeps a copy that does not parse beside one that does, home root first", () => {
    writeLease({ docsSite: join(home, "docs-site"), name: "call-2.json", text: "torn" });
    writeLease({ docsSite, name: "call-2.json", text: '{"callId":"c2","untilMs":0}' });
    expect(unwrap(readCallLeaseCopies({ cacheRoots: [cacheRoot], homes: [home], seams: DISK }))).toStrictEqual([
      { key: "slopweaver-1a2b3c4d.hold/call-2.json", text: "torn" },
      { key: "slopweaver-1a2b3c4d.hold/call-2.json", text: '{"callId":"c2","untilMs":0}' },
    ]);
  });

  it("reads no copy when no console has ever run", () => {
    expect(unwrap(readCallLeaseCopies({ cacheRoots: [cacheRoot], homes: [home], seams: DISK }))).toStrictEqual([]);
  });

  // A cache root moved by `SLOPWEAVER_CACHE_HOME` must not hide the console's lease under the OS default one. Every
  // root named is read, and one named twice is read once.
  it("reads a lease under every cache root named, each root once", () => {
    const moved = mkdtempSync(join(tmpdir(), "slop-call-leases-moved-"));
    try {
      writeLease({ docsSite, name: "owner-call.json", text: '{"callId":"owner","untilMs":1}' });
      const copies = unwrap(
        readCallLeaseCopies({ cacheRoots: [moved, cacheRoot, cacheRoot], homes: [home], seams: DISK }),
      );
      expect(copies).toStrictEqual([
        { key: "slopweaver-1a2b3c4d.hold/owner-call.json", text: '{"callId":"owner","untilMs":1}' },
      ]);
    } finally {
      rmSync(moved, { force: true, recursive: true });
    }
  });

  // A state home moved by `SLOPWEAVER_HOME` must not hide the lease under the default home's legacy docs-site. Every
  // home named is read, before every cache root.
  it("reads a lease under every state home named, homes before cache roots", () => {
    const moved = mkdtempSync(join(tmpdir(), "slop-call-leases-home-"));
    try {
      writeLease({ docsSite: join(home, "docs-site"), name: "owner-call.json", text: "legacy" });
      writeLease({ docsSite, name: "other.json", text: "current" });
      const copies = unwrap(readCallLeaseCopies({ cacheRoots: [cacheRoot], homes: [moved, home], seams: DISK }));
      expect(copies.map((copy) => copy.text)).toStrictEqual(["legacy", "current"]);
    } finally {
      rmSync(moved, { force: true, recursive: true });
    }
  });
});
