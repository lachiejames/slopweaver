# Gathering proof: what each method can see, and how a proof lies

Bundled reference for the `github` skill, linked from [proof-evidence.md](proof-evidence.md). The grades and
what each one needs are in [pull-requests.md](pull-requests.md); this page is how to take the evidence without
it describing something other than the branch being merged.

## A worktree's `bin/slopweaver` may be running `main`

`bin/slopweaver` resolves its code from `PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT` first
(`hooks/lib/resolve-root.sh`), and the host exports those into every session. Only a `dev` verb prefers the
checkout its own launcher lives in. So `./bin/slopweaver <verb>` run from your worktree to demonstrate a
change can execute the plugin mirror — `main` — and print the OLD behaviour with no warning. MEASURED proving a
new refusal: it did not fire until `SLOPWEAVER_CLI_DIR` named the worktree.

A proof that silently exercised `main` reads exactly like one that passed, which is the one failure a gold
grade exists to exclude. Every CLI run meant to exercise branch code sets
`SLOPWEAVER_CLI_DIR="$(git rev-parse --show-toplevel)"`. Run once WITHOUT it to take the before half of a
before/after pair: that run is the mirror, and the mirror is `main`. When the tree that would run is another
worktree of the same repo, the launcher warns and prints this exact form
(`SLOPWEAVER_CLI_DIR=<worktree> <worktree>/bin/slopweaver <your args>`); re-running the bare launcher path
does not clear it.

## A live run and a review pass find DISJOINT bugs — do both

Neither is a stronger version of the other. Review reasons about reachable paths over a diff; it cannot supply
realistic input or feel latency. A run supplies both and never enumerates the adversarial input review does.

- **MEASURED, run over review.** After 12 adversarial Codex passes, 3,817 green unit tests and a clean
  validate on the handover run-lifecycle change, one live `claude --plugin-dir <worktree>` session found two
  more at once: a doc declaring two probes of the same kind was refused by its own board, because every
  fixture carried one of each; and a `Stop` hook spent 2,509 ms of its 10 s deadline starting the CLI with
  nothing to report, cut to 505 ms by a shell fast-path. Inert by default only helps if it is also free.
- **MEASURED, review over run** (acme-admin `session start`). Running it found two bugs; four review
  passes then found four more running had not — a blank reason the type claimed was unrepresentable, a
  future-dated mark suppressing a real report, a date regex accepting `2001-02-30`. Zero overlap either way.
- **MEASURED, the producer over its contract.** A parser written to the reviewer-picker's
  DECLARED output refused one of the four payloads the picker actually emits — and it was the common path.
  A declared shape names the fields, never the field COMBINATIONS the code emits. Running the producer
  offline on its own stub flags took about ten minutes.

For anything that runs inside the harness — a hook, a plugin skill, a verb the agent invokes — the live
`--plugin-dir` session ([the dogfood skill](../../dogfood/SKILL.md)) is its own class of evidence: set up real
state, not a fixture, and pre-warm `scripts/plugin-install-deps.sh` so a first install does not confound a
timing. Expect review findings to get more exotic rather than to stop: "the passes went quiet" is not a
completion signal.

## A test written beside a hole asserts the hole

A test authored in the same breath as the code inherits its blind spot. Measured three times across the runs
above: a unit test codified the bug as correct behaviour, passed, and was caught by review or a real run
rather than by the suite. Neuter the fix and confirm the test goes red; when the input is in doubt, feed the
real producer's output rather than adding cases built from your own assumption. A ported rule is the same
failure from the other side ([relaxed constraints](../../../docs/constraints/relaxed.md)).

## A bulk rewrite corrupts prose that no gate reads

A regex call-site migration edits comments, docstrings and string literals too, and the result compiles,
passes every test and states something false. MEASURED on a migration of 254 logger call sites: a JSDoc
example rewritten into nonsense, a neighbouring comment whose premise the migration had just made untrue, and
a comment claiming a fake asserted an exact query when it took no arguments.

After any bulk rewrite, read the added comment lines in `git diff -U0` for the rewritten token, then every
added claim word — `asserts`, `measured`, `verified`, `the test` — and **open what each claim names**. Point
one review pass at exactly that property.

## Proof that needs a real send goes to a self-addressed venue — never a question

A proof needing a REAL outbound send under the owner's name posts to the bot's own DM, captures the receipt, deletes
it, and says in the pull request what was created and removed. That traffic is pre-approved
([testing.md](../../../.claude/rules/testing.md#recording-a-cassette-is-pre-approved--never-stop-to-ask));
stopping to ask is the defect. MEASURED: a pull request was graded silver and a question queued for the owner on
which surface a render proof could use, while the DM's id sat in two records on disk.

Before grading below gold for want of somewhere to send, resolve a self-addressed venue — the bot DM the record lane
already posts to ([integration-coverage](../../../docs/integration-coverage.md#re-recording-a-cassette)),
the owner's mailbox, a throwaway issue. Check a `D` id against a second record before posting: a wrong one messages a
real person.

## A screen recording runs where the owner cannot see it

Recorded before/after proofs are wanted more often, and invisibly. One session once showed the owner a region
picker with the screen dimmed and another raised two Terminal windows over the chat the owner was reading; terminals
stay in the background. Record a terminal scene with `slopweaver proof cassette`: VHS drives a terminal of its own
with no window on the owner's screen, and the verb writes the transcript beside the `.mp4` and files its capture
receipt. A still of terminal output is `browser terminal-shot`; a console page's click-through is `browser
console-shot --walk <name>`, headless over a throwaway fixture store. **Only a console-shot can be attached** until a
figure check exists; a cassette or a terminal-shot is local proof
([attachments.md](attachments.md#only-a-file-a-capture-verb-wrote-is-sent)). Never an interactive
`screencapture -i`, never `activate` an app or open a Terminal window; a `screencapture` recording has no receipt,
so attach refuses it anyway. The capture lands under `$SLOPWEAVER_HOME/proof/<slug>/`, never the checkout
([pull-requests.md](pull-requests.md)). Where a recording cannot be invisible, ship a text transcript and say
why rather than interrupt the owner.

Before attaching a console-shot, read it back and record what it shows with `slopweaver browser image-record` (for a
cassette, read its transcript); `--proves "<one line>"` then names what it proves
([attachments.md](attachments.md#only-a-file-a-capture-verb-wrote-is-sent)).
