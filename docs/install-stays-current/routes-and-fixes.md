# The three routes

Part of [An install stays current, or the feedback is about code that no longer exists](../install-stays-current.md).

| Route                                  | Who                          | What it loads                                                    |
| -------------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `claude plugin install …`              | anyone using it              | a **copy** in `~/.claude/plugins/cache/<mkt>/<plugin>/<version>` |
| skills-dir symlink to a checkout       | an operator on one checkout  | that checkout's working tree, live                               |
| `claude --plugin-dir <checkout>`       | anyone developing Slopweaver | that checkout's working tree, live                               |
| `codex plugin add slopweaver@personal` | anyone using it, in Codex    | a **copy** in `~/.codex/plugins/cache/personal/slopweaver/local` |

The first row holds whether the marketplace is a hosted repository or a local clone
(`claude plugin marketplace add "$PWD"`, the install [getting started](../getting-started.md) gives): measured
in a throwaway `CLAUDE_CONFIG_DIR`, a clone's install landed as a full copy keyed by the clone's
commit, and one more commit there plus `claude plugin update` moved it to a second copy keyed by the new one.

The second and third are the same tree; the first and fourth are snapshots, and the snapshot is the problem.
The Codex copy in every Codex home that carries one is re-taken by `slopweaver codex plugin-sync` on every
fast-forward of the main checkout — no
live route exists there, because Codex refuses a symlinked cache and drops symlinks from the copy
([getting started § Codex](../getting-started.md#codex)).

## Which route a SPAWNED session takes, and the ruling that set it

The owner's ruling, choosing among four routes: the marketplace install by default, while still allowing
dogfooding. So `cmux spawn` and every fresh-session dispatch pass
`--plugin-dir` for exactly one case, **a worktree cut from a repository that carries a plugin manifest**, and
every other spawn loads the marketplace install. `src/cmux/pluginDir.ts` is where that decision lives, and
`src/cmux/spawn.ts` makes it once per PLAN rather than once per caller.

What the ruling was answering, measured across 50 live workspaces: Slopweaver was installed as a
plugin **nowhere** on this machine and every session ran from the flag, **30 of those 50 trees were ten or
more commits behind** `origin/main`, the worst 130 behind, and two loaded no skills at all. A flag pins a
session to whichever tree the hand that spawned it happened to be standing in. The install is one tree the
whole fleet shares, and it is the half this page already keeps current.

**The install is machine state, so the spawn probes it.** A session opened with no flag and no install boots
a `claude` with no skills, no commands and no hooks, which nothing downstream can describe. `cmux spawn`
refuses before it creates a worktree or a tab, and names `claude plugin install slopweaver@slopweaver-dev`.
The probe reads `~/.claude/plugins/installed_plugins.json` and answers whether the plugin is INSTALLED, never
whether the host has it enabled for the session about to open.

## What was actually wrong, measured

Both halves were measured in a throwaway `HOME` — never the owner's, which carries a
skills-dir copy that would have masked the whole thing.

**The version string was the only thing that triggered an update.** A marketplace, a plugin pinned at
`0.2.0`, install, then a new commit on the source with the pin untouched:

```
$ claude plugin marketplace update probe-mkt   → ✔ Successfully updated marketplace: probe-mkt
$ claude plugin update probe-plugin@probe-mkt  → ✔ probe-plugin is already at the latest version (0.2.0).
$ cat …/cache/probe-mkt/probe-plugin/0.2.0/skills/demo/SKILL.md
MARKER-V1                                      ← the commit BEFORE the one just published
```

The marketplace refreshed. The plugin did not, and said so in the language of success. Bumping the string to
`0.2.1` and re-running the same command updated it immediately, which is the proof that the string — not the
commit, not the content — was the trigger. Both `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` pinned `0.2.0`, so **no merge to main reached a marketplace install at
all**, and had not since that string was last touched.

**The owner's own checkout was moved only by hand.** Its reflog over one day showed five fast-forwards —
five moments a session happened to run one — and for nearly thirteen hours its upstream still named a remote the
repository had already moved off. Every session booted in that window
loaded code up to nine merges behind, and nothing anywhere said so.

## The fix, route by route

## A marketplace install: no version field at all

The `version` field is **absent** from both manifests. Claude Code then keys the install on the source
commit itself, which is the behaviour the owner picked over bumping a string on every merge (option (b) of
three; the other two were a release step on every merge, and tagged releases). Measured on the same probe:

```
$ claude plugin update probe-plugin@probe-mkt
✔ Plugin "probe-plugin" updated from 0.2.1 to <sha-1> for scope user.
$ claude plugin update probe-plugin@probe-mkt        # nothing new pushed
✔ probe-plugin is already at the latest version (<sha-1>).
$ claude plugin update probe-plugin@probe-mkt        # one more commit pushed
✔ Plugin "probe-plugin" updated from <sha-1> to <sha-2> for scope user.
```

Every commit is a version; nothing is remembered; nothing is bumped. `installed_plugins.json` records a
`gitCommitSha` either way, so the SHA is the real identity and a pinned version is a second, staler name for it.

Two consequences worth stating rather than discovering:

- **A cache directory per commit.** Three updates left four directories in the probe's cache
  (`0.2.0`, `0.2.1`, and two SHAs) and none was pruned during the run. Growth is a copy of the plugin per
  update, not per session.
- **`slopweaver doctor` finds no version in the Claude manifest**, so it falls back to `package.json` — see
  `pluginVersion` in `src/cli/commands/doctor/pluginReport.ts`. That fallback is the release version, which for a
  marketplace install is the _less_ precise of the two names available.

## …and no command to pull it

Dropping the pin makes an update _available_. What makes it _arrive_ is auto-update, and the default is
against us: per Claude Code's own documentation, `claude-plugins-official` and most other official Anthropic
marketplaces have auto-update on by default, while **third-party and local development marketplaces have it
off**. Measured: adding this repository as a marketplace in a clean `HOME` wrote no `autoUpdate` key at all.

An administrator turns it on for everybody at once, without each colleague toggling anything, by adding one
key to the existing entry in managed settings:

```json
{
  "extraKnownMarketplaces": {
    "slopweaver-dev": {
      "source": { "source": "directory", "path": "/absolute/path/to/your/clone" },
      "autoUpdate": true
    }
  }
}
```

The one-line change is `"autoUpdate": true` as a sibling of `"source"`. `claude plugin marketplace add "$PWD"`
from a clone writes exactly that `source` entry, `directory` and the clone's path, into user settings; a
hosted copy is `{ "source": "github", "repo": "<owner>/<repo>" }` instead.

With it set, Claude Code checks for marketplace **and plugin** updates after a session starts, on a random
delay of up to ten minutes, so the running session keeps what it booted with and the new version loads on
the next launch (or on `/reload-plugins`, which it offers).

**This half is documented, not measured here, and there is a known bug against exactly it.**
An issue filed against `anthropics/claude-code` reports `autoUpdate: true` on an `extraKnownMarketplaces` entry
refreshing the marketplace checkout while leaving installed plugins pinned — filed against v2.1.149 and
closed as a duplicate. This machine runs v2.1.247 and the current documentation describes the fixed
behaviour. Proving it needs a real session boot in a `HOME` that is signed in, which a throwaway `HOME` is
not, so it is **not proven here**. If a colleague's install is stale a day after a merge, that is
the bug and not the pin, and the workaround is the one command this whole page exists to avoid:
`claude plugin update slopweaver@slopweaver-dev`.

## The owner's checkout: fast-forwarded at every session start

`scripts/plugin-checkout-sync.sh` runs at session start and fast-forwards the checkout the session is about
to load. A cache install has no repository, so it exits having touched nothing; a skills-dir or
`--plugin-dir` install resolves through the symlink to the real checkout and moves it.

It refuses in every case `slopweaver checkout sync` refuses, and for the same reasons — a dirty tree, a
detached HEAD, a branch tracking nothing, a linked worktree that is somebody's branch in flight, and a
diverged branch that `--ff-only` will not apply. "Diverged" is decided the same way too: a failed merge is
re-measured, and only a branch both behind and ahead is called diverged — one still a clean fast-forward
failed on a lock, is retried, and after three attempts says so. Each refusal exits 0: a session boot may
never fail on this. All of them are held by `src/__tests__/subprocess/scripts/pluginCheckoutSync.test.ts` against real
repositories.

**Why session start, and why it cannot race a booting session.** Three placements were available — this
hook, a standing session's own tick, and a post-merge step in the door. The door only sees merges that went
through the door, and a standing tick only helps while something is standing by — and nothing does, by the
owner's ruling. Neither is true of "every session, on every machine". Session start is the only one that fires exactly when a session is about to read the tree.

The ordering is not left to the host: this is invoked from the **top of `plugin-mirror-sync.sh`**, in the
same process, rather than registered as its own `SessionStart` hook — hooks within one group are not ordered
against one another, so a sibling hook could not guarantee it ran first. Across _concurrent_ boots, a lock
in the plugin-data directory serialises the fast-forward, so no session can copy the tree while another
session's `git merge` is rewriting it. A lock older than 120s is treated as a dead holder's and broken; a
live one means another booting session is already doing the work, so exiting is correct. The fetch is
bounded at 45 seconds — offline or slow, the session boots anyway on what it has. The mirror copy that
follows takes a **second lock of its own**, for the reason the next section gives.

**And it says so when it does not update.** A no-op fetch on the real repository costs 6.1s measured
(`for i in 1 2 3; do /usr/bin/time -p git fetch --quiet --no-tags origin main; done`), which is why the bound
is 45 seconds: at 15, a run against a checkout three merges behind updated the ref and then did nothing at
all, silently — doctrine rule 6's failure mode inside a hook. A fetch that runs out of time, and a branch that
will not fast-forward while it is genuinely behind, each print one line. An already-current checkout prints
nothing, because that one really is nothing to report.

This is **not** the background sync daemon `docs/main-checkouts/cwd-safety-and-scope.md` rules out. It is one bounded
fast-forward in the foreground of a boot, on the one checkout that boot is about to load. The rich version —
pull plus install plus a drift report across every declared checkout — is `slopweaver checkout sync`, and
`doctor` reports drift on every session.

## The mirror: one syncer at a time, because a slot is shared state

`scripts/plugin-mirror-sync.sh` copies the hook-executable surface into the plugin root's own mirror,
`…/plugins/data/slopweaver/mirror/by-root/<root>/` ([one mirror per plugin root](../hooks/mirrors-and-failure-policy.md)),
and flips a `current` symlink onto it, building into whichever of two alternating slots `current` does not
already name so the flip is atomic and disk stays bounded to 2x.

**That alternation is only atomic for ONE syncer, and it takes a lock to be sure it has one.** Every
concurrent run reads the same `current`, so every one of them derives the same target slot and builds into
the same directory; `rm -rf` walks a tree, unlinks it, then `rmdir`s it, and a sibling's `rsync` recreating a
file between the walk and the `rmdir` makes that `rmdir` fail `ENOTEMPTY`. Measured when a cmux
restart resumed six seats at once and their screens carried
`rm: …/mirror/a/templates: Directory not empty`; reproduced in a run where 11 of 18 concurrent runs
exited non-zero **and** left `current` naming a slot that held 199 of 400 files. The incomplete mirror is the
real damage rather than the noise: a frozen hook command naming a file that never got copied is exactly the
127 this whole mirror exists to prevent.

So the whole sequence — pick the slot, rebuild it, flip the symlink — runs inside a `.sync.lock` taken
in the same `mkdir` idiom, with the same 120s dead-holder break. What a contender does depends on what it
already has, and the two answers are deliberately different:

| The contender finds                         | What it does                                                          |
| ------------------------------------------- | --------------------------------------------------------------------- |
| a live holder, and `current` already usable | stands down at once, says so, and still points the `slopweaver` shim  |
| a live holder, and **no** usable mirror     | waits for it, bounded by what is left of the hook budget, then builds |
| a lock older than 120s                      | breaks it — no live holder could be that slow against a 3.59s build   |

**Both locks read that mtime GNU-first, and check the answer is a number.** `stat -f %m` is BSD's mtime and
GNU's `--file-system`, where `%m` is no directive at all, so on Linux that form exits 0 printing a block
opening `File: "..."` and a `stat -f … || stat -c …` chain never reaches its second arm. Measured on the CI
runner, feeding that to `$(( ))` made bash read `File` as a variable and `set -u` killed five of
six concurrent runs, while every darwin run of the same commit was green. `src/__tests__/statFlavourShim.ts`
puts each platform's `stat` contract on PATH so the class is testable off the runner.

Standing down is right in the first row because the mirror is valid now and the holder will leave it valid
and one sync fresher, while every second of waiting is charged against a 60s hook budget the fast-forward
above may already have spent 45s of — and after a restart that row is what every seat but one is in. The
accepted residue is that such a seat can run for its whole life on a mirror one fast-forward behind its own
source; the window is seconds wide and the next session start closes it. Waiting is right in the second row
because a session with no mirror has no `slopweaver` command to point and no resolvable hook commands at
all, which is worse than a slow boot. The wait bound is **derived, not chosen**: the script captures its own
start time before the fast-forward and waits only while `55s - elapsed` is positive, so a run whose fetch
already cost 45s waits ten seconds and no more. Both endings print one line, because an exit 0 that decided
to do nothing must not look like an exit 0 that synced.

The test files under `src/__tests__/subprocess/scripts/pluginMirrorSync/` hold all of it against real concurrent
processes, and every one of their concurrency cases asserts a positive witness that contention actually
happened — the contender's own stand-down line — alongside the absence of the `rm:` failure, because a storm
whose processes happened not to overlap would satisfy the absence while proving nothing.
