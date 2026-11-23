# What a repository exposes when it goes public

`github exposure inventory --repo <owner/name> [--json]` counts what every surface of a repository holds that
becomes public the moment a private repository is switched public. `github exposure sweep --repo <owner/name>
[--json]` reads the same surfaces and scans their text. Both read through the GitHub door (the resilient read
client and `safeProviderCall`), every request a GET from one closed call table (`src/live/github/exposureModel.ts`),
and neither edits, deletes or posts anything.

`audit publications` reuses the thread listings and this file's text table to judge the same threads with the
outbound privacy check, carding each finding through the `publication-leak` monitor
([publication-leak](../../monitor/reference/publication-leak.md)).

## What it reads

Repository settings; every ref under `refs/heads`, `refs/tags` and `refs/pull` (each pull request's head ref is
probed when the listing does not return it, so a deleted branch's pull ref is never missed); every commit reachable
from those refs, with distinct author and committer address COUNTS; every file version in every commit's tree;
pull requests, issues, reviews, review comments, issue comments and commit comments; uploads those texts
reference; commit statuses and check runs on every commit; Actions workflows, runs, jobs (each with a log) and
artifacts; releases and their assets; labels, milestones, deployments and environments; discussions; Pages; the
wiki; and the events feed.

It deliberately leaves out what stays private after the switch: secret values, Actions variables, Dependabot,
code-scanning and secret-scanning alerts, webhooks, deploy keys, collaborators, traffic and draft releases.

## Reading an inventory line

Each surface lands in one state, and a zero is printed only when it was measured:

- `counted` — an exact count of everything the API can enumerate. A `limit:` line under it names what the API
  itself cannot reach: an object no ref reaches, an upload no text references, events past GitHub's 300.
- `partial` — `>=N`, a lower bound. A `gap:` line names why: a page ceiling, a truncated tree, a failed page.
- `read-failed` — nothing was counted, and the `gap:` line says why.
- `not-enabled` — off in the repository document's own flags. Never inferred from a 404, which GitHub also
  answers for a surface it hides.
- `not-readable-by-api` — on, but out of the API's reach: the wiki is a separate git repository.

## The sweep

The sweep runs the inventory over a seam that hands every page it reads to one table of text fields
(`src/live/github/exposureTexts.ts`): titles, bodies, comments, review hunks and paths, commit messages and both
identities, ref names, every path in every tree, check-run output, status descriptions, workflow, run, job and step
names, release text, deployment payloads, discussion threads, and the commits and bodies the events feed embeds.
Logins and avatar URLs are left out: they say who acted, not what was written.

Two stages then read past the inventory (`src/live/github/exposureContents.ts`, `exposureLogs.ts`):

- **File contents** — each listed commit's diff, scanned on the lines it ADDED, each at its line in the new file.
  Every line of every file version was added by some commit, so this reads all of them with one listing per commit
  rather than one read per blob. GitHub lists at most 3,000 files of a commit and omits the patch of a binary or an
  over-large diff, so three kinds of blob are then read whole: one a commit listed without a patch, every blob of a
  commit whose list failed or was cut off (its tree is re-read), and every blob of the tree walk no patch produced.
  Fifty go to a GraphQL query, and REST takes one GitHub cuts off or calls binary. A binary is scanned on its
  printable runs.
- **Job logs** — each listed job's log, streamed through the `github run-log` seam and scanned in batches of 2,000
  lines, each finding at the log's own line. A log GitHub no longer serves is a `limit:` (it will not be public
  either); any other failure is a counted `gap:`.

One home directory is a finding: the account running the sweep, exactly. Every other `/Users/<name>` or
`/home/<name>` in a log or a diff measured as a placeholder or a hosted runner's (`src/live/github/exposureScan.ts`),
and a person's name in one is still caught by the identifier rules and the denylist.

Each text gets the hygiene scan's leak classes and the private denylist, the forbidden-identifier rules (this
repository's own address forgiven), and a mailbox-address rule that skips GitHub's no-reply relays, `git@github.com`
and the reserved example domains. Per surface it reports `swept`, `partial`, `read-failed`, `not-enabled`,
`not-readable-by-api`, or `not-swept`. `not-swept` means the surface holds content the sweep counts but does not
fetch: artifact archives (their names are swept) and uploaded assets. A gap is always a count, never the commit,
path or job it sits at.

Uploads are listed, never fetched or analysed. Every text the scan takes, a commit message and a job log included,
feeds an index of each upload URL it links (query and fragment removed, so a signed image token is never kept) and
every surface, locator and field that links it. The bytes are left for a visible session to look at. Whether
`attachments` is `not-swept` is decided by that index, since the inventory's own count reads bodies only.

Every finding goes to `$SLOPWEAVER_HOME/evidence/github-exposure/<instant>-<repository digest>-<nonce>/`.
`findings.jsonl` has one line per finding: surface, locator, field, line, rule and the matched text.
`uploads.jsonl` has one line per upload: its URL and every place linking it. `summary.json` holds the coverage and
the counts. Directories are `0700` and files `0600`. An unreadable denylist refuses the sweep before anything is
read.

## Exit codes

The inventory exits `0` when every surface is counted, off or out of the API's reach. The sweep exits `0` only
when every surface was swept or is off AND nothing was found. Both exit `1` otherwise, and when the repository
document itself could not be read. Both exit `2` on a usage error.

## What it never prints

Counts only: findings per surface and per rule, uploads and the places linking them, and the report directory's
name relative to the state home. No
identity, body, comment, ref name, upload URL, locator or matched text reaches stdout or the JSON form, so either
report is safe to read in a seat's transcript. What to do about a finding is the owner's call, not this verb's.
