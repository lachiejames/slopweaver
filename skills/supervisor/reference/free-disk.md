# Freeing disk outside the worktrees — `machine free-disk`

The owner ruled what may go to free disk beyond what `worktree prune` reclaims. `slopweaver
machine free-disk <target>` is that ruling as a closed list: four targets, no path flag, so nothing the
ruling did not name can be reached. The routine remedy for [the disk floor](disk-floor.md) is still
`worktree prune`; this is the one-off lane.

```bash
slopweaver machine free-disk package-caches            # the plan: what each path holds, what removing it frees, the exact act
slopweaver machine free-disk package-caches --apply    # the same plan printed again, then each act
slopweaver machine free-disk docker-data [--apply]
slopweaver machine free-disk before-setup-copy [--apply]
slopweaver machine free-disk app --bundle "<Name>" [--apply]
```

**Which apps may go is the owner's ruling, kept in the state home**, never in this tree: `app` resolves
`--bundle` against `$SLOPWEAVER_HOME/machine/free-disk-bundles.json`, strict
`{ "removable": ["<Name>.app", …], "kept": ["<Name>.app", …] }`. An absent file rules nothing removable, so
every bundle is refused as not approved; a malformed one is `BUNDLE_RULING_INVALID`, never read as empty.

## The targets

| Target              | What it does                                                                                         | What it never touches                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `package-caches`    | removes `~/Library/Caches/{pypoetry,pnpm,pip,pipenv}`; each tool refills its own on its next install | npm's `~/.npm`, Yarn's cache, and every child of Slopweaver's own cache — reported, each with its reason |
| `docker-data`       | TRIMs the Docker VM's `/var/lib`, so `Docker.raw` hands its unused blocks back                       | any image, volume or container: no prune, no restart, no pull                                            |
| `before-setup-copy` | removes the `.before-setup` sibling of a main checkout `profile.json` declares                       | a copy with a `.git` entry anywhere inside it, or one inside a git repository — refused, both checked    |
| `app --bundle`      | moves a ruled-removable app from `/Applications` to `~/.Trash` on the same volume                    | an app the ruling keeps, every app it does not name, any path                                            |

**Nothing under Slopweaver's own cache is freed, and that was measured, not assumed.** `lap-trees.noindex` is
registered git worktrees `worktree prune` owns; every file in `exec-store` is hardlinked into a checkout's
`node_modules`, so removing it frees nothing (`find ~/Library/Caches/slopweaver/exec-store -type f -links 1`
found none); `codex-plugin` is the export Codex's marketplace entry points at.

## The order, which is the safety argument

1. Every run reads the target and prints its plan. Without `--apply` it stops there and changes nothing.
2. `--apply` prints that same plan from a fresh read — a dry run from earlier is evidence, never authority.
3. Each path comes from a fixed root, never a flag. The cache, Docker and Trash paths derive from the account's
   own home in the user database, never `$HOME`, so an exported `HOME` cannot aim them elsewhere. The pre-setup
   copy is the sibling of the main checkout the working directory resolves to, acted on only when that checkout
   is one the state home's `profile.json` declares. An app is `/Applications/<Name>.app`, named by the ruling.
4. Immediately before each act it reads the target again through the same pure planner and acts only when the
   item's path still has the device and inode the plan captured. The first item that changed or failed stops
   the run, and what already happened is reported. Four directories cannot be removed atomically, and the verb
   does not claim to.
5. A recheck and an act are still two calls, so each act renames first and checks the device and inode of the
   object it actually moved: a removal renames into a fresh sibling directory, a Trash move into the Trash. A
   different object is renamed back and refused as `PLAN_CHANGED`; a rename back that itself fails is
   `APPLY_FAILED`, naming where the object now sits.

## The Docker command

```text
docker run --rm --pull never --privileged --pid=host postgres:17 nsenter -t 1 -m -- fstrim [-n] -v /var/lib
```

A throwaway container from an image already on the machine enters the VM's mount namespace and trims its data
mount. `-n` is the dry run, and the dry run must print `fstrim`'s own `(dry run)` line or the plan is refused.
Never `fstrim -a`: inside the VM it also lists the host's virtiofs shares. The plan's figure is an upper bound —
`Docker.raw`'s allocation less what the VM's `df -k /var/lib` says it uses — and the outcome is the measured
drop in the file's own allocated blocks.

## What it reports

Three measures, kept apart: what a path **holds** (`st_blocks × 512`), what its act **frees**, and the state
home volume's `df` before and after, which other writers move too and is never attributed to one item. Each
outcome names how its freed figure was arrived at (`freedBasis`), because only one of them is measured:

- a removal is **counted at the recheck**, its single-link files just before the act, so a file that gained a
  hard link since the plan counts as freeing nothing;
- a trim is **measured after** the act, the drop in `Docker.raw`'s own allocated blocks;
- a Trash move frees nothing yet: its bytes are **moved**, and land only once the Trash is emptied.

`--json` prints one document with all three, and an apply that stops partway still prints it, with the acts
already done and the stop's code and message in `stopped`. An act is recorded before anything after it can
stop the run: a trim that printed a line `fstrim` does not print, and an act whose read after it failed, whose
after-figure is then `null` (`unread` in the text) rather than 0, with a trim's `freedBasis` reading
`after-read-failed`.

## Refusals

| Code                          | Why                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| `UNSUPPORTED_TARGET`          | not one of the four targets                                            |
| `PROTECTED_TARGET`            | `npm`, `yarn` or `slopweaver-cache`, named so the refusal says why     |
| `BUNDLE_NAME_INVALID`         | `--bundle` was a path, empty, or carried a control character           |
| `BUNDLE_PROTECTED`            | an app the owner's ruling keeps                                        |
| `BUNDLE_RULING_INVALID`       | the state home's bundle ruling is there but malformed                  |
| `BUNDLE_NOT_APPROVED`         | an app the owner has not ruled removable                               |
| `SYMLINK_REFUSED`             | a target is a link                                                     |
| `WRONG_KIND`                  | a target is not the directory or file the registry names               |
| `PATH_OUTSIDE_EXPECTED_ROOT`  | a target resolves somewhere other than itself                          |
| `MAIN_CHECKOUT_UNPROVEN`      | the main checkout could not be resolved, so the copy cannot be derived |
| `MAIN_CHECKOUT_UNDECLARED`    | the run stands in a checkout `profile.json` does not declare           |
| `GIT_REPOSITORY_REFUSED`      | the pre-setup copy is, holds or sits inside a git repository           |
| `APP_RUNNING`                 | a process is running from inside the bundle                            |
| `TRASH_COLLISION`             | the Trash already holds that name; the verb never overwrites it        |
| `TRASH_VOLUME_MISMATCH`       | the bundle and the Trash are on different volumes                      |
| `DOCKER_COMMAND_FAILED`       | Docker's in-VM command failed or printed something unrecognised        |
| `DOCKER_ARGV_REFUSED`         | a `docker` argv that is not one of the three fixed commands            |
| `HARDLINKED_FILE`             | `Docker.raw` has another hard link, so no saving can be counted on it  |
| `PLAN_CHANGED`                | an item changed between the plan and its act; nothing further touched  |
| `READ_FAILED`, `APPLY_FAILED` | a read or the act itself failed                                        |

None has an escape hatch: the registry is the ruling, and a new target is a new ruling and a code change. A
newly ruled app is one line in the state home's ruling file, never a code change.
