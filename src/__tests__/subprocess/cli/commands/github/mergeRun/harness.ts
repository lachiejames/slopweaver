/**
 * What the `github merge` test files share: the verb's argv prefix, the `--admin` edges that fail loudly, the
 * no-hold edges, the fixture SHAs and fetched base, the deps builder every case overrides, and the capturing
 * `out`. Moved here when the verb's one test file was split by describe.
 */
import { GithubVerbErrors } from "../../../../../../cli/commands/github/errors.js";
import type { GithubMergeDeps } from "../../../../../../cli/commands/github/mergeRun.js";
import { err, ok } from "../../../../../../lib/result.js";
import { unmeasurable } from "../../../../../../measurement/status.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";

export const VERB_ARGV: readonly string[] = [
  "node",
  "slopweaver",
  "github",
  "merge",
  "--repo",
  "owner/name",
  "--base",
  "main",
  "--head",
  "feature",
  "--description",
  "no deletions here",
];

/**
 * The `--admin` edges, every one of them failing loudly. No test in this file types `--admin`, so reaching
 * any of these is itself the defect: the report path must never touch a credential or the network.
 */
export const UNREACHABLE_ADMIN_DEPS: GithubMergeDeps["admin"] = {
  doorLedger: memoryDoorLedger().port,
  localSha: () =>
    err(
      GithubVerbErrors.upstreamRefused({
        operation: "rev-parse",
        reasons: ["the report path must not resolve a local head"],
      }),
    ),
  makeApi: () => {
    throw new Error("the report path must not build a GitHub client");
  },
  measureBaseFreshness: () =>
    err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["the report path must not fetch a remote"] })),
  nowIso: () => {
    throw new Error("the report path must never merge, so it never probes post-merge");
  },
  out: () => undefined,
  probePostMergeDocsBudget: () => {
    throw new Error("the report path must never merge, so it never probes post-merge");
  },
  publishAlert: () => {
    throw new Error("the report path must never merge, so it never publishes a post-merge alert");
  },
  readCodexLoop: () => {
    throw new Error("the report path must never merge, so it never reads the Codex pairing floor");
  },
  readBumpWitness: () => {
    throw new Error("the report path must never merge, so it never reads the ratchet-bump witness");
  },
  releaseOwnHold: () => {
    throw new Error("the report path must never merge, so it never releases a hold");
  },
  sweepPrivateTerms: () => {
    throw new Error("the report path must never merge, so it never sweeps the change set for private terms");
  },
  token: () => undefined,
  walkthrough: {
    now: () => {
      throw new Error("the report path must never merge, so it never resolves a walkthrough thread");
    },
    recordAutonomy: () => {
      throw new Error("the report path must never merge, so it never ledgers a resolve");
    },
    reopenThread: () => {
      throw new Error("the report path must never merge, so it never reopens a walkthrough thread");
    },
    rememberThreads: () => {
      throw new Error("the report path must never merge, so it never writes the walkthrough-thread register");
    },
    threadMemory: () => {
      throw new Error("the report path must never merge, so it never reads the walkthrough-thread register");
    },
    unseenThreadsAllowed: () => {
      throw new Error("the report path must never merge, so it never reads the unseen-threads hatch");
    },
    resolveThread: () => {
      throw new Error("the report path must never merge, so it never resolves a walkthrough thread");
    },
    sessionRef: () => {
      throw new Error("the report path must never merge, so it never ledgers a resolve");
    },
    walkthroughs: () => {
      throw new Error("the report path must never merge, so it never reads review threads");
    },
  },
};

/** A home with no hold document at all — the ordinary state, and the one every report test starts from. */
export const NO_HOLD_DEPS: GithubMergeDeps["hold"] = {
  appendLedgerRow: () => {
    throw new Error("no hold stands, so nothing is journalled");
  },
  holderLive: () => unmeasurable<boolean>({ why: "no hold stands, so no holder is asked about" }),
  nowIso: () => "2026-08-28T00:00:00.000Z",
  out: () => undefined,
  publish: () => {
    throw new Error("no hold stands, so nothing is published");
  },
  readHolds: () => [],
  readLedgerRows: () => [],
  sessionId: () => undefined,
  writeHolds: () => {
    throw new Error("a read that found no hold must not write one");
  },
};

/** The two commits every injected measurement claims to have been taken between. */
export const BASE_SHA = "1111111111111111111111111111111111111111";
export const HEAD_SHA = "2222222222222222222222222222222222222222";

/** A base that resolved cleanly to the remote tip — the ordinary case every report test starts from. */
const FETCHED_BASE: GithubMergeDeps["resolveBase"] = () => ({
  branch: "main",
  fetchedFrom: "origin",
  revision: BASE_SHA,
  why: undefined,
});

/**
 * A deps set every test starts from, overriding only what it cares about.
 *
 * @returns the default fake deps with `overrides` spread over them
 */
export function depsWith(overrides: Partial<GithubMergeDeps>): GithubMergeDeps {
  return {
    admin: UNREACHABLE_ADMIN_DEPS,
    // A current tree by default, so no staleness advisory appears above a report these cases assert on;
    // the behind-base cases below inject their own count.
    countBehindBase: () => ok(0),
    cwd: () => "/repo",
    hold: NO_HOLD_DEPS,
    measureFacts: () => ({ baseAhead: [], baseSha: BASE_SHA, diff: [], headSha: HEAD_SHA, reverted: [] }),
    out: () => undefined,
    readDescription: ({ source }) => source,
    resolveBase: FETCHED_BASE,
    resolveRepoRoot: () => ok("/repo"),
    sweepDocsBudget: () => ({ budgets: [], kind: "evaluated" }),
    sweepProbes: () => ({ docsChecked: 0, kind: "evaluated", regressions: [] }),
    ...overrides,
  };
}

/**
 * Collects every line a fake `out` receives, in order.
 *
 * @returns the captured lines and the `out` that appends to them
 */
export function capturingOut(): { lines: string[]; out: GithubMergeDeps["out"] } {
  const lines: string[] = [];
  return { lines, out: ({ line }) => lines.push(line) };
}
