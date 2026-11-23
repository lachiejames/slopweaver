/*
 * The two pre-door verdicts `github merge --admin` takes, read directly: the pull request agreeing with the
 * change the guard measured, and the Codex pairing floor's decision. Every edge is a plain fake — no mocks.
 * The whole merge's ordering, both floor reads and the door are pinned end to end by the shell's own test.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { AdminMergeRequest, GithubAdminMergeDeps } from "../../../../../cli/commands/github/mergeAdminTypes.js";
import { judgeCodexPairingFloor, readAndAgree } from "../../../../../cli/commands/github/mergeAdminVerdicts.js";
import type { LocalCodexLoopRead } from "../../../../../codex/landingGateTypes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AdminMergePr, GithubAdminMergeApi } from "../../../../../outbound/github/adminMerge.js";
import { unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";
import { noWalkthroughs } from "../../../../walkthroughFake.js";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "e".repeat(40);
const HTTP_ERROR = { kind: "http" as const, message: "boom", operation: "x" };

/** The pull request GitHub reports; a case overrides only the field it is about. */
function pr(over: Partial<AdminMergePr> = {}): AdminMergePr {
  return {
    baseRef: "main",
    baseSha: BASE_SHA,
    body: "",
    draft: false,
    headRef: "feature",
    headSha: HEAD_SHA,
    number: 21,
    stack: undefined,
    stackQueue: undefined,
    state: "open",
    title: "feat: a change",
    url: "https://github.invalid/o/n/pull/21",
    ...over,
  };
}

/** Every merge argument, overridable per case. */
function request(over: Partial<AdminMergeRequest> = {}): AdminMergeRequest {
  return {
    acknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
    base: "origin/main",
    execution: "merge",
    head: "feature",
    home: "/home-unused",
    number: 21,
    remote: "origin",
    repo: "o/n",
    repoRoot: "/repo",
    ...over,
  };
}

/** A GitHub client whose only answering read is the one a case supplies; every other call fails loudly. */
function api({ read }: { read: GithubAdminMergeApi["read"] }): GithubAdminMergeApi {
  return {
    checks: () => Promise.reject(new Error("checks is not read by these verdicts")),
    isAdmin: () => errAsync(HTTP_ERROR),
    merge: () => errAsync(HTTP_ERROR),
    protection: () => errAsync(UNREACHED_PROTECTION_READ),
    read,
    requiredContexts: () => Promise.reject(new Error("requiredContexts is not read by these verdicts")),
    reviewRules: () => Promise.reject(new Error("reviewRules is not read by these verdicts")),
  };
}

/** A checkout matching the pull request under test whose Codex loop cleared the floor. */
const PAIRED_CHECKOUT: LocalCodexLoopRead = {
  evidence: {
    baseSha: BASE_SHA,
    branch: "feature",
    failures: [],
    headSha: HEAD_SHA,
    leftovers: [],
    repository: "o/n",
    roots: ["/repo"],
  },
  kind: "read",
};

/** A checkout that agrees with the pull request but whose Codex loop has not cleared the floor. */
const UNPAIRED_CHECKOUT: LocalCodexLoopRead = {
  evidence: { ...PAIRED_CHECKOUT.evidence, failures: ["no planning pass has run on this branch"] },
  kind: "read",
};

/** A checkout whose loop fails the floor twice over, so a waiver has more than one obligation to name. */
const TWICE_UNPAIRED_CHECKOUT: LocalCodexLoopRead = {
  evidence: {
    ...PAIRED_CHECKOUT.evidence,
    failures: ["no planning pass has run on this branch", "r1 is CURRENT and BROKEN (switch-integrity)"],
  },
  kind: "read",
};

/** The invocation's flags waiving the pairing floor with a reason. */
const TYPO_FIX_WAIVER: AdminMergeRequest["acknowledgement"] = {
  acknowledge: ["codex-loop-incomplete"],
  acknowledgeAll: false,
  reason: "a typo fix",
};

/** The injected edges, answering the Codex loop read with `reading` and collecting every printed line. */
function deps({ reading, lines }: { reading: LocalCodexLoopRead; lines: string[] }): GithubAdminMergeDeps {
  return {
    doorLedger: unreachableDoorLedger(),
    localSha: () => ok(HEAD_SHA),
    makeApi: () => api({ read: () => okAsync(pr()) }),
    measureBaseFreshness: ({ baseBranch }) =>
      ok({ baseBranch, baseSha: BASE_SHA, headSha: HEAD_SHA, kind: "fresh", remote: "origin", reverted: [] }),
    nowIso: () => "2026-08-27T00:00:00.000Z",
    out: ({ line }) => lines.push(line),
    probePostMergeDocsBudget: () => ({ budgets: [], kind: "evaluated" }),
    publishAlert: () => undefined,
    readBumpWitness: () => ({ kind: "clear" }),
    readCodexLoop: () => reading,
    releaseOwnHold: () => undefined,
    token: () => "t",
    walkthrough: noWalkthroughs({ headOid: HEAD_SHA }),
  };
}

describe("readAndAgree", () => {
  it("returns the pull request GitHub holds when it is the change measured, read by number and slug", async () => {
    const reads: Record<string, unknown>[] = [];
    const client = api({
      read: (args) => {
        reads.push({ ...args });
        return okAsync(pr());
      },
    });
    const result = await readAndAgree({
      api: client,
      baseBranch: "main",
      headSha: HEAD_SHA,
      owner: "o",
      repo: "n",
      request: request(),
    });

    expect(unwrap(result)).toEqual(pr());
    expect(reads).toEqual([{ number: 21, owner: "o", repo: "n" }]);
  });

  it("returns the read's own message when GitHub cannot be read", async () => {
    const result = await readAndAgree({
      api: api({ read: () => errAsync(HTTP_ERROR) }),
      baseBranch: "main",
      headSha: HEAD_SHA,
      owner: "o",
      repo: "n",
      request: request(),
    });

    expect(unwrapErr(result)).toEqual(["boom"]);
  });

  it("names the head disagreement when GitHub holds a different commit than the one measured", async () => {
    const result = await readAndAgree({
      api: api({ read: () => okAsync(pr({ headSha: "d".repeat(40) })) }),
      baseBranch: "main",
      headSha: HEAD_SHA,
      owner: "o",
      repo: "n",
      request: request(),
    });

    expect(unwrapErr(result)).toEqual([
      `#21 is at ${"d".repeat(40)}, but --head resolves locally to ${HEAD_SHA} — the report is ` +
        "about a commit GitHub is not merging. Push the branch, or point --head at what is on GitHub.",
    ]);
  });
});

describe("judgeCodexPairingFloor", () => {
  it("clears with nothing waived and prints nothing when the loop is complete", async () => {
    const lines: string[] = [];
    const verdict = await judgeCodexPairingFloor({
      deps: deps({ lines, reading: PAIRED_CHECKOUT }),
      pr: pr(),
      request: request(),
    });

    expect(verdict).toEqual({ acknowledgement: undefined, kind: "clear" });
    expect(lines).toEqual([]);
  });

  it("says so on the announcing re-read when the floor has since been met", async () => {
    const lines: string[] = [];
    const verdict = await judgeCodexPairingFloor({
      announce: true,
      deps: deps({ lines, reading: PAIRED_CHECKOUT }),
      pr: pr(),
      request: request(),
    });

    expect(verdict).toEqual({ acknowledgement: undefined, kind: "clear" });
    expect(lines).toEqual(["codex-loop-incomplete: cleared before the merge — the floor was met on the second read"]);
  });

  it("stands with every failure and the acknowledgement route when the loop is incomplete and unwaived", async () => {
    const lines: string[] = [];
    const verdict = await judgeCodexPairingFloor({
      deps: deps({ lines, reading: UNPAIRED_CHECKOUT }),
      pr: pr(),
      request: request(),
    });

    expect(verdict).toEqual({
      kind: "standing",
      lines: [
        "codex-loop-incomplete: no planning pass has run on this branch",
        'accept it with --acknowledge codex-loop-incomplete --reason "…", which is written to the door ledger',
      ],
    });
    expect(lines).toEqual([]);
  });

  it("clears carrying the waiver, and announces every waived failure then the reason, when acknowledged", async () => {
    const lines: string[] = [];
    const verdict = await judgeCodexPairingFloor({
      announce: true,
      deps: deps({ lines, reading: TWICE_UNPAIRED_CHECKOUT }),
      pr: pr(),
      request: request({ acknowledgement: TYPO_FIX_WAIVER }),
    });

    expect(verdict).toEqual({
      acknowledgement: { reason: "a typo fix", subject: "codex-loop-incomplete" },
      kind: "clear",
    });
    expect(lines).toEqual([
      "ACKNOWLEDGED: codex-loop-incomplete: no planning pass has run on this branch",
      "ACKNOWLEDGED: codex-loop-incomplete: r1 is CURRENT and BROKEN (switch-integrity)",
      "ACKNOWLEDGED: codex-loop-incomplete — reason: a typo fix",
    ]);
  });

  it("carries the same waiver and prints nothing on the first, non-announcing read", async () => {
    const lines: string[] = [];
    const verdict = await judgeCodexPairingFloor({
      deps: deps({ lines, reading: TWICE_UNPAIRED_CHECKOUT }),
      pr: pr(),
      request: request({ acknowledgement: TYPO_FIX_WAIVER }),
    });

    expect(verdict).toEqual({
      acknowledgement: { reason: "a typo fix", subject: "codex-loop-incomplete" },
      kind: "clear",
    });
    expect(lines).toEqual([]);
  });
});
