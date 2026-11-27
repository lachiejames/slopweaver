/**
 * The sanctioned seams of this machine's workspace: the cmux client and socket, worktrees and their prune, checkouts, live machine reads, the desktop end-to-end drivers, and the Codex snapshot and account state.
 *
 * One part of the sanctioned-seam catalogue: `./sanctionedSeams.ts` spreads it into `SANCTIONED_SEAMS`, which stays
 * the one table `./coverage.ts` reads, so a module is still sanctioned in exactly one place. A new row goes in the
 * part whose theme its module belongs to, and a part nearing 300 code lines splits again.
 */

/** The sanctioned seams of this part, keyed by repo-relative path. */
export const WORKSPACE_SEAMS = {
  // The one owned client for the real `cmux` CLI — controls a local terminal multiplexer (create/send/read/
  // close a workspace), never a Slack/GitHub/Linear provider. Same class as `codex/snapshot.ts` below: a
  // local dev-environment tool, not an external write the door governs.
  "src/cmux/client.ts": "local-state",
  // The cmux control socket itself — a Unix stream socket on this machine, carrying the same local
  // terminal-multiplexer operations `client.ts` above wraps. Same class, one layer down.
  "src/cmux/socket.ts": "local-state",
  // `cmux revive`'s effects: a read-only `ps` listing of this machine's process table, and the restart of the
  // local cmux app itself (a signal to its pid, then `open -g -a cmux`). The same local terminal multiplexer the
  // two rows above drive, restarted from outside it — nothing here reaches a provider.
  "src/cmux/reviveEffects.ts": "local-state",
  // `cmux dialog`'s effects: System Events, from inside a seat, reading the local cmux app's modal dialogs and
  // pressing Cancel on the one allowlisted prompt. The same local app as the rows above; nothing reaches a provider.
  "src/cmux/dialogEffects.ts": "local-state",
  // The cmux event subscription: opens the same local socket and only ever READS frames from it.
  "src/cmux/eventStream.ts": "local-state",
  // The sidebar identity writers — the one part of cmux with no socket method, so the one part still
  // shelling the `cmux` binary. Writes a row's title, colour and ref pill onto a LOCAL terminal window;
  // same class as `client.ts` above, and see that module's header for why it is shelled at all.
  "src/cmux/sidebar.ts": "local-state",
  // Finds or creates a git worktree for a handover branch. Shells `git worktree`/`rev-parse` exactly like
  // `codex/snapshot.ts` below, for the same reason: a local checkout operation, not an external write.
  "src/cmux/worktree.ts": "local-state",
  // Its failed-add cleanup's direct removal of one admin directory under the checkout's own `.git/worktrees/`,
  // split out when that file passed the size ratchet.
  "src/cmux/worktreeAdminDir.ts": "local-state",
  // The rebase and bisect hold read behind every operational worktree listing: state files off a local git
  // directory and one `git rev-parse --short` to abbreviate an id. A constant argv, reads only, no provider.
  "src/cmux/worktreeHeldBranch.ts": "read-only-tool",
  // The `worktree` noun's three effectful edges. `shell.ts` runs `yarn install`/`yarn build` and one git
  // read; `provision.ts` replaces a `node_modules` symlink; `inventory.ts` runs `git worktree remove` and
  // `git rev-list`. Every one of them writes inside a LOCAL checkout the caller already owns — the same
  // class as `cmux/worktree.ts` above and `checkout sync`'s own install, and no external provider is
  // reachable from any of them.
  "src/worktree/inventory.ts": "local-state",
  "src/worktree/provision.ts": "local-state",
  "src/worktree/shell.ts": "local-state",
  // Copies each native binary in a LOCAL `node_modules` to Slopweaver's own exec store under
  // $SLOPWEAVER_HOME and hardlinks the checkout's copy to it, so a sibling install cannot write the inode
  // they all share. `link`/`rename`/`mkdir` inside the caller's own checkout and their own state home, the
  // same class as `provision.ts` above; nothing external is reachable. `worktree/execInodes.ts` has the
  // measurement that makes it necessary.
  "src/worktree/execInodesApply.ts": "local-state",
  // `worktree prune --apply`'s dependency pass: `rmSync` of a wholly-untracked `node_modules` inside a LOCAL
  // worktree the plan keeps, then `utimesSync` putting the tree's mtime back. The same class as
  // `provision.ts` replacing a `node_modules` symlink; `yarn install` writes it back, and nothing external is
  // reachable.
  "src/worktree/pruneDeps.ts": "local-state",
  // The node_modules recycle pool between `worktree prune` and the next provision. `recyclePool.ts` moves a
  // pruned tree's `node_modules` into `<repo>/.claude/worktrees.noindex/.recycle-pool/<slot>` and back out
  // (`mkdir`/`rename`); `trashBatch.ts` is the pending-batch protocol that stages a move aside in the
  // checkout's own trash (`mkdir`/`rename`/`rm`/`unlink`); `provisionRecycle.ts` discards a recycled tree
  // whose install failed (`rm`). All inside the caller's own checkout, the same class as `pruneDeps.ts` and
  // `reclaimTrash.ts`; nothing external is reachable.
  "src/worktree/recyclePool.ts": "local-state",
  "src/worktree/trashBatch.ts": "local-state",
  "src/worktree/provisionRecycle.ts": "local-state",
  // The PreToolUse bundle builder: its lock, failure marker, generation directories and `current` pointer, all
  // under the checkout's own gitignored `.hook-build/` (`mkdir`/`rename`/`rm`/`writeFile`). A build cache of
  // the checkout's own source, the same class as the recycle pool above; nothing external is reachable.
  "src/admit/hookBundleBuild.ts": "local-state",
  // The recycle race tests' contender processes: each writes its one result file into the `mkdtemp`
  // directory the calling test made under the per-file temp root. They reach no provider.
  "src/__tests__/subprocess/worktree/depsLockContender.entry.ts": "local-state",
  "src/__tests__/subprocess/worktree/recyclePoolContender.entry.ts": "local-state",
  // `verbCodexRoute.test.ts`'s child: writes the fleet-cap rows its in-memory store filed to the one file the parent
  // test named under the per-file temp root, so the parent can read them back. It reaches no provider.
  "src/__tests__/subprocess/cli/commands/talk/codexRouteChild.entry.ts": "local-state",
  // `worktree mirror-prune` and the hourly prune's mirror pass: `rmSync` of a gone worktree's `current` link and
  // `.last-sync` marker, then a bounded `rm -rf` of its two slots, all under `~/.claude/plugins/data`. The same
  // removal `scripts/plugin-mirror-sync.sh`'s own prune makes, on local plugin data; nothing external is reachable.
  "src/worktree/pluginMirrors.ts": "local-state",
  // Writes one small text file inside a LOCAL `node_modules` — Slopweaver's record that a yarn install
  // succeeded there, because yarn writes nothing when an install changes nothing. The same class as
  // `provision.ts` above and `checkout sync`'s own install: a write inside a checkout the caller already
  // owns, with no external provider reachable from it.
  "src/checkouts/installMark.ts": "local-state",
  // Renames `<repo>/.claude/worktrees` to a `.noindex` directory and leaves a symlink behind — a write to the
  // caller's own checkout, the same class as `provision.ts` replacing a `node_modules` symlink, so Spotlight
  // never indexes a worktree. The measurement and proof are in the file's header.
  "src/worktree/location.ts": "local-state",
  // Read-only git probes against a configured main checkout (`branch --show-current`, `rev-list --count`,
  // `status --porcelain`, `diff --name-only`, `grep -l`) plus one `fetch` of an already-configured remote.
  // Exactly the class `admit/mainCheckoutCleanliness.ts` above is: a local checkout read, never a provider
  // write. The fetch moves no local ref a caller acts on without asking — it only refreshes remote-tracking
  // refs so a comparison is not made against stale evidence.
  "src/checkouts/inspect.ts": "local-state",
  // `checkout console`'s seams: the same read-only git probes and throttled `git fetch` of the tracking remote
  // (remote-tracking refs only), one `ps` per recorded pid, and the claim files and `fetched` stamp under
  // the cache root's `docs-site/` that keep several console tabs to one fetch a minute. Never a provider write.
  "src/checkouts/consoleBuildDeps.ts": "local-state",
  // The same class again: `git fetch` refreshing only remote-tracking refs and a pull request head, then
  // `git merge-tree --write-tree` — a three-way merge in memory that touches no ref, index or working tree —
  // to name the paths a CONFLICTING pull request conflicts on. Never a provider write.
  "src/checkouts/conflictPaths.ts": "local-state",
  // `github repoint-plan`'s reads: read-only git probes of each checkout (`config --get-regexp`, `worktree
  // list`, `rev-list --max-parents=0`) and one `plutil -convert json -o -` per launch-agent plist, which prints
  // the plist to stdout and writes no file. The verb is a dry run; nothing here writes anything at all.
  "src/checkouts/repointReaders.ts": "local-state",
  // Exactly the class above, one worktree over: read-only git probes against a standing session's own
  // checkout (`rev-parse`, `rev-list --count`, `diff --name-only`) plus one `fetch` of an already-configured
  // remote, and a read-only `ps` listing of the local process table. Nothing here writes anything at all —
  // it answers "which commit is that session running", which is a question about this machine.
  "src/live/standing/inspect.ts": "local-state",
  // The cold-seat verdict's three pid-scoped reads of this machine's own process state, taken after the graft:
  // `lsof -p <pids>` for the image behind each shell, `lsof /dev/<tty>` for who holds the tab's tty open, and
  // `ps -o pid=,pgid=,tpgid= -p <pids>` for each prompt shell's group beside its tty's foreground group. Exactly the
  // class above — read-only, nothing leaves the machine; it answers "is this tab a bare shell at its prompt".
  "src/live/standing/coldReads.ts": "local-state",
  // `session respawn loop`'s one record, `$SLOPWEAVER_HOME/live/standing/respawn-pending.json`: a boot removes
  // the earlier respawn's record with one `rmSync` before it writes its own. A file under the state home,
  // never a provider write.
  "src/live/standing/respawnStore.ts": "local-state",
  // `slopweaver machine capacity`'s read seams: `top -l 1`, `sysctl vm.swapusage`, the compressor oids, the
  // local core count and two read-only `ps` listings of this machine's own process table. Exactly the class above — nothing here writes anything or
  // reaches an external provider; it answers "what is this machine's own capacity doing right now".
  "src/live/machine/read.ts": "local-state",
  // `slopweaver machine reap`'s and `slopweaver perf`'s stray-dev-server read: two read-only `ps` listings
  // and one `lsof -a -d cwd` bounded to the pids that already matched `next dev`, all of this machine's own
  // process table. Exactly the class above — it reads nothing but local process state, writes nothing, and
  // reaches no provider; the SIGNAL that ends one lives in `cli/commands/machine/reap.ts`, already listed.
  "src/live/machine/devServerRead.ts": "local-state",
  // `fseventsd-bloated`'s onset capture: one `/usr/bin/log show` over fseventsd's own unified log and one read-only
  // `ps -p` over the client pids it names, written to one file under `$SLOPWEAVER_HOME/live/machine/`. Exactly the
  // class above — local process and log state, nothing reaches a provider.
  "src/monitor/fseventsdOnset/capture.ts": "local-state",
  // One read-only `lsof` over the files local Codex processes hold open, so a run writer's Codex thread can be
  // proven live. Same class as the `lsof` reads in `devServerRead.ts` above; nothing reaches a provider.
  "src/measurement/codexOpenFiles.ts": "local-state",
  // `slopweaver machine series`'s reads: `top -l 2`, two read-only `ps` listings, `sysctl` and `vm_stat`, every one
  // a literal local tool over this machine's own state. It writes only its own ring under `$SLOPWEAVER_HOME`.
  "src/live/machine/seriesRead.ts": "local-state",
  // `claude gauge`'s chair mark: one `lsof` of descriptor 3 and one `ps eww` of each live session in the pinned
  // chair, to read which plan's token or store it booted on. Read-only local process state, the same class.
  "src/claude/seatBootRead.ts": "local-state",
  // `fleet health`'s and `fleet resume`'s one `ps -ax -o pid=,lstart=` listing, binding each registry record to the
  // process that wrote it. Read-only local process state, the same class as the chair mark above.
  "src/fleet/processStarts.ts": "local-state",
  // `fleet recover`'s scratch: `mkdirSync` of one empty directory per throwaway session, and one `rmSync` of the
  // whole scratch once every session in it is proven closed, all under `$SLOPWEAVER_HOME/sessions`, never a symlink
  // or a path outside it. Local state of this machine's own sessions; nothing reaches a provider.
  "src/fleet/recoveryScratch.ts": "local-state",
  // `fleet resume`'s console step: one `docs-site.sh --serve` of the installed checkout, starting the local console
  // server. A local process on this machine, the same class as `checkout sync`'s install below; no provider.
  "src/cli/commands/fleet/resumePassState.ts": "local-state",
  // `slopweaver machine reap`'s own seams: two read-only `ps` listings and one `top -l 2` of this machine's
  // process table, plus `process.kill` on pids the pure plan selected. Same class as the read seams above —
  // nothing reaches an external provider. The signal is the POINT of the verb,
  // and what may be signalled is decided entirely in `live/machine/reap.ts`, which never touches a process.
  "src/cli/commands/machine/reap.ts": "local-state",
  // `slopweaver machine free-disk`'s reads: `lstat`/`realpath`/`readdir` walks of the registry-derived paths,
  // `git rev-parse` inside the pre-setup copy, one `ps -axo pid=,comm=` listing, and the fixed in-VM `docker run
  // --pull never ... df -k /var/lib` and `fstrim [-n] -v /var/lib` argv on the local Docker VM. Local machine state
  // only — no image is pulled and nothing reaches a provider.
  "src/live/machine/freeDisk/read.ts": "local-state",
  // `slopweaver machine free-disk`'s `df -k` of the state home and the read of the owner's ruled bundle list in
  // that home. Nothing reaches a provider.
  "src/cli/commands/machine/freeDisk.ts": "local-state",
  // `machine free-disk`'s two acts, each bound to the inode its plan read: a `renameSync` of a registry-derived
  // directory into a fresh sibling, then its `rmSync`, and one same-volume `renameSync` of a ruled app into
  // `~/.Trash`, each renamed back when the moved object is not the planned one. Local machine state only.
  "src/live/machine/freeDisk/boundAct.ts": "local-state",
  // `machine free-disk before-setup-copy`'s `git rev-parse --show-toplevel` inside the copy, a read that fails
  // closed. Local machine state only.
  "src/live/machine/freeDisk/beforeSetupRead.ts": "local-state",
  // `checkout sync`'s two local effects: `git merge --ff-only` on a main checkout, and `yarn install
  // --immutable` in it. Both are local-environment operations on a checkout the operator declared in their
  // own profile — the same class as `cmux/client.ts` driving a local terminal multiplexer. Nothing here
  // reaches Slack, GitHub or Linear, so there is no external write for the door to govern.
  "src/cli/commands/checkout/syncRun.ts": "local-state",
  // The `yarn install --immutable` `checkout sync` above used to spawn itself, now shared with the
  // post-merge/post-checkout git hooks so there is ONE implementation of it. Same seam, same class, one file
  // over: a local install inside a checkout the caller already stands in, reaching no provider at all.
  "src/checkouts/install.ts": "local-state",
  // `desktop install`'s every effect, gathered behind one injected object: building the app with `yarn`,
  // moving bundles in /Applications, asking `lsregister`, `mdutil` and `open` about this Mac's own app, and
  // SIGTERM to the app's own running copies. All of it is this Mac's local environment, the same class as
  // `checkout sync` above; nothing reaches Slack, GitHub or Linear, so there is no external write for the door.
  "src/cli/commands/desktop/installSeams.ts": "local-state",
  // `desktop e2e`'s folders: the run's proof folder under $SLOPWEAVER_HOME (or `--out`), and the throwaway
  // saved-state folder its test instance runs in, removed when the walk ends. The walk only reads the console;
  // nothing it writes reaches Slack, GitHub or Linear.
  "src/cli/commands/desktop/e2eRun.ts": "local-state",
  // The walk leg, split out of `e2eRun.ts`: the test instance's throwaway saved state.
  "src/cli/commands/desktop/e2eWalkLeg.ts": "local-state",
  // The walk's fixture page: removing exactly the page and freeze folders its own publish wrote under the home. The
  // publish and the store removal go through the publisher and the store; nothing reaches Slack, GitHub or Linear.
  "src/desktop/e2ePageFixtureStore.ts": "local-state",
  // The call leg's six: `/usr/bin/say` rendering the test instance's microphone WAV into a scenario's scratch
  // folder (the reopen scenario's quiet-room and tiled microphones beside it), that scratch folder (and the card
  // inventory's, which places no call) removed when it ends or a signal interrupts it, and a recovered voice window's
  // photograph written into the run's proof folder. The calls themselves go through the console the instance reads;
  // nothing here reaches Slack, GitHub or Linear.
  "src/cli/commands/desktop/e2eCallAudio.ts": "local-state",
  "src/cli/commands/desktop/e2eCallCardInventory.ts": "local-state",
  "src/cli/commands/desktop/e2eCallDriver.ts": "local-state",
  "src/cli/commands/desktop/e2eCallMicrophone.ts": "local-state",
  "src/cli/commands/desktop/e2eCallSignals.ts": "local-state",
  "src/cli/commands/desktop/e2eCallView.ts": "local-state",
  // `transcription-fidelity`'s microphone: macOS `say` lists its installed voices and renders the script, and the
  // rendered WAV is written into the scenario's scratch folder. Nothing leaves this Mac.
  "src/cli/commands/desktop/e2eTranscriptFidelityAudio.ts": "local-state",
  // `desktop e2e`'s on-call hold: one `osascript` asking AVFoundation whether another app holds a microphone, and
  // the console call leases read off this Mac's disk. A read of this Mac's own state; nothing reaches a provider.
  "src/cli/commands/desktop/onCallRead.ts": "local-state",
  // The Codex artifact writer: creates one exclusively-owned directory per pass under $SLOPWEAVER_HOME and
  // renames a temp file into place. Local state only — the model call it records is a READ of the repo, and
  // the artifact never touches the repository (a repo-local one would dirty the diff under review).
  "src/codex/artifactStore.ts": "local-state",
  // The git runner `codex/gitDiff.ts` shells `git` through to compute the review diff. A read-only tool,
  // exactly like the residue scanners: those reads are rev-parse/merge-base/diff/ls-files. The snapshot
  // modules' worktree writes reach it too, each sanctioned as `local-state` on its own row below.
  "src/codex/gitRun.ts": "read-only-tool",
  // The live account read behind `codex status`/`route`/`quota` and `plans sync-accounts`: ONE `spawnSync` of
  // `tclsh` driving each store's own `codex app-server` through `account/read` and `account/rateLimits/read`,
  // two reads that start no model. The same exchange carries the one write, `account/rateLimitResetCredit/
  // consume`, and only `codex reset` sends it, from inside `throughDoor` — so the file is the executor behind
  // a door decision, not a read-only tool. Its local writes are the logic-free program in a `mkdtemp`
  // directory it removes on every path out. It never opens `auth.json` (`docs/security/codex-boundary.md`).
  "src/codex/accountLive.ts": "door-internal",
  // The `codex reset` claims journal: one append-only JSONL under $SLOPWEAVER_HOME/codex-reset, the intent
  // written before the consume exchange and the outcome after. Local state only; it reaches no provider.
  "src/codex/resetJournalStore.ts": "local-state",
  // Its `claude reset` twin under $SLOPWEAVER_HOME/claude-reset: the intent before the claim, the answer or close
  // after. Local state only; it reaches no provider.
  "src/claude/resetJournalStore.ts": "local-state",
  // The review-pass extension register: one append-only JSONL under $SLOPWEAVER_HOME/codex-pass-extensions that
  // the pinned supervisor's `codex extend` writes and the pass-cap gate reads. Local state only; it reaches no provider.
  "src/codex/passExtensionStore.ts": "local-state",
  // The browser door's probe: ONE `spawnSync` of `codex mcp list --json` with the launch's own binary, home
  // and overrides. The listing starts no stdio server and no model. Its network is OAuth-discovery GETs for
  // each enabled REMOTE server — the server and the metadata it names, reads the
  // launch it precedes makes anyway — and its writes are the CLI's own bookkeeping at paths under the Codex home
  // (start-up scratch under `tmp/`, an OAuth lock under `mcp-oauth-locks/`) — the class
  // `codex/accountLive.ts` above has, which also starts a Codex CLI for a read.
  "src/codex/browserProbe.ts": "read-only-tool",
  // The Electron guard's probe: ONE `spawnSync` of `codex sandbox -- /usr/bin/printenv ELECTRON_RUN_AS_NODE` with
  // the pass's own binary, home and overrides. It starts no model, no server and no network call, and the command
  // inside the seatbelt only prints one variable — the same class as `codex/browserProbe.ts` directly above.
  "src/codex/electronProbe.ts": "read-only-tool",
  // `talk offer`'s MCP listing: ONE `spawnSync` of the vendored `codex mcp list --json` under the
  // credential scrub, so the plan call can stub every configured server out of its thread. The same class as
  // `codex/browserProbe.ts` directly above: a listing that starts no stdio server and no model.
  "src/talk/planLaunch.ts": "read-only-tool",
  // `catalog health`'s debt-trend reader. Shells `git log -n 2` and `git show <sha>:<baseline>` against the
  // checkout it already stands in, to learn what a ratchet list held at its previous rebaseline. The same
  // class as `codex/gitRun.ts` directly above: a constant argv, two reads, no writes, no provider.
  "src/cli/commands/catalog/healthDebt.ts": "read-only-tool",
  // `handover row --json`'s pull-request scale. Shells `git log -n 200 --format=%s refs/remotes/origin/HEAD`
  // against the row's own `repo:` checkout. The same class as `codex/gitRun.ts` above: a constant argv, one
  // read, no writes, no provider.
  "src/cli/commands/handover/repoPullScale.ts": "read-only-tool",
  // `handover reconcile`'s trunk-moved hold. Shells `git log` and `git remote get-url` against each ready finding's
  // own `repo:` checkout, its manifests read off disk. The same class as `repoPullScale.ts` above: reads only, no
  // writes, no provider.
  "src/cli/commands/handover/trunkMovedRead.ts": "read-only-tool",
  // `handover wake`'s merge proof before a finish stands in the state home. Shells `git ls-files`, `git status` and
  // `git merge-base --is-ancestor` against the doc's own `repo:` checkout. The same class as `repoPullScale.ts`
  // above: reads only, no writes, no provider.
  "src/cli/commands/handover/wakeMergeProof.ts": "read-only-tool",
  // Reads/writes/clears $SLOPWEAVER_HOME/codex-quota.json — the cached Codex usage-exhaustion backstop
  // `cmux/pickupDelivery.ts`'s post-boot check writes and `cmux spawn`'s pre-boot fast-fail reads. Local state only,
  // same class as `judgement/miningStore.ts` above: nothing here reaches an external provider.
  "src/codex/quotaCache.ts": "local-state",
  "src/codex/snapshot.ts": "local-state",
  // `fresh-cut`'s git runner: argv-only `git` with global and system config off. It reads the source checkout's
  // objects and writes ONLY a new repository on this machine — no remote is added and nothing is pushed, so no
  // provider is reachable from it. Same class as `codex/snapshot.ts` above.
  "src/freshCut/git.ts": "local-state",
  // `fresh-cut produce`'s one `mkdir` of the new repository's directory, outside every checkout.
  "src/freshCut/produce.ts": "local-state",
  // The snapshot POOL beside it: slot directories, lease markers and git worktrees under the OS temp dir, plus
  // one `/bin/ps` read of a holder's start time. The same class as `codex/snapshot.ts` directly above — a
  // local checkout on this machine, never a provider.
  "src/codex/snapshotLease.ts": "local-state",
  "src/codex/snapshotPool.ts": "local-state",
  "src/codex/snapshotSync.ts": "local-state",
  // Removes the Slack draft pass's own empty workspace under the OS temp directory once the pass ends. Local
  // state only: its one model call goes through `codex/client.ts`'s locked client, and it writes no provider.
  "src/codex/slackDraftPass.ts": "local-state",
  // `worktree prune`'s halves. All shell `git` (and `du`/`df`) against local checkouts only — the same
  // class as `cmux/worktree.ts` above, and for the same reason: removing a worktree on this machine is a
  // local checkout operation, and there is no provider on the other side of it to route through the door.
  // `pruneGit.ts` is the scan's git edge, split out of `pruneScan.ts` when that file passed the size ratchet.
  // `salvageScan.ts` reads the blobs a salvage push would send, for the secrets scan that replaces the hook.
  // `reclaimTrash.ts` renames a removed seat's `node_modules` into the checkout's own trash and deletes it there.
  // `pruneRemoved.ts` deletes the build output an unregistered removal left behind at the tree's own path.
  // `pruneDisk.ts` is the scan's `du`. `prunePacing.ts` is every bulk delete's bounded `rm -rf` quanta (and an
  // owner `chmod` per read-only directory on a retry) under `taskpolicy -b`, of a directory the caller already chose.
  // `pruneRefusal.ts` is the removal's and the branch deletion's git write, split out of `pruneApply.ts`.
  "src/worktree/pruneApply.ts": "local-state",
  "src/worktree/pruneRefusal.ts": "local-state",
  "src/worktree/pruneDisk.ts": "local-state",
  "src/worktree/prunePacing.ts": "local-state",
  "src/worktree/pruneRemoved.ts": "local-state",
  "src/worktree/reclaimTrash.ts": "local-state",
  "src/worktree/bulkAside.ts": "local-state",
  "src/worktree/salvageLedger.ts": "local-state",
  "src/worktree/pruneGit.ts": "local-state",
  "src/worktree/pruneScan.ts": "local-state",
  "src/worktree/salvageScan.ts": "local-state",
  // Every bulk delete's fseventsd gauge: one read-only, timeout-bounded `/bin/ps -ax -o pid=,%cpu=,comm=` listing of
  // this machine's own process table. Writes nothing and reaches no provider, the class of `fleet/processStarts.ts`.
  "src/worktree/fseventsdGauge.ts": "local-state",
  // The prune's balloon stand-down: the same class of listing, `/bin/ps -ax -o pid=,rss=,comm=`, read once per apply.
  "src/worktree/fseventsdBalloon.ts": "local-state",
  // The unasked prune's trigger: per-window marker files and a log under $SLOPWEAVER_HOME, and one detached
  // launch of this machine's own `slopweaver worktree prune` or `automation run-due`. No provider is reachable.
  "src/worktree/pruneTriggerLaunch.ts": "local-state",
  "src/worktree/pruneTriggerDetach.ts": "local-state",
  // A page's Codex review repository under $SLOPWEAVER_HOME/page-reviews/<slug>/<id>/: the inputs and the page
  // written as files, two local `git` commits, and the whole directory removed if building it fails. Local
  // machine state exclusively; the review itself is the `codex` SDK's own egress, never this module's.
  "src/pages/reviewRepo.ts": "local-state",
  // `page export`: one published page created as one owner-only file at the absolute path its caller names, never
  // replacing one. Its read is the store's; this module writes that single file on this machine and nothing else.
  "src/cli/commands/page/exportRun.ts": "local-state",
  "src/codex/streamLog.ts": "local-state",
  // Settings → Models' Connect: the attempt records, cancel and sign-in-page markers and the per-provider lock
  // under $SLOPWEAVER_HOME/live/plan-connections, the new store's 0700 directory and its reservation marker, and
  // one detached launch of this machine's own `slopweaver plans connect-worker`. No provider is reachable.
  "src/plans/connectionStore.ts": "local-state",
  "src/plans/connectLaunch.ts": "local-state",
  "src/cli/commands/plans/connectDeps.ts": "local-state",
  // The Connect worker's sign-in: ONE `spawnSync` of `tclsh` holding one store's own `codex app-server` through
  // `account/login/start`, the shape and reasons of `codex/accountLive.ts`. It starts no model and reads no
  // credential — the one the owner's browser sign-in mints lands in that store's `auth.json` through Codex
  // itself. Its local writes are the logic-free program in a `mkdtemp` directory it removes on every path out.
  "src/codex/loginExchange.ts": "local-state",
} as const satisfies Readonly<Record<string, "door-internal" | "local-state" | "read-only-tool">>;
