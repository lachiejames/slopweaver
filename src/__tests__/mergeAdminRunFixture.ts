/**
 * The injected edges `slopweaver github merge --admin`'s effectful shell runs over in its unit tests, every one a
 * plain fake defaulting to the happy path — no mocks. Shared by the test files `mergeAdminRun.test.ts` was split
 * into by scenario; each keeps its own state home and door ledger, and passes them in.
 */
import { okAsync } from "neverthrow";
import type { AdminMergeRequest, GithubAdminMergeDeps } from "../cli/commands/github/mergeAdminTypes.js";
import type { PullRequestHead } from "../codex/landingGate.js";
import type { LocalCodexLoopRead } from "../codex/landingGateTypes.js";
import { ok } from "../lib/result.js";
import type { AdminMergePr, GithubAdminMergeApi } from "../outbound/github/adminMerge.js";
import type { MemoryDoorLedger } from "./doorLedgerFixture.js";
import { noWalkthroughs } from "./walkthroughFake.js";

export const HEAD_SHA = "a".repeat(40);
export const BASE_SHA = "e".repeat(40);
export const MERGE_SHA = "c".repeat(40);

/**
 * A checkout matching the pull request under test whose Codex loop cleared the floor. The pairing floor gets
 * its own cases; every other case is about the merge itself and holds it clean.
 */
export const PAIRED_CHECKOUT = {
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
} satisfies LocalCodexLoopRead;

/**
 * The pull request GitHub reports; a case overrides only the field it is about.
 *
 * @returns the pull request, with the case's overrides applied
 */
export function adminMergePr(over: Partial<AdminMergePr> = {}): AdminMergePr {
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

/**
 * Every merge argument, overridable per case.
 *
 * @param home the case's own state home
 * @param over the fields this case is about
 * @returns the merge request
 */
export function adminMergeRequest({
  home,
  over = {},
}: {
  home: string;
  over?: Partial<AdminMergeRequest>;
}): AdminMergeRequest {
  return {
    acknowledgement: { acknowledge: [], acknowledgeAll: false, reason: undefined },
    base: "origin/main",
    execution: "merge",
    head: "feature",
    home,
    number: 21,
    remote: "origin",
    repo: "o/n",
    repoRoot: "/repo",
    ...over,
  };
}

/** What one run observed: every printed line, and every merge the fake API was asked to perform. */
export interface AdminMergeHarness {
  readonly deps: GithubAdminMergeDeps;
  readonly lines: string[];
  /** Every argument object the fake merge received, whole — so a field that should NOT be sent fails here. */
  readonly merges: Record<string, unknown>[];
  readonly order: string[];
  /** Every hold release the merge asked for, whole — so a release of the WRONG pull request fails here. */
  readonly released: Record<string, unknown>[];
  /** Every head the ratchet-bump witness was asked about — kept off `order`, whose sequence other cases pin. */
  readonly bumpHeads: PullRequestHead[];
}

/**
 * The fake GitHub client: a clean, admin-mergeable pull request whose required `build` passed.
 *
 * @param merges where every merge call's arguments are recorded
 * @param over single client methods this case replaces
 * @returns the client
 */
function fakeAdminMergeApi({
  merges,
  over,
}: {
  merges: Record<string, unknown>[];
  over: Partial<GithubAdminMergeApi> | undefined;
}): GithubAdminMergeApi {
  return {
    checks: () =>
      Promise.resolve(
        ok({
          baseRef: "main",
          checks: [{ kind: "check-run" as const, name: "build", state: "passed" as const, url: undefined }],
          headSha: HEAD_SHA,
          mergeable: undefined,
          residue: [],
          rollupState: "SUCCESS",
          supersededChecks: [],
          truncated: false,
        }),
      ),
    isAdmin: () => okAsync(true),
    merge: (args) => {
      merges.push({ ...args });
      return okAsync({ merged: true, sha: MERGE_SHA });
    },
    protection: () => okAsync({ enforceAdmins: false, kind: "protected" }),
    read: () => okAsync(adminMergePr()),
    requiredContexts: ({ branch }) =>
      Promise.resolve(ok({ branch, contexts: ["build"], requiresCodeOwnerReviews: undefined })),
    reviewRules: ({ branch }) => Promise.resolve({ branch, kind: "read" as const, rules: [] }),
    ...over,
  };
}

/** A zero-argument edge that records its name in `order` each time it runs, then answers `value`. */
function recorded<T>({ name, order, value }: { name: string; order: string[]; value: T }): () => T {
  return () => {
    order.push(name);
    return value;
  };
}

/**
 * Build the injected edges, defaulting every one to the happy path.
 *
 * @param door the case's own door ledger, which every merge goes through
 * @param over the edges this case replaces; `api` replaces single client methods
 * @returns the edges and what a run over them observed
 */
export function adminMergeHarness({
  door,
  over = {},
}: {
  door: MemoryDoorLedger;
  over?: Partial<GithubAdminMergeDeps> & { api?: Partial<GithubAdminMergeApi> };
}): AdminMergeHarness {
  const lines: string[] = [];
  const merges: Record<string, unknown>[] = [];
  const order: string[] = [];
  const released: Record<string, unknown>[] = [];
  const bumpHeads: PullRequestHead[] = [];
  const api = fakeAdminMergeApi({ merges, over: over.api });
  const deps: GithubAdminMergeDeps = {
    doorLedger: door.port,
    localSha: recorded({ name: "localSha", order, value: ok(HEAD_SHA) }),
    readCodexLoop: recorded({ name: "readCodexLoop", order, value: PAIRED_CHECKOUT }),
    readBumpWitness: ({ head }) => {
      bumpHeads.push(head);
      return { kind: "clear" };
    },
    makeApi: recorded({ name: "makeApi", order, value: api }),
    measureBaseFreshness: ({ baseBranch }) => {
      order.push("measureBaseFreshness");
      return ok({
        baseBranch,
        baseSha: "b".repeat(40),
        headSha: HEAD_SHA,
        kind: "fresh",
        remote: "origin",
        reverted: [],
      });
    },
    nowIso: () => "2026-08-27T00:00:00.000Z",
    out: ({ line }) => lines.push(line),
    probePostMergeDocsBudget: () => ({ budgets: [], kind: "evaluated" }),
    publishAlert: () => undefined,
    releaseOwnHold: (args) => {
      released.push({ ...args });
    },
    sweepPrivateTerms: () => {
      order.push("sweepPrivateTerms");
      return { accepted: 0, binaryFiles: 0, kind: "clean", terms: [], textFiles: 1 };
    },
    token: () => {
      order.push("token");
      return "t";
    },
    walkthrough: noWalkthroughs({ headOid: HEAD_SHA }),
    ...over,
  };
  return { bumpHeads, deps, lines, merges, order, released };
}
