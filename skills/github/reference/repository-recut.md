# Re-cutting a repository's history

A re-cut moves a repository's old history to an archive and starts it again from one fresh root commit.
Two verbs prepare for that switch:

- `github push-root` records the root and guards every push.
- `github repoint-plan` lists every local place that names the repository.

Neither verb creates, renames or pushes to a repository. The switch is a separate step, and it runs only on
the owner's yes. Its writes are `github repo` writes, each previewed and sent on `--approve <digest>`.

## Pushing the root

```bash
github repo --repo <owner/name> --push-fresh-cut <record-id>   # preview, then again with --approve <digest>
```

This is the only path for the root, and it runs after `--create` and Actions off, before `--apply-manifest`.
It pushes the cut record's root to `refs/heads/main` from the cut's own repository, and pushes nothing else.
It refuses unless:

- `github push-root` binds the repository to exactly that root;
- the root is a parentless commit over the tree the cut recorded;
- the repository reads private and not archived;
- the repository holds no ref at all.

Success is a read-back of the remote's refs: `main` at the root, and no other ref. It does not ask whether
`fresh-cut verify` refused, because the repository is private. `--set-public` asks: a repository `push-root`
binds goes public only when the latest `fresh-cut verify` of its cut reads clear.

## Recording the root

```bash
github push-root record --repo <owner/name> --root <sha> --cwd <fresh clone> --dry-run   # then without it
github push-root list
```

The root must be a parentless commit in the checkout at `--cwd`. A binding is written to `push-roots.json` in
the state home, which is per install and never committed. Recording the same binding again changes nothing. A
different root for a repository that is already bound is refused. Record it before the fresh history is
pushed: from then on, every push to that repository is judged.

## What the guard refuses

The guard reads the root SET, not ancestry. It refuses a pushed commit when its parentless ancestors are
anything other than exactly the recorded root. So it refuses an old-history commit, and also a merge that
joins the old history into the fresh one, which a plain ancestry check would let through.

- **It covers every push path.** The guard runs in `pushAndVerify`, which `github push`, every stack verb and
  a worktree salvage share. It also runs in `stack submit`'s preflight, before the dry-run stop, and in the
  `old-history-push` pre-push hook (`src/admit/pushRootGuardCli.ts`), which a push made outside the verbs
  meets. A hook can be skipped, so it is a tripwire, not a boundary. The root itself goes up through
  `--push-fresh-cut`, which meets the same criterion by construction.
- **It matches on push URLs.** A target is matched by every push URL of the remote
  (`git remote get-url --push --all`), case-insensitively.
- **Some pushes always pass.** A branch deletion passes. With no binding recorded, git is not read at all.
- **An unreadable register refuses every push**, because reading it as empty would let through exactly the
  pushes it exists to stop.
- **A shallow clone is refused.** Its boundary commits read as parentless, so the refusal tells you to run
  `git fetch --unshallow`.
- **The hatch is `SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH=1`**, row `old-history-push`. Use it only for a push the
  owner means to send into a bound repository.

## Planning the repoint

```bash
github repoint-plan --repo <owner/name> --archive-name <name> --new-checkout <fresh clone> [--json]
```

This is a dry run only, and it writes nothing. Each place in the plan has one of three roles:

- **archive**: the old checkout's remote config moves to `<owner>/<archive-name>`. Every worktree of the old
  checkout is listed as following the archive. A worktree is never moved to the fresh repository.
- **fresh**: these move to `--new-checkout`:
  - the profile's main checkout;
  - the desktop app's checkout;
  - a Codex marketplace source that sits inside the old checkout;
  - launch-agent path strings.
- **historical-link**: state-home links to pull requests, issues and commits are rewritten to the archive's
  name, because the fresh repository's numbers restart at 1 and would collide. A file that is not text is
  searched as bytes. If it names no link, it is counted in one observation. If it names a link, it is residue.

Some places are only noted, not changed: the plugin directory a running process holds, and cmux spawn paths,
which follow the profile.

**Exit codes:**

- `0`: the plan is complete.
- `3`: the plan is incomplete. There is no valid `--new-checkout`, no root is recorded, or something could not
  be read. Each unresolved item is named.
- `1`: the push-root register is untrusted.
- `2`: a usage error, including an archive name that is the repository's own.

Under `--json`, each action carries the sha-256 of the bytes it expects to find.

## What is not built

The apply half is not built. It belongs to the switch row, which runs on the owner's yes and refuses a plan
whose `complete` is false.
