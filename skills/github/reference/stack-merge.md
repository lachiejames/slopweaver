# Queueing a NATIVE-STACK member — `github enqueue`'s asynchronous REST route

The rest of the verb is [merge-queue.md](merge-queue.md); this is the one path that differs, and why.

## GitHub refuses the mutation, so membership picks the transport

GraphQL's `enqueuePullRequest` answers a stack member:

> This pull request is part of a stack and must be enqueued using the asynchronous merge REST API

Measured twice on `acme/acme-admin` with all 21 of its checks green, `MERGEABLE` and its required reviews
present. It is not a state you can acknowledge past, and every workaround overreaches: `merge --admin` bypasses the queue that caught
the bug in the first place, and `stack remove` retargets the pull requests, changing what they ship.

The direct route is closed to a member too. GitHub answers an admin squash of a stack member "Merging stacked
PRs via this endpoint is not supported", however green its laps were (relayed from a lap's console; the merge
output was not logged). So `github merge --admin`, and the lap's `--land`, which checks it before its first lane, refuse every
stack member: on a queued base they name `enqueue`, on a queueless one `stack remove`.

So `enqueue` reads `stack`/`stackEntry` on the pull request itself and routes on that. **A half-populated
membership is a READ FAILURE, never "no stack"** — reading a shape we did not understand as absence would
send a member straight back into the mutation GitHub refuses.

## The landing branch is the STACK's base, not the pull request's

A stack chains each member onto the head branch of the one below it, so only the bottom member targets the
branch the stack actually lands on.

MEASURED: the pull request at position 1 of a stack reads `baseRefName: staging`; the one at position 2
reads `baseRefName: feature-branch-below` — a branch with no queue, no protection rule and
no required contexts. Judging that branch would refuse a perfectly queueable member with _"has no merge
queue"_, which is a verdict about the wrong subject. Reproduce:

```bash
slopweaver github read https://github.com/acme/acme-admin/pull/<n> --json
```

The queue read, the required-context read, the refusals and the code-owner wording all use the stack's base.
The two coincide for an ordinary pull request and for the bottom of a stack, which is exactly why this only
ever surfaced as GitHub's own rejection message.

## Queueing a member queues everything unmerged BELOW it

GitHub's own words: _"The selected pull request and all unmerged pull requests below it land on the base
branch together as a single operation"_, and _"You cannot merge a mid-stack pull request in isolation"_. The
group is atomic — the whole of it merges, or is queued, or none of it is.

So the report names its scope BEFORE the write, and the `clean` verdict says explicitly that it read only the
SELECTED pull request:

```text
stack:        #<stack>  position 2 of 3  landing on staging
PR base:      feature-branch-below — the member below it, which is NOT where the stack lands
scope:        #<n> and every unmerged pull request BELOW it in stack #<stack> are requested together, bottom-up.
```

**No count is derived from `size` or `position`** — those describe the whole stack, not the unmerged
remainder, so turning them into "3 pull requests" would be a confident wrong number. **Land a stack
bottom-up**, one member at a time, re-reading between presses.

## The request runs in the background, and the verb waits with a STATED bound

`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async` answers `202` and then runs. The body is exactly:

```json
{ "sha": "<the head the guard measured>", "merge_action": "merge_queue" }
```

`sha` is the same optimistic-concurrency pin `expectedHeadOid` is on the GraphQL path — a force-push landing
mid-flight is refused rather than queued unseen. `merge_method` is deliberately NOT sent, so the queue keeps
its own configured method, and `merge_action` is explicit so GitHub's automatic action selection cannot pick
`direct_merge` and bypass the gate this verb exists to press. Neither route has a generated Octokit type yet,
so both go through `client.request(...)` with a hand-narrowed projection, exactly as the native-stack
endpoints do ([docs/provider-sdks.md](../../../docs/provider-sdks.md)).

The verb then polls `GET .../merge-async/{uuid}` and re-reads the pull request over a budget of **six waits
totalling 60 seconds of scheduled waiting** (`[1s, 2s, 4s, 8s, 15s, 30s]`), plus however long each request
takes. **That budget is a CHOICE, not a measured GitHub completion time** — none was measured, and nothing in
the code or here implies an SLA.

| what happened                           | exit | what it says                                                                     |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| an entry read back                      | 0    | the ordinary `queued #<n> into <branch> at position …` line, plus the scope line |
| `status: failed`                        | 1    | `FAILED: …` carrying GitHub's own reason verbatim                                |
| `status: merged`                        | 1    | `MERGED: …` — non-zero, because this verb's only witness is a queue ENTRY        |
| budget spent, still pending or enqueued | 1    | `UNCONFIRMED: …` naming the request's uuid, so a re-read picks it up             |

**`status: failed` arrives under an HTTP 200**, so the body is parsed rather than judged by its status code —
that is the whole reason the projection is load-bearing rather than decorative. And **nothing ever sends a
second `PUT`**: an unconfirmed request is reported with its uuid precisely so nobody starts a competing job
for the same stack.

**Every one of those lines names `owner/repo#number` and the request's uuid**, because `--json` suppresses
the identity lines above and a bare `#<n>` identifies nothing across repositories. An `IN FLIGHT:` line is added
wherever the request may STILL BE RUNNING — a read that failed after the PUT was accepted, and a pull request
that read back CLOSED while the request itself reads `pending` — warning that a retry starts a second merge
job. A `FAILED:` refusal and a GitHub-reported `merged` deliberately carry no such warning, because nothing
is running in either. A PUT whose OWN answer could not be read gets a third wording, `UNCERTAIN:` — a `202`
this build cannot parse is an accepted job with a lost uuid, and "GitHub accepted it" is exactly what is
not known. Three Codex review passes found this
class three times, each with its own counterexample, which is why it is written down rather than assumed.

## `--dequeue` is unchanged, and its limit is stated rather than guessed

It still goes through GraphQL's `dequeuePullRequest`. **Whether GitHub accepts that mutation for a native
member is UNVERIFIED here** — the asynchronous endpoint has no removal action, and no verb invents one. What
IS documented is the cascade, and the report says so: removing one member removes every member ABOVE it.
