/**
 * A merged park whose finish would probe the doc's own `repo:` — its worktree gone, or a path left that is no linked
 * worktree of that repo — is offered to `handover finish` only once that repo holds the merge commit GitHub reported
 * on a clean tree: finish then probes that checkout's working tree.
 * Short of that proof the row reseats, as it did before the finish, and spends no ask.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";

import { WAKE_FINISH_ASKS } from "../../../../../../cli/commands/handover/wakeFinish.js";
import { docRepoUnproven, type MergeProof } from "../../../../../../cli/commands/handover/wakeMergeProof.js";
import {
  INDEX_HEAD_BYTES,
  indexBlindSpot,
  NEWLINE,
  NUL,
  recordHeads,
  STATUS_HEAD_BYTES,
  statusSnapshot,
} from "../../../../../../cli/commands/handover/wakeMergeScan.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, wakeJson } from "./harness.js";

const WAKE = { kind: "checks", number: 7, repo: "o/r" } as const;
const MERGED = { 7: { prState: "MERGED" } } as const;
const RESEATED = "reseated by cmux spawn gone (was parked at 2026-10-15T02:00:00.000Z)";
const DUE = "o/r#7 is MERGED";

describe("runHandoverWake on a merged park whose finish would probe the doc repo", () => {
  beforeEach(() => {
    mintWakeHome();
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("reseats without asking finish while the doc repo lacks the merge or carries local changes", async () => {
    const details: string[] = [];
    for (const mergeHeld of ["missing", "dirty"] as const) {
      parkedRow({ slug: "gone", wake: WAKE });
      const recorded = record();
      const deps = fakes({ checks: MERGED, finishes: { gone: 0 }, mergeHeld, recorded });
      const { report } = await wakeJson({ deps, recorded });
      expect([recorded.mergeChecks, recorded.finished, recorded.spawned]).toEqual([
        ["/repo/acme@merge-7"],
        [],
        ["gone"],
      ]);
      details.push(report.rows[0]!.detail);
      removeFixtureDirs();
      mintWakeHome();
    }
    expect(details).toEqual([
      `${DUE}, but its probes would read /repo/acme, which does not hold the merge merge-7 yet, so handover ` +
        `finish was not asked; ${RESEATED}`,
      `${DUE}, but its probes would read /repo/acme, which holds uncommitted changes a probe could read, so ` +
        `handover finish was not asked; ${RESEATED}`,
    ]);
  });

  it("reseats without asking finish when git cannot say, naming what it said", async () => {
    parkedRow({ slug: "gone", wake: WAKE });
    const recorded = record();
    const deps = fakes({ checks: MERGED, finishes: { gone: 0 }, mergeHeld: "unreadable", recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([recorded.finished, recorded.spawned]).toEqual([[], ["gone"]]);
    expect(report.rows[0]!.detail).toBe(
      `${DUE}, but its probes would read /repo/acme, which could not say whether it holds merge-7: fatal: not a ` +
        `git repository, so handover finish was not asked; ${RESEATED}`,
    );
  });

  it("reseats without asking finish when the doc names no repo to probe", async () => {
    parkedRow({ repo: null, slug: "gone", wake: WAKE });
    const recorded = record();
    const deps = fakes({ checks: MERGED, finishes: { gone: 0 }, recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([recorded.mergeChecks, recorded.finished, recorded.spawned]).toEqual([[], [], ["gone"]]);
    expect(report.rows[0]!.detail).toBe(
      `${DUE}, but its doc names no repo: to prove its probes' tree against, so handover finish was not asked; ` +
        RESEATED,
    );
  });

  // A relative repo: names one checkout to the wake and another to finish's own cwd.
  it("reseats without asking finish, or proving anything, when the doc's repo is relative", async () => {
    parkedRow({ repo: "repo", slug: "gone", wake: WAKE });
    const recorded = record();
    const deps = fakes({ checks: MERGED, finishes: { gone: 0 }, recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([recorded.mergeChecks, recorded.finished, recorded.spawned]).toEqual([[], [], ["gone"]]);
    expect(report.rows[0]!.detail).toBe(
      `${DUE}, but its doc's repo: repo is relative, so the wake and finish would read it from different ` +
        `directories, so handover finish was not asked; ${RESEATED}`,
    );
  });

  // With no repo: to classify against, a path that exists proves nothing.
  it("reseats without asking finish from a path still on disk when the doc names no repo", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "wt-"));
    parkedRow({ repo: null, slug: "kept", wake: WAKE, worktree });
    const recorded = record();
    const deps = fakes({ checks: MERGED, finishes: { kept: 0 }, recorded });
    await wakeJson({ deps, recorded });
    expect([recorded.mergeChecks, recorded.finished, recorded.spawned]).toEqual([[], [], ["kept"]]);
  });

  // An unproven tree launched no finish, so it spends none of the run's asks.
  it(`spends none of the ${String(WAKE_FINISH_ASKS)} finish asks on a tree it never asked about`, async () => {
    const checks: Record<number, { prState: "MERGED" }> = {};
    for (let number = 1; number <= WAKE_FINISH_ASKS + 1; number += 1) {
      parkedRow({ slug: `m${String(number)}`, wake: { kind: "checks", number, repo: "o/r" } });
      checks[number] = { prState: "MERGED" };
    }
    const recorded = record();
    await wakeJson({ deps: fakes({ bootsInFlight: 3, checks, mergeHeld: "missing", recorded }), recorded });
    expect([recorded.mergeChecks.length, recorded.finished]).toEqual([WAKE_FINISH_ASKS + 1, []]);
  });

  it("asks finish in a linked worktree still on disk without asking about the merge", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "wt-"));
    parkedRow({ slug: "kept", wake: WAKE, worktree });
    const recorded = record();
    const deps = fakes({ checks: MERGED, finishes: { kept: 0 }, mergeHeld: "missing", recorded });
    await wakeJson({ deps, recorded });
    expect([recorded.mergeChecks, recorded.finished, recorded.finishCwds, recorded.finishRepos]).toEqual([
      [],
      ["kept"],
      [worktree],
      ["/repo/acme session-worktree"],
    ]);
  });

  // A path that exists but finish classifies as no linked worktree probes the doc repo.
  it("proves the merge before asking finish from a path that is no linked worktree of the doc repo", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "wt-"));
    parkedRow({ slug: "kept", wake: WAKE, worktree });
    const recorded = record();
    const deps = fakes({
      checks: MERGED,
      finishes: { kept: 0 },
      mergeHeld: "missing",
      probeTree: "doc-repo",
      recorded,
    });
    await wakeJson({ deps, recorded });
    expect([recorded.mergeChecks, recorded.finished, recorded.spawned]).toEqual([["/repo/acme@merge-7"], [], ["kept"]]);
  });
});

/**
 * A document cut into chunks of `size` bytes, so a record, a delimiter or a tag-and-mode prefix lands split across two.
 *
 * @param text the whole document
 * @param size each chunk's length
 * @returns the chunks, in order
 */
function chunked({ size, text }: { size: number; text: string }): Uint8Array[] {
  const bytes = Buffer.from(text, "utf8");
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
}

/** One status document's verdict, read as `productionMergeProof` reads it, from chunks of `size` bytes. */
function snapshotOf({ size = 4096, text }: { size?: number; text: string }): ReturnType<typeof statusSnapshot> {
  const chunks = chunked({ size, text });
  return statusSnapshot({ lines: recordHeads({ chunks, delimiter: NEWLINE, headBytes: STATUS_HEAD_BYTES }) });
}

/** One index listing's verdict, read as `productionMergeProof` reads it, from chunks of `size` bytes. */
function blindOf({ size = 4096, text }: { size?: number; text: string }): ReturnType<typeof indexBlindSpot> {
  const chunks = chunked({ size, text });
  return indexBlindSpot({ entries: recordHeads({ chunks, delimiter: NUL, headBytes: INDEX_HEAD_BYTES }) });
}

describe("statusSnapshot", () => {
  const HEADER = ["# branch.oid 1111111111111111111111111111111111111111", "# branch.head main"];

  it("reads HEAD's commit and a clean tree off the header alone", () => {
    expect(snapshotOf({ text: `${HEADER.join("\n")}\n` })).toEqual({
      clean: true,
      headOid: "1111111111111111111111111111111111111111",
    });
  });

  it("reads an untracked or changed entry as dirty, and a repository with no commit as no HEAD", () => {
    expect([
      snapshotOf({ text: [...HEADER, "? local.txt", ""].join("\n") }).clean,
      snapshotOf({ text: [...HEADER, "1 .M N... 100644 100644 100644 a b a.txt", ""].join("\n") }).clean,
      snapshotOf({ text: "# branch.oid (initial)\n# branch.head main\n" }).headOid,
    ]).toEqual([false, false, undefined]);
  });

  it("reads the same verdict when every line, the commit's included, is split across one-byte chunks", () => {
    expect([
      snapshotOf({ size: 1, text: `${HEADER.join("\n")}\n` }),
      snapshotOf({ size: 1, text: [...HEADER, "? local.txt"].join("\n") }).clean,
    ]).toEqual([{ clean: true, headOid: "1111111111111111111111111111111111111111" }, false]);
  });
});

describe("indexBlindSpot", () => {
  const entry = ({ tag, mode, path }: { tag: string; mode: string; path: string }): string =>
    `${tag} ${mode} 1111111111111111111111111111111111111111 0\t${path}\0`;

  it("names a submodule first, then an assume-unchanged (lowercase) or skip-worktree (S) entry, else nothing", () => {
    const plain = entry({ mode: "100644", path: "a.txt", tag: "H" });
    expect([
      blindOf({ text: `${plain}${entry({ mode: "100755", path: "b.sh", tag: "H" })}` }),
      blindOf({ text: `${plain}${entry({ mode: "100644", path: "b.txt", tag: "h" })}` }),
      blindOf({ text: entry({ mode: "100644", path: "a.txt", tag: "S" }) }),
      blindOf({
        text: `${entry({ mode: "100644", path: "b", tag: "h" })}${entry({ mode: "160000", path: "sm", tag: "H" })}`,
      }),
      blindOf({ text: "" }),
    ]).toEqual([undefined, "hidden", "hidden", "nested", undefined]);
  });

  it("reads a NUL or a tag-and-mode prefix split across chunks, and a long path past the head, unchanged", () => {
    const long = entry({ mode: "100644", path: "p".repeat(5000), tag: "H" });
    const gitlink = entry({ mode: "160000", path: "sm", tag: "H" });
    const flagged = entry({ mode: "100644", path: "b", tag: "h" });
    expect([
      blindOf({ size: 1, text: `${long}${flagged}${gitlink}` }),
      blindOf({ size: 3, text: `${long}${flagged}` }),
      blindOf({ size: 7, text: long }),
    ]).toEqual(["nested", "hidden", undefined]);
  });
});

describe("docRepoUnproven", () => {
  it("is clear once the doc repo holds the merge on a clean tree, and names the gap otherwise", () => {
    const proving =
      ({ proof }: { proof: MergeProof }) =>
      () =>
        ok(proof);
    expect([
      docRepoUnproven({ docRepo: "/r", mergeCommitOid: "m", mergeProof: proving({ proof: "held" }) }),
      docRepoUnproven({ docRepo: "/r", mergeCommitOid: "m", mergeProof: proving({ proof: "missing" }) }),
      docRepoUnproven({ docRepo: "/r", mergeCommitOid: "m", mergeProof: proving({ proof: "dirty" }) }),
      docRepoUnproven({ docRepo: "/r", mergeCommitOid: "m", mergeProof: proving({ proof: "hidden" }) }),
      docRepoUnproven({ docRepo: "/r", mergeCommitOid: "m", mergeProof: proving({ proof: "nested" }) }),
      docRepoUnproven({ docRepo: "/r", mergeCommitOid: undefined, mergeProof: proving({ proof: "held" }) }),
      docRepoUnproven({ docRepo: "/r", mergeCommitOid: "m", mergeProof: () => err({ message: "bad" }) }),
    ]).toEqual([
      undefined,
      "its probes would read /r, which does not hold the merge m yet",
      "its probes would read /r, which holds uncommitted changes a probe could read",
      "its probes would read /r, which marks tracked files assume-unchanged or skip-worktree, so git cannot say they " +
        "are clean",
      "its probes would read /r, which holds a submodule whose own tree its status does not vouch for",
      "its probes would read /r, and the read carried no merge commit to find there",
      "its probes would read /r, which could not say whether it holds m: bad",
    ]);
  });
});
