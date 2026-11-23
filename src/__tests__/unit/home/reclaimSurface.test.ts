// The respell verb's registration assertion went out with the verb.
// deleted-with-code: homeRespellCommand
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HOME_RECLAIM_FLAG_NAMES,
  HOME_RECLAIMED_FLAG_NAMES,
  parseHomeReclaimArgs,
  RECLAIM_USAGE,
  RECLAIMED_USAGE,
} from "../../../cli/commands/home/core.js";
import { type HomeReclaimedDeps, runHomeReclaimed } from "../../../cli/commands/home/reclaimedRun.js";
import { homeManifest } from "../../../cli/manifests/home.js";
import { HomeReclaimErrors } from "../../../home/reclaim/errors.js";
import { type ReclaimJournalRow, renderReclaimRow } from "../../../home/reclaim/journalRow.js";
import { appendReclaimRow, readReclaimLedger, reclaimLedgerPath } from "../../../home/reclaim/journalStore.js";
import { reclaimFinishedScratch } from "../../../home/reclaim/run.js";
import { removeEntry, stillExists, walkFiles } from "../../../home/reclaim/scan.js";

let home = "";

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A throwaway home, so nothing here writes into the ambient `$SLOPWEAVER_HOME`. */
function freshHome(): string {
  home = mkdtempSync(join(tmpdir(), "reclaim-surface-"));
  return home;
}

/** Write a file, creating its directory. */
function put({ path, text }: { path: string; text: string }): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** One gibibyte, the sparse fixture's logical length. */
const GIB = 1024 * 1024 * 1024;

/** The storage a file holds, read the way the reclaim reads it: `st_blocks × 512`. */
function allocated({ path }: { path: string }): number {
  return lstatSync(path).blocks * 512;
}

/**
 * A row from the RETIRED `duplicate-copy` class, carrying its `survivingDigests` — the one a past reclaim
 * wrote, in shape. Kept as the fixture on purpose: dropping the field from the type would have
 * made that act unreadable, and a ledger that cannot print what it most needs to explain is worse than one
 * carrying a field nothing writes any more.
 */
const historicalRow: ReclaimJournalRow = {
  atIso: "2026-09-21T20:37:59.788Z",
  freedBytes: 2 * 1024 * 1024,
  removedEntries: 7,
  root: "supervisor-scratch",
  session: "workspace:1",
  survivingDigests: 12,
  takes: "duplicate-copy",
  witnessHeld: true,
};

/** What a run writes now: one class, and no content column at all. */
const row: ReclaimJournalRow = {
  atIso: "2026-09-22T00:00:00.000Z",
  freedBytes: 2 * 1024 * 1024,
  removedEntries: 7,
  root: "codex-scratch",
  session: "workspace:1",
  takes: "finished-scratch",
  witnessHeld: true,
};

describe("HomeReclaimErrors", () => {
  it("names the declared roots on a root it does not carry", () => {
    const error = HomeReclaimErrors.rootNotDeclared({ declared: ["a", "b"], named: "corpus" });
    expect(error.code).toBe("ROOT_NOT_DECLARED");
    expect(error.message).toBe('no reclaim root is declared as "corpus" — declared roots are a, b');
  });

  it("carries the path a scan failed on", () => {
    const error = HomeReclaimErrors.scanFailed({ cause: new Error("EACCES"), path: "/x" });
    expect(error.code).toBe("SCAN_FAILED");
    expect(error.message).toBe("could not walk /x: EACCES");
  });

  it("names how many kept paths a witness lost", () => {
    const error = HomeReclaimErrors.witnessFailed({ lostPaths: ["p", "q"] });
    expect(error.code).toBe("WITNESS_FAILED");
    expect(error.message).toBe("the reclaim lost information: 2 kept path(s) no longer exist");
  });

  it("survives a non-Error cause rather than printing undefined", () => {
    expect(HomeReclaimErrors.applyFailed({ cause: "a string", path: "/y" }).message).toBe(
      "could not remove /y: unknown failure",
    );
  });
});

describe("renderReclaimRow", () => {
  it("renders the run's own numbers and its witness", () => {
    const line = renderReclaimRow({ row });
    expect(line).toContain("2026-09-22T00:00:00.000Z  codex-scratch (finished-scratch)");
    expect(line).toContain("removed 7 entr(ies), freed 2.0 MiB — witness held");
    expect(line).toContain("ran by workspace:1");
  });

  it("still prints a retired duplicate-copy row, content column and all", () => {
    const line = renderReclaimRow({ row: historicalRow });
    expect(line).toContain("2026-09-21T20:37:59.788Z  supervisor-scratch (duplicate-copy)");
    expect(line).toContain("removed 7 entr(ies), freed 2.0 MiB, 12 content(s) survive — witness held");
  });

  // The shape the real ledger's first row has: the old code wrote `survivingDigests` on every row, so the
  // build-tree run carries a 0 it never computed. The input CARRIES the field the assertion
  // calls absent from the output, so this reddens if the column is ever rendered off presence again.
  it("drops the content column on a build-tree row that carries a survivingDigests it never judged", () => {
    const line = renderReclaimRow({ row: { ...row, survivingDigests: 0, takes: "build-tree" } });
    expect(line).toContain("codex-scratch (build-tree)");
    expect(line).toContain("removed 7 entr(ies), freed 2.0 MiB — witness held");
    expect(line).not.toContain("content(s) survive");
  });

  it("says so loudly when the witness did not hold", () => {
    expect(renderReclaimRow({ row: { ...row, witnessHeld: false } })).toContain("WITNESS FAILED");
  });
});

describe("the reclaim ledger", () => {
  it("reads back exactly what was appended, and reports an absent ledger as empty", () => {
    const root = freshHome();
    const path = reclaimLedgerPath({ home: root });
    const empty = readReclaimLedger({ path });
    expect(empty.isOk()).toBe(true);
    expect(empty._unsafeUnwrap()).toEqual([]);
    expect(appendReclaimRow({ path, row }).isOk()).toBe(true);
    const after = readReclaimLedger({ path });
    expect(after.isOk()).toBe(true);
    expect(after._unsafeUnwrap()).toEqual([row]);
  });

  it("refuses a corrupt row rather than reading past it", () => {
    const root = freshHome();
    const path = reclaimLedgerPath({ home: root });
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, '{"root":"supervisor-scratch"}\n', "utf8");
    const rows = readReclaimLedger({ path });
    expect(rows.isErr()).toBe(true);
    expect(rows._unsafeUnwrapErr().message).toContain("line 1 is not a complete reclaim row");
  });
});

describe("walkFiles", () => {
  it("records a regular file's size and link count and never follows a symlink out of the root", () => {
    const root = freshHome();
    put({ path: join(root, "inside/a.txt"), text: "12345" });
    put({ path: join(root, "outside.txt"), text: "not in the walk root" });
    mkdirSync(join(root, "walked"), { recursive: true });
    put({ path: join(root, "walked/real.txt"), text: "abc" });
    symlinkSync(join(root, "outside.txt"), join(root, "walked/escape.txt"));
    const found = walkFiles({ root: join(root, "walked"), skip: () => false });
    expect(found.isOk()).toBe(true);
    expect(found._unsafeUnwrap().map((one) => one.relativePath)).toEqual(["real.txt"]);
    expect(found._unsafeUnwrap()[0]!.bytes).toBe(3);
    expect(found._unsafeUnwrap()[0]!.links).toBe(1);
  });

  it("does not descend into a directory the caller skips", () => {
    const root = freshHome();
    put({ path: join(root, "keep/a.txt"), text: "a" });
    put({ path: join(root, "drop/b.txt"), text: "b" });
    const found = walkFiles({ root, skip: ({ relativePath }) => relativePath === "drop" });
    expect(found._unsafeUnwrap().map((one) => one.relativePath)).toEqual(["keep/a.txt"]);
  });

  it("reports a root that is not there rather than returning nothing", () => {
    const root = freshHome();
    const found = walkFiles({ root: join(root, "never-made"), skip: () => false });
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().code).toBe("SCAN_FAILED");
  });
});

describe("stillExists", () => {
  it("answers for a path that is there and for one that is not", () => {
    const root = freshHome();
    put({ path: join(root, "a.txt"), text: "a" });
    expect(stillExists({ path: join(root, "a.txt") })).toBe(true);
    expect(stillExists({ path: join(root, "gone.txt") })).toBe(false);
  });
});

describe("removeEntry", () => {
  // A parent its owner may list but not search makes both the `rmSync` and the `lstat`
  // after it fail with EACCES. The input CARRIES a target that still exists, so a removal that read any
  // `lstat` failure as "already gone" answers ok here and reddens.
  it("reports a failed removal whose target it can no longer see, rather than calling it gone", () => {
    const root = freshHome();
    put({ path: join(root, "parent/target/file"), text: "still here" });
    chmodSync(join(root, "parent"), 0o600);
    try {
      const removal = removeEntry({ relativePath: "target", root: join(root, "parent") });
      expect(removal._unsafeUnwrapErr().code).toBe("APPLY_FAILED");
    } finally {
      chmodSync(join(root, "parent"), 0o700);
    }
    expect(stillExists({ path: join(root, "parent/target/file") })).toBe(true);
  });

  it("counts a target that is already absent as removed", () => {
    const root = freshHome();
    mkdirSync(join(root, "parent"), { recursive: true });
    expect(removeEntry({ relativePath: "vanished", root: join(root, "parent") })._unsafeUnwrap()).toBe(true);
  });
});

describe("reclaimFinishedScratch", () => {
  const codexScratch = {
    because: "a reason long enough to be useful to whoever reads the report",
    homeSegment: "orchestration",
    name: "codex-scratch",
    takes: "finished-scratch",
  } as const;

  it("reports the whole finished workspace it would take without removing it", () => {
    const root = freshHome();
    put({ path: join(root, "orchestration/aaa/artifact.md"), text: "done" });
    put({ path: join(root, "orchestration/aaa.scratch/node_modules/x/index.js"), text: "01234" });
    put({ path: join(root, "orchestration/aaa.scratch/notes.md"), text: "678" });
    const outcome = reclaimFinishedScratch({
      apply: false,
      deps: { home: root, progress: () => undefined },
      root: codexScratch,
    });
    expect(outcome.isOk()).toBe(true);
    expect(outcome._unsafeUnwrap().entries).toEqual(["aaa.scratch"]);
    expect(outcome._unsafeUnwrap().freedBytes).toBe(
      allocated({ path: join(root, "orchestration/aaa.scratch/node_modules/x/index.js") }) +
        allocated({ path: join(root, "orchestration/aaa.scratch/notes.md") }),
    );
    expect(stillExists({ path: join(root, "orchestration/aaa.scratch/notes.md") })).toBe(true);
  });

  // A sparse file's logical length is not storage. The input CARRIES a 1 GiB logical
  // length over almost no blocks, so a figure built on `st_size` reads at least 1 GiB and reddens here.
  it("counts a sparse file's allocated blocks, never its logical length", () => {
    const root = freshHome();
    put({ path: join(root, "orchestration/aaa/artifact.md"), text: "done" });
    put({ path: join(root, "orchestration/aaa.scratch/sparse"), text: "" });
    truncateSync(join(root, "orchestration/aaa.scratch/sparse"), GIB);
    const outcome = reclaimFinishedScratch({
      apply: false,
      deps: { home: root, progress: () => undefined },
      root: codexScratch,
    });
    expect(outcome._unsafeUnwrap().freedBytes).toBe(
      allocated({ path: join(root, "orchestration/aaa.scratch/sparse") }),
    );
    expect(outcome._unsafeUnwrap().freedBytes).toBeLessThan(GIB);
  });

  // A hardlinked file frees nothing when one of its paths goes, so a figure that counted it would be a
  // fabrication. The input CARRIES both files, so a sum that stopped checking links counts both.
  it("counts no byte of a file whose inode another path still holds", () => {
    const root = freshHome();
    put({ path: join(root, "orchestration/aaa/artifact.md"), text: "done" });
    put({ path: join(root, "orchestration/aaa.scratch/own.txt"), text: "abc" });
    put({ path: join(root, "elsewhere/binary"), text: "01234567" });
    linkSync(join(root, "elsewhere/binary"), join(root, "orchestration/aaa.scratch/binary"));
    const outcome = reclaimFinishedScratch({
      apply: false,
      deps: { home: root, progress: () => undefined },
      root: codexScratch,
    });
    expect(allocated({ path: join(root, "elsewhere/binary") })).toBeGreaterThan(0);
    expect(outcome._unsafeUnwrap().freedBytes).toBe(
      allocated({ path: join(root, "orchestration/aaa.scratch/own.txt") }),
    );
  });
});

describe("the home noun's flag surface", () => {
  it("declares every flag its usage text offers", () => {
    expect(HOME_RECLAIM_FLAG_NAMES).toEqual(["--apply", "--home", "--json", "--root"]);
    expect(HOME_RECLAIMED_FLAG_NAMES).toEqual(["--home", "--json"]);
    HOME_RECLAIM_FLAG_NAMES.forEach((flag) => {
      expect(RECLAIM_USAGE).toContain(flag);
    });
    HOME_RECLAIMED_FLAG_NAMES.forEach((flag) => {
      expect(RECLAIMED_USAGE).toContain(flag);
    });
  });

  it("refuses a flag it does not declare, naming the flag rather than failing anonymously", () => {
    const refused = parseHomeReclaimArgs({ rest: ["--force"] });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().join("\n")).toContain("--force");
  });

  it("registers every home verb, each with an example that starts with the verb line", () => {
    expect(Object.keys(homeManifest).toSorted()).toEqual(["reclaim", "reclaimed"]);
    expect(homeManifest["reclaim"]!.meta.example).toContain("slopweaver home reclaim");
    expect(homeManifest["reclaimed"]!.meta.example).toContain("slopweaver home reclaimed");
  });
});

describe("home reclaimed", () => {
  /** Both output channels, captured. */
  function captured(): { deps: HomeReclaimedDeps; out: string[] } {
    const out: string[] = [];
    return {
      deps: {
        writeDiagnostic: () => undefined,
        writeOut: (line) => {
          out.push(line);
        },
      },
      out,
    };
  }

  it("says plainly that nothing has been reclaimed rather than printing an empty list", () => {
    const root = freshHome();
    const { deps, out } = captured();
    expect(runHomeReclaimed({ deps, rest: ["--home", root] })).toBe(0);
    expect(out.join("\n")).toBe("home reclaimed: nothing has been reclaimed on this install.");
  });

  it("prints each run that took something", () => {
    const root = freshHome();
    appendReclaimRow({ path: reclaimLedgerPath({ home: root }), row });
    const { deps, out } = captured();
    expect(runHomeReclaimed({ deps, rest: ["--home", root] })).toBe(0);
    expect(out[0]).toBe("home reclaimed: 1 run(s)");
    expect(out[1]).toContain("codex-scratch (finished-scratch)");
  });
});
