import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GithubEnqueueArgs } from "../../../../../cli/commands/github/enqueueArgs.js";
import { mutateAndConfirm } from "../../../../../cli/commands/github/enqueueMutate.js";
import type { GithubAsyncMergeState } from "../../../../../corpus/github/mergeAsync.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { MergeQueuePrState } from "../../../../../live/github/mergeQueue.js";
import type { GithubMergeQueueApi } from "../../../../../outbound/github/mergeQueue.js";

/** No HTTP response came back at all — the one failure class the recovery path may re-send after. */
const TRANSPORT: IngestError = {
  code: "UND_ERR_SOCKET",
  kind: "network",
  message: "other side closed",
  operation: "github.enqueuePullRequest",
  provider: "github",
};

/** GitHub answered and refused, so a second send would only earn the same answer. */
const REFUSED: IngestError = {
  kind: "http",
  message: "expected head oid does not match",
  operation: "github.enqueuePullRequest",
  provider: "github",
  status: 422,
};

const PENDING: GithubAsyncMergeState = { message: "queued for merge", status: "pending", uuid: "req-1" };

/** A pull request holding no queue entry, which is what an enqueue is asking to change. */
function pr(over: Partial<MergeQueuePrState> = {}): MergeQueuePrState {
  return {
    approvedBy: [],
    baseRefName: "main",
    baseRefOid: "ba5e0000",
    body: "",
    checks: {
      baseRef: undefined,
      checks: [],
      headSha: "cafe1234",
      mergeable: undefined,
      residue: [],
      rollupState: "SUCCESS",
      supersededChecks: [],
      truncated: false,
    },
    codeownerRequests: [],
    codeownerRequestsTruncated: false,
    githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
    entry: undefined,
    headOid: "cafe1234",
    headRefName: "feature",
    isDraft: false,
    mergeable: "MERGEABLE",
    nodeId: "PR_kwabc",
    number: 9,
    reviewDecision: "APPROVED",
    stack: undefined,
    state: "OPEN",
    url: "https://example.invalid/pr/9",
    ...over,
  };
}

/** The same pull request once GitHub holds it in the queue — what a landed press reads back as. */
function queued(): MergeQueuePrState {
  return pr({ entry: { estimatedSecondsToMerge: undefined, position: 2, state: "QUEUED" } });
}

/** Every send and read one case took, so a test can assert the COUNT as well as the outcome. */
interface Calls {
  readonly sends: string[];
  readonly reads: number[];
}

/**
 * A plain fake API — one failure per SEND consumed in order, one read-back per READ consumed in order. Both
 * are sequences because the whole property under test is that the second send and the second read behave
 * differently from the first.
 */
function api({
  calls,
  sendFailures = [],
  reads = [],
  readFailsFrom = 0,
}: {
  calls: Calls;
  sendFailures?: (IngestError | undefined)[];
  reads?: MergeQueuePrState[];
  readFailsFrom?: number;
}): GithubMergeQueueApi {
  const send = ({ label }: { label: string }): IngestError | undefined => {
    calls.sends.push(label);
    return sendFailures.shift();
  };
  const readResult = (): Result<MergeQueuePrState, GithubLiveError> => {
    calls.reads.push(calls.reads.length + 1);
    const broken = readFailsFrom > 0 && calls.reads.length >= readFailsFrom;
    if (broken) {
      return err(GithubLiveErrors.notFound({ identity: "acme/widget#9", kind: "pull request" }));
    }
    const next = reads.shift();
    if (next === undefined) {
      return ok(queued());
    }
    return ok(next);
  };
  return {
    asyncMergeResult: () => Promise.resolve(ok(PENDING)),
    dequeue: () => {
      const failure = send({ label: "dequeue" });
      return failure === undefined ? okAsync(undefined) : errAsync(failure);
    },
    enqueue: () => {
      const failure = send({ label: "enqueue" });
      return failure === undefined ? okAsync(undefined) : errAsync(failure);
    },
    enqueueStack: () => {
      const failure = send({ label: "enqueueStack" });
      return failure === undefined ? okAsync(PENDING) : errAsync(failure);
    },
    queue: () => Promise.resolve(ok(undefined)),
    read: () => Promise.resolve(readResult()),
    requiredContexts: async ({ branch }) => ok({ branch, contexts: [], requiresCodeOwnerReviews: undefined }),
  };
}

/** The parsed invocation these cases share: an ordinary enqueue of `acme/widget#9`. */
function args(over: Partial<GithubEnqueueArgs> = {}): GithubEnqueueArgs {
  return {
    acknowledge: [],
    acknowledgeAll: false,
    home: undefined,
    reason: undefined,
    dequeue: false,
    dryRun: false,
    json: false,
    number: 9,
    owner: "acme",
    repo: "widget",
    ...over,
  };
}

/** The two edges the write takes, with the diagnostics captured for assertion. */
function deps({ diagnostic }: { diagnostic: string[] }): {
  wait: (args: { ms: number }) => Promise<void>;
  writeDiagnostic: (line: string) => void;
} {
  return {
    wait: async () => undefined,
    writeDiagnostic: (line) => {
      diagnostic.push(line);
    },
  };
}

const MAIN = { branch: "main", kind: "ordinary" } as const;

describe("mutateAndConfirm", () => {
  it("sends once and confirms from a fresh read when nothing fails", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const result = await mutateAndConfirm({
      api: api({ calls, sendFailures: [undefined] }),
      args: args(),
      deps: deps({ diagnostic: [] }),
      pr: pr(),
      target: MAIN,
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).entry?.position).toBe(2);
    expect(calls.sends).toEqual(["enqueue"]);
    expect(calls.reads.length).toBe(1);
  });

  it("re-sends exactly once when the transport dropped and the witness proved nothing was applied", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const diagnostic: string[] = [];
    const result = await mutateAndConfirm({
      api: api({ calls, reads: [pr(), queued()], sendFailures: [TRANSPORT, undefined] }),
      args: args(),
      deps: deps({ diagnostic }),
      pr: pr(),
      target: MAIN,
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).entry?.position).toBe(2);
    expect(calls.sends).toEqual(["enqueue", "enqueue"]);
    expect(diagnostic[0]).toContain("sending it once more");
  });

  it("reports a press the witness found already applied, without sending again", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const diagnostic: string[] = [];
    const result = await mutateAndConfirm({
      api: api({ calls, reads: [queued()], sendFailures: [TRANSPORT] }),
      args: args(),
      deps: deps({ diagnostic }),
      pr: pr(),
      target: MAIN,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.sends).toEqual(["enqueue"]);
    expect(diagnostic[0]).toBe(
      "the enqueue reported a failure (github github.enqueuePullRequest UND_ERR_SOCKET: other side closed) but " +
        "GitHub had already applied it — the connection dropped after the mutation was accepted. The queue read " +
        "below is the witness.",
    );
  });

  it("never re-sends a press GitHub itself refused, however absent the witness", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const result = await mutateAndConfirm({
      api: api({ calls, reads: [pr()], sendFailures: [REFUSED] }),
      args: args(),
      deps: deps({ diagnostic: [] }),
      pr: pr(),
      target: MAIN,
    });

    expect(result.isOk()).toBe(false);
    expect(calls.sends).toEqual(["enqueue"]);
    expect(unwrapErr(result)[1]).toContain("GitHub answered and refused this enqueue of acme/widget#9");
  });

  it("stops at two sends and reports the second failure's own cause", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const result = await mutateAndConfirm({
      api: api({ calls, reads: [pr(), pr()], sendFailures: [TRANSPORT, TRANSPORT] }),
      args: args(),
      deps: deps({ diagnostic: [] }),
      pr: pr(),
      target: MAIN,
    });

    expect(result.isOk()).toBe(false);
    expect(calls.sends).toEqual(["enqueue", "enqueue"]);
    expect(unwrapErr(result)[0]).toBe("github github.enqueuePullRequest UND_ERR_SOCKET: other side closed");
  });

  it("says UNCERTAIN when the witness read failed too, rather than claiming a no-op", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const result = await mutateAndConfirm({
      api: api({ calls, readFailsFrom: 1, sendFailures: [TRANSPORT] }),
      args: args(),
      deps: deps({ diagnostic: [] }),
      pr: pr(),
      target: MAIN,
    });

    expect(result.isOk()).toBe(false);
    expect(calls.sends).toEqual(["enqueue"]);
    expect(unwrapErr(result)[1]).toContain("UNCERTAIN: the enqueue of acme/widget#9 failed");
  });

  it("judges a DEQUEUE by the entry being gone, so an emptied read is the landed witness", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const diagnostic: string[] = [];
    const result = await mutateAndConfirm({
      api: api({ calls, reads: [pr()], sendFailures: [TRANSPORT] }),
      args: args({ dequeue: true }),
      deps: deps({ diagnostic }),
      pr: queued(),
      target: MAIN,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.sends).toEqual(["dequeue"]);
    expect(diagnostic[0]).toContain("the dequeue reported a failure");
  });

  it("takes the asynchronous REST transport for a native-stack member, never the GraphQL mutation", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const result = await mutateAndConfirm({
      api: api({ calls, sendFailures: [undefined] }),
      args: args(),
      deps: deps({ diagnostic: [] }),
      pr: pr(),
      target: { branch: "main", kind: "stack", stack: { baseRefName: "main", number: 3, position: 1, size: 2 } },
    });

    expect(result.isOk()).toBe(true);
    expect(calls.sends).toEqual(["enqueueStack"]);
  });
});

describe("the asynchronous stack route", () => {
  it("names the layer and the transport code on a failed REST request, and never sends a second one", async () => {
    const calls: Calls = { reads: [], sends: [] };
    const result = await mutateAndConfirm({
      api: api({ calls, sendFailures: [TRANSPORT] }),
      args: args(),
      deps: deps({ diagnostic: [] }),
      pr: pr(),
      target: { branch: "main", kind: "stack", stack: { baseRefName: "main", number: 3, position: 1, size: 2 } },
    });

    expect(result.isOk()).toBe(false);
    expect(calls.sends).toEqual(["enqueueStack"]);
    expect(unwrapErr(result)[0]).toBe("github github.enqueuePullRequest UND_ERR_SOCKET: other side closed");
    expect(unwrapErr(result)[1]).toContain("UNCERTAIN: an asynchronous merge request for");
  });
});
