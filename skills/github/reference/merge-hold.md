# Slopweaver's own merge lane — `github hold` / `github release`

Bundled reference for the `github` skill, split out of [pr-operations.md](pr-operations.md) when the lane
stopped being the default landing path.

**Scope first: this is for a base branch with NO native merge queue.** On a queued base — `lachiejames/slopweaver`
`main` — [`github enqueue`](merge-queue.md) serialises the landings
instead, and the last bullet below is why the hand-run lane could not. The exceptions on a queued base are
a proof that is an expensive live measurement a moved head would invalidate outright, and a repository whose
hosted Actions is off, where the queue waits on contexts nothing posts and `github lap --land` takes this hold
([local-lap.md](local-lap.md)).

`slopweaver github hold --pr <n> --repo <owner/name> --why "…"` gives ONE pull request slopweaver's own
advisory lane. **`slopweaver github merge` AND `slopweaver github enqueue` then refuse every other pull
request in that repository** — merge on both its report path and its `--admin` path, enqueue on every path
but `--dequeue`.

**Why enqueue is gated, since the paragraph above says this lane is for an unqueued base.** Because the
exception it names is not: an expensive live measurement lives on a QUEUED base by construction, and there
the mandated landing verb is `enqueue`. MEASURED: every hold placed after the queue landed stood
on the queued base, four for four, while the gate was on `merge` alone. One hold stood on
`lachiejames/slopweaver` for 27 minutes and another pull request landed underneath it, from a
`verb:github.enqueue` door record. The hold refused the verb nobody in that lane was using.
Read both back:

```bash
grep github-hold "$SLOPWEAVER_HOME/live/events/stream.jsonl"
grep <UTC date and hour prefix> "$SLOPWEAVER_HOME/ledgers/door.jsonl"
```

**`--dequeue` is exempt, and that is load-bearing rather than an oversight.** Leaving a queue only ever
narrows what happens next, so refusing it would refuse the one act that gets a competing entry out of the
holder's way — which is exactly what a session should do when it meets the refusal holding a queue entry.

**This does not make the hold cheaper to take.** It blocks the lane every session on a queued base is
actually in, so the head-of-line risk the last bullet measures is REAL here rather than theoretical. `enqueue`
is the lane; the hold is the exception.

Five things the verb's own help does not say:

- **It replaces a fan-out, not a guard.** The alternative, as measured, was `ListAgents` plus
  one message per live session, a line in a state doc, and a second round of messages carrying the landed
  SHA once the held pull request was in. A message has to be READ at the right moment; a refusal at the
  LANDING step cannot be missed, because every session's landing step is one of the two verbs it gates.
- **`merge --admin` releases its own hold** the instant it lands the held pull request, recording the landed
  commit on the supervisor stream. That is the second round of messages gone. It never clears a hold held
  for a different pull request.
- **It is advisory BY MECHANISM**, exactly like the guard it sits beside: `gh pr merge`, GitHub's own
  **Merge when ready** button and an administrator's override in the GitHub UI bypass it entirely. Do not
  read the refusal as a fence.
- **A stale hold warns, it does not expire.** Past its threshold (`--stale-minutes`, default 30) the next
  reader — `github hold --status`, which the supervisor's sweep runs every tick, a merge or an enqueue the
  hold refuses, or a `github push` refused as `base-moved`, which reads the hold to decide its own remedy —
  publishes one
  `warn` to the supervisor stream and marks it, so eight sessions produce one warning. Nothing polls it: with
  nobody looking, nothing warns and the hold still stands.
- **`--status` REPORTS whether the holder is still a live session; nothing expires a hold.** A hold belongs
  to a session, a queue entry to GitHub. MEASURED: the hold-and-baton lane sat idle 371 of 905
  minutes — 41% of the day — behind dead or parked holders, once 199 minutes on one pull request, while
  service time was a healthy 24.5 min/PR. Head-of-line blocking, not throughput, was the defect, and that is
  why the lane is not the default. `--status` asks the same live-session registry every other surface
  asks and marks a gone holder `GONE`, with the release command on the line under it; a holder it cannot
  measure reads `(liveness unknown)` rather than being called dead — and `an unidentified session`, the label a
  hold placed with no readable session id carries, is such a holder: it names nothing the registry could lack. It changes what a reader is TOLD and
  nothing else — the hold keeps refusing, because a hold that expired itself would be a hold that is safer to
  reach for, and `enqueue` is the lane.

## The journal — `github hold --history`

`merge-hold.json` is REPLACED on every write, so on its own a released hold leaves nothing. Every transition
also appends one row to
`$SLOPWEAVER_HOME/live/github/hold-ledger.jsonl` — `held`, `released` or `stale`, each carrying the
repository, the pull request, the holding session, the instant, the holder's stated reason, the threshold it
was placed with and how long it had stood.

```bash
github hold --history            # the last 20 rows, oldest first
github hold --history --limit 5  # fewer
github hold --history --json     # the rows verbatim
```

Two things it is not. It is not a second source of truth for what is held NOW — that is `--status`, reading
the document. And it does not make holding easier: nothing in it refuses less, holds longer, or gives a hold
any power it did not have. It exists so a shift that took a hold can be measured after the fact, the way
the lane's idle time once had to be measured by hand.

## On a gated queue, neither push nor create refuses a base-moved head at all

A base branch with a native merge queue that requires at least one status-check context already tests the
MERGED result against the tip plus everything ahead of it. The local lap was never what protected that base,
so refusing the push and sending the author round another rebase-and-revalidate lap is racing a race it need
not win — MEASURED: a lap takes ~18 minutes at fleet load while the base
advances roughly every 10, and three consecutive laps each timed out a different innocent file, every one
green on its own.

So both doors that measure base freshness — `github push`, and the creation gates `github stack push` runs —
read the base's queue on that arm, and only on that arm, so a fresh push still reaches no network. Each then
PERMITS an unacknowledged `base-moved` when both hold:

- the queue exists and requires at least one status-check context (an empty set means it merges an entry on
  arrival without testing anything, which excuses nothing);
- the base is no more than **16** commits past the head. MEASURED over the last 400 commits on
  `main`, by rolling window: 30 min held at most 5, 1 h at most 6, 90 min at most 9, 2 h at most 11, 3 h at
  most 15, 6 h at most 24. So 16 clears a three-hour cycle at the busiest cadence this tree has seen, while a
  base half a day past the head is still refused. Re-measure any window, in seconds:
  `git log origin/main -400 --format=%ct | sort -n | awk -v w=10800 '{t[NR]=$1} END{for(i=1;i<=NR;i++){j=i; while(j<=NR && t[j]-t[i]<=w) j++; if(j-i>m) m=j-i} print m}'`

**The bound is sized against being too TIGHT, not too loose**, because the queue is what makes any drift
safe and the bound only says how stale a local lap may be. It was first drafted at 8, off the 30-minute
window alone. Measured live while landing that draft: the gate lap ran 688 s, and by the time the creation
door checked, the base was 7 commits past the head. A cycle is a gate lap plus a push plus a create, and it
is the cycle that has to fit.

Every check is POSITIVE evidence: an unreadable queue, a branch with no queue, an unreadable rules payload,
a missing token and an uncountable drift all leave the refusal exactly where it was. A gate cannot be relaxed
here by failing to look. `github merge --admin` is deliberately untouched — it bypasses the queue, so a
base-moved head there really would land untested.

**Both doors, because one was not enough, and that was MEASURED rather than reasoned.** This change first
relaxed `push` alone, on the argument that a branch is cut fresh so creation rarely races. Its own pull
request then disproved that within the hour: `main` advanced between the `github push` that sent the branch
and the `stack push` that opened the pull request, and creation refused a head push had just accepted.

## What a `base-moved` refusal says when the queue does not excuse it

`github push` reads the hold record before it prints a `base-moved` refusal, so the remedy names the lap that
actually lands rather than the lap that loses. It opens by naming which of the checks above failed, then —
with nothing held, the ordinary case on a queued base — prescribes ONE rebase, one gate lap and
`slopweaver github enqueue`, and says in as many words not to take a hold or hand a baton on. The two hold
branches fire only when a hold genuinely stands, which is the scope this file opens with.

It reads the record rather than assuming, because `base-moved` is the moment a session learns it is in a
serial landing at all — the one point where telling it the wrong lane costs a whole rebase-and-validate lap.
