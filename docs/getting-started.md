# Getting started — install in full, and developing Slopweaver itself

The short form is in the [README](../README.md#install). This page is every step, in order, with what each one
needs and what it does when something is missing, then Codex and the development loop.

## What you need

| For                          | You need                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the CLI and the plugin       | macOS, git, bash, [Node](https://nodejs.org) at the version in `.nvmrc` from a version manager such as nvm (so `corepack enable` can write beside it), Yarn 4 through Corepack, Claude Code, and a network connection for the package installs                                                                                                                                        |
| the desktop app              | macOS 13 or later on Apple silicon (the install refuses anything but Apple silicon, and the built app declares 13.0 as its minimum macOS), the Xcode Command Line Tools (`xcode-select --install`), whose `swiftc` builds the app's native helper, and an account that can write `/Applications` (an administrator)                                                                   |
| GitHub reads and writes      | the [GitHub CLI](https://cli.github.com) signed in, or a token in `GITHUB_TOKEN` or `GH_TOKEN`                                                                                                                                                                                                                                                                                        |
| the fleet's visible sessions | [cmux](https://cmux.dev), open                                                                                                                                                                                                                                                                                                                                                        |
| the local store              | [Docker Desktop](https://www.docker.com/products/docker-desktop) 4.88.0 or later (another runtime serving `docker` works, unproven), its Port binding behavior set to local only before the store first starts ([why](security/local-store-hardening.md)); the Supabase CLI is pinned in `package.json` and `yarn install` installs it, so Homebrew is not needed — [store](store.md) |
| Codex planning and review    | the Codex CLI, signed in                                                                                                                                                                                                                                                                                                                                                              |

Only the first two rows and the store block the install: the console refuses to draw until the store holds the
organisation (step 3). `bin/slopweaver doctor` reports a missing Docker runtime, an uninstalled or mismatched
Supabase CLI, missing GitHub access, cmux or Codex as a finding with its fix, and the verbs that do not need one
keep working.

## 1 — Clone, and install the dependencies

Clone this repository with git over SSH or HTTPS. The install needs a real clone, not a copy of the files: the
desktop build stamps the app with the clone's `HEAD` (and builds from that commit when `desktop/` has no local
edits), and `desktop install`, like every verb that opens a worktree, finds the clone through its `origin`, which
must read as an `owner/repo` remote (a `file://` or plain-path origin does not). Then, from inside the clone:

```bash
corepack enable
yarn install
yarn lefthook install
bin/slopweaver doctor --deep
```

`yarn install` does not install the git hooks, so `yarn lefthook install` does: among them the `post-merge`
hook that refreshes the Codex install on a merging or fast-forward pull. `bin/slopweaver` is the CLI and works from the clone
before anything else is installed.

## 2 — Install the Claude Code plugin from the clone

```bash
claude plugin marketplace add "$PWD"
claude plugin install slopweaver@slopweaver-dev
```

The marketplace is the clone itself, so the install depends on no hosted copy. Claude Code installs a copy
of the clone's current commit, and that commit is the plugin's version: after a `git pull`,
`claude plugin update slopweaver@slopweaver-dev` takes the new one. Start a NEW Claude Code session — a
running one does not load a plugin installed under it. On that first session the plugin installs its own
dependencies (one-time, about a minute) and puts a `slopweaver` command in `~/.local/bin`
([a colleague can type `slopweaver`](install-stays-current/running-sessions-and-cli.md#a-colleague-can-actually-type-slopweaver)).
Routes and what keeps each current: [install-stays-current](install-stays-current.md).

## 3 — Create the home, declare the clone, and write the organisation

```bash
bin/slopweaver init
```

`init` creates `~/.slopweaver` (or `$SLOPWEAVER_HOME`) with a seeded `profile.json`. Open that file and add one
key, keeping the fields already there, with the clone's absolute path:

```json
"mainCheckouts": [{ "path": "/absolute/path/to/your/clone" }]
```

The desktop app builds from a declared main checkout and opens its console, the fleet cuts its worktrees
from one, and the Codex install publishes from one. Without it `desktop install` refuses with
`no main checkout for the app to serve its console from`, before it builds anything. Both optional fields, and what they guard: [declaring your main
checkouts](main-checkouts/declarations-and-freshness.md#declaring-your-main-checkouts).

Then bring up the store, select it, and name the organisation this install works for. The console places every
row by that organisation and draws nothing but `Organisation required` until it is written, and the plan register
lives in the same store, so both come before the app:

```bash
yarn store:start
bin/slopweaver store push
bin/slopweaver org set --display-name Acme --github-owner acme --without-google --without-slack \
  --without-linear --without-vanta --repository acme/acme-admin
```

Put your own organisation's values in `org set`; every field is stated, and a provider you do not use is stated
absent ([org](../skills/org/SKILL.md)). Slack is one of those, never a requirement: an organisation that uses it
passes `--slack-host <workspace>.slack.com` in place of `--without-slack`. `yarn store:start` runs from the clone. It starts the stack, then locks it:
it writes `secrets/store-url` (`0600`) as the verbs' own login with a random password, and refuses every other
login from this Mac ([the local lock](../skills/store/reference/local-lock.md)), so there is no URL to paste.

## 4 — Install and open the desktop app

Build it from the clone:

```bash
bin/slopweaver desktop install
```

It builds the clone's `desktop/`, signs it with a local identity it creates on the first run, installs it as
`/Applications/Slopweaver.app` and opens it on the console's Queue. There is nothing separate to start: later
opens are a Dock click, and the app serves the console from the clone. Each refusal and what it asks of you:
[the desktop skill](../skills/desktop/SKILL.md); what the app does: [the desktop app](../desktop/README.md).

Or download it: this repository's Releases page carries `Slopweaver-desktop-arm64.zip` for each `desktop-v*`
release. Expand it, move `Slopweaver.app` into Applications and open it; it raises a note with **Choose a
Slopweaver clone…**, and the folder you pick (the clone from step 1) is remembered. A download does not replace
steps 1 to 3: the app serves the console from that clone. Each release's notes say whether it is Developer ID
signed and notarised; one that says **ad-hoc signed and not notarised** is refused by macOS until you run, once:

```bash
xattr -dr com.apple.quarantine /Applications/Slopweaver.app
```

which takes the download mark off that one app, so run it only for a copy you downloaded from the Releases page
on purpose ([why](../desktop/docs/download-a-release.md)).

## 5 — Connect your sources: `/slopweaver:onboard`

Run `/slopweaver:onboard` in the new Claude Code session. It walks GitHub, Slack, Linear, Notion and Gmail, plus
Datadog live: it renders the Slack app manifest for the access level you pick, walks you through the Google
OAuth client, and asks for each token on a Queue card in the app, never in the chat. It then pulls the window
you choose and lands a first cited answer. Re-run it any time; it resumes where it stopped. Between runs:

```bash
bin/slopweaver secrets status
bin/slopweaver connect slack --check
```

`secrets status` names each stored credential and counts the missing ones (`--all` names those too), never
printing a value; `connect <source> --check` says
whether one source is ready and, when it is not, which secret to set.

## 6 — Plans: the model subscriptions sessions run on

With **one Claude subscription** there is nothing to do: the `claude` sign-in you already have is the plan.

With **two or more**, the fleet rotates between them. Adopt the register once, add each plan with an absolute
store directory under `~/.slopweaver/claude-accounts/`, then sign each in from your own terminal:

```bash
bin/slopweaver plans adopt
bin/slopweaver plans add --provider claude --plan plan-one --store-dir "$HOME/.slopweaver/claude-accounts/plan-one" --pinned
bin/slopweaver plans add --provider claude --plan plan-two --store-dir "$HOME/.slopweaver/claude-accounts/plan-two"
bin/slopweaver claude signin
bin/slopweaver claude signin --status
```

A **Codex** plan connects from the console with no terminal: **Settings → Models → Connect** runs `plans connect
--provider codex`, which opens Codex's own sign-in page in your browser, registers the plan once you sign in there,
and installs Slopweaver into its home (`plans connections` reports the attempt; `plans connect-cancel --id <id>` ends
one). By hand, `plans add --provider codex --plan <alias> --store-dir <absolute dir>` prints the `codex login` line to
run, then installs Slopweaver into that one home as a foreground `codex plugin-sync` would ([Codex](#codex)). Either
way a failed install keeps the row and exits non-zero, so rerun `codex plugin-sync`. To give the fleet only part of
a plan, record a usage limit on its row, such as `plans set-usage-limit --provider claude --plan plan-one --percent
50 --allowance weekly-window`, or pick its percentage in Settings → Models, one drop-down per plan; routing stops at
it. The house bars every plan is routed against (95% by default for Claude, 99% for Codex) are the
register's too: `plans list` prints them, `plans set-thresholds` moves one. The register, pausing a plan, usage
limits, thresholds and routing:
[plans](../skills/plans/SKILL.md).

## Codex

The Codex manifest and skills are checked in under `.codex-plugin/` and `skills/`. Codex installs from a
personal marketplace, `~/.agents/plugins/marketplace.json`. With the clone declared (step 3) and checked out on
the remote's default branch, from inside it:

```bash
bin/slopweaver codex plugin-sync
```

It adds a local `slopweaver` entry to that marketplace when it has none — creating the file with the `personal`
marketplace when there is no file, appending to `plugins` when there is one, and never touching another entry
or a file it cannot parse, nor one holding a number JSON would write back differently. The entry's path,
`$HOME/plugins/slopweaver`, becomes a symlink to the sync's export; a real directory there, or a
path that reaches the marketplace file itself, a linked parent included, is refused. It then installs into **every Codex home**: each one the
plan register names (paused plans included) and the ambient `$CODEX_HOME`, since a seat boots with
`CODEX_HOME` set to its plan's home and loads only what is installed there. Each home gets its own line and its
own hook-trust pass; a registered home with no directory is that home's failure, judged before the marketplace write, and nothing is installed into it; an
absent ambient home is left alone. A home that is the export's cache directory, holds it or sits in it, compared
through every link, fails the run before anything is written. With a clone on another branch, or one missing `origin/HEAD` (restore it with
`git remote set-head origin --auto`), the sync prints `skipped` and installs nothing.

`plans add --provider codex` runs the same install over the one home it has just registered, after the row is
published: from a clone that is not a declared main checkout it prints that `skipped` line and exits zero. `cmux
spawn` checks the routed home before it provisions anything, and **refuses a seat whose home carries no
Slopweaver install** under any marketplace directory of its plugin cache (it never reads the marketplace file), naming `slopweaver codex plugin-sync` as the fix, a continuing app session included. A stamp path it cannot look up — a directory on it that cannot be searched — is refused as an install that could not be read, naming that path and its error, never as a missing one. A
stale install boots: one behind HEAD, or one whose stamp will not parse, is the refresh's to repair, never the
spawn's to refuse.

**Codex installs a COPY, and re-copies only on `codex plugin add`** — never at a session start (measured on
codex 0.157.1). `codex plugin-sync` exports the declared main checkout's HEAD (`git archive`, tracked files
only) into the cache root's `codex-plugin/slopweaver` (`src/cacheHome.ts`; `slopweaver doctor` prints it) once,
points the marketplace entry at it, and runs the add into each home with `CODEX_HOME` set to it. The main
checkout's `post-merge` hook runs it in the background on every merge or fast-forward, so such a pull reaches
the next Codex thread in every home. **The hook only UPDATES a home that already carries a Slopweaver install
stamp**: it never makes a first install and never writes the marketplace, so a home with no install, or a
machine with no marketplace entry, gets a `not installed here — run slopweaver codex plugin-sync` line and no
failure. Only the foreground run seeds the marketplace and makes the first install. A `git pull --rebase` runs
no `post-merge`, so run `bin/slopweaver codex plugin-sync` after one. `.codex-plugin/plugin.json`
carries no `version`, so the cache key is a stable `local` and a running thread's `bin/slopweaver` path
survives a refresh. In a Codex thread, `slopweaver doctor` prints `v<release>+<commit>`; that commit equals the
main checkout's HEAD. Why no live route works: `src/codexPlugin/plan.ts`.

Start a new Codex thread after installation so the skills and hooks are discovered, then ask it to onboard
Slopweaver. In that fresh thread, use `/skills` to verify `slopweaver:handover`, `slopweaver:pickup`, and
`slopweaver:orchestrate`. Every `codex plugin-sync` refresh has Codex trust each Slopweaver hook it would
otherwise skip, and `bin/slopweaver codex hooks --trust` does the same on demand; `bin/slopweaver codex hooks` names
any still skipped, the hook that gives a Codex session this repository's always-on rules among them
([the always-on set](doctrine-rationale/always-on.md#how-codex-receives-the-set)). Codex persists the
installed plugin across sessions, but a plugin install or update is not loaded into an already-running thread.
The foreground bot loop is the `loop` skill; it runs entirely inside that visible thread.

`slopweaver:pickup` reconstructs a run from the shared on-disk board. Moving an open run between Claude Code
and Codex is explicit: the current writer runs `handover release`, then the destination runs
`handover claim`. Neither host may silently steal the other's journal.

## Developing Slopweaver itself

The plugin install serves a COPY taken at a commit, so every edit needs a commit and a
`claude plugin update` before a session sees it — friction while iterating on the plugin's own code. Load the
working tree directly instead:

```bash
claude --plugin-dir "$PWD"
```

That loads every skill and command in the repo for that session, namespaced the same way
(`slopweaver:store`, `slopweaver:refresh`, …), always running the code on disk rather than an installed copy.
Pass `--plugin-dir` more than once to load several plugins; passing the same directory twice is tolerated. A
development checkout is session-scoped, so make it repeatable with your own shell launcher if you want every
development session to receive the flag. After editing a plugin-discovered surface, run `/reload-plugins`;
the `/slopweaver:dogfood` command enforces that checkpoint and re-proves the exact root after reload.

The Codex SDK ships a **platform binary** (~300MB), so a first install is not instant. There is no model, no
native inference step and no index build: the store is the local Supabase Postgres (`yarn store:start` from this
checkout, then `slopweaver store push`, so Docker and the pinned Supabase CLI), read by full text — [store](store.md).

## The development loop

```bash
yarn install
yarn slopweaver doctor  # smoke-test the CLI
yarn validate:local     # what the pre-push hook runs: lint's local lane, the secrets scan
yarn validate           # the whole lap, at a human's terminal: an agent session is refused it
```

CI runs the whole lap and a session watches it (`whole-tree-check-guard`). `yarn lefthook install` (step 1)
installs the git hooks: `pre-commit` sorts staged files' imports with Biome and formats them with Prettier, and `pre-push` refuses a tree that
differs from HEAD, then runs only the gates CI cannot see — the secrets scan over local state
([toolchain](toolchain.md)).
The static-analysis bar is deliberately high: Prettier, oxlint (including its `--type-aware` mode), knip,
dependency constraints, plus bespoke ratchets that machine-enforce the house rules — a cognitive-complexity cap,
a ReDoS check, the hygiene gate, the door-coverage proof, a testing-discipline lane that bans mocks and
unfalsifiable assertions in tests, and a markdown cap with a link checker that keep these docs a linked tree
([agent-docs-practice](agent-docs-practice.md)).

Architecture: [architecture.md](architecture.md) · Contributor rules: [AGENTS.md](../AGENTS.md).
