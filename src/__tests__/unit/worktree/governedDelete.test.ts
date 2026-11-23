/**
 * A governed delete over plain fakes: the exact order of fseventsd reads, holds and removes, so the brake is proven
 * to act INSIDE one tree — a past storm was one tree's `rm` by itself — and each `rm` is proven to carry a
 * counted number of entries, never a path that names a subtree of any size.
 */
import { describe, expect, it } from "vitest";

import type { FseventsdCpu } from "../../../worktree/fseventsdGauge.js";
import {
  countEntriesUpTo,
  type DeleteSeams,
  governedDelete,
  HOLD_POLL_MS,
  QUANTUM_ENTRIES,
  removeBeforeDeadline,
} from "../../../worktree/governedDelete.js";

/** A directory's child directories by name, and how many plain files it holds. */
interface FakeDir {
  readonly dirs: readonly string[];
  readonly files: number;
}

/** A listing over a map of directory → its contents; a directory missing from the map cannot be listed. */
const fakeTree = ({ tree }: { tree: ReadonlyMap<string, FakeDir> }): DeleteSeams["list"] => {
  return ({ dir }) => {
    const node = tree.get(dir);
    if (node === undefined) {
      return { kind: "unlistable" };
    }
    const files = Array.from({ length: node.files }, (_, index) => ({
      isDirectory: false,
      path: `${dir}/f${String(index)}`,
    }));
    const dirs = node.dirs.map((name) => ({ isDirectory: true, path: `${dir}/${name}` }));
    return { entries: [...files, ...dirs], kind: "listed" };
  };
};

/** A trash batch holding one `node_modules` of `packages` packages of `files` files each. */
const trashBatch = ({ packages, files }: { packages: number; files: number }): DeleteSeams["list"] => {
  const names = Array.from({ length: packages }, (_, index) => `p${String(index)}`);
  const tree = new Map<string, FakeDir>([
    ["/t/batch", { dirs: ["node_modules"], files: 0 }],
    ["/t/batch/node_modules", { dirs: names, files: 0 }],
    ...names.map((name): [string, FakeDir] => [`/t/batch/node_modules/${name}`, { dirs: [], files }]),
  ]);
  return fakeTree({ tree });
};

/**
 * Fakes that write every effect to one log, with fseventsd answering `readings` in turn, the machine's lease held by
 * someone else for the first `busyClaims` attempts (and impossible to take at all when `unavailable`), and a clock that
 * advances when the delete sleeps and by `readMs` for each fseventsd read. Every `rm` answers `removeAnswer`.
 */
const recorder = ({
  list,
  readings,
  busyClaims = 0,
  unavailable = false,
  readMs = 0,
  removeAnswer = "go",
}: {
  list: DeleteSeams["list"];
  readings: readonly FseventsdCpu[];
  busyClaims?: number;
  unavailable?: boolean;
  readMs?: number;
  removeAnswer?: "go" | "deadline";
}): {
  seams: DeleteSeams;
  log: string[];
  windows: number[];
  removed: { trees: readonly string[]; leaves: readonly string[] }[];
  leases: { taken: number; released: number };
} => {
  const leases = { released: 0, taken: 0 };
  const log: string[] = [];
  const windows: number[] = [];
  const removed: { trees: readonly string[]; leaves: readonly string[] }[] = [];
  let clock = 0;
  let read = 0;
  let claims = 0;
  return {
    leases,
    log,
    removed,
    seams: {
      claim: () => {
        claims += 1;
        if (claims <= busyClaims) {
          log.push("lease busy");
          return { kind: "busy" };
        }
        if (unavailable) {
          return { kind: "unavailable", why: "ENOSPC" };
        }
        leases.taken += 1;
        return {
          kind: "held",
          release: () => {
            leases.released += 1;
          },
        };
      },
      gauge: ({ remainingMs }) => {
        const reading = readings[read]!;
        read += 1;
        clock += readMs;
        windows.push(remainingMs);
        log.push(`read ${reading.kind === "read" ? String(reading.cpu) : reading.kind}`);
        return reading;
      },
      list,
      now: () => clock,
      remove: ({ trees, leaves }) => {
        removed.push({ leaves, trees });
        log.push(`rm ${String(trees.length + leaves.length)}`);
        return removeAnswer;
      },
      sleep: ({ ms }) => {
        clock += ms;
        log.push(`sleep ${String(ms)}`);
      },
      unlock: ({ dir }) => {
        log.push(`unlock ${dir}`);
      },
    },
    windows,
  };
};

const at = ({ cpu }: { cpu: number }): FseventsdCpu => ({ cpu, kind: "read", pids: [97860] });

/** 40 packages of 30 files: 32 packages fill one quantum (32 × 31 = 992 entries), the other 8 the next. */
const FORTY_PACKAGES = trashBatch({ files: 30, packages: 40 });

describe("countEntriesUpTo", () => {
  it("counts every entry below a directory, files and directories alike", () => {
    const list = trashBatch({ files: 5, packages: 3 });
    expect(countEntriesUpTo({ cap: 64, dir: "/t/batch", seams: { list, unlock: () => {} }, unlocking: false })).toBe(
      1 + 3 + 15,
    );
  });

  it("stops at its cap", () => {
    expect(
      countEntriesUpTo({
        cap: 64,
        dir: "/t/batch",
        seams: { list: FORTY_PACKAGES, unlock: () => {} },
        unlocking: false,
      }),
    ).toBe("over");
  });

  it("reads a directory it cannot list as over, since it says nothing about its size", () => {
    const list = fakeTree({ tree: new Map([["/t/batch", { dirs: ["a"], files: 0 }]]) });
    expect(countEntriesUpTo({ cap: 64, dir: "/t/batch", seams: { list, unlock: () => {} }, unlocking: false })).toBe(
      "over",
    );
  });
});

describe("governedDelete", () => {
  it("removes a tree of at most 64 entries in one rm, still under the lease and after one read", () => {
    const { seams, log, leases } = recorder({
      list: trashBatch({ files: 5, packages: 3 }),
      readings: [at({ cpu: 1 })],
    });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("deleted");
    expect(log).toEqual(["read 1", "rm 1"]);
    expect(leases).toEqual({ released: 1, taken: 1 });
  });

  it("holds even a tree of at most 64 entries while fseventsd is hot, until its deadline", () => {
    const { seams, log } = recorder({
      list: trashBatch({ files: 5, packages: 3 }),
      readings: [at({ cpu: 30 }), at({ cpu: 30 })],
    });

    expect(governedDelete({ deadline: 3_000, dir: "/t/batch", seams, unlocking: false })).toBe("deadline");
    expect(log).toEqual(["read 30", "sleep 2000", "read 30", "sleep 1000"]);
  });

  it("removes a big tree in quanta of a counted number of entries, reading fseventsd before each", () => {
    const { seams, log } = recorder({ list: FORTY_PACKAGES, readings: [at({ cpu: 1 }), at({ cpu: 1 })] });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("deleted");
    // 32 packages, then the other 8 with node_modules and the batch itself, each emptied by then.
    expect(log).toEqual(["read 1", "rm 32", "read 1", "rm 10"]);
  });

  it("governs a narrow tree whose bulk sits deeper than any fixed number of levels", () => {
    // Four directories deep, then 70 files: two paths, but 74 entries, so it is not small.
    const list = fakeTree({
      tree: new Map([
        ["/t/batch", { dirs: ["a"], files: 0 }],
        ["/t/batch/a", { dirs: ["b"], files: 0 }],
        ["/t/batch/a/b", { dirs: ["c"], files: 0 }],
        ["/t/batch/a/b/c", { dirs: ["d"], files: 0 }],
        ["/t/batch/a/b/c/d", { dirs: [], files: 70 }],
      ]),
    });
    const { seams, log } = recorder({ list, readings: [at({ cpu: 113 })] });

    expect(governedDelete({ deadline: 1_000, dir: "/t/batch", seams, unlocking: false })).toBe("deadline");
    expect(log).toEqual(["read 113", "sleep 1000"]);
  });

  it("opens a package too big for one quantum rather than handing it to rm whole", () => {
    const list = trashBatch({ files: QUANTUM_ENTRIES + 500, packages: 1 });
    const { seams, log } = recorder({ list, readings: [at({ cpu: 1 }), at({ cpu: 1 }), at({ cpu: 1 })] });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("deleted");
    // Its 1,500 files go 512 at a time, the path cap, then the last 476 with the package, node_modules and the batch.
    expect(log).toEqual(["read 1", "rm 512", "read 1", "rm 512", "read 1", "rm 479"]);
  });

  it("holds mid-tree while fseventsd is hot, and resumes only under the lower bar", () => {
    const { seams, log } = recorder({
      list: FORTY_PACKAGES,
      readings: [at({ cpu: 1 }), at({ cpu: 47 }), at({ cpu: 15 }), at({ cpu: 9 })],
    });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("deleted");
    expect(log).toEqual([
      "read 1",
      "rm 32",
      "read 47",
      `sleep ${String(HOLD_POLL_MS)}`,
      "read 15",
      `sleep ${String(HOLD_POLL_MS)}`,
      "read 9",
      "rm 10",
    ]);
  });

  it("ends at its deadline while held, having removed only what it removed before the storm", () => {
    const { seams, log } = recorder({
      list: FORTY_PACKAGES,
      readings: [at({ cpu: 1 }), at({ cpu: 113 }), at({ cpu: 113 })],
    });

    expect(governedDelete({ deadline: 3_000, dir: "/t/batch", seams, unlocking: false })).toBe("deadline");
    expect(log).toEqual(["read 1", "rm 32", "read 113", "sleep 2000", "read 113", "sleep 1000"]);
  });

  it("gives every fseventsd read only the time the delete has left, so a stalled read cannot outrun the deadline", () => {
    const { seams, windows } = recorder({
      list: FORTY_PACKAGES,
      readings: [at({ cpu: 1 }), at({ cpu: 113 }), at({ cpu: 113 })],
    });

    governedDelete({ deadline: 3_000, dir: "/t/batch", seams, unlocking: false });
    expect(windows).toEqual([3_000, 3_000, 1_000]);
  });

  it("stops before its next quantum when fseventsd cannot be read", () => {
    const { seams, log } = recorder({
      list: FORTY_PACKAGES,
      readings: [at({ cpu: 1 }), { kind: "unreadable", why: "ps timed out" }],
    });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("unreadable");
    expect(log).toEqual(["read 1", "rm 32", "read unreadable"]);
  });

  it("never hands rm a directory it cannot list, nor any directory above it, even with fseventsd quiet", () => {
    // `bad` cannot be listed, so its size is unknown: only `good` goes, and the batch stays for the next pass.
    const list = fakeTree({
      tree: new Map([
        ["/t/batch", { dirs: ["good", "bad"], files: 0 }],
        ["/t/batch/good", { dirs: [], files: 100 }],
      ]),
    });
    const { seams, log } = recorder({ list, readings: [at({ cpu: 1 })] });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("incomplete");
    expect(log).toEqual(["read 1", "rm 1"]);
  });

  it("removes nothing at all when the tree itself cannot be listed", () => {
    const { seams, log } = recorder({ list: fakeTree({ tree: new Map() }), readings: [at({ cpu: 1 })] });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("incomplete");
    expect(log).toEqual([]);
  });

  it("hands rm a subtree whole only when it holds a quantum or fewer entries, itself included", () => {
    // p0 is 999 files and itself, exactly one quantum; p1 forces the quantum to close behind it.
    const tree = ({ files }: { files: number }): DeleteSeams["list"] =>
      fakeTree({
        tree: new Map([
          ["/t/batch", { dirs: ["p0", "p1"], files: 0 }],
          ["/t/batch/p0", { dirs: [], files }],
          ["/t/batch/p1", { dirs: [], files: 1 }],
        ]),
      });
    const fits = recorder({ list: tree({ files: QUANTUM_ENTRIES - 1 }), readings: [at({ cpu: 1 }), at({ cpu: 1 })] });
    const over = recorder({ list: tree({ files: QUANTUM_ENTRIES }), readings: [at({ cpu: 1 }), at({ cpu: 1 })] });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams: fits.seams, unlocking: false })).toBe("deleted");
    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams: over.seams, unlocking: false })).toBe("deleted");
    expect(fits.log).toEqual(["read 1", "rm 1", "read 1", "rm 2"]);
    // One file more and p0 is opened: 512 of its files, then the other 488 with p0, p1 and the batch.
    expect(over.log).toEqual(["read 1", "rm 512", "read 1", "rm 491"]);
  });

  it("hands rm -rf only counted subtrees, and every file and opened directory to rm -d, which keeps a non-empty one", () => {
    const list = trashBatch({ files: QUANTUM_ENTRIES + 500, packages: 1 });
    const { seams, removed } = recorder({ list, readings: [at({ cpu: 1 }), at({ cpu: 1 }), at({ cpu: 1 })] });

    governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false });
    expect(removed.map((quantum) => quantum.trees.length)).toEqual([0, 0, 0]);
    expect(removed[2]!.leaves.slice(-3)).toEqual(["/t/batch/node_modules/p0", "/t/batch/node_modules", "/t/batch"]);
  });

  it("removes each package whose count fits as one recursive tree", () => {
    const { seams, removed } = recorder({ list: FORTY_PACKAGES, readings: [at({ cpu: 1 }), at({ cpu: 1 })] });

    governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false });
    expect(removed.map((quantum) => [quantum.trees.length, quantum.leaves.length])).toEqual([
      [32, 0],
      [8, 2],
    ]);
  });

  it("waits for the machine's one delete lease before it reads fseventsd, and releases every lease it takes", () => {
    const { seams, log, leases } = recorder({
      busyClaims: 1,
      list: FORTY_PACKAGES,
      readings: [at({ cpu: 1 }), at({ cpu: 1 })],
    });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("deleted");
    expect(log).toEqual(["lease busy", `sleep ${String(HOLD_POLL_MS)}`, "read 1", "rm 32", "read 1", "rm 10"]);
    expect(leases).toEqual({ released: 2, taken: 2 });
  });

  it("still deletes, governed by fseventsd alone, when the lease cannot be taken at all", () => {
    const { seams, log, leases } = recorder({
      list: FORTY_PACKAGES,
      readings: [at({ cpu: 1 }), at({ cpu: 1 })],
      unavailable: true,
    });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("deleted");
    expect(log).toEqual(["sleep 2000", "read 1", "rm 32", "sleep 2000", "read 1", "rm 10"]);
    expect(leases).toEqual({ released: 0, taken: 0 });
  });

  it("without the lease, ends rather than start a quantum its whole pause no longer fits before", () => {
    const { seams, log } = recorder({ list: FORTY_PACKAGES, readings: [], unavailable: true });

    expect(governedDelete({ deadline: 1_999, dir: "/t/batch", seams, unlocking: false })).toBe("deadline");
    expect(log).toEqual([]);
  });

  it("starts no rm once the read that cleared it has run past the deadline", () => {
    const { seams, log } = recorder({ list: FORTY_PACKAGES, readMs: 5, readings: [at({ cpu: 1 })], unavailable: true });

    expect(governedDelete({ deadline: 2_001, dir: "/t/batch", seams, unlocking: false })).toBe("deadline");
    expect(log).toEqual(["sleep 2000", "read 1"]);
  });

  it("ends at the deadline, not deleted, when the deadline stopped part of a quantum's rm", () => {
    const { seams, log } = recorder({ list: FORTY_PACKAGES, readings: [at({ cpu: 1 })], removeAnswer: "deadline" });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: false })).toBe("deadline");
    expect(log).toEqual(["read 1", "rm 32"]);
  });

  it("ends at its deadline while another delete holds the lease, never reading or removing", () => {
    const { seams, log } = recorder({ busyClaims: 5, list: FORTY_PACKAGES, readings: [] });

    expect(governedDelete({ deadline: 3_000, dir: "/t/batch", seams, unlocking: false })).toBe("deadline");
    expect(log).toEqual(["lease busy", "sleep 2000", "lease busy", "sleep 1000"]);
  });

  it("unlocks each directory as the walk reaches it on a retry, before it lists it", () => {
    const { seams, log } = recorder({ list: trashBatch({ files: 1, packages: 2 }), readings: [at({ cpu: 1 })] });

    expect(governedDelete({ deadline: 60_000, dir: "/t/batch", seams, unlocking: true })).toBe("deleted");
    expect(log).toEqual([
      "unlock /t/batch",
      "unlock /t/batch/node_modules",
      "unlock /t/batch/node_modules/p1",
      "unlock /t/batch/node_modules/p0",
      "read 1",
      "rm 1",
    ]);
  });
});

describe("removeBeforeDeadline", () => {
  /**
   * A run that records each argv with the timeout it was handed, spends `spendMs` of the clock per `rm`, and answers
   * `timed-out` once it has spent the whole timeout it was given.
   */
  const timed = ({ spendMs }: { spendMs: number }) => {
    let clock = 0;
    const started: string[] = [];
    return {
      now: (): number => clock,
      run: ({ argv, timeoutMs }: { argv: readonly string[]; timeoutMs: number }): "finished" | "timed-out" => {
        started.push(`${argv.join(" ")} within ${String(timeoutMs)}`);
        clock += Math.min(spendMs, timeoutMs);
        return spendMs > timeoutMs ? "timed-out" : "finished";
      },
      started,
    };
  };

  it("ends at the deadline when the trees' rm was killed by its timeout, starting no other", () => {
    const { now, run, started } = timed({ spendMs: 25 });

    expect(removeBeforeDeadline({ deadline: 10, leaves: ["/t/a"], now, run, trees: ["/t/a/b"] })).toBe("deadline");
    expect(started).toEqual(["rm -rf /t/a/b within 10"]);
  });

  it("ends at the deadline when the last rm of a quantum was killed by its timeout", () => {
    const { now, run, started } = timed({ spendMs: 25 });

    expect(removeBeforeDeadline({ deadline: 10, leaves: ["/t/f"], now, run, trees: [] })).toBe("deadline");
    expect(started).toEqual(["rm -fd /t/f within 10"]);
  });

  it("starts the trees' rm, then the leaves', each bounded by the time its own clock read left", () => {
    const { now, run, started } = timed({ spendMs: 1 });

    expect(removeBeforeDeadline({ deadline: 10, leaves: ["/t/a"], now, run, trees: ["/t/a/b", "/t/a/c"] })).toBe("go");
    expect(started).toEqual(["rm -rf /t/a/b /t/a/c within 10", "rm -fd /t/a within 9"]);
  });

  it("never starts the leaves' rm once the trees' rm has spent the deadline, and says so", () => {
    const { now, run, started } = timed({ spendMs: 10 });

    expect(removeBeforeDeadline({ deadline: 10, leaves: ["/t/a"], now, run, trees: ["/t/a/b"] })).toBe("deadline");
    expect(started).toEqual(["rm -rf /t/a/b within 10"]);
  });

  it("starts no rm for an empty half", () => {
    const { now, run, started } = timed({ spendMs: 1 });

    expect(removeBeforeDeadline({ deadline: 10, leaves: ["/t/f"], now, run, trees: [] })).toBe("go");
    expect(started).toEqual(["rm -fd /t/f within 10"]);
  });
});
