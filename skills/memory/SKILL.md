---
name: memory
description: Check your Claude Code auto-memory corpus for defects, lay it all out for a keep/adjust/drop review, run the standing hygiene pass that proposes prunes and never makes one, or gate every corpus on the machine against a new defect. Use when the user asks what you remember, suspects a memory is wrong or stale, wants to prune or dedupe them, or asks what the scheduled memory review found. Phrases like "what do you remember", "review your memories", "that memory is wrong", "clean up your memory", "are any memories redundant".
argument-hint: check|sweep|gate|hygiene|grade|passes|overlaps --dir <path> --repo <path> [--also-repo <path>] [--json] [--stale-after <days>] [--install] [--accept]
---

Seven verbs over the memory corpus, plus `hook`, which the write-time hook runs. `check`, `sweep`, `hygiene`
and `overlaps` take one directory you name; `gate` finds every corpus itself. **None of them ever edits or deletes a memory**, and only `gate` writes anything at all.

- **`check`** — the mechanical defects in ONE corpus: routing, schema, name format, dead links, a dated
  addendum, a root-routed memory with no `**Why always-loaded:**` paragraph, an index line naming an identifier
  its memory lacks, and a canon amendment whose row is missing or closed
  ([declaring one](reference/checks.md#declaring-a-memory-that-amends-canon)). Exits non-zero when it finds some.
  Every id, and what each cannot see: [checks](reference/checks.md).
- **`sweep`** — the whole corpus laid out for a review. It has nothing to fail; it exists to be read.
- **`gate`** — every corpus on this machine, refusing on a NEW defect only. `--install` wires it to the
  state repository's `pre-push` hook; `--accept` records what stands today as debt.
- **`hygiene`** — the standing six-check pass, scheduled weekly, that PROPOSES keep/adjust/drop and writes its
  evidence to `$SLOPWEAVER_HOME/morning/memory-hygiene-<date>.md`. Also needs `--repo`; it reads knowledge rows too.
- **`grade`** — records the owner's answer to one proposal by id. A `refused` answer is TERMINAL.
- **`passes`** — when the hygiene pass last ran, read from its ledger. It proposes nothing.
- **`overlaps`** — per leaf, what the write-time overlap nomination would ask if it were written now. Also
  needs `--repo`, whose always-on canon it reads. Exits `0` whatever it finds.

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" memory $ARGUMENTS`.

## `--dir` is required, and you must not guess it

There is no default and nothing is derived. Claude Code keys auto-memory to the **git repository**, so every
worktree of a repo shares one directory, and the `<project>` component of the path is undocumented. Deriving it
produces a path that does not exist whenever you are in a worktree — and a tool that reads the wrong directory
and reports it confidently is worse than no tool.

So: if the user has not said where their memories live, **ask**. Do not construct a plausible-looking path.

## Turning a sweep into something reviewable

`sweep` prints a human report to stderr. When the user wants to actually review their corpus — rather than
glance at it — run it with `--json` and build them an artifact from the rows:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" memory sweep --dir <path> --json --stale-after 90
```

One card per row, grouped by `routedBy`, each carrying `description`, `declaredType`, `inboundLinks`, the age,
and any `findings`. Keep the order the verb gave you — it is the review order, and re-sorting throws away the
`--stale-after` grouping the user asked for.

**Three things the artifact must not do**, because each of them turns an honest inventory into a confident
wrong answer:

1. **Never merge `declaredModifiedIso` and `fileModifiedIso` into one age.** They answer different questions.
   The first is when Claude last rewrote the memory; the second is when the bytes last changed, which a `git
checkout` or a file copy disturbs without the memory changing at all. Every row names its source in
   `ageSource` — carry that label onto the card, next to the number. A row with `ageSource: "none"` has no age;
   say so rather than showing a blank that reads as zero.
2. **Never judge a memory.** No "probably stale", no "looks superseded", no scoring. The verb is deterministic
   because a marker-matching heuristic for this was tried against a real corpus and produced false positives.
   The judgement is the user's; your job is to make it fast to make.
3. **Never edit or delete a memory as part of a sweep.** Report; let the user decide, then act on what they say.

## `gate` refuses on a NEW defect, never on a dirty corpus

`memory gate` walks every `~/.claude/projects/*/memory` that holds a `MEMORY.md`, and compares what it finds
against the debt list at `$SLOPWEAVER_HOME/memory-gate-baseline.txt` — machine-local, uncommitted, because it
records defects in THIS install's corpora rather than a fact about the repository.

- A finding NOT on that list is fresh: the run exits `3` and prints the refusal, whose hatch is
  `SLOPWEAVER_ALLOW_MEMORY_CORPUS=1`.
- A finding on the list is printed as `accepted` and does not block.
- A listed finding that stopped firing is dropped on the next run — by a build that runs its check, so neither
  a run nor `--accept` from an older checkout erases a newer check's entries. **The list only ever shrinks.**

`--accept` is the only way onto it, and it is never automatic — the write-time gate refuses and explains
rather than repairing, and a report that accepted its own findings would be that same auto-fix in disguise.

**Never edit the baseline by hand.** Re-run `--accept`, or fix the finding.

`--install` writes the `pre-push` hook into `$SLOPWEAVER_HOME`. That hook **gates nothing about what is being
pushed** — the corpus is not in that repository and the directory it lives in is not a git repository at all.
It rides the repo the fleet pushes often so a standing defect cannot sit unseen between reviews. The installer
resolves a launcher and PROVES it answers `memory gate --help` before baking the absolute path in, preferring
the plugin mirror, then a declared main checkout, and the running tree last.

## The write-time gate

A `PreToolUse` hook on `Write` and `Edit` refuses a payload that would put a malformed `name` or an
unresolvable `[[wikilink]]` into an auto-memory leaf, and says which. It only ever refuses; it never repairs.
A dated addendum (`Settled 29 Sep 2001:`) is reported after the write instead, never refused ([why](reference/checks.md)).
It judges the file the write would LEAVE BEHIND rather than the payload alone, and subtracts whatever the file
already carried, so a rename is caught and a rewrite of an already-broken memory is not.
A forward reference — a link to a well-formed name no memory carries yet — is ALLOWED, because Claude Code's
own standing memory instruction tells you to link liberally. Hatch: `SLOPWEAVER_ALLOW_MEMORY_WRITE=1`.

**It answers by CORPUS, not by path spelling.** The `~/.claude/projects/<project>/memory/` envelope is decided
lexically and costs nothing, and one live corpus on this machine is a symlink into another repository, so every
leaf in it has a second, equally real path. A `.md` written into any other directory named `memory` therefore
gets one question asked of the filesystem — is there a `MEMORY.md` beside it — which is the same mark
`discoverMemoryCorpora` uses. An ordinary source write fails two free tests first and reaches no `stat`.

**It NOMINATES every overlap and makes you answer each one; it never decides.** A leaf whose subject (name
and description) shares rare tokens with another memory in the same corpus, or with a section of the
always-on canon of the repository the writing session stands in, is refused until its frontmatter answers:

```yaml
metadata:
  slopweaver:
    overlaps:
      older-memory-name: supersedes # this replaces it: delete it too
      "AGENTS.md § Code standards": compatible # both stand
```

A memory never supersedes canon: if it contradicts a canon section, change the canon instead. An overlap the
file already carried unanswered is not asked about again. `memory check` reports `superseded-still-present`
while a superseded memory's file is still there. Thresholds and why: [overlaps](reference/overlaps.md).

## Reading the counts

- `inboundLinks` — how many OTHER memories wikilink to this one, counted once per linking memory. A hub that
  everything depends on and a fact nothing references carry different risk, and neither is a defect. It is
  worth saying out loud when you present it that this number rewards age: links accumulate, so an old memory
  can rank high simply for having been around. Do not sort the review by it.
- `findings` — the `memory check` findings for that same file, inlined so a memory that is both orphaned and
  old reads as one row. Both verbs read the same directory through the same reader, so they cannot disagree.

## The hygiene pass — it proposes, and it never deletes

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" memory hygiene --dir <memory-dir> --repo <checkout> [--also-repo <checkout>] [--json]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" memory grade <id> accepted|refused --why '<what the owner said>'
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" memory passes [--home <dir>] [--json]
```

`passes` answers how long it has been. A PASS is one INSTANT, not one row: a single run stamps every proposal
it writes with the same timestamp, so the grouping is by that instant and the count of rows is a different
number. The codebase atlas page renders it beside the store share.

Six checks, in the severity order the card ranks them by: the **index budget** against the official loader
limit (first 200 lines or 25KB, whichever comes first), the **schema/routing/dead-link** findings `check`
already computes, **referent staleness** against the tree, the **near-duplicate** scan, and the
**enforcement** check — a memory restating a gate, schema, skill or always-on doc. An **adversarial arm** then
tries to REFUTE every drop candidate before it is proposed, so a nomination the owner should not act on arrives as a
`keep` with the refutation attached rather than as a drop.

Five things that are the contract rather than notes; the [hygiene reference](reference/hygiene.md) is the rest:

1. **`--repo` is as required as `--dir`, and for the same reason.** The staleness and enforcement checks
   resolve what a memory names against a TREE. A scheduled run fires from whatever directory it was in, so a
   derived or relative root measures the wrong checkout and reports a clean pass. `--also-repo` adds the
   second checkout: a referent EITHER tree holds resolves.
2. **It reads the knowledge rows, and an unread table is exit `1`.** Each claim's current lesson or
   preference is scanned for a gone path, flag, verb or skill; the report and ledger are still written, and
   the residue opens with why the rows were not read. [The stores](reference/hygiene.md#the-stores-it-reads).
3. **Nothing is dropped without the owner's grade.** A `drop` recommendation is a question with an id on it; the pass
   writes a ledger row and waits. `grade … refused` is terminal — that proposal is never raised again.
4. **Similarity nominates, it never concludes.** Every duplicate pair and every enforcement match is rare-token
   overlap. What the run could not settle is printed under its own heading, on every run, rather than left for
   a reader to infer.
5. **Do not re-run it to "check" a result.** It is scheduled weekly and its output is a file. Read the newest
   `$SLOPWEAVER_HOME/morning/memory-hygiene-<date>.md` instead.

## Explicit current-owner rulings

Ordinary memories are context, never control. An owner-authored standing correction affects new live turns
immediately only when it is a `feedback` memory with this explicit namespaced opt-in:

```yaml
metadata:
  type: feedback
  slopweaver:
    ownerDirective: true
```

The memory hook then records the bounded `description` as an active `owner_directive` version in the store (a
correcting memory, `owner_correction`); a changed ruling retires its old version. `turn brief` freezes the active
versions beside the mined profile, and matching rulings override conflicting mined guidance. A malformed tag, a
non-feedback memory, an over-limit directive or an unreadable store is refused by the hook, never ignored or
substituted into `judgement/profile.json`. A legacy `judgement/owner-directives.json` is imported once.

Set `ownerDirective: false` on the same named feedback memory to revoke its ruling. The explicit false is
required so an unrelated memory rewrite cannot silently delete current control-plane state; after revocation,
the memory can be deleted normally.

## Exit codes

For `gate`: `0` when nothing fresh stands (or the hatch is open), `3` on a fresh finding, `2` on a bad flag,
`1` on an I/O fault. For `check` and `sweep`: `0` with rows, `3` when there is nothing to lay out (an empty corpus, or a directory with no `MEMORY.md` —
which means it is not a memory corpus and the path is probably wrong), `2` on a bad flag, `1` on an I/O fault.
`3` is a status, not a fault: report what it said rather than treating the run as failed.

`hygiene` adds a fourth: **`4` is NOT YET.** The corpus changed within the last five seconds, so another
session may be mid-save and this run judged nothing — the scheduler leaves a `4` unstamped and the row is still
due at its next firing. It is never `3`, which would silence the row until the week after.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
