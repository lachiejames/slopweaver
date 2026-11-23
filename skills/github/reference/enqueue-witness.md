# The enqueue witness — what proves a press, and what a failed one leaves behind

Split out of [merge-queue.md](merge-queue.md), which holds the verb's refusals and its shape. This file is
the one property that governs both a successful press and a failed one: the verb believes a SEPARATE read of
`PullRequest.mergeQueueEntry`, never the write's own answer.

## The witness is a read-back, never the write's own word

Both GraphQL mutations return a `mergeQueueEntry` and discard it, and the asynchronous request's own status is
read for progress and failure only. Success is reported after a SEPARATE read of `mergeQueueEntry`:

- an enqueue that reads back with no entry is **UNCONFIRMED** and exits non-zero — never success, and the
  same for a dequeue that reads back still holding one.

The enqueue is also pinned to the head commit the report measured (`expectedHeadOid`), exactly as
`github merge --admin` pins its squash to a SHA: a force-push landing between the measurement and the call
is refused by GitHub rather than queued unseen.

## The same read answers a FAILED press — a dropped connection is never left ambiguous

A press can fail two ways, and they call for opposite acts, so the verb separates them instead of printing
one message. **GitHub answered and refused** — a stale `expectedHeadOid`, a closed pull request — is a
verdict: the line names the operation and its HTTP status, and re-sending would earn the same refusal.
**Nothing answered at all** — the connection died, no HTTP response of any kind — tells you nothing about
whether the press landed, so the verb takes the witness read anyway and reports what GitHub actually holds:

- the entry is THERE → the press landed and the connection dropped after it was accepted; the verb reports
  it queued and says so;
- the entry is NOT there → the failed send changed nothing, so the verb sends it **once** more, says it is
  doing so before it does, and reports a second failure rather than retrying again;
- the witness read failed too → **UNCERTAIN**, naming both failures, because an unproven absence is not an
  absence.

A second send never contradicts the write lane's at-most-once rule. That rule is about what a re-send can
DUPLICATE, and an entry the witness has just proven absent can be duplicated by nothing; the lane itself
still never retries, because it would be retrying blind.

Every transport failure prints its real cause — `github github.enqueuePullRequest UND_ERR_SOCKET: other
side closed` — never the socket layer's bare phrase. MEASURED on
one `acme/acme-admin` pull request: six presses within an hour whose entire output was
`other side closed`, while GitHub's own `enqueuePullRequest` under the raw break-glass queued the same head
first try. Reproduce the class at the wire with the `hangup` mode in
`src/__tests__/integration/githubWriteTransport.test.ts`.

## The asynchronous stack route gets the named cause and no re-send

A native-stack member goes through the asynchronous merge REST request instead
([stack-merge.md](stack-merge.md)), and a failure there prints the same formatted cause — the layer, the
operation and the undici code — followed by `UNCERTAIN`, because the request may already have reached GitHub.
There is no permitted re-send on that transport: one `mergeQueueEntry` read cannot prove a background merge
job absent, and enqueueing again would start a second one on the stack.
