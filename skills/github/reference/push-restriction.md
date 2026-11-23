# Push restriction — who may land on a branch

`slopweaver github push-restriction` reads and writes one classic protection rule's push restriction: who may
push to, merge into and ENQUEUE onto the branch. With no `--allow`/`--unrestrict` it reads. `--allow <logins>`
sets the EXACT allowance list, `--unrestrict` lifts it, and `--dry-run` prints the change. The write goes
through the door. A separate read-back is its witness.

```bash
slopweaver github push-restriction --repo lachiejames/slopweaver --branch main --json
slopweaver github push-restriction --repo lachiejames/slopweaver --branch main --allow "$OWNER_LOGIN" --dry-run
```

`$OWNER_LOGIN` is the owner's own GitHub login, which no doc here writes: the read on the first line prints it as
the rule's `user:` entry. Set it from that line before running the write.

## Why `main` is protected this way and not by a required review

Nobody but the owner lands on `main`, ahead of a colleague's own install raising a pull request against this
repository.

- A `CODEOWNERS` file (`*` owned by the owner's own login) with classic protection requiring one code-owner approval
  and `enforce_admins: false` made every landing a `github merge --admin`: the owner authors nearly every pull
  request, and GitHub never lets an author approve their own
  ([rule-1 rationale](../../../docs/doctrine-rationale/rule-1.md)).
- Landing then moved onto GitHub's native merge queue (`github enqueue`), and the review requirement was dropped.

**Why the review requirement went, and why that still holds.** An administrator's bypass is honoured only by a
DIRECT merge. `enqueuePullRequest` refuses an unmet review ("At least 1 approving review is required"), under
classic protection and under a ruleset alike, with `bypass_mode` either `always` or `pull_request`. So a
required review means none of the owner's pull requests can enter the queue. GitHub's docs are silent on this. Two
independent community tests agree, and the `cli/cli` tracker carries the same report:

- [codenote's verification](https://codenote.net/en/posts/github-codeowners-bypass-merge-queue-verification/)
- [a GitHub community discussion](https://github.com/orgs/community/discussions/208718)

**Why a push restriction works.** A user missing from the allowance list cannot push. They also cannot merge
or enqueue: "Base branch restricts merging to restricted users"
([community discussion](https://github.com/orgs/community/discussions/62541)). The fleet enqueues with the owner's token,
so the owner's own pull requests and the bumps `github bump-drive` presses keep landing through the queue. A
colleague's pull request lands only when the owner enqueues it, and that enqueue is the owner's approval.

**Rejected alternatives.**

- A ruleset `update` rule: the merge-queue bot cannot be one of its bypass actors
  ([community discussion](https://github.com/orgs/community/discussions/168123)), so it is unproven.
- A pull-request rule with zero approvals: it blocks a direct push, but any writer can still enqueue.

## What it does not cover

- `isAdminEnforced: false` still lets every repository ADMIN past the restriction, org owners included. That
  is the bypass the owner's own fleet relies on, and it is not a gap this verb can close.
- The write goes over GraphQL `updateBranchProtectionRule`, never REST's `PUT …/protection`. The PUT replaces
  the whole rule, and its payload cannot carry the merge-queue requirement.
- **Rollback**: `--unrestrict`.
