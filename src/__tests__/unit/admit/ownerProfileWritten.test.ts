/**
 * `src/admit/ownerProfileWritten.ts` — the mark `profile set` leaves, read by the first-boot evidence as a profile
 * that exists: written in every home named before the row, the row refused when a home cannot take it or a session's
 * first-boot mark, the marks this write made retracted only when the store proves no row, and one writer at a time.
 * The row write and the store's re-read are plain fakes passed in.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { firstBootSessionSeen } from "../../../admit/firstBootSession.js";
import { acquireOperationLockDetailed } from "../../../admit/operationLock.js";
import {
  type OwnerMarkedWrite,
  type OwnerRowState,
  settleOwnerMarks,
  writeUnderOwnerMark,
} from "../../../admit/ownerProfileWrite.js";
import { markOwnerProfileWritten, ownerProfileWrittenPath } from "../../../admit/ownerProfileWritten.js";
import { readFirstBootEvidence } from "../../../admit/profileFirstBoot.js";
import { neverConfigured } from "../../../admit/profileHeld.js";
import { err, ok, type Result, unwrap } from "../../../lib/result.js";

const made: string[] = [];

/** A fresh directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "owner-written-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const NOW = "2026-11-01T08:00:00.000Z";
/** The fingerprint of the store a row is written to, as `storeFingerprint` names one. */
const STORE = "0123456789abcdef";
/** Another store's fingerprint. */
const OTHER = "fedcba9876543210";

/** Whether `homes` read together as a machine the owner's profile never reached. */
function fresh({ homes }: { homes: readonly string[] }): boolean {
  return neverConfigured({ evidence: unwrap(readFirstBootEvidence({ homes })) });
}

/** A row write that records it ran and answers `result`. */
function rowWrite({
  ran,
  result,
}: {
  ran: string[];
  result: Result<number, string>;
}): () => Promise<Result<number, string>> {
  return () => {
    ran.push("write");
    return Promise.resolve(result);
  };
}

/** {@link writeUnderOwnerMark} with a lock home of its own and a re-read answering `row`. */
function under({
  homes,
  write,
  row,
  lockHome = tempDir(),
  nowIso = NOW,
  sessionIds = [],
}: {
  homes: readonly string[];
  write: () => Promise<Result<number, string>>;
  row: OwnerRowState;
  lockHome?: string;
  nowIso?: string;
  sessionIds?: readonly string[];
}): Promise<OwnerMarkedWrite<number, string>> {
  return writeUnderOwnerMark({
    homes,
    lockHome,
    nowIso,
    rowState: () => Promise.resolve(row),
    sessionIds,
    store: STORE,
    write,
  });
}

describe("the owner-written mark", () => {
  it("is written in every home named, and turns a first boot into a configured machine", () => {
    // A session that wrote the profile after an empty live read acted on it unloaded.
    const resolved = join(tempDir(), "state");
    const fallback = tempDir();
    const before = fresh({ homes: [resolved, fallback] });
    const marked = markOwnerProfileWritten({ homes: [resolved, fallback, fallback], store: STORE });
    const after = [resolved, fallback].map((home) => fresh({ homes: [home] }));

    expect([before, marked, after]).toEqual([
      true,
      {
        created: [ownerProfileWrittenPath({ home: resolved }), ownerProfileWrittenPath({ home: fallback })],
        failed: [],
      },
      [false, false],
    ]);
  });

  it("names a home that could not take the mark, and counts a mark already there as no creation", () => {
    const blocked = tempDir();
    writeFileSync(join(blocked, "profile"), "");
    const already = tempDir();
    markOwnerProfileWritten({ homes: [already], store: STORE });

    expect(markOwnerProfileWritten({ homes: [blocked, already], store: STORE })).toEqual({
      created: [],
      failed: [blocked],
    });
    expect(ownerProfileWrittenPath({ home: already })).toBe(join(already, "profile", "owner-written"));
  });

  it("adds a second store to a mark already there rather than replacing it, and leaves no staging file", () => {
    // A mark naming store A stood in for a row written to store B, so an empty read of A deleted
    // B's only evidence. No hard link, since an exFAT home takes none — a rename under the lock instead.
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: OTHER });
    const again = markOwnerProfileWritten({ homes: [home], store: STORE });
    const repeat = markOwnerProfileWritten({ homes: [home], store: STORE });

    expect([again, repeat, readFileSync(ownerProfileWrittenPath({ home }), "utf8")]).toEqual([
      { created: [ownerProfileWrittenPath({ home })], failed: [] },
      { created: [], failed: [] },
      `${OTHER}\n${STORE}`,
    ]);
    expect(readdirSync(join(home, "profile")).toSorted()).toEqual(["first-boot", "owner-written"]);
  });

  it("refuses a home whose mark path cannot be read as a mark", () => {
    const home = tempDir();
    mkdirSync(ownerProfileWrittenPath({ home }), { recursive: true });

    expect(markOwnerProfileWritten({ homes: [home], store: STORE })).toEqual({ created: [], failed: [home] });
  });

  it("names a home whose first-boot session directory cannot take a mark, and leaves no owner mark there", () => {
    // With `profile/first-boot/` unwritable, a first-boot session wrote the profile and its door
    // write passed, since no mark said the session began on a first boot.
    const blocked = tempDir();
    mkdirSync(join(blocked, "profile"));
    writeFileSync(join(blocked, "profile", "first-boot"), "");

    expect(markOwnerProfileWritten({ homes: [blocked], store: STORE })).toEqual({ created: [], failed: [blocked] });
    expect(existsSync(ownerProfileWrittenPath({ home: blocked }))).toBe(false);
  });
});

describe("writeUnderOwnerMark", () => {
  it("leaves the mark in every home once the row lands", async () => {
    const homes = [tempDir(), tempDir()];
    const ran: string[] = [];
    const marked = await under({ homes, row: "absent", write: rowWrite({ ran, result: ok(1) }) });

    expect(marked.kind).toBe("attempted");
    expect([ran, homes.map((home) => fresh({ homes: [home] }))]).toEqual([["write"], [false, false]]);
  });

  it("retracts the marks when the row write fails and the store proves no row, so a fresh machine stays one", async () => {
    // A first `profile set` whose insert failed left its mark over an empty owner table, and
    // every later call was held behind a `profile context` that could only ever load nothing.
    const homes = [tempDir(), join(tempDir(), "state")];
    const marked = await under({ homes, row: "absent", write: rowWrite({ ran: [], result: err("insert rejected") }) });

    expect(marked).toEqual({ kept: [], kind: "attempted", result: err("insert rejected") });
    expect(fresh({ homes })).toBe(true);
  });

  it("keeps the marks when the write failed but the store holds a row, as one another writer committed", async () => {
    // The writer that made the marks lost the insert to one that found them made, and its
    // retraction erased the only evidence of the winner's row.
    const homes = [tempDir()];
    const marked = await under({ homes, row: "present", write: rowWrite({ ran: [], result: err("duplicate key") }) });

    expect(marked).toEqual({ kept: [], kind: "attempted", result: err("duplicate key") });
    expect(fresh({ homes })).toBe(false);
  });

  it("keeps the marks, and names them, when the store cannot say whether a row exists", async () => {
    const home = tempDir();
    const marked = await under({ homes: [home], row: "unknown", write: rowWrite({ ran: [], result: err("timeout") }) });

    expect(marked).toEqual({
      kept: [ownerProfileWrittenPath({ home })],
      kind: "attempted",
      result: err("timeout"),
    });
  });

  it("retracts the marks when the row write throws and no row exists, and lets the throw through", async () => {
    const homes = [tempDir()];
    const thrown = under({ homes, row: "absent", write: () => Promise.reject(new Error("connection reset")) });

    await expect(thrown).rejects.toThrow("connection reset");
    expect(fresh({ homes })).toBe(true);
  });

  it("keeps a mark an earlier write left when this one fails, since a profile already exists", async () => {
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: STORE });
    const marked = await under({ homes: [home], row: "absent", write: rowWrite({ ran: [], result: err("conflict") }) });

    expect([marked.kind, existsSync(ownerProfileWrittenPath({ home }))]).toEqual(["attempted", true]);
  });

  it("refuses the row when any home cannot take the mark, and retracts the marks it did leave", async () => {
    // A full disk let `profile set` write the row with no mark anywhere, and every gate read the
    // machine as a first boot over a profile that existed.
    const blocked = tempDir();
    writeFileSync(join(blocked, "profile"), "");
    const open = tempDir();
    const ran: string[] = [];
    const marked = await under({ homes: [open, blocked], row: "absent", write: rowWrite({ ran, result: ok(1) }) });

    expect(marked).toEqual({ failed: [blocked], kept: [], kind: "refused" });
    expect([ran, fresh({ homes: [open] })]).toEqual([[], true]);
  });

  it("refuses a second writer while one holds the owner-write lock, and touches no home", async () => {
    const lockHome = tempDir();
    const held = unwrap(acquireOperationLockDetailed({ home: lockHome, key: "owner-profile-write", nowIso: NOW }));
    const home = tempDir();
    const ran: string[] = [];
    const marked = await under({ homes: [home], lockHome, row: "absent", write: rowWrite({ ran, result: ok(1) }) });
    const untouched = fresh({ homes: [home] });
    held.release();
    const after = await under({ homes: [home], lockHome, row: "absent", write: rowWrite({ ran, result: ok(1) }) });

    expect([marked.kind, untouched, after.kind, ran]).toEqual(["locked", true, "attempted", ["write"]]);
  });

  it("leaves each mark naming the store its row was written to", async () => {
    const home = tempDir();
    await under({ homes: [home], row: "absent", write: rowWrite({ ran: [], result: ok(1) }) });

    expect(readFileSync(ownerProfileWrittenPath({ home }), "utf8")).toBe(STORE);
    // Renamed into place from a staging file, so a kill can never leave a mark short of its fingerprint, and no
    // staging file outlives the call.
    expect(readdirSync(join(home, "profile")).toSorted()).toEqual(["first-boot", "owner-written"]);
  });

  it("marks the session it runs in as a first-boot one in every home, before the row", async () => {
    // A hook-time mark failed, the same call cleared the obstruction, wrote the profile and
    // passed the door, which could not tell that session from one that never met a first boot.
    const homes = [tempDir(), join(tempDir(), "state")];
    const marked = await under({
      homes,
      row: "absent",
      sessionIds: ["s-1"],
      write: rowWrite({ ran: [], result: ok(1) }),
    });

    expect([marked.kind, homes.map((home) => firstBootSessionSeen({ homes: [home], sessionIds: ["s-1"] }))]).toEqual([
      "attempted",
      [true, true],
    ]);
  });

  it("refuses the row when its own session cannot be marked, and leaves no owner mark", async () => {
    const home = tempDir();
    mkdirSync(join(home, "profile", "first-boot", "s-1"), { recursive: true });
    const ran: string[] = [];
    const marked = await under({
      homes: [home],
      row: "absent",
      sessionIds: ["s-1"],
      write: rowWrite({ ran, result: ok(1) }),
    });

    expect([marked, ran, fresh({ homes: [home] })]).toEqual([{ failed: [home], kept: [], kind: "refused" }, [], true]);
  });
});

describe("settleOwnerMarks", () => {
  /** {@link settleOwnerMarks} over a load answering `absent`, with a lock home of its own. */
  function settle({
    homes,
    absent,
    lockHome = tempDir(),
    nowIso = NOW,
    store = STORE,
  }: {
    homes: readonly string[];
    absent: boolean;
    lockHome?: string;
    nowIso?: string;
    store?: string;
  }): ReturnType<typeof settleOwnerMarks<string>> {
    return settleOwnerMarks({
      homes,
      load: () => Promise.resolve("loaded"),
      lockHome,
      nowIso,
      disproved: () => (absent ? store : undefined),
    });
  }

  it("withdraws the store the load itself answered from, never one read beside it", async () => {
    // The store to withdraw was read separately from the store the live read used, so a selection
    // changed between the two reads let an empty read of store B erase store A's mark.
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: STORE });
    markOwnerProfileWritten({ homes: [home], store: OTHER });
    const settled = await settleOwnerMarks({
      disproved: (loaded) => loaded.ownerAbsentIn,
      homes: [home],
      load: () => Promise.resolve({ ownerAbsentIn: OTHER }),
      lockHome: tempDir(),
      nowIso: NOW,
    });

    expect([settled.retracted, readFileSync(ownerProfileWrittenPath({ home }), "utf8")]).toEqual([
      [ownerProfileWrittenPath({ home })],
      STORE,
    ]);
  });

  it("withdraws only the disproved store, so a row another store holds keeps its mark", async () => {
    // A `profile set` killed after marking store A, a second one that wrote its row to store B
    // reusing that mark, then `profile context` reading A empty — and B's configured profile read as a first boot.
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: OTHER });
    await under({ homes: [home], row: "present", write: rowWrite({ ran: [], result: ok(1) }) });
    const settled = await settle({ absent: true, homes: [home], store: OTHER });

    expect([
      settled.retracted,
      readFileSync(ownerProfileWrittenPath({ home }), "utf8"),
      fresh({ homes: [home] }),
    ]).toEqual([[ownerProfileWrittenPath({ home })], STORE, false]);
  });

  it("withdraws a failed write's store from a mark that names another, leaving that one", async () => {
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: OTHER });
    const marked = await under({
      homes: [home],
      row: "absent",
      write: rowWrite({ ran: [], result: err("insert failed") }),
    });

    expect([marked.kind, readFileSync(ownerProfileWrittenPath({ home }), "utf8")]).toEqual(["attempted", OTHER]);
  });

  it("retracts a mark a killed `profile set` left, once the store it names holds no row", async () => {
    // SIGKILL between the mark and the row ran no retraction, and the mark held a fresh machine
    // for a profile no store had, behind a `profile context` that could only load nothing.
    const homes = [tempDir(), join(tempDir(), "state")];
    markOwnerProfileWritten({ homes, store: STORE });
    const before = fresh({ homes });
    const settled = await settle({ absent: true, homes });

    expect([before, settled, fresh({ homes })]).toEqual([
      false,
      { kept: [], loaded: "loaded", retracted: homes.map((home) => ownerProfileWrittenPath({ home })) },
      true,
    ]);
  });

  it("keeps a mark when the store holds a row, or when the mark names another store", async () => {
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: STORE });
    const other = tempDir();
    markOwnerProfileWritten({ homes: [other], store: OTHER });

    expect([
      (await settle({ absent: false, homes: [home] })).retracted,
      (await settle({ absent: true, homes: [other] })).retracted,
      fresh({ homes: [home] }),
      fresh({ homes: [other] }),
    ]).toEqual([[], [], false, false]);
  });

  it("retracts nothing while a writer holds the owner-write lock, since that writer settles its own marks", async () => {
    const lockHome = tempDir();
    const held = unwrap(acquireOperationLockDetailed({ home: lockHome, key: "owner-profile-write", nowIso: NOW }));
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: STORE });
    const settled = await settle({ absent: true, homes: [home], lockHome });
    held.release();

    expect([settled, fresh({ homes: [home] })]).toEqual([{ kept: [], loaded: "loaded", retracted: [] }, false]);
  });

  it("never takes the lock from a live writer however long it has held it, so its marks survive an empty read", async () => {
    // A `profile set` blocked in its insert past the ordinary 15-minute expiry lost the lock to
    // `profile context`, which retracted its marks on an empty read before the insert committed with no mark anywhere.
    const lockHome = tempDir();
    const held = unwrap(acquireOperationLockDetailed({ home: lockHome, key: "owner-profile-write", nowIso: NOW }));
    const home = tempDir();
    markOwnerProfileWritten({ homes: [home], store: STORE });
    const later = "2026-11-01T09:00:00.000Z";
    const settled = await settle({ absent: true, homes: [home], lockHome, nowIso: later });
    const second = await under({
      homes: [home],
      lockHome,
      nowIso: later,
      row: "absent",
      write: rowWrite({ ran: [], result: ok(1) }),
    });
    held.release();

    expect([settled.retracted, second.kind, fresh({ homes: [home] })]).toEqual([[], "locked", false]);
  });
});
