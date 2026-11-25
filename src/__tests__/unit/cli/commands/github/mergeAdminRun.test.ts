/**
 * `slopweaver github merge --admin`'s effectful shell, with every edge injected as a plain fake — no mocks.
 * The door is the REAL door, writing into a `mkdtempSync` state home and read back from it, because the
 * point of routing a merge through it is that the record exists.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPreflightFacts } from "../../../../../cli/commands/github/mergeAdminPreflightReads.js";
import { performAdminMerge } from "../../../../../cli/commands/github/mergeAdminRun.js";
import type { AdminMergeRequest, GithubAdminMergeDeps } from "../../../../../cli/commands/github/mergeAdminTypes.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { BaselineBumpVerdict } from "../../../../../codex/baselineBumpWitnessRun.js";
import type { LocalCodexLoopRead } from "../../../../../codex/landingGateTypes.js";
import { GithubProtectionReadErrors } from "../../../../../corpus/github/protectionRead.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubAdminMergeApi } from "../../../../../outbound/github/adminMerge.js";
import type { WalkthroughAct } from "../../../../../outbound/github/walkthroughLedger.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  type AdminMergeHarness,
  adminMergeHarness,
  adminMergeRequest,
  BASE_SHA,
  HEAD_SHA,
  MERGE_SHA,
  PAIRED_CHECKOUT,
  adminMergePr as pr,
} from "../../../../mergeAdminRunFixture.js";
import { expectedHoldRefusal, withProfileHold } from "../../../../profileHoldFixture.js";
import { type WalkthroughWrites, walkthroughDeps, walkthroughThread } from "../../../../walkthroughFake.js";

const HTTP_ERROR = { kind: "http" as const, message: "boom", operation: "x" };

let home: string;
let door: MemoryDoorLedger;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-admin-merge-"));
  door = memoryDoorLedger();
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every merge argument, overridable per case, in this case's own state home. */
function request(over: Partial<AdminMergeRequest> = {}): AdminMergeRequest {
  return adminMergeRequest({ home, over });
}

/** The injected edges over this case's own door ledger, defaulting every one to the happy path. */
function harness(over: Partial<GithubAdminMergeDeps> & { api?: Partial<GithubAdminMergeApi> } = {}): AdminMergeHarness {
  return adminMergeHarness({ door, over });
}

/** The last door line's recorded acknowledgements, or `undefined` when it waived nothing. */
function lastDoorAcknowledgements(): unknown {
  return (door.records().at(-1)! as { acknowledgements?: unknown }).acknowledgements;
}

/** A checkout that agrees with the pull request but whose Codex loop has not cleared the floor. */
const UNPAIRED_CHECKOUT: LocalCodexLoopRead = {
  evidence: { ...PAIRED_CHECKOUT.evidence, failures: ["no planning pass has run on this branch"] },
  kind: "read",
};

/** The door ledger's recorded decision statuses for this test's home. */
function doorStatuses(): readonly string[] {
  return door.records().map((record) => String(record["status"]));
}

describe("performAdminMerge --dry-run", () => {
  /** The head before a lap: `build` is required and nothing has reported on it yet. */
  const UNLAPPED_CHECKS: Partial<GithubAdminMergeApi> = {
    checks: () =>
      Promise.resolve(
        ok({
          baseRef: "main",
          checks: [],
          headSha: HEAD_SHA,
          mergeable: undefined,
          residue: [],
          rollupState: "PENDING",
          supersededChecks: [],
          truncated: false,
        }),
      ),
  };

  it("runs every check, says it would merge, and writes nothing — no merge, no door record, no release", async () => {
    const h = harness({ api: UNLAPPED_CHECKS });
    const code = await performAdminMerge({ deps: h.deps, request: request({ execution: "dry-run" }) });
    expect(code).toBe(EXIT_OK);
    expect(h.merges).toEqual([]);
    expect(h.released).toEqual([]);
    expect(doorStatuses()).toEqual([]);
    expect(h.lines.at(-1)).toBe(
      "would merge #21 into main as a squash through the administrator bypass; dry-run wrote nothing.",
    );
    expect(h.lines.some((line) => line.includes("dry-run note: "))).toBe(true);
  });

  it("refuses under --dry-run what the merge refuses: a stack member on a base with no queue", async () => {
    const stacked = pr({ stack: { baseRefName: "main", number: 900, position: 1, size: 2 } });
    const h = harness({ api: { ...UNLAPPED_CHECKS, read: () => okAsync(stacked) } });
    const code = await performAdminMerge({ deps: h.deps, request: request({ execution: "dry-run" }) });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.some((line) => line.includes("in native stack #900, which lands on main"))).toBe(true);
    expect(h.lines.some((line) => line.startsWith("would merge"))).toBe(false);
  });

  it("refuses under --dry-run a write the door would hold, and records no decision", async () => {
    const h = harness({ api: UNLAPPED_CHECKS });
    const { result: code, decision } = await withProfileHold({
      home,
      run: () => performAdminMerge({ deps: h.deps, request: request({ execution: "dry-run" }) }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(doorStatuses()).toEqual([]);
    expect(decision.findings.map((finding) => finding.code)).toEqual(["PROFILE_NOT_LOADED"]);
    expect(h.lines.slice(-5)).toEqual(
      expectedHoldRefusal({ command: "slopweaver github merge --admin", decision }).map((line) => `refused: ${line}`),
    );
  });
});

describe("performAdminMerge", () => {
  it("merges through the door, pinned to the head it read, with GitHub's own squash subject", async () => {
    const h = harness();
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_OK);
    // The WHOLE argument object, so a `commitMessage` creeping back in fails here: GitHub composes the
    // squash BODY itself, and sending an empty one would land a commit with no explanation at all.
    expect(h.merges).toEqual([
      { commitTitle: "feat: a change (#21)", number: 21, owner: "o", repo: "n", sha: HEAD_SHA },
    ]);
    expect(doorStatuses()).toEqual(["pass"]);
    expect(h.lines.some((line) => line.includes(`merged #21 into main as ${MERGE_SHA}`))).toBe(true);
    expect(h.lines.at(-1)).toContain("within every ceiling");
  });

  it("releases its own merge hold the moment the merge lands, carrying the landed commit", async () => {
    const h = harness();
    await performAdminMerge({ deps: h.deps, request: request() });
    expect(h.released).toEqual([{ home, pr: 21, repo: "o/n", sha: MERGE_SHA }]);
  });

  it("releases nothing when the merge did not land", async () => {
    const h = harness({ api: { merge: () => errAsync(HTTP_ERROR) } });
    await performAdminMerge({ deps: h.deps, request: request() });
    expect(h.released).toEqual([]);
  });

  it("merges nothing, and says the decision was not recorded, when the door ledger's store is down", async () => {
    const h = harness();
    const deps: GithubAdminMergeDeps = { ...h.deps, doorLedger: unreachableDoorLedger() };
    const code = await performAdminMerge({ deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.released).toEqual([]);
    expect(h.lines.some((line) => line.includes("slopweaver github merge --admin not performed:"))).toBe(true);
  });

  it("does every blocking Git measurement BEFORE it resolves a credential or builds a client", async () => {
    const h = harness();
    await performAdminMerge({ deps: h.deps, request: request() });
    // `readCodexLoop` TWICE is the design, not a slip: once before the privileged reads and once immediately
    // before the mutation, because the preflight between them is awaited. See the re-read case below.
    expect(h.order.join(" ")).toBe(
      "localSha measureBaseFreshness sweepPrivateTerms token makeApi readCodexLoop readCodexLoop",
    );
  });

  it("refuses a base that moved since the last push, and never merges", async () => {
    const h = harness({
      measureBaseFreshness: ({ baseBranch }) =>
        ok({
          baseBranch,
          baseSha: "b".repeat(40),
          behindBy: 3,
          headSha: HEAD_SHA,
          kind: "base-moved",
          remote: "origin",
          reverted: [],
        }),
    });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.some((line) => line.includes("refused: base-moved"))).toBe(true);
  });

  it("merges a moved base once base-moved is explicitly acknowledged", async () => {
    const h = harness({
      measureBaseFreshness: ({ baseBranch }) =>
        ok({
          baseBranch,
          baseSha: "b".repeat(40),
          behindBy: 3,
          headSha: HEAD_SHA,
          kind: "base-moved",
          remote: "origin",
          reverted: [],
        }),
    });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({ acknowledgement: { acknowledge: ["base-moved"], acknowledgeAll: false, reason: undefined } }),
    });
    expect(code).toBe(EXIT_OK);
    expect(h.merges).toHaveLength(1);
  });

  it("refuses when the local head does not resolve, before touching GitHub", async () => {
    const h = harness({ localSha: () => ok("") });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.some((line) => line.includes("--head resolves locally to"))).toBe(true);
  });

  it("refuses when GitHub's head is not the commit that was measured", async () => {
    const h = harness({ api: { read: () => okAsync(pr({ headSha: "d".repeat(40) })) } });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
  });

  it("refuses, naming the permission, when the token is not an admin", async () => {
    const h = harness({ api: { isAdmin: () => okAsync(false) } });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.lines.some((line) => line.includes("ADMIN permission on o/n"))).toBe(true);
  });

  it("refuses, naming enforce_admins, when the protection leaves no bypass", async () => {
    const h = harness({ api: { protection: () => okAsync({ enforceAdmins: true, kind: "protected" }) } });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.lines.some((line) => line.includes("enforce_admins=true"))).toBe(true);
  });

  it("refuses, and merges NOTHING, when a required context never ran under a SUCCESS rollup", async () => {
    // The bypass merges past branch protection, so nothing on GitHub's side would notice: the rollup reads
    // SUCCESS because it summarises only the runs PRESENT, and `build` is not one of them.
    const h = harness({
      api: {
        checks: () =>
          Promise.resolve(
            ok({
              baseRef: "main",
              checks: [{ kind: "check-run" as const, name: "CodeQL", state: "passed" as const, url: undefined }],
              headSha: HEAD_SHA,
              mergeable: undefined,
              residue: [],
              rollupState: "SUCCESS",
              supersededChecks: [],
              truncated: false,
            }),
          ),
      },
    });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.some((line) => line.includes("main requires build"))).toBe(true);
  });

  it("refuses without a token, and never builds a client", async () => {
    const h = harness();
    const code = await performAdminMerge({
      deps: { ...h.deps, token: () => undefined },
      request: request(),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.order).toEqual(["localSha", "measureBaseFreshness", "sweepPrivateTerms"]);
    expect(h.lines.at(-1)).toContain("no GitHub token configured");
  });

  it("refuses a --repo that is not owner/name", async () => {
    const h = harness();
    const code = await performAdminMerge({ deps: h.deps, request: request({ repo: "name" }) });
    expect(code).toBe(EXIT_ERROR);
    expect(h.lines[0]).toContain("--repo must be owner/name to merge");
  });

  it("treats a GitHub answer that did not merge as a failure", async () => {
    const h = harness({ api: { merge: () => okAsync({ merged: false, sha: "" }) } });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.lines.at(-1)).toContain("answered without merging");
  });

  it("reports a failed merge call rather than claiming success", async () => {
    const h = harness({ api: { merge: () => errAsync(HTTP_ERROR) } });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.lines.at(-1)).toBe("refused: boom");
  });

  it("refuses when branch protection cannot be read at all, never assuming it is absent", async () => {
    const h = harness({
      api: { protection: () => errAsync(GithubProtectionReadErrors.readFailed({ branch: "main", cause: HTTP_ERROR })) },
    });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.at(-1)).toContain("could not read branch protection for main: boom");
  });

  it("refuses a DENIED protection read in its own words, never as an unread one", async () => {
    const denied = { ...HTTP_ERROR, message: "Resource not accessible by personal access token", status: 403 };
    const h = harness({
      api: {
        protection: () => errAsync(GithubProtectionReadErrors.permissionDenied({ branch: "main", cause: denied })),
      },
    });
    const api = h.deps.makeApi({ home, token: "t" });
    const facts = await readPreflightFacts({ api, branch: "main", number: 7, owner: "o", repo: "n" });
    expect(unwrapErr(facts).code).toBe("PROTECTION_PERMISSION_DENIED");
    expect(unwrapErr(facts).message).toContain("GitHub denied this token permission to read main's branch protection");
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
  });

  it("carries a base its plan cannot protect through as a fact, not a failure", async () => {
    const h = harness({ api: { protection: () => okAsync({ kind: "plan-unavailable" as const }) } });
    const api = h.deps.makeApi({ home, token: "t" });
    const facts = await readPreflightFacts({ api, branch: "main", number: 7, owner: "o", repo: "n" });
    expect(unwrap(facts).protection).toEqual({ kind: "plan-unavailable" });
  });
});

/**
 * The wiring half of the standing Codex-pairing rule, proved where it matters: on the mutation itself.
 *
 * `github enqueue`'s half of the same proof lives in `../../../codex/landingGateWiring/enqueueFloor.test.ts`. Both count
 * real calls, because the failure the rule closes was never a wrong policy answer — it was that nothing on
 * the landing path asked at all.
 */
describe("performAdminMerge and the Codex pairing floor", () => {
  it("merges nothing when the local loop is incomplete", async () => {
    const h = harness({ readCodexLoop: () => UNPAIRED_CHECKOUT });
    const code = await performAdminMerge({ deps: h.deps, request: request() });

    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.some((line) => line.includes("codex-loop-incomplete"))).toBe(true);
  });

  /** An association that cannot be made costs exactly what an incomplete loop costs. */
  it("merges nothing when the reading answers for a different pull request", async () => {
    const elsewhere: LocalCodexLoopRead = {
      evidence: { ...PAIRED_CHECKOUT.evidence, repository: "o/other" },
      kind: "read",
    };
    const h = harness({ readCodexLoop: () => elsewhere });
    const code = await performAdminMerge({ deps: h.deps, request: request() });

    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.some((line) => line.includes("could not be examined"))).toBe(true);
  });

  it("merges nothing when the checkout could not be read at all", async () => {
    const h = harness({ readCodexLoop: () => ({ kind: "unreadable", reason: "HEAD is detached" }) });
    const code = await performAdminMerge({ deps: h.deps, request: request() });

    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
  });

  /**
   * The refusal has to land BEFORE the privileged reads, and the only falsifiable way to say so is to make
   * those reads fail loudly: if the guard ever moved below them, this throws instead of refusing cleanly.
   */
  it("refuses before it reads admin rights or branch protection, so a refusal costs no privileged read", async () => {
    const h = harness({
      api: {
        isAdmin: () => {
          throw new Error("an unmet pairing floor must refuse before any admin-rights read");
        },
        protection: () => {
          throw new Error("an unmet pairing floor must refuse before any branch-protection read");
        },
      },
      readCodexLoop: () => UNPAIRED_CHECKOUT,
    });

    expect(await performAdminMerge({ deps: h.deps, request: request() })).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
  });

  it("refuses the subject acknowledged without a reason", async () => {
    const h = harness({ readCodexLoop: () => UNPAIRED_CHECKOUT });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({
        acknowledgement: { acknowledge: ["codex-loop-incomplete"], acknowledgeAll: false, reason: undefined },
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
  });

  it("merges once the subject is acknowledged with a reason, and records that reason at the door", async () => {
    const h = harness({ readCodexLoop: () => UNPAIRED_CHECKOUT });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({
        acknowledgement: { acknowledge: ["codex-loop-incomplete"], acknowledgeAll: false, reason: "a typo fix" },
      }),
    });

    expect(code).toBe(EXIT_OK);
    expect(h.merges.length).toBe(1);
    expect(lastDoorAcknowledgements()).toEqual([{ reason: "a typo fix", subject: "codex-loop-incomplete" }]);
  });

  /**
   * The floor is read TWICE — once before the privileged reads, once immediately before the mutation — because
   * the preflight in between is awaited and a review can finish BROKEN inside that window. Found by a Codex
   * review. This asserts the second read happens by letting the first pass and the second refuse.
   */
  it("re-reads the floor immediately before merging, so a review that breaks mid-preflight still refuses", async () => {
    let reads = 0;
    const h = harness({
      readCodexLoop: () => {
        reads += 1;
        return reads === 1 ? PAIRED_CHECKOUT : UNPAIRED_CHECKOUT;
      },
    });

    expect(await performAdminMerge({ deps: h.deps, request: request() })).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(reads).toBe(2);
  });

  /** A waiver recorded from the FIRST read would land the merge with no reason in the ledger. */
  it("records the re-read's own waiver when the floor only becomes unmet at the second read", async () => {
    let reads = 0;
    const h = harness({
      readCodexLoop: () => {
        reads += 1;
        return reads === 1 ? PAIRED_CHECKOUT : UNPAIRED_CHECKOUT;
      },
    });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({
        acknowledgement: { acknowledge: ["codex-loop-incomplete"], acknowledgeAll: false, reason: "a typo fix" },
      }),
    });

    expect(code).toBe(EXIT_OK);
    expect(h.merges.length).toBe(1);
    expect(lastDoorAcknowledgements()).toEqual([{ reason: "a typo fix", subject: "codex-loop-incomplete" }]);
  });

  /** A floor that was already met must not write an audit entry for something nobody waived. */
  it("records no acknowledgement when the flags are supplied over a loop that already cleared", async () => {
    const h = harness();
    await performAdminMerge({
      deps: h.deps,
      request: request({
        acknowledgement: { acknowledge: ["codex-loop-incomplete"], acknowledgeAll: false, reason: "not needed" },
      }),
    });

    expect(lastDoorAcknowledgements()).toBeUndefined();
  });
});

describe("performAdminMerge — the owner's own walkthrough threads", () => {
  const MIXED = {
    authorLogin: "owner",
    headOid: HEAD_SHA,
    threads: [
      walkthroughThread({ id: "PRRT_note1" }),
      walkthroughThread({ id: "PRRT_reviewer", lastCommentLogin: "teammate", openedByLogin: "teammate" }),
    ],
    truncated: false,
    viewerLogin: "owner",
  };

  /** Every self-review note is resolved before one of the owner's pull requests merges, by any door. */
  it("resolves the owner's own note before the merge, never the reviewer's, and ledgers it", async () => {
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const mergesAtResolve: number[] = [];
    const h = harness();
    const deps = {
      ...h.deps,
      walkthrough: walkthroughDeps({
        beforeResolve: () => mergesAtResolve.push(h.merges.length),
        read: MIXED,
        writes,
      }),
    };

    expect(await performAdminMerge({ deps, request: request() })).toBe(EXIT_OK);
    expect(writes.resolved).toEqual(["PRRT_note1"]);
    expect(mergesAtResolve).toEqual([0]);
    expect(h.merges.length).toBe(1);
    expect(writes.ledger.map((row) => [row.actionId, row.kind])).toEqual([
      ["o-n-21-resolve-own-threads-aaaaaaa-038002", "resolve-own-threads"],
    ]);
    expect(h.lines).toContain("resolved our own 1 open walkthrough thread(s) before landing");
  });

  /** A note the owner answered without resolving read `answered-open` and was merged over. */
  it("resolves a note of the owner's carrying a colleague's question and their answer before the merge", async () => {
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const answered = walkthroughThread({ commentCount: 3, id: "PRRT_answered", lastCommentBody: "yes, both paths" });
    const h = harness();
    const deps = {
      ...h.deps,
      walkthrough: walkthroughDeps({ read: { ...MIXED, threads: [answered, ...MIXED.threads] }, writes }),
    };

    expect(await performAdminMerge({ deps, request: request() })).toBe(EXIT_OK);
    expect(writes.resolved).toEqual(["PRRT_answered", "PRRT_note1"]);
    expect(h.merges.length).toBe(1);
    expect(h.lines).toContain("resolved our own 2 open walkthrough thread(s) before landing");
  });

  it("does not merge when one of the owner's notes will not resolve", async () => {
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const h = harness();
    const deps = { ...h.deps, walkthrough: walkthroughDeps({ failIds: ["PRRT_note1"], read: MIXED, writes }) };

    expect(await performAdminMerge({ deps, request: request() })).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(writes.ledger).toEqual([]);
  });

  /** An unseen thread may be a reply collapsed under the owner's resolve, which no rule catches. */
  it("does not merge when the thread read fails", async () => {
    const h = harness();
    const deps = { ...h.deps, walkthrough: walkthroughDeps({ read: undefined, writes: { ledger: [], resolved: [] } }) };

    expect(await performAdminMerge({ deps, request: request() })).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.filter((line) => line.includes("SLOPWEAVER_ALLOW_UNSEEN_REVIEW_THREADS=1")).length).toBe(1);
  });

  it("does not merge, nor resolve anything, over a truncated thread read", async () => {
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const h = harness();
    const deps = { ...h.deps, walkthrough: walkthroughDeps({ read: { ...MIXED, truncated: true }, writes }) };

    expect(await performAdminMerge({ deps, request: request() })).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(writes.resolved).toEqual([]);
    expect(
      h.lines.filter((line) => line.includes("(GitHub had more review threads than this read carried)")).length,
    ).toBe(1);
  });

  /**
   * The admin door bypasses the conversation rule, so a reply the landing reopened must hold
   * it on every later run, not only the one that reopened it.
   */
  it("reopens a reply collapsed under the landing's resolve, then keeps refusing while it sits unanswered", async () => {
    const memory: WalkthroughAct[] = [{ kind: "resolving", threadId: "PRRT_note1" }];
    const reopened: string[] = [];
    const replied = walkthroughThread({ commentCount: 2, id: "PRRT_note1", lastCommentLogin: "teammate" });
    const h = harness();
    const first = await performAdminMerge({
      deps: {
        ...h.deps,
        walkthrough: walkthroughDeps({
          memory,
          read: { ...MIXED, threads: [{ ...replied, isResolved: true, resolvedByLogin: "owner" }] },
          reopened,
          writes: { ledger: [], resolved: [] },
        }),
      },
      request: request(),
    });
    const second = await performAdminMerge({
      deps: {
        ...h.deps,
        walkthrough: walkthroughDeps({
          memory,
          read: { ...MIXED, threads: [replied] },
          writes: { ledger: [], resolved: [] },
        }),
      },
      request: request(),
    });

    expect([first, second]).toEqual([EXIT_ERROR, EXIT_ERROR]);
    expect(reopened).toEqual(["PRRT_note1"]);
    expect(h.merges).toEqual([]);
    expect(h.lines.filter((line) => line.includes("reply nobody has answered (PRRT_note1)")).length).toBe(1);
  });

  /** The admin door bypasses the conversation rule, so its own read must hold a fresh reply. */
  it("does not merge over a colleague's reply on the owner's note that arrived before the landing ever resolved it", async () => {
    const h = harness();
    const fresh = walkthroughThread({ commentCount: 2, id: "PRRT_note1", lastCommentLogin: "teammate" });
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const code = await performAdminMerge({
      deps: { ...h.deps, walkthrough: walkthroughDeps({ read: { ...MIXED, threads: [fresh] }, writes }) },
      request: request(),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(writes.resolved).toEqual([]);
    expect(h.lines.filter((line) => line.includes("reply nobody has answered (PRRT_note1)")).length).toBe(1);
  });

  /**
   * A thread the landing resolved, reopened by somebody else with a reply, is refused naming the answer as the way
   * through. The refusal records nothing, since printing a reply is not the owner reading it, so a bare resolve
   * under the owner's login is reopened and shown again, and their answer lets the next run merge.
   */
  it("names the answer as the way through a reply it refused on, and merges once the owner has answered", async () => {
    const memory: WalkthroughAct[] = [{ kind: "resolving", threadId: "PRRT_note1" }];
    const reopened: string[] = [];
    const replied = walkthroughThread({
      commentCount: 2,
      id: "PRRT_note1",
      lastCommentBody: "does this cover the retry path?",
      lastCommentLogin: "teammate",
    });
    const h = harness();
    const run = (thread: typeof replied): Promise<number> =>
      performAdminMerge({
        deps: {
          ...h.deps,
          walkthrough: walkthroughDeps({
            memory,
            read: { ...MIXED, threads: [thread] },
            reopened,
            writes: { ledger: [], resolved: [] },
          }),
        },
        request: request(),
      });

    const refused = await run(replied);
    const rowsAfterRefusal = memory.length;
    const bareResolve = await run({ ...replied, isResolved: true, resolvedByLogin: "owner" });
    const answered = await run({
      ...replied,
      commentCount: 3,
      isResolved: true,
      lastCommentLogin: "owner",
      resolvedByLogin: "owner",
    });

    expect([refused, bareResolve, answered]).toEqual([EXIT_ERROR, EXIT_ERROR, EXIT_OK]);
    expect(rowsAfterRefusal).toBe(1);
    expect(reopened).toEqual(["PRRT_note1"]);
    expect(h.lines.filter((line) => line === "    > does this cover the retry path?").length).toBe(2);
    expect(
      h.lines.filter(
        (line) =>
          line ===
          `    answer: \`slopweaver github thread reply --repo o/n --number 21 --thread PRRT_note1 --home ${home} ` +
            "--body - --resolve`",
      ).length,
    ).toBe(2);
    expect(h.merges.length).toBe(1);
  });

  /**
   * The confirming re-read is the step's final read, so a reply arriving mid-step
   * under a resolve an EARLIER landing made holds the merge, though it is not among the threads just resolved.
   */
  it("does not merge over a reply that arrived mid-step under an earlier landing's resolve", async () => {
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const reopened: string[] = [];
    const h = harness();
    const old = walkthroughThread({ id: "PRRT_old", isResolved: true, resolvedByLogin: "owner" });
    const code = await performAdminMerge({
      deps: {
        ...h.deps,
        walkthrough: walkthroughDeps({
          afterResolve: (thread) =>
            thread.id === "PRRT_old"
              ? {
                  ...thread,
                  commentCount: 2,
                  lastCommentAtIso: "2026-09-28T04:40:00.000Z",
                  lastCommentLogin: "teammate",
                }
              : thread,
          memory: [{ kind: "resolving", threadId: "PRRT_old" }],
          read: { ...MIXED, threads: [...MIXED.threads, old] },
          reopened,
          writes,
        }),
      },
      request: request(),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(writes.resolved).toEqual(["PRRT_note1"]);
    expect(reopened).toEqual(["PRRT_old"]);
    expect(h.merges).toEqual([]);
  });

  /** Surfacing one reply must not exempt the thread from the next colleague's reply. */
  it("reopens a later reply under the owner's own resolve of a thread it already surfaced, and does not merge", async () => {
    const memory: WalkthroughAct[] = [
      { kind: "resolving", threadId: "PRRT_note1" },
      { kind: "surfaced", replyAtIso: "2026-09-28T04:30:00.000Z", replyCount: 2, threadId: "PRRT_note1" },
    ];
    const reopened: string[] = [];
    const later = walkthroughThread({
      commentCount: 4,
      id: "PRRT_note1",
      isResolved: true,
      lastCommentAtIso: "2026-09-28T04:50:00.000Z",
      lastCommentLogin: "teammate",
      resolvedByLogin: "owner",
    });
    const h = harness();
    const code = await performAdminMerge({
      deps: {
        ...h.deps,
        walkthrough: walkthroughDeps({
          memory,
          read: { ...MIXED, threads: [later] },
          reopened,
          writes: { ledger: [], resolved: [] },
        }),
      },
      request: request(),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(reopened).toEqual(["PRRT_note1"]);
    expect(h.merges).toEqual([]);
    expect(memory.at(-1)).toEqual({
      kind: "surfaced",
      replyAtIso: "2026-09-28T04:50:00.000Z",
      replyCount: 4,
      threadId: "PRRT_note1",
    });
  });
});

describe("readPreflightFacts", () => {
  it("reads an unreadable required-context gate as a note, never as a refusal about permissions", async () => {
    const h = harness({
      api: { requiredContexts: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "boom" }))) },
    });
    const api = h.deps.makeApi({ home, token: "t" });
    const facts = unwrap(await readPreflightFacts({ api, branch: "main", number: 7, owner: "o", repo: "n" }));
    expect(facts).toEqual({
      gate: { kind: "unreadable", reason: "boom" },
      isAdmin: true,
      protection: { enforceAdmins: false, kind: "protected" },
      reviews: { branch: "main", kind: "read", rules: [] },
    });
  });

  it("stops at the administrator read, before protection is read at all", async () => {
    const h = harness({
      api: {
        isAdmin: () => errAsync(HTTP_ERROR),
        protection: () => errAsync(GithubProtectionReadErrors.readFailed({ branch: "main", cause: HTTP_ERROR })),
      },
    });
    const api = h.deps.makeApi({ home, token: "t" });
    const facts = await readPreflightFacts({ api, branch: "main", number: 7, owner: "o", repo: "n" });
    expect(unwrapErr(facts).message).toBe("could not establish whether this token holds admin on o/n: boom");
  });
});

/** A witness read that found one bump manifest with no Codex witness. */
const UNWITNESSED: BaselineBumpVerdict = {
  details: [
    "ledgers/baseline-bumps/widen.json has no Codex witness (no review); take it with: slopweaver codex review",
  ],
  kind: "refused",
};

describe("performAdminMerge and the ratchet-bump witness", () => {
  it("asks the witness about the pull request GitHub holds, its base commit included", async () => {
    const h = harness();
    expect(await performAdminMerge({ deps: h.deps, request: request() })).toBe(EXIT_OK);
    expect(h.bumpHeads).toEqual([{ baseSha: BASE_SHA, branch: "feature", headSha: HEAD_SHA, repository: "o/n" }]);
  });

  it.each([
    { label: "by subject", acknowledge: ["baseline-bump-unwitnessed"], acknowledgeAll: false },
    { label: "wholesale", acknowledge: [], acknowledgeAll: true },
  ])("refuses an unwitnessed bump however it is acknowledged ($label), and merges nothing", async (flags) => {
    const h = harness({ readBumpWitness: () => UNWITNESSED });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({
        acknowledgement: {
          acknowledge: flags.acknowledge,
          acknowledgeAll: flags.acknowledgeAll,
          reason: "the owner said so",
        },
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(doorStatuses()).toEqual([]);
    expect(h.lines.slice(-2)).toEqual([
      "refused: baseline-bump-unwitnessed: ledgers/baseline-bumps/widen.json has no Codex witness (no review); take " +
        "it with: slopweaver codex review",
      "refused: baseline-bump-unwitnessed has no acknowledgement and no escape hatch: --acknowledge and " +
        "--acknowledge-all do not reach it. Take the Codex witness review each line names on the pull " +
        "request's head, then land again.",
    ]);
  });
});
