# A chained pull request that is not a native GitHub stack

Every stack of the owner's is an actual GitHub native stack. The failure this closes: GitHub's own **Preview stack**
dialog offering a chain of pull requests nothing had ever registered. GitHub could see the chain; GitHub's stacks API
had never been told about it. This file is how that state is impossible to create and impossible to keep.
Everything else about the stack verbs is in [stacks.md](stacks.md).

**The class, exactly.** An open pull request whose base branch is another OPEN pull request's head branch in
the same repository, where the two do not sit in the same native GitHub stack. Four shapes, and the repair
differs per shape, so every refusal names which one it is: `neither-stacked`, `child-unstacked` (the parent
is in a stack and the child never joined it — the refusal names that stack), `parent-unstacked`, and
`different-stacks`.

**Three doors refuse it, and a fourth check stops it standing.**

- **`stack push`** registers the membership as part of opening a pull request, and a create that succeeded
  while its registration FAILED exits non-zero and prints the repair,
  because that outcome is the class. A base that is not the default and that nobody has opened a pull request
  for is reported separately (`no-parent`) and is not a failure — it is not a chain.
- **`pr retarget`** refuses a `--base` that is another open pull request's head branch unless `--adopt` is
  passed, which retargets AND registers in the same invocation — the only order under which the chained,
  unregistered state never exists. A `--dry-run` runs the same gate.
- **`github push`** refuses a push to a branch whose own open pull request is chained without a stack. That
  is the door for a pull request opened before these gates existed, opened in the web UI, or opened by a
  session that routed around the verbs — creation cannot be the only place this is caught. Cost is one
  `findOpenPrByHead`, plus a second one only when the base is not the repository default.
- **CI** runs `github stack audit --repo "$GITHUB_REPOSITORY" --check` in the `dev-gate` job, so a violation
  anywhere in this repository reddens the pull request being built. A door can be routed around; a red
  required check cannot. A walk the page cap cut short fails `--check` too, printing `INCOMPLETE`: the
  pull requests past the cap were never audited, so the run cannot be clean.

```bash
github stack audit --repo acme/acme-admin            # every chained-not-native pair, whoever authored it
github stack audit --repo acme/acme-admin --mine     # only pairs involving a pull request you authored
github stack audit --repo lachiejames/slopweaver --check  # exit non-zero on any violation or a truncated walk — what CI runs
```

`audit` READS and never repairs, deliberately: MEASURED, it found dozens of violations across hundreds of
open pull requests on one repository and only a couple involved this account. Adopting somebody else's chain
rewrites their branches, which is not this installation's call — report those, adopt your own. It is one paged
`pulls.list` walk, because that payload carries each pull request's `stack` object inline (matching `getPr`
byte for byte wherever it is populated), so it costs one call per page of 100 rather than one per pull request.

## `stack adopt` counts what a rebase WOULD leave, not what GitHub reports today

MEASURED adopting one pull request into a stack: GitHub reported two commits, `adopt` refused
on its exactly-one-commit rule, and a human had to rebase by hand first — the verb refused precisely the pull
request it exists to repair. The second commit was a 67-line stale COPY of a consent test the
base had since landed at 78 lines; the rebase dropped it and left one commit. A neighbouring pull request had the
same shape, and it is also why both read `CONFLICTING`: one cause, two symptoms.

The ordering is the trap — a count taken before the rebase that would make it right. So `adopt` measures
what a rebase WOULD leave, with
`git rev-list --cherry-pick --right-only <fresh base tip>...<head sha>`, and proceeds when exactly one commit
survives AND that commit is the head. Both halves are required: a branch shaped `[real work, stale
duplicate]` also survives one commit, and replaying its tip would push the duplicate and silently drop the
work. It does NOT rebase first to find out, because the only rebase primitive this repository trusts is the
single-commit replay, which cannot run until the count says one (`stackSquash.ts`'s module doc carries the
two rounds of adversarial testing behind that).

## A drifted chained pull request: `stack adopt --register-only`

MEASURED on acme/acme-admin, where `stack audit --mine` named exactly two violations this
account authored and **both doors refused both of them**, so no local rewrite could repair either:

- `github push` on `pr-description-zod-verb` — _"refused: pushing pr-description-zod-verb, whose open pull
  request #<n> is based on agent-cli-package-foundations would leave a chained pull request that GitHub
  does not know is a stack"_.
- `github stack adopt --pr <n> --dry-run` — _"refused: PR #<n> has 8 commits — rebased onto its base's
  fresh tip it would still be 5"_.

Squashing locally does not break the loop: adopt also requires the local HEAD to equal GitHub's reported head
SHA, so reaching one commit locally fails that check instead, while the only way to make the REMOTE one
commit is the push the first door refuses.

**The seam is that registration is not replay.** `createStack`/`addToStack` select pull-request NUMBERS; they
read no local Git and move no ref. Every precondition that deadlocks a drifted branch — the commit count, the
checked-out branch, the HEAD match, the clean worktree — belongs to `stackSquash.ts`'s single-commit replay,
not to registration. So `--register-only` performs the first operation without the second, and the push door
then clears **by construction**: once both carry the same stack number, `chainKindFor` returns `undefined`.
No gate was weakened to get there.

```bash
github stack adopt --pr <n> --register-only --dry-run   # what it would register, and nothing else
github stack adopt --pr <n> --register-only
```

**What it claims, and what it does not.** It claims one thing, confirmed by a read-back of both pull requests
and the stack against a PINNED stack number: the membership. It says the rest in its own success report —
the branch is not rebased, `stack sync` cannot replay a multi-commit entry, and pushing the PARENT may
refuse on carry with entries above it (`--orphan-above` is the existing route). `stack audit --check` is
a falsifiable MEMBERSHIP check; reading its green as proof the tree is healthy is the defect.

**A chain is registered from the BOTTOM UP, and the verb enforces it.** A Codex review reproduced
the reason against this module's own core: in a three-deep unregistered chain `A ← B ← C`, registering
the UPPER pair forms a fresh stack holding `B` while `A` stays in none — so the `B ← A` relation moves
from `neither-stacked`, which one `--register-only` repairs, to `parent-unstacked`, which only a dissolve
does. A successful run would have left the tree harder to fix than it found it. So a `create` whose parent is
itself an unstacked chain child is refused, naming the lower pair to register first. An `add` onto a parent
that already carries a stack cannot have that shape and costs one read fewer — that stack membership is the
ONLY thing that skips the lookup. "The parent targets the default branch, so nothing is below it" was tried
and removed: `chainParentFor` pairs by head branch and does not exclude the default, so an open pull
request whose HEAD is `main` makes a parent based on `main` a chain child after all. For the same reason the
parent LOOKUP is unconditional too, and the two no-registration outcomes are decided by its empty answer
rather than by a branch's name (the shortcut made the bottom-up repair a silent no-op). Where the walk
would terminate on a pull request whose head IS the default branch — which stack automation never enrols —
the refusal says so instead of prescribing a repair the verb would itself refuse.

Four refusals survive and are not waivable by this flag, because none of them is about replay: a parent that
is not the open pull request whose head is this base; the bottom-up rule above; `parent-unstacked` and
`different-stacks` (GitHub's add endpoint cannot insert BELOW an existing entry, so those need a dissolve —
the refusal carries the audit's own repair lines); and the foreign-author gate. Native registration runs
BEFORE the local enrolment, so the only partial outcome possible is the recoverable one, and a re-run
performs no second native write.
