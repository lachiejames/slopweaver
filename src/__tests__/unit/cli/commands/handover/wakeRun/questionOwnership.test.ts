/**
 * `handover wake`'s question pass suspends a merged park's wake only when the merged pull request is PROVEN the run's
 * whole work: in the run checkout's own repository, base and head, on the one branch every name the run gives agrees
 * on, with the parked worktree standing clean on its head COMMIT. Anything short of that reseats, as on main.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { RunEvent } from "../../../../../../handover/ledger.js";
import { appendRunEvent, readRunJournal } from "../../../../../../handover/runStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, wakeJson } from "./harness.js";
import { HEAD_OID } from "./reconcileFakes.js";

const QUESTION = "Keep the backup key wrapped by the master password?";
const ASKED_ISO = "2026-10-15T01:30:00.000Z";
const MERGED = { 7: { prState: "MERGED" } } as const;
/** The run's own branch is its slug (`parkedRow` records it at `start` and on the park). */
const OWN_HEAD = { 7: "asked" } as const;

describe("runHandoverWake's proof that a merged pull request is the run's own whole work", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    ({ home, runsDir } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  /** A row parked on PR #7 whose run then asked {@link QUESTION}, with its worktree at `worktree` when given. */
  function askedAndParked({
    front,
    startedBranch,
    worktree,
  }: { front?: readonly string[]; startedBranch?: string; worktree?: string } = {}): void {
    parkedRow({
      ...(front === undefined ? {} : { front }),
      ...(startedBranch === undefined ? {} : { startedBranch }),
      question: QUESTION,
      slug: "asked",
      wake: { kind: "checks", number: 7, repo: "o/r" },
      ...(worktree === undefined ? {} : { worktree }),
    });
    unwrap(
      appendRunEvent({ event: { atIso: ASKED_ISO, kind: "question", question: QUESTION }, runsDir, slug: "asked" }),
    );
  }

  /** Every `park-wake-suspended` line the row's journal holds. */
  function suspensions(): readonly RunEvent[] {
    return unwrap(readRunJournal({ runsDir, slug: "asked" })).events.filter(
      (event) => event.kind === "park-wake-suspended",
    );
  }

  // A stack parent's merge unblocks the seat's own work, whatever the question.
  it("reseats a park whose merged pull request was another branch's", async () => {
    askedAndParked();
    const recorded = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, heads: { 7: "the-stack-parent" }, recorded }),
      recorded,
    });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
  });

  // A bare branch name matches a dependency's same-named branch in another repository.
  it("reseats a park whose merged pull request lives in another repository, though its branch has the run's name", async () => {
    askedAndParked();
    const recorded = record();
    const deps = fakes({ checks: MERGED, heads: OWN_HEAD, origin: "o/elsewhere", recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned, suspensions()]).toEqual([0, ["asked"], []]);
    expect(recorded.diagnostics.filter((line) => line.includes("own repository o/elsewhere (base o/r")).length).toBe(1);
  });

  // A run that started on a stack parent and moved its worktree to the child names the parent
  // among its branches, so the parent's merge matched "own" though the work left is on the child.
  it("reseats a park whose worktree has another branch out than the merged head, though the run once named it", async () => {
    const worktree = join(home, "wt-asked");
    mkdirSync(worktree);
    askedAndParked({ worktree });
    const recorded = record();
    const deps = fakes({ branches: { [worktree]: "stack-child" }, checks: MERGED, heads: OWN_HEAD, recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned, suspensions()]).toEqual([0, ["asked"], []]);
    expect(recorded.diagnostics.filter((line) => line.includes("also names stack-child beside")).length).toBe(1);
  });

  // The park copies the started branch, but a journal where they differ names both.
  it("reseats a park whose run started on another branch than the one it parked on and merged", async () => {
    const worktree = join(home, "wt-asked");
    mkdirSync(worktree);
    askedAndParked({ startedBranch: "stack-parent", worktree });
    const recorded = record();
    const deps = fakes({ branches: { [worktree]: "asked" }, checks: MERGED, heads: OWN_HEAD, recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned, suspensions()]).toEqual([0, ["asked"], []]);
    expect(recorded.diagnostics.filter((line) => line.includes("also names stack-parent beside")).length).toBe(1);
  });

  it("suspends a park whose worktree still has the merged head out", async () => {
    const worktree = join(home, "wt-asked");
    mkdirSync(worktree);
    askedAndParked({ worktree });
    const recorded = record();
    const deps = fakes({ branches: { [worktree]: "asked" }, checks: MERGED, heads: OWN_HEAD, recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned]).toEqual([1, []]);
  });

  // A stated branch matching the head is no proof once the worktree's own branch read failed.
  it("reseats a park whose worktree branch did not read, though its stated branch is the merged head", async () => {
    const worktree = join(home, "wt-asked");
    mkdirSync(worktree);
    askedAndParked({ worktree });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, suspensions().length]).toEqual([0, 0]);
    expect(recorded.diagnostics.filter((line) => line.includes("its worktree's branch did not read")).length).toBe(1);
  });

  it("reseats a park whose doc names another branch than the merged head", async () => {
    askedAndParked({ front: ["status: in-progress", "branch: stack-child"] });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
  });

  it("reseats a park whose merged pull request's head lives in a fork", async () => {
    askedAndParked();
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const deps = {
      ...base,
      readPrHead: async (args: Parameters<typeof base.readPrHead>[0]) =>
        (await base.readPrHead(args)).map((head) => ({ ...head, headRepository: "someone/r" })),
    };
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
    expect(recorded.diagnostics.filter((line) => line.includes("head someone/r)")).length).toBe(1);
  });

  it("reseats a park whose run checkout's origin does not read", async () => {
    askedAndParked();
    const recorded = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, heads: OWN_HEAD, origin: null, recorded }),
      recorded,
    });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
    expect(recorded.diagnostics.filter((line) => line.includes("has no origin read")).length).toBe(1);
  });

  // A branch name outlives the merge, so the worktree must stand on the merged head's commit.
  it("reseats a park whose worktree stands on a commit past the merged head", async () => {
    const worktree = join(home, "wt-asked");
    askedAndParked({ worktree });
    const recorded = record();
    const commits = { [worktree]: { dirty: false, oid: "b".repeat(40) } };
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, commits, heads: OWN_HEAD, recorded }),
      recorded,
    });
    expect([report.suspended, recorded.spawned, suspensions()]).toEqual([0, ["asked"], []]);
    expect(recorded.diagnostics.filter((line) => line.includes(`not the merged head ${HEAD_OID}`)).length).toBe(1);
  });

  it("reseats a park whose worktree has changes beside the merged head", async () => {
    const worktree = join(home, "wt-asked");
    askedAndParked({ worktree });
    const recorded = record();
    const commits = { [worktree]: { dirty: true, oid: HEAD_OID } };
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, commits, heads: OWN_HEAD, recorded }),
      recorded,
    });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
    expect(
      recorded.diagnostics.filter((line) => line.includes("has changes the merged head does not carry")).length,
    ).toBe(1);
  });

  it("reseats a park whose worktree does not read, and says would-suspend for nothing on a dry run", async () => {
    const worktree = join(home, "wt-asked");
    askedAndParked({ worktree });
    const dry = record();
    const commits = { [worktree]: null };
    const dryRun = await wakeJson({
      deps: fakes({ checks: MERGED, commits, heads: OWN_HEAD, recorded: dry }),
      extra: ["--dry-run"],
      recorded: dry,
    });
    const recorded = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, commits, heads: OWN_HEAD, recorded }),
      recorded,
    });
    expect([dryRun.report.suspended, report.suspended, recorded.spawned]).toEqual([0, 0, ["asked"]]);
    expect(recorded.diagnostics.filter((line) => line.includes(`its worktree ${worktree} did not read`)).length).toBe(
      1,
    );
  });

  // A rebase or bisect leaves HEAD detached on the right commit, clean, mid-operation.
  it("reseats a park whose worktree has a detached HEAD on the merged head", async () => {
    const worktree = join(home, "wt-asked");
    askedAndParked({ worktree });
    const recorded = record();
    const commits = { [worktree]: { branch: "(detached)", dirty: false, oid: HEAD_OID } };
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, commits, heads: OWN_HEAD, recorded }),
      recorded,
    });
    expect([report.suspended, recorded.spawned, suspensions()]).toEqual([0, ["asked"], []]);
    expect(recorded.diagnostics.filter((line) => line.includes("has (detached) out")).length).toBe(1);
  });

  // The question must be ALL that is left, so finish's gates run with only it set aside.
  it("reseats a park whose finish readiness fails with the question set aside", async () => {
    askedAndParked();
    const recorded = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, heads: OWN_HEAD, readies: { asked: 1 }, recorded }),
      recorded,
    });
    expect([report.suspended, recorded.spawned, suspensions(), recorded.readied]).toEqual([
      0,
      ["asked"],
      [],
      ["asked --dry-run true"],
    ]);
    expect(recorded.diagnostics.filter((line) => line.includes("asked's wake was not suspended")).length).toBe(1);
  });

  // A commit made while the readiness child ran must stop a dry run's promise as it stops the live run.
  it("says would-suspend for nothing on a dry run whose worktree moved while finish readiness ran", async () => {
    askedAndParked();
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    let reads = 0;
    const deps = {
      ...base,
      readWorktreeCommit: (args: Parameters<typeof base.readWorktreeCommit>[0]) => {
        reads += 1;
        return base.readWorktreeCommit(args).map((commit) => ({ ...commit, dirty: reads > 1 }));
      },
    };
    const { report } = await wakeJson({ deps, extra: ["--dry-run"], recorded });
    expect([report.suspended, reads, recorded.readied]).toEqual([0, 2, ["asked --dry-run true"]]);
    expect(
      recorded.diagnostics.filter((line) => line.includes("has changes the merged head does not carry")).length,
    ).toBe(1);
  });

  // An owner word journalled while the readiness child ran must stop a dry run's promise too.
  it("says would-suspend for nothing on a dry run whose journal took the owner's word while finish readiness ran", async () => {
    askedAndParked();
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const said: RunEvent = { atIso: "2026-10-15T03:13:30.000Z", kind: "said", message: "also rebase" };
    const deps = {
      ...base,
      finish: (args: Parameters<typeof base.finish>[0]) => {
        unwrap(appendRunEvent({ event: said, runsDir, slug: "asked" }));
        return base.finish(args);
      },
    };
    const { report } = await wakeJson({ deps, extra: ["--dry-run"], recorded });
    expect([report.suspended, recorded.readied]).toEqual([0, ["asked --dry-run true"]]);
    expect(
      recorded.diagnostics.filter((line) => line.includes("a said line landed while the wake judged")).length,
    ).toBe(1);
  });

  // The journal is the dry run's LAST read, so an owner word during the worktree re-read is caught too.
  it("says would-suspend for nothing on a dry run whose journal took the owner's word during the worktree re-read", async () => {
    askedAndParked();
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const said: RunEvent = { atIso: "2026-10-15T03:13:30.000Z", kind: "said", message: "also rebase" };
    let reads = 0;
    const deps = {
      ...base,
      readWorktreeCommit: (args: Parameters<typeof base.readWorktreeCommit>[0]) => {
        reads += 1;
        if (reads === 2) {
          unwrap(appendRunEvent({ event: said, runsDir, slug: "asked" }));
        }
        return base.readWorktreeCommit(args);
      },
    };
    const { report } = await wakeJson({ deps, extra: ["--dry-run"], recorded });
    expect([report.suspended, reads]).toEqual([0, 2]);
    expect(
      recorded.diagnostics.filter((line) => line.includes("a said line landed while the wake judged")).length,
    ).toBe(1);
  });

  // The judging pass's MERGED is not the fresh head read's word.
  it("reseats a park whose fresh head read does not say MERGED", async () => {
    askedAndParked();
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const deps = {
      ...base,
      readPrHead: async (args: Parameters<typeof base.readPrHead>[0]) =>
        (await base.readPrHead(args)).map((head) => ({ ...head, state: "OPEN" as const })),
    };
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, suspensions().length, recorded.readied]).toEqual([0, 0, []]);
    expect(recorded.diagnostics.filter((line) => line.includes("its head read OPEN")).length).toBe(1);
  });

  it("asks finish readiness once, with the question set aside, before it suspends", async () => {
    askedAndParked();
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, recorded.spawned, recorded.readied]).toEqual([1, [], ["asked --dry-run true"]]);
  });

  it("reseats a park whose merged head GitHub named no commit for", async () => {
    askedAndParked();
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const deps = {
      ...base,
      readPrHead: async (args: Parameters<typeof base.readPrHead>[0]) =>
        (await base.readPrHead(args)).map(({ headRefOid: _oid, ...head }) => head),
    };
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
    expect(recorded.diagnostics.filter((line) => line.includes("GitHub named no head commit")).length).toBe(1);
  });
});
