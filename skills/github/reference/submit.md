# `stack submit` — push the whole restacked forest, or none of it

`github stack restack` prepares every open pull request of yours locally and pushes nothing.
`github stack submit` is the other half: it sends what that prepared, in tree order, and it decides
everything before it opens a transport.

```bash
github stack submit --dry-run
github stack submit
github stack submit --force     # only after reading what moved
```

## All or nothing, and what that can honestly mean

Submit fails if some stack is in a bad state: it refuses until the local issue is reconciled, and it does not
leave a stack behind. It fails all or nothing.

GitHub offers no transaction across branches — a push moves one ref at a time — so the guarantee this makes
is **all-or-nothing ADMISSION**: not one branch is sent until every branch in the whole forest has passed
every check. That is the property the guarantee actually needs. One acme-admin pull request was orphaned by a CONFLICT
found mid-carry, after two branches were already public; a conflict is found at restack time, before this
verb runs at all, and a forest carrying one is refused whole.

A transport that fails at branch N still leaves 1..N-1 on the remote. This says so rather than claiming a
rollback it cannot perform: it prints the pushed prefix, the failure, and the untouched suffix, and leaves
your local state UNCHANGED — so the next ordinary submit reads that prefix as a moved remote and refuses. That
refusal is the record of the partial push, and `--force` is how you say you have looked at it.

## What it checks, and what `--force` waives

Every issue is collected and named; one unwaived issue means nothing is pushed.

| Code                 | It fired because                                                                    | `--force`? |
| -------------------- | ----------------------------------------------------------------------------------- | ---------- |
| `REMOTE_MOVED`       | someone else pushed to one of your pull requests since your state recorded its head | **yes**    |
| `REMOTE_REF_MISSING` | the remote has no such branch at all                                                | no         |
| `NOT_PREPARED`       | the last restack left that pull request blocked, with the reason it carries         | no         |
| `STAGED_REF_MOVED`   | the ref the restack staged no longer holds what it prepared                         | no         |
| `INVENTORY_CHANGED`  | a pull request opened, merged or was retargeted, so your state is not the world     | no         |

`--force` waives a moved remote and nothing else: to push it anyway, rerun with `--force`. Even under `--force` the push carries an exact lease — against what the
remote holds NOW rather than what your state expected — so a branch that moves again between the check and
the transport is still refused by git itself. A bare `--force` push is never sent.

## Afterwards

A fully confirmed submit advances the snapshot in place: every pushed row's recorded head becomes what was
just sent, so an immediately repeated submit is a no-op rather than a second push. `INVENTORY_CHANGED` is
never a `--force` case — it means the local picture is simply old, and the answer is another `stack restack`.
