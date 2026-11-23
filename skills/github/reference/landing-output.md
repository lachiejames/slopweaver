# What `github landing` prints, and how a reader asks for more

Bundled reference for the `github` skill, loaded when a landing line has to be read, extended or disputed. The
verb itself, its six tests and its acts: [landing.md](landing.md).

The read must name **each pull request's specific blocker** — which check is
red, which unit-test file failed and whether this pull request added it, CodeRabbit's state, who approved and
the code owners for the paths touched — **compactly, with progressive disclosure through an extra argument,
never a dump**. Three depths answer it, each one flag deeper than the last.

## The default: one fact line per pull request

```bash
slopweaver github landing --author @me
```

Rows are grouped under their dispatch verdict (`merge-now — 4`), one line each
(`src/cli/commands/github/landingFacts.ts`):

```text
  acme/widgets#<n> rebase-and-fix/spawn-ci · CI red, REQUIRED: unit; advisory red: lint · rabbit green · approved: alice · owners approved @acme/eng; pending @carol · 2 thread(s) awaiting us: dave (2) · asked: yes, chase DUE · "a change"
```

- **CI names the failing check and whether the base REQUIRES it.** An advisory-only red reads `required CI
clear; advisory red: …`, never `green`; a red whose requirement could not be read says `requirement unknown`,
  and a cut check list says `(check list truncated)`. Only a check GitHub reported FAILED is called red; one still
  running or queued is named apart as `pending`.
- **Every row carries the full table's why-cell sentence in brackets** unless the line already says it —
  `press`, a REQUIRED failing check's `spawn-ci`, threads held by named people — so CodeRabbit's objection, a
  conflict's paths or a required context that never ran is never absent. A non-act or `NEEDS-OWNER-JUDGMENT` carries its own why BESIDE that sentence, never instead of it, and an
  `unread` one names WHICH test could not be answered (`mergeable could not be answered: …`). The dispatch's
  instruction to a spawned seat is `--pr`'s and `--full`'s.
- **The table's QUEUE and BOARD cells ride the line when they hold something**: `queue: DROPPED`, `queue: #2
awaiting_checks`, `board: fix-the-build in-progress`.
- **A blocker is named by WHO, never only counted**: every holder in `held by`, every failing check that is
  REQUIRED or whose requirement is unknown, and each reviewer waiting on a thread with how many.
- **Every other list is capped at three names then `+N more`** — an advisory red, the approvers — so a wide diff's code owners stay one line, and a list GitHub cut short says so (`owners: unknown (request list truncated)`, `0+ thread(s)`) rather than reading as none.
- **A clause that has nothing to say is still printed** (`approved: none`, `owners: none named`) — an absent
  clause would read as "not checked".
- The residue folds to ONE stderr line naming `--full`. The same line rides each row as `facts` under
  `--json`, and the supervisor digest prints it for a dispatchable row (`src/supervisor/digestLanding.ts`).

## `--full`: the wide table and every residue line

The wide table, plus every residue line unfolded. Read it when a fact line's
clause needs its test-by-test reason.

## `--pr <n>`: one pull request, whole, with the job logs read

```bash
slopweaver github landing --repo acme/acme-admin --author @me --pr <n>
```

Prints the fact line, the six tests with their reasons, the dispatch, the approvers, the code owners'
sentence, the Slack ask trail and CodeRabbit, then **each check not passing, with its own state, followed by the
test files its Actions job log names as failing** (`src/cli/commands/github/landingDetail.ts`), each marked by whether this pull
request's diff `ADDED` it, changes an existing one, or does not touch it.

**Only `--pr` pays for those two reads, so a fleet tick never does.** A job log per red row is the expensive
half; the drill-down reads one row's logs (through `github checks --log`'s own seam) and its changed-file list,
paged to the end. `--pr` takes exactly one `--repo` and refuses beside any write flag.

**An ENDED pull request reads ended, never as a row.** `--pr` reads by number, which GitHub answers whatever the
state, so it asks GitHub's own state first (`src/cli/commands/github/landingEnded.ts`): a merged one prints
`has ended — <url> merged at <merge commit> (<instant>)`, a closed one its close instant, and neither builds a row.
A state it could not read refuses, exit 1, rather than print a row that might call a merged pull request
`pressed-not-queued` — which is what it once did for over an hour after a pull request merged off the queue.

**What it cannot establish, it names rather than drops:**

- A check still running or queued has no verdict, so its partial log is not read: `log not read`, saying so.
- A legacy commit Status, wherever its URL points, and a Check Run whose details URL is not THIS repository's
  Actions job on github.com — run and job read from its PATH alone, never a query string — have no log GitHub
  serves: `log not read`, with that reason. The URL is the posting app's claim, so a Check Run's log is read
  only when GitHub's own `checkSuite.workflowRun` ties it to the run that URL names.
- A file list cut short, holding an entry it cannot name, or read while the head moved off the judged one or the base moved at all leaves
  `not touched` unprovable, so it reads `unknown` instead. `changed` is said only on a status that changes the
  file, and a check's log evidence is matched by its position, so two failing runs sharing a name never swap.
- A test path is taken only from a FAILURE line (`FAIL `, `##[error]`, vitest's `❯ … failed)`), at most 50 per
  job with the rest counted; a log line longer than 8,192 characters is searched only at its start, and the check
  says how many were cut, so an empty search reads `no failing test file found in the part … searched`, never
  `names no failing test file` (`src/live/github/testFailurePaths.ts`).
