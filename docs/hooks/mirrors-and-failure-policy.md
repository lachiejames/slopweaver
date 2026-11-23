# One mirror per plugin root

Part of [Hooks — what runs automatically, and what each one refuses](../hooks.md).

Every mirrored hook command names `…/plugins/data/slopweaver/mirror/by-root${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-/_unkeyed}}/current/…`.
The key is what makes a seat's hooks resolve in the tree that declared them.

Before it, `mirror/` was ONE directory shared by every seat on the machine and `scripts/plugin-mirror-sync.sh`
rewrote it from whichever worktree booted last. MEASURED, after the owner asked about a flood of hook errors: a
boot from a branch that had folded ten PreToolUse scripts into one rewrote the
shared mirror with that layout, and seven seats on `main` — whose own `hooks.json` still named the ten —
lost every PreToolUse guard at once. A missing hook command exits **127**, which the host does not treat as a
block, so the door tripwires were off fleet-wide with no symptom on any seat. It recurred twice more within the
hour, from **auto-compact**: `SessionStart` fires on a compaction resume, so a write
path exists in every long session and not only at boot.

Nine things are the rule rather than notes:

- **The key is the RAW environment value**, never `resolve_plugin_root`'s answer. `hooks.json` is static text
  that can only substitute a variable, while that helper deliberately falls back when the variable names a
  directory that no longer exists. Key on the resolved root and a stale-variable session builds its mirror
  under one name and looks for it under another — the 127 again.
- **Nothing at runtime compares the two files**, so `src/__tests__/unit/context/hookMirrorKey.test.ts` does:
  it checks `hooks.json` and `plugin-mirror-sync.sh` against one constant, rather than each against the
  other.
- **The unkeyed `mirror/current` stays, re-pointed at whatever booted last.** Two callers want exactly that
  and neither is a hook surface: `~/.local/bin/slopweaver` and `memory hook --install`'s baked launcher path
  want A slopweaver CLI, deliberately the installed one. Shared is right for a binary and wrong for a set of
  script paths a seat's own `hooks.json` declares; conflating the two is what that incident was. It also keeps
  commands frozen in sessions that booted before the key resolving.
- **Per-root means unbounded, so it prunes.** Each root costs two slots at 74 MiB a slot (measured). A root whose `.last-sync` marker is older than seven days has its slots, `current` and marker
  removed on the next boot — its LOCK is left standing, the one entry that could belong to a contender
  building right now. A root whose lock is FRESH is skipped; one past `lock_is_stale`'s 120s is pruned like
  any other, because its holder died and a root that never boots again never breaks it (measured: 16 such locks
  once pinned their slots, the oldest sixteen days stale). The MARKER decides, not
  whether the root still exists, because a root can be pruned out from under a running session. **What it owns, never its directory**, for the same reason the
  sweep below is bounded by name: roots NEST, so `rm -rf` on a stale `<checkout>` root would take every live
  worktree root's mirror standing inside it, and a live seat with no mirror is the 127 the mirror prevents.
  The slots are all the disk there is, so leaving an empty skeleton costs nothing.
  **A worktree root does not wait the seven days.** At a worktree per seat the age window held 533 gone
  worktrees' mirrors, about 77 GB, the morning the disk filled. `slopweaver worktree
mirror-prune`, which the hourly prune also runs, frees a root under a declared checkout's worktree home once
  the tree is gone, no live register names it and no FRESH lock stands — the same slots, `current` and
  marker, lock left standing. A `current` that is a real directory rather than the link is left too, as the
  script's `rm -f` leaves it, and a root whose free still throws is reported kept with the error while the pass
  goes on: one root once ended the whole hourly prune and held its row.
  [Operations](../worktree-prune/operations.md#a-removed-worktrees-plugin-mirror-goes-with-it).
- **A root resolves BEFORE its mirror is built, because the build is the part that gets killed.** The sync is
  itself a `SessionStart` hook with `"timeout": 60`, and everything a seat's `hooks.json` names sits behind
  the `current` it flips at the END — so a run the host kills mid-build leaves a freshly spawned root with no
  `current` at all and every hook in that seat at 127, non-blocking, for the life of the session. MEASURED
  (a fleet finding): five runs ended at 60053–60128 ms against the declared 60000; two of
  those roots carried no `current` and no `.last-sync` afterwards, and their seats logged `exitCode 127 …
current/scripts/hook.sh: No such file or directory` on SessionStart, PreToolUse and Stop. A first boot into
  a new worktree is where it lands, because it runs beside `plugin-install-deps.sh` — 112026 ms in that same
  group — on a disk-bound machine, against a build measured at 3.59s uncontended. So the sync points
  `current` at the live plugin root the moment there is nothing usable there, inside the lock and before the
  copy: `$ROOT` already carries `scripts/hook.sh`, and it is COMPLETE by construction, which is why the seed
  is a LINK to it and why the first build still goes into a slot rather than straight into `current` — either
  shortcut would put a half-written tree back behind `current`, which is the 199-of-400 damage above.
  **`current` pointing outside the mirror is therefore a designed staging state, not corruption**: it is the
  behaviour this machine had before the mirror existed, and the next boot that completes a build replaces it.
- **A slot missing `scripts/hook.sh`, `scripts/pretooluse.sh` or what they source is never made current.** A slot
  short of other files is flipped, unstamped, and rebuilt next boot; one short of `HOOK_ENTRY_FILES` (`hook.sh`,
  `bounded-run.sh`, `profile-delivered.sh`, `pretooluse.sh`, `resolve-root.sh`, `guard-root.sh`, node's entry
  `hooks/pretooluse.ts`, wherever the source
  carries them) would be a seat whose hooks cannot run — the entry or its envelope gone exits 127 and the tool runs
  past every gate, the profile hold gone refuses every call with no profile and no reload (found in Codex review).
  Present is not enough: each must match the source byte for byte (`cmp`), since a copy reporting success over a
  zero-byte `hook.sh`, `pretooluse.sh` or `pretooluse.ts` is an entry that exits 0 before any gate, and must keep the
  source's execute bit, since `hooks.json` executes `hook.sh` and a 126 runs the tool as a 127 does. So `current` stays on the tree it names, and when that tree fails the same
  check — a slot an older commit built — it is re-seeded to the plugin root, complete by construction; the next boot
  builds again either way.
- **The sweep that finds those markers is bounded by the SLOT NAMES, and nothing else will do.** MIRROR ROOTS
  NEST: the key is the plugin root path appended whole, and a worktree lives at
  `<checkout>/.claude/worktrees.noindex/<branch>`, so 63 of the 64 roots on the owner's machine sit inside
  the `<checkout>` root's own mirror directory. A marker only ever sits at a root's top level, but the walk
  still has to descend PAST one — which rules out `-maxdepth` (there is no single depth) and rules out
  stopping at the first marker found (it would hide every worktree root and silently turn the prune off).
  What is safe to skip is every directory the script itself creates inside a root: `.slot-a`, `.slot-b`,
  `.sync.lock`. `node_modules` is deliberately NOT in that list — it exists only inside a slot, so the slot
  skip already covers it, while skipping it by name would also skip a by-root path COMPONENT called
  `node_modules` and hide that root forever. MEASURED on the 8.1 GB mirror: unbounded, the walk
  visited **864,565** entries in **72.22s real / 36.73s sys** to find 64 markers — past this hook's declared
  60s, so every boot was killed inside it. Bounded: **200** entries, and the whole script **79.83s ->
  18.33s** (30.06s on a second sample — the spread is the machine's disk, and both are inside a budget the
  old one could not meet at all). Repro:
  ```bash
  B=~/.claude/plugins/data/slopweaver-inline/mirror/by-root
  /usr/bin/time -p find "$B" -name .last-sync -type f
  find "$B" \( -name .slot-a -o -name .slot-b -o -name .sync.lock \) -prune -o -print | wc -l
  ```
- **The prune runs LAST, after `point_path_shim`.** A kill at the declared 60s takes every step after the one
  it lands in, so while the sweep sat in the middle it cost a killed boot its path shim as well as its disk.
  Ordering it last is what keeps a future slow step — 63 stale roots is a real `rm -rf` — from reaching the
  shim again.
- **A boot whose mirror already matches its commit copies nothing.** MEASURED: seven of
  these syncs copied at once and fseventsd and mds took the load from 5 to 52 on a 22-core machine, though
  most were a resume, a compaction or a second session on an unchanged worktree. A build writes the commit it
  copied into the slot as `.source-commit`; the next boot compares that with its root's HEAD, BEFORE the lock
  since it only reads, and on a match refreshes `.last-sync`, points the shim and exits — 0.41s against a
  5.71s build on the real tree. The one risk is a skip serving a stale tree, so only a STRICTLY clean surface
  has a stamp: no tracked edit, untracked file or ignored file under a mirrored entry (the copy takes all
  three), a root that is its checkout's own top level, and the same answer before and after the copy. The
  slot itself must then pass an `rsync --dry-run --delete` against the source, because a clean source says
  nothing about what landed: review found another root's prune `rm -rf`ing a waiting root's slots mid-copy,
  which a stamp would have made permanent — so the prune also passes over any root whose lock is fresh. Anything
  else builds exactly as before, and a cache install, having no git, always builds.
- **One copy per data root at a time.** What still copies (a new worktree, a new commit) takes
  `mirror/.copy.lock` after the per-root lock, and releases it at the flip. A contender waits while a copy
  would still finish inside the budget (`COPY_RESERVE_SECONDS`, 20); past that a checkout root seeds `current`
  at itself rather than keep a slot from an older commit, which can lack a file its own `hooks.json` now names.
  A cache install keeps its slot: its key is a versioned path, so the slot is the same bytes.

The witness is `src/__tests__/subprocess/scripts/pluginMirrorSync/twoSeats.test.ts` § "two seats with
different hook layouts": two roots with different scripts boot against one plugin-data root, and each is
asserted to hold its own file **and not the other's**.
`src/__tests__/subprocess/scripts/pluginMirrorSync/seedBeforeFirstBuild.test.ts` § "a seat spawned into a root
with no mirror yet" is the witness for the seed: it hangs the build with an `rsync` on PATH that never returns,
kills the tree, and asserts both that `current/scripts/hook.sh` is executable and that `.last-sync` is ABSENT —
the second half being what proves the flip never happened, since without it the case would pass just as well on
a build that finished. Two cases in `twoSeats.test.ts` hold the sweep's bound down, and each reddens against a real alternative rather than
against silence — a decoy `.last-sync` planted inside a LIVE slot must survive
(the unbounded walk `rm -rf`d its parent, inside the live mirror, which was the unreported second half of
that defect), and a root NESTED inside another root's mirror must still be pruned (a `-maxdepth` bound
leaves it standing). Its § "a boot whose mirror already matches its commit copies nothing" and § "one copy per
data root at a time" hold the last two down, each against a real git checkout.
`scripts/prove-hook-mirror-survives-cache-replacement.sh` carries the sharper case — version B booting must not reach version A's mirror, with version A itself already pruned.

## The event that builds the mirror cannot run from it

**Every `SessionStart` entry names the plugin root, never the mirror.** One event's hooks start in parallel,
and `plugin-mirror-sync` is one of them, so a sibling naming `…/by-root<root>/current/…` raced the build that
creates it. On a root with no mirror yet — a fresh worktree, which at a worktree per seat is nearly every boot
— `/bin/sh` exited 127 before `scripts/hook.sh` ran, and `profile-context` and `handover-run`, the hooks that
put the owner's profile and the open run's brief in front of a session, delivered nothing in most
seats. Both fail open, so nothing looked wrong. `slopweaver-init` failed the same way with its error discarded.
The seed above narrows that window and cannot close it: it waits on the checkout fast-forward and the lock.
MEASURED: 119 of 152 transcripts touched in the previous day carried a `SessionStart`
`hook_non_blocking_error` naming `current/scripts/hook.sh: No such file or directory`. Repro, and the probe that
holds it down per seat:

```bash
slopweaver transcripts boot-hooks --since 1d
```

It exits 1 on any `SessionStart` hook a transcript RECORDS as never having run (a 127 whose whole stderr is the
shell's one sentence naming the command's own first word, or a stderr that is only `scripts/hook.sh`'s
missing-target line for the command's own label) and on any
transcript it could not read whole, 3 over none walked, else 0. It reads failure records, not a roll call: a
hook that left no record at all is invisible to it — `slopweaver-init`, whose command discards its own error,
is one — so 0 means no recorded failure, never that every registered hook delivered. One shape reads as a
missing wrapper and is not: a target that ran a bare `sh` on some other missing file ending `scripts/hook.sh`
and printed nothing else. The registered command's first word is stored unexpanded, so the probe cannot
compare the two paths; no hook in this repository does that.

Four things are the rule:

- **The rule is per HOST EVENT, across manifests.** Codex runs `hooks/hooks.json` and `hooks/codex-hooks.json`
  together, so `codex-rules-context` raced the sync the shared file registers and moved with the other three.
  `unit/context/hookMirrorKey.test.ts` § "the event that BUILDS the mirror" merges every manifest by event
  before it asserts.
- **Every later event stays mirrored.** `PostCompact`, `Stop`, `PreToolUse`, `PostToolUse` and
  `UserPromptSubmit` fire after `SessionStart` has finished, and keep the mirror's reason for existing: a
  command frozen at session start that outlives a pruned plugin root.
- **The residue is a compaction after a prune.** A `compact`-source `SessionStart` in a session whose plugin
  root was pruned after the session started fails all four, as `plugin-mirror-sync` itself always has — three as a
  recorded 127, `slopweaver-init` silently, because its command discards its own error. `PostCompact` cannot
  re-deliver the owner's profile — its output reaches no context, a HOST fact measured with its repro in
  `src/context/loadLedger.ts`, which no test here can pin; `unit/context/hookRegistration.test.ts` pins only our side
  of it, that no `PostCompact` row runs `profile-context.sh` — so that compaction leaves no delivery marker and the next guarded call is
  held and reloads it (`profile-held`, [the registered set](registered-and-bounded.md)); whether Codex re-delivers
  `codex-rules-context` then is unmeasured.
- **A changed command is a changed Codex hook.** Codex trusts a hook by its command, so these four read
  `modified` in `slopweaver codex hooks` until the landing's `codex plugin-sync` refresh trusts them.

## The three that fail closed, and why the rest do not

**The `admit` check (`src/admit/pretooluseAdmit.ts`) is the raw-tool guard.** A malformed payload blocks loudly rather than
silently allowing, and a thrown evaluation error exits 2. It defends a boundary rather than a workflow, so
being broken must stop the tool call.

**The `bot-live-write-guard` check (`src/admit/botLiveWriteGuardRunner.ts`) runs ahead of it**, and a thrown
evaluation error exits 2 for the same reason: what it guards is a migration or a staging or production write
from a bot turn, which the owner ruled the bot never makes unless the owner asked. A payload that names no shell
line still releases, because it runs nothing this check judges. It sits ahead of `admit` so a bot turn meets
that ruling rather than the raw-tool refusal and the hatches the raw-tool refusal offers.

**The `browser-door-guard` check is the browser-door guard**, and it fails closed one step further
than its sibling: the SHIM exits 2 when it cannot resolve a runtime AND the payload is a browser call.
`scripts/pretooluse.sh` decides that from the payload rather than from the matcher, because folding ten
shims into one left it with no matcher to read — a shim that always failed closed would wedge every command
in the session on a broken toolchain, and one that never did would drop this gate silently. This call's tool
name is `mcp__claude-in-chrome__*`, so the entire cost of failing closed is that browser calls stop, and what it guards is a post under the owner's own identity with no door,
no ledger and no preview. See [the browser guard](browser-memory-and-limits.md).

**A SPENT budget is the other axis, and it fails closed on every guarded tool.** `give_up_code` in
`scripts/pretooluse.sh` splits by failure CLASS. A `persistent` one (no guard root, no runtime) exits 0 for
everything but a browser call, because it would wedge every call until the toolchain is mended — except a
context holding no CURRENT delivery of the owner's profile, which the **bash recovery lane**
(`hooks/lib/profile-delivered.sh`) holds and hands the owner's profile from the plain-text copy `writeContextCache`
keeps beside the cache (`profile/context.txt`), marking it behind the delivery so the retry passes with nobody's
hand on it. "Current" is checked as node checks it — the transcript the payload names, and no compaction record
past the marker's offset, and a scan whose `tail` failed is no scan (its `PIPESTATUS` is read, never `grep`'s
count alone) — so a marker a compaction outdated is no marker here either (the owner would rather a session do
nothing than act misaligned). A `spent` one (the dispatch or payload read outran the
budget) exits 2 for every guarded tool, `Edit|Write|Agent|Task` included, since the `profile-held` check the
budget never reached covers those too; a context holding no current delivery gets the owner's profile from the same
lane with that refusal, the browser's included, so a load that spends every budget still hands it over rather
than refusing forever. Exactly the by-hand reload passes on EVERY path, copy or none, node and bash alike
(`profile_is_reload`, matched as node's `RELOAD_PATTERN`): its output IS the owner's profile, so it is the one guarded call
that cannot act without it, and where no copy exists it is the command that writes one. It writes no marker, so
the next call is still judged; the pattern admits nothing but that command and `--json`. A machine never
configured is not held on the persistent paths either: `profile_first_boot` (`hooks/lib/profile-delivered.sh`) is
the bash twin of node's first-boot read (`src/admit/profileFirstBoot.ts`), over the same three homes and failing
closed alike — any load ledger at all reads configured there, since a first boot writes none and bash decodes no
JSON — so a newcomer with no runtime can still install one (the owner's rule: onboarding must never trap
anyone). A spent budget still refuses for a retry, first boot or not.
MEASURED: 101 `Bash` calls
in one morning were released past the one-door, poll and script gates with no verdict. The refusal says "run it
again", and the budget variable only NARROWS (`hook_budget_seconds`, `hookBudgetMs`): the fix for a spent
budget is the step spending it, never more budget.

**The envelope refuses on both `PreToolUse` rows, because it cannot make the split.** A kill cannot read a
payload, so it cannot tell a context holding the owner's profile from one without it, and the `profile-held` hold
covers `Edit|Write|Agent|Task` as well as the door-gated tools: `hooks.json` prefixes both disjoint rows with
`SLOPWEAVER_HOOK_GIVE_UP=2`, so any call the envelope has to end is refused — an `Edit` from a profiled context
included, which costs one retry under a starvation that deep — and every other entry keeps the release. An environment prefix rather than an argument because a
seat's `hooks.json` and its mirrored `scripts/hook.sh` can be a version apart in either direction, and an older
`hook.sh` ignores a prefix where it would have read an argument as its label and run no check at all. A
missing target releases on a refusing row only for a context holding a current delivery: it is persistent,
like the inner layer's own persistent failure, so `run_target` reads the payload and runs the same bash recovery
lane, and refuses outright when `hooks/lib/profile-delivered.sh` is missing beside it — a tree the mirror never
makes current (above), so only a hand deleting it reaches that refusal. The envelope's OWN
kill on a refusing row prints the copy into its refusal (`HOOK_ENVELOPE_KILLED`, never a target's own exit
2), builtins only, started only with a whole second left before the declared timeout, and cut short at that
second, at 12 KiB written (under a drained pipe's buffer), or at 1024 reads of 256 bytes, since a whole-line
read swallowed a newline-free 128 MiB copy and held the refusal 9.13s past a declared 6, and a byte total kept
from what was read undercounts NULs. It never read the payload, so that delivery is unmarked and the
next call a gate judges marks it. Under kills that never let up, that means every guarded call is refused and the
context stays unmarked until one is judged: fail closed, per the owner's ruling, and recovered by itself on the first call
the starvation spares. The envelope writes no ledger row either, so `profile-unloaded` reads that session as
`not yet held` rather than `held` until then.
MEASURED: with only the inner layer closed, one load episode still ran ~22 `Bash` calls past
every gate, because nothing of ours ended inside the harness's 20 and a harness timeout RUNS the tool. So
`PreToolUse` declares 30 — runway for the inner 15 (+2 for a pid that ignores its TERM) and the envelope, not
more budget. **The residue is
stated, not closed**: a machine that starves our whole tree past 30 still hands the call to the harness, which
runs it; so does a host that stopped reading a hook's stderr once its target filled the pipe, since no bash write
can be timed out and the envelope's own diagnostic blocks there first; and so does a disk stalling the copy's read.
Two more, each reached only by a state no live seat is in. A session frozen on the per-check `pretooluse-*.sh` shims
the one-process fold retired calls the dispatcher `--only` its old checks, which never select `profile-held`;
MEASURED, the oldest running `claude` started weeks after that fold (`ps -Ao lstart,comm | grep -i 'claude$'`), and
every later session reads the folded rows. And a payload whose id or transcript path carries a JSON escape is
delivered by the bash lane but never marked there, since it cannot key one; Claude Code writes neither escaped,
and the node gate marks such a context on the first call it judges (`profile_deliver_from_copy`).

**The three main-checkout guards fail OPEN, deliberately.** They protect a pinned main checkout from a
branch switch, a branch RENAME, a dirty write, or a stray edit made from another worktree — a workflow
safety net, not a security boundary. A broken toolchain must never wedge every tool call, so an unhandled
error exits 0. Each carries its own break-glass, kept separate on purpose so one escape hatch is never
broader than the case it was opened for — see [environment.md](../environment.md).

**What counts as protected has two keys, not one** (`src/admit/declaredMainCheckouts.ts`). The topology key
is "the main worktree of the SAME repository this session is standing in", which only protects a checkout
from its own repository's sessions, and it is read from `.git`/`commondir` on disk, never a `git` fork — the
six `rev-parse` children it replaced were the worst-scaling step on the `Bash` path (`src/admit/mainWorktree.ts`). The second key is `profile.json`'s declared `mainCheckouts[]` — the same
register `checkout status` and `doctor` read — so a session standing anywhere at all is refused a write into
a declared checkout. Both keys fail open: an unresolvable `cwd` and an empty declaration protect nothing.

**The guard refuses a rename too.** A `git branch -m` is not destructive by any ordinary reading and does not
move `HEAD` — it moves the branch out from under it. Measured: a spawned child renamed a shared checkout's long-lived
branch to its own feature name and committed on top, and the resulting pull request rendered that entire
branch instead of a one-file change. See [main-checkouts/cwd-safety-and-scope.md](../main-checkouts/cwd-safety-and-scope.md#a-child-must-never-work-in-the-shared-main-checkout).

**`hooks/handover-run.sh` fails open on every path, and is inert by default.** For a `Stop` hook a non-zero
exit is itself a way to block, so a missing checkout or a crash must never be able to refuse. `Stop` fires
on every stop, clear, resume and compact, and starting the CLI costs about 2.5 seconds — a quarter of the
hook's own deadline — so the common case (no runs directory, or no journal in it) is answered in shell and
never launches Node at all.

**The start brief never tells a session to take over landed work.** A run held by a DEAD session is normally
routed at `handover claim`, but when its row is already SETTLED — and the board was read in full — the brief
says there is nothing to take over and names `handover reap`, which writes the ending the dead session never
could. Measured: five atlas asks settled on merged pull requests were offered to every fresh
session as claimable (`src/handover/hookGate.ts`, `settledDeadRunLine`).

**The run hooks rank journals before they cap them, and say what they skipped.** The brief and the Stop gate
fully parse at most 24 journals, a deadline bound. Every journal is first stat'ed and byte-searched for the
hooked session's own `sessionId`, and those it names are folded to learn whether the session still HOLDS the
run; held, unclosed runs come first, then the rest newest-written first, and the brief (and any refusal) states
how many ranked below the cap or were unreadable. The cap used to cut the slugs ALPHABETICALLY,
so with hundreds of journals on disk most runs, this session's own included, got no brief and no gate, silently
(`src/handover/hookJournalRank.ts`, `hookJournalScan.ts`).
