# The local lap — `github lap`, CI on this machine when hosted Actions is off

Bundled reference for the `github` skill. A repository can have its hosted Actions turned off over cost and
still require `build` and `integration` on its base. Then nothing ever posts them, a merge queue waits on
them forever, and `github enqueue` cannot land anything. `github lap` is the stand-in: it runs the
registered CI commands on this machine over one pull request's head, posts the two contexts on that commit
through the door, and with `--land` lands it.

```bash
slopweaver github lap --repo <owner/name> --number <n> --dry-run   # preflight + the plan, nothing run or posted
slopweaver github lap --repo <owner/name> --number <n>             # run it and post build / integration
slopweaver github lap --repo <owner/name> --number <n> --land      # …then land it under a hold
```

While a chair's `github lap-seat set <slug>` stands, only that run's session laps, every mode but `--dry-run`:
[the lap seat](lap-seat.md).

## What it refuses before an hour of lanes

- the pull request is not open;
- the token is not a repository administrator, or the base enforces its protection on administrators — the
  landing is the administrator's bypass, so either one closes it;
- the base requires a context other than `build` and `integration`, which a lap never posts. This reads
  classic protection only; a context only a RULESET requires passes the preflight and is refused afterwards
  by `github merge`'s required-context gate, which reads both, so the cost is a wasted lap, never a landing;
- **GitHub DENIED the protection read**: `PROTECTION_PERMISSION_DENIED`. Three answers (`protectionRead.ts`): 404 is
  unprotected; a 403 with GitHub's "Upgrade to GitHub Pro or make this repository public" sentence is a base its
  plan cannot protect, where the lap and `merge --admin` RUN with that note; any other 403 refuses;
- **the head does not contain the base's fetched tip.** Rebase and push first: a squash of a head that already
  contains its base is that head's own tree, so the tested tree is the landed tree;
- **the running CLI's CI model differs from the head's** (`LAP_PLAN_SOURCES` in `lapPlanSources.ts`: the register,
  the `lap*.ts` modules of this verb, the `lapSeat*.ts` gate's included, and `ci.yml`, each compared byte for byte;
  a shared library they import is not in it). The plan and its environment are computed by the code running the verb, so its own tree is
  the side compared, never the directory you stand in: a lap from an older CLI over a head that added a lane
  or changed a job's setup would post green without running what the head's CI would. Run a CLI whose copies
  match the head's (`SLOPWEAVER_CLI_DIR=<tree> <tree>/bin/slopweaver`), from any directory of the repository;
  a head that contains the base tip and touches none of them matches any CLI at that base;
- **with `--land` on ONE pull request, the landing itself would refuse.** The lap runs the very
  `github merge --admin` it will land with, same argv, body and acknowledgements, with `--dry-run` appended, in a
  fresh tree at the head, under the lock's `preflight`, before the `pending` post or any lane. Every check the merge makes runs; a
  required context not yet on the head is a note there, because posting it is the lap's job, and so is a hold
  another pull request stands, which is transient and leaves the lap's green for `--land-only`. So a
  precondition no lap can fix — a native stack member, a draft, an unpaired Codex loop, a review rule no bypass
  waives, a door hold such as an unloaded profile — refuses here, not after the lanes; only GitHub's own merge
  endpoint stays unasked, since only a write can ask it. `--land --dry-run` runs that check and prints the plan. Without
  it, a stack member laps green and is then refused at the merge on a membership that was true before its first lane.

**Residue, stated.** A BATCH's landings are not checked ahead (`--land --dry-run` on a batch is refused), and a
refused lap leaves no receipt of the refusal beyond its own output. Both are follow-ups, not oversights.

A batch's preflight (every member's read, fetch, simulated squash and merge measurement, then the plan sources
and protection) will not START a stage past a 10-minute deadline. It is checked once a stage has passed its own
checks and before the next starts, so a stage's own refusal always outranks it, and a refusal past it names the
stage it just finished. A preflight whose last stage finishes is never refused after the fact, since there is
nothing left to bound. A stage already running is not interrupted, so one long member measurement overshoots by its own
length before the refusal. The merge guard's revert walk inside it is two git reads per member, a `log --raw`
of the base's history and one `ls-tree` of the head: it was one child per past version of every changed path,
which is what spun a seven-member dry run for 57 minutes.

When both contexts are pinned to an app (the hosted CI app, typically), the lap NOTES it and carries on:
GitHub's own protection never counts a status this token posts, so these statuses are Slopweaver's evidence,
read by `github merge`'s required-context gate before the administrator bypass.

## What it runs, and in what environment

The plan is DERIVED from `OFFLOADED_COMMANDS` (`src/devLint/ciOffloadCommands.ts`), the register
`ci-offload-contract` proves CI runs: an install, `integration`, then every register entry in order, a nested
project's install before its first command and `yarn slopweaver dev build` before the subprocess lane. It
stops at the first red step, and a step past its 45-minute ceiling is killed with its whole process group.

The detached checkout lives under `<cache root>/lap-trees.noindex` (`~/Library/Caches/slopweaver/lap-trees.noindex`
by default on macOS), never the per-user temp directory: macOS's nightly temp cleaner empties files there older
than three days, and an install keeps the package cache's old timestamps, so it once emptied a live tree's packages
mid-lap. The lane home stays under `TMPDIR`.

A lane sees only an allowlist of the seat's variables (`PATH`, `TMPDIR` and the like), plus
`CI=true`, `POLLY_MODE=replay`, `TZ=UTC`, one throwaway directory as both `HOME` and `SLOPWEAVER_HOME`, the
named download caches under the real home (proto's, Yarn's, Playwright's, Electron's) and the coverage base.
A throwaway `postgres:17` on an ephemeral local port reaches only the lanes whose CI job pointed at the
service (`subprocess`, `desktop-e2e`), through that job's own variables: handed to `integration`, a
live-store test CI skips runs against a database nothing migrated. No token, no open hatch, no live cassette
recording, no operator state, and no seat home: that is where its GitHub, Codex and Claude credentials and its
git identity live.

That removes what a lane reaches BY DEFAULT, the way a test finds `HOME` or a token; it is not a sandbox. The
lap runs as the seat's own OS user and passes the seat's `PATH` through so `yarn`, `node`, `docker` and
proto's shims resolve, so a lane can still read anything that user can by absolute path. Lap only a pull
request you would run on this machine anyway.

Every Vitest lane runs with `--maxWorkers=4`, CI's runner size. Uncapped, a lane takes one worker per local
core while the fleet shares the machine, and the subprocess lane's own cap lifts under `CI=true`: an
uncapped unit run failed 13 tests whose files all pass alone.

A red Vitest lane is re-run once, whole, into `<id>.retry.log`, on a tree cleaned as at its job's start (below):
the lap's equivalent of CI's "re-run failed jobs", because a fleet-loaded machine times a test out that a dedicated runner would not. A real defect fails
the fresh run too, and that red stands. A step killed at its ceiling is never retried, and any other step's
red stands at once. A retried green is never silent: every status its context posts, green, red or stopped,
ends `; 1 green only on retry: unit-1`, a red that failed its retry says `on its retry`, and the receipt
carries the first exit. GitHub's 140-character cap may cut only that trailing list of ids, never its count.

One lap per machine: a lock at `$SLOPWEAVER_HOME/laps/lock.json`, created by hard-linking a file that already
holds its body, so it never stands empty, and taken over atomically once its process is gone; a lock set aside by
mistake is linked back. A lap takes it FIRST, after the lap-seat gate and before its token, reads, fetch or landing tree, as `preflight`, then rewrites it `running` once it has a head; a second lap refuses in either phase, `github lap-seat show` names both, and `--dry-run` takes no lock. Then it holds the compile lease to the end ([build](../../../docs/toolchain/build.md)). Logs and a receipt (`lap.json`, rewritten after every step, `running` until the last) sit under
`$SLOPWEAVER_HOME/laps/<owner>-<repo>/<n>/<instant>/`.

**Where it is not CI.** Every lane runs serially in ONE worktree on macOS, where CI ran each job in its own
Linux checkout. So before the first step and each step opening a new CI job, the lap runs `git clean -d
--force --force`: every untracked, unignored file goes, nested repositories included, while `node_modules` and
a build's output stay, being ignored. It spares only what stands in for an artifact `ci.yml` hands on,
root-anchored: each shard's blob in `.vitest-reports` through the LATER shards and their merge, never its own
or an earlier shard's retry and never `subprocess`, which once ran out of heap reading six shards' blobs. A clean that fails stops the lap red at that step, unrun. Ignored output still
carries over, and `desktop-e2e` runs every spec, since there is no event payload to narrow it.

## What it posts, and how it lands

`pending` on both contexts the moment the lock turns `running`, so an earlier green on the same commit stops being
current while a rerun works. Then `error` if the tree or the store will not come up, or the verdict: each
context `success` only when every step under it ran green, `failure` naming the red step or how many never
ran. Each status is read back and matched, up to four reads 2s, 4s and 8s apart, because GitHub's status list
trails the POST it just took; a read that fails stops at once, its client having retried a transient failure
itself, and a POST is never re-sent. A lap
killed mid-run leaves `pending`, never green.

Every GitHub call the lap itself awaits ends by 60 seconds, its own retries included, in `LAP_GITHUB_TIMEOUT`
(`src/outbound/github/lapApiDeadline.ts`): a request on a dead socket once held a batch `--dry-run` for 15m37s.
A timed-out write is not known absent, so the lap stops rather than retrying it. The nested `github merge
--admin` keeps its own 45-minute bound as a whole, sized to its revert walk on a large pull request
(`LAP_VERB_TIMEOUT_MS`, `lapVerb.ts`); a verb killed there exits 124 with a line saying so, never 127.

`--land` refuses when a hold already stands over the repository, since `github hold` answers success for one
on the same pull request it did not place and the lap would then release somebody else's. It reads the hold
document FAIL-CLOSED: only a missing file is clear, and one it cannot read or decode refuses the landing, where
the shared store's tolerant read would call it empty. Otherwise it takes
`github hold` FIRST, then refetches both refs and refuses if either moved, then runs `github
merge --admin` pinned to the lapped head with the pull request's own body, and releases the hold whatever
happened. The merge measures in a fresh tree at that head, never the seat's checkout, so the Codex loop it
reads is the pull request's own (every checkout holding its head), not the lapping seat's branch. A finding
merge would accept by subject (`codex-loop-incomplete` on a data-only change, say) passes through as
`--acknowledge <subject,...> --reason <text>`, verbatim, which merge writes to the door ledger. `merge --admin` refuses a moved base on its own account too. The hold is advisory: it serialises
Slopweaver's own landings, not a push from GitHub's UI, and GitHub's merge pins the head, not the base — that
residue is the one race left.

`--land-only` is that same landing with no lane run and nothing posted, for a head a lap already made green
whose merge then refused on a finding since cleared. It lands only when the LATEST `build` and `integration`
status on the head is `success`, written by a lap (`local lap: …`) over the base tip as just fetched; anything
else, a hosted green or a lap over an older base included, refuses and names the context. The status is only
a claim, since any status poster can write that text, so it also needs this home's own receipt under `laps/`:
one FINISHED lap at exactly that head and base, over the plan the running CLI runs, every step green. It holds
the machine's lap lock from that check through its merge, so no lap here posts over the head in between.

## A batch: one lap, every member landed

`--number a,b,c` laps an ordered batch (at most 12, every member open and on ONE base branch; a native-stack
member is refused, since it lands through [stack-merge.md](stack-merge.md)). One lap per landing measured 0.28
landings per lap (18 laps, 5 landings), because each landing moves the base and every other green head goes
stale. A batch fetches every head over one base tip and SIMULATES the squash chain: `s_0` is the tip, each
`s_k` a one-parent commit on `s_{k-1}` whose tree is `git merge-tree` of `s_{k-1}` and member k's head. A
conflict refuses before anything posts, naming the member and its paths. So does a member whose content its
link's history once held (`reverts-main`, measured over `s_{k-1}`, so undoing an earlier member counts): its merge
would refuse it, and the batch never acknowledges one, so it lands alone with `--acknowledge <path>` or is rebased.
The lanes run ONCE over `s_n`, with
the coverage base set to the real tip, and the verdict is posted on every member's head as `local lap batch: …,
batch of N`. That lead is never `local lap: `, so `--land-only` on one member never reads a batch's green as its own.
The receipt, under `laps/<owner>-<repo>/batch/`, carries every link.

The machine's lap lock spans the lap AND every landing. `--land` lands each member in order exactly as a single
lap does (hold, refetch unmoved, `merge --admin`, release), with three batch-only steps:

- **Before each merge** it re-reads the member and stops unless it is still open, on the batch's base branch and
  at the simulated head, since the refetch reads the base BY NAME. It then measures the `base-moved` findings the merge will raise over the REAL tip, with the
  guard's own code, and requires them to equal the ones over the simulated link. It then accepts them on the
  member's behalf, plus `base-moved` for the freshness gate when the head lacks the tip. Because
  `--acknowledge` accepts by subject, a `base-moved` path the member ITSELF changes would also silence that
  path's other finding, so it stops instead. It stops too on a `base-moved` path git quoted, which cannot be
  compared with the member's raw paths, or one holding a comma, which a comma-separated `--acknowledge` cannot
  name. Every other finding still refuses: a batch refuses `--acknowledge`
  and `--reason` outright, since one caller acknowledgement would be handed to every member. The one caller
  acknowledgement a batch takes is PER MEMBER: `--codex-loop-incomplete <n>=<reason>`, repeatable, adds
  `codex-loop-incomplete` and that reason to member `n`'s merge and no other, for a member whose capped Codex
  review left findings (name them in the reason). A member owing any other acknowledgement laps alone, and one
  that itself changes a path named `codex-loop-incomplete` stops, since the subject would accept that path too.
  So does ANY member whose `base-moved` paths include one with that name, flag or not, since accepting the
  path would accept the Codex loop finding for a member nobody named.
- **After each merge** it reads the new tip back. Its one parent must be the tip it landed onto, and its tree
  the simulated `T_k`, or the batch stops. The simulation is a prediction of GitHub's squash, not a
  reproduction, so a disagreement lands at most one unpredicted commit, named in the stop line. The base is read
  back whatever the merge exited, since a lost response can hide a landing; when the tip moved somewhere
  unpredicted, GitHub's own merge record of the member says whether it was this one (never `closed` alone,
  which a pull request closed without merging also reads); a record that cannot be read confirms nothing, so
  the member is posted failed whatever its merge exited. GitHub's merge cannot pin a base, so a base an
  administrator moves past the hold after the last refetch is the same residue: one unpredicted commit, caught
  here.
- **On any stop**, every unlanded member gets `failure` on both contexts (`local lap batch stopped …`). That
  text is never a lap's green, so `--land-only` refuses it. It is advisory: an administrator can still merge
  past it outside Slopweaver.

A red lap lands nothing. The next invocation is a shorter list; bisection waits on how often a real batch is
red. `--land-only` with a batch is refused, since its green was earned in combination. The intermediate trees
`T_1..T_{n-1}` reach the base checked for shape but never run, which is what any batching merge queue accepts.
