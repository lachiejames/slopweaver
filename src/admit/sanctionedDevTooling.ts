/**
 * Every development-tooling seam, one row per module.
 *
 * A `dev-tooling` seam is a direct effect whose whole reach is this repository's own checkout and the local
 * binaries that operate on it: a linter spawned synchronously, a `git` read of a commit this clone already
 * has, a `--rebaseline` writing a committed floor file. None of them reaches a provider, starts a session
 * or leaves the machine, which is what keeps them outside the door rather than inside it.
 *
 * Split out of `./sanctionedSeams.ts` along the class that file's own `SeamClass` union already names, and
 * spread straight back into `SANCTIONED_SEAMS` — which stays the one table `./coverage.ts` reads, so a
 * module is still sanctioned in exactly one place. MEASURED: the parent is held at its exact
 * code-line count, and a catalogue that grows by one row per sanctioned module had nowhere to
 * put the next one. Reproduce with `yarn lint --only file-size-ratchet`.
 */

/** The development-tooling rows, keyed by repo-relative path. */
export const DEV_TOOLING_SEAMS = {
  "eval/askProvider.ts": "dev-tooling",
  // Scores an off-repo case file against a corpus home and writes only the `--out` report the caller named.
  // Reaches no provider and touches no corpus.
  "eval/privateArmRun.ts": "dev-tooling",
  "eval/scoreboardRun.ts": "dev-tooling",
  // The turn-level judgement provider (`slopweaver-turn`, run via `yarn eval:turn`) creates and removes its
  // own per-call scratch directory under the OS temp dir — the workspace `productionCodexClient()` requires
  // — and touches nothing else. Same class as `src/__tests__/tempGitRepo.ts` below.
  "eval/turnProvider.ts": "dev-tooling",
  // The ambient-home guard: mints ONE `mkdtempSync` sandbox per test file, empties it after each test, and
  // removes it at the end. It never reads a provider and never touches the real home — its whole purpose is
  // to keep every other test off it. Test support, exactly the class of `tempGitRepo.ts` below.
  "src/__tests__/setup-ambient-home.ts": "dev-tooling",
  // The temp-root sandbox, the ambient-home guard's twin: mints ONE `mkdtempSync` root per test file inside
  // this run's own parent directory, points `$TMPDIR` at it, and removes it when the file ends. It reads no
  // provider and touches nothing but the directories it made itself — its whole purpose is to keep every
  // other test's fixtures off the machine's shared temp directory. Test support, the class of
  // `tempGitRepo.ts` below.
  "src/__tests__/setup-temp-root.ts": "dev-tooling",
  // The run-level half of that sandbox, and the reason its one `rmSync` is safe: the directory it removes is
  // named for the main vitest process's own pid, so it can only ever contain roots this run minted. Same
  // class as `setup-temp-root.ts` above.
  "src/__tests__/global-temp-root.ts": "dev-tooling",
  // Writes a committed replay fixture's redacted state home into a throwaway temp directory the test named,
  // so the real verbs can be pointed at it. Test support, exactly like `tempGitRepo.ts` beside it.
  "src/__tests__/replayFixture.ts": "dev-tooling",
  // Seeds a test file's lazily built template inside its own `mkdtempSync` directory under the per-file temp
  // root, and its one `rmSync` removes only that directory, when the seed throws. Test support, exactly the
  // class of `tempGitRepo.ts` below.
  "src/__tests__/seedTemplate.ts": "dev-tooling",
  // Writes one `stat` shell script into its own `mkdtempSync` temp directory, for a test's PATH to find
  // ahead of the real one, so a shell script's GNU-vs-BSD portability is testable off the CI runner. Test
  // support, exactly the class of `tempGitRepo.ts` below — never reaches a provider, and the only thing it
  // ever writes is a fixture the caller then removes.
  "src/__tests__/statFlavourShim.ts": "dev-tooling",
  "src/__tests__/tempGitRepo.ts": "dev-tooling",
  // The `named-object-params` fixture: the 7.1 compiler server reads files from disk, so each case writes its
  // source to a `mkdtempSync` directory inside the per-file temp sandbox and removes it. Test support, the
  // class of `tempGitRepo.ts` above.
  "src/__tests__/namedObjectParamsFixture.ts": "dev-tooling",
  // A fake cmux control-socket server for the subprocess lane's cmux tests: a Unix socket listening in its
  // own `mkdtempSync` temp directory, removed by its own `close()`. Test support, exactly the class of
  // `tempGitRepo.ts`/`replayFixture.ts` above — never reaches a provider, and its whole existence is to let
  // `socketProtocol.test.ts`/`eventStream.test.ts` talk to something instead of the real cmux app.
  "src/__tests__/subprocess/cmux/fakeCmuxServer.ts": "dev-tooling",
  // Writes one `package.json` carrying this repository's `engines.node` into the fake CLI tree a launcher test
  // already minted, so `bin/slopweaver`'s Node resolution has a floor to hold candidates to. Test support, the
  // class of `statFlavourShim.ts` above — never reaches a provider, and writes only into the caller's fixture.
  "src/__tests__/subprocess/launcherNode.ts": "dev-tooling",
  // Builds the store catch-up tests' fixture checkout — this tree's migrations plus one synthetic one, committed to a
  // throwaway git repo — under the temp root its caller minted. Test support, the class of `tempGitRepo.ts` above.
  "src/__tests__/subprocess/store/catchUpFixture.ts": "dev-tooling",
  // One contender in the operation-lock race test: spawned under tsx, it acquires the lock under a temp
  // home and writes its own outcome line to a file the test hands it. Test fixture, never a provider.
  "src/__tests__/subprocess/admit/operationLockContender.entry.ts": "dev-tooling",
  // One contender in the Slack send-reservation race test, the same shape: it works one slot under a temp
  // home and writes its own outcome line to a file the test hands it. Test fixture, never a provider.
  "src/__tests__/subprocess/outbound/slack/sendReservationContender.entry.ts": "dev-tooling",
  // One contender in the Codex pass-reservation race test, the same shape again: it routes one pass under a temp
  // home and writes its own outcome line to a file the test hands it. Test fixture, never a provider.
  "src/__tests__/subprocess/codex/passReservationContender.entry.ts": "dev-tooling",
  // One contender in the load-slot race test, the same shape: it takes one slot in a temp slot directory and writes
  // its own outcome line to a file the test hands it. Test fixture, never a provider.
  "src/__tests__/subprocess/lib/loadSlotContender.entry.ts": "dev-tooling",
  // The `plugin-mirror-sync.sh` tests' shared harness: `fixture()` mints a throwaway `mkdtempSync` plugin root and
  // records it in `fixtureDirs`, `runOnce()` runs the local script under bash against it, `commitAll()` commits it
  // through `tempGitRepo.ts`'s git door, and the `afterEach` that `useFixtureCleanup()` registers removes every one.
  // Test support, the class of `catchUpFixture.ts` above — it moved here when `pluginMirrorSync.test.ts` was split.
  "src/__tests__/subprocess/scripts/pluginMirrorSync/harness.ts": "dev-tooling",
  // Mints a throwaway `mkdtempSync` root holding a temp home's `plans.json` and one store directory per row, for
  // the reservation tests to route through the real port. Test support, the class of `replayFixture.ts` above.
  "src/__tests__/codexPassReservationFixture.ts": "dev-tooling",
  // The Codex rollout-log reader tests' shared harness: `tempCodexHome()` mints a throwaway `mkdtempSync` Codex home
  // and records it in a private list, and the `afterEach` that `useTempCodexHomes()` registers removes every one,
  // each fixture file calling it once at module scope. Test support, the class of `tempGitRepo.ts` above — it moved
  // here when the reader's one test file was split by behaviour.
  "src/__tests__/unit/codex/quotaLog/harness.ts": "dev-tooling",
  // The landing-floor wiring tests' shared harness: `scratchHome()` mints a throwaway `mkdtempSync` state home and
  // records it in `homes`, and the module-scope `afterEach` removes every one. Test support, the class of
  // `quotaLog/harness.ts` above — it moved here when `landingGateWiring.test.ts` was split by behaviour.
  "src/__tests__/unit/codex/landingGateWiring/harness.ts": "dev-tooling",
  // The review verbs' pre-spend tests' shared fixture: `scratch()` mints a throwaway `mkdtempSync` directory and
  // records it, `scratchRepo()` writes one fixture file into a git checkout beneath one, and `removeScratch()`, each
  // test file's `afterEach`, removes every one. Test support, the class of `landingGateWiring/harness.ts` above —
  // it moved here when `reviewAnnounce.test.ts` and `reviewCapGate.test.ts` came to share it.
  "src/__tests__/unit/cli/commands/codex/fallbackBranchFixture.ts": "dev-tooling",
  // The `codex route` tests' shared harness: `temp()` mints a throwaway `mkdtempSync` directory and records it in a
  // private list, `codexHomeAtWeekly()` and `homeWith()` write only a fixture rollout line and register file beneath
  // one, and the `afterEach` that `useRouteRunHomes()` registers removes every one. Test support, the class of
  // `quotaLog/harness.ts` above — it moved here when `codex/routeRun.test.ts` was split by behaviour.
  "src/__tests__/unit/codex/routeRun/harness.ts": "dev-tooling",
  // The `codex gauge` and `codex signin` tests' shared harness: `emptyCodexHome()` mints a throwaway `mkdtempSync`
  // Codex home and records it in a private list, and the `afterEach` that `useGaugeRunHomes()` registers unsets
  // `CODEX_HOME` and removes every one. Test support, the class of `quotaLog/harness.ts` above — it moved here when
  // the two verbs' one test file was split by describe.
  "src/__tests__/unit/codex/gaugeRun/harness.ts": "dev-tooling",
  // The `codex plugin-sync` tests' synthetic fleet: `makeFleet()` mints a throwaway `mkdtempSync` root holding a
  // copied git checkout, a user home and two empty Codex homes, the seeded template is removed by
  // `disposeTemplate()`, and every write lands under those roots. Test support, the class of
  // `quotaLog/harness.ts` above; no real Codex home is read or written.
  "src/__tests__/unit/codexPlugin/fleetFixture.ts": "dev-tooling",
  // The `scripts/docs-site.sh` cache-root tests' shared harness: `scratch()` mints a throwaway `mkdtempSync`
  // directory and records it in `made`, which each test file's own `afterEach` removes, and `run()` spawns the
  // script against a temp home a test built beneath one. Test support, the class of
  // `quotaLog/harness.ts` above — it moved here when `docsSiteCacheRoot.test.ts` was split by describe.
  "src/__tests__/subprocess/scripts/docsSiteCacheRoot/harness.ts": "dev-tooling",
  // Writes recipe definition files and a run-stamps file into the explicit temp home a test named, so the
  // silent-row reader and the `recipe-stopped` monitor read one shape. Test support, exactly the class of
  // `replayFixture.ts` above — never reaches a provider.
  "src/__tests__/unit/live/automation/recipeHome.ts": "dev-tooling",
  // The `automation run-due` tests' shared harness: mints throwaway `mkdtempSync` homes, writes definition files
  // into them, and removes them in its own `removeHomes()`, which each run-due test file registers with
  // `afterEach`. Test support, the class of `recipeHome.ts` above — it moved here when `runDue.test.ts` was split
  // by behaviour.
  "src/__tests__/unit/cli/commands/automation/runDue/harness.ts": "dev-tooling",
  // The `automation seat` tests' shared harness: mints throwaway `mkdtempSync` homes, writes definition files into
  // them, and removes them in its own `removeHomes()`, which each seat test file registers with `afterEach`. Test
  // support, the class of `recipeHome.ts` above — it moved here when `seat.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/automation/seat/harness.ts": "dev-tooling",
  // The `gmail triage` tests' shared harness: `newHome()` mints one `mkdtempSync` home per case, removed by the
  // `afterEach` that `useHomes()` registers, and every Gmail seam `depsFor()` builds is an in-memory fake that
  // reaches no provider. Test support, the class of `automation/seat/harness.ts` above — it moved here when
  // `gmail/triageRun.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/gmail/triageRun/harness.ts": "dev-tooling",
  // The backup chunk-store tests' shared harness: `scratchDirectory()` mints one `mkdtempSync` directory per use
  // under the test file's temp sandbox, removed by the `afterEach` that `useScratchDirectories()` registers, and its
  // other helpers only build bytes in memory. Test support, the class of `gmail/triageRun/harness.ts` above — it
  // moved here when `store/backupChunks.test.ts` was split by behaviour.
  "src/__tests__/unit/store/backupChunks/harness.ts": "dev-tooling",
  // A fake `handover register` that writes the finding's doc into the explicit temp home a test named, so the
  // board read sees a row the way the real registrar leaves one. Test support, the class of `recipeHome.ts` above.
  "src/__tests__/registeredRowFake.ts": "dev-tooling",
  // The `github attach` run tests' harness: a throwaway `mkdtempSync` home per case, a zero-filled fixture file of
  // the size a case names, and an `afterEach` that removes both. Test support, the class of `registeredRowFake.ts`.
  "src/__tests__/attachRunFixture.ts": "dev-tooling",
  // The serving-checkout tests' fixture: one throwaway `mkdtempSync` git checkout per case, its one source file and
  // the `dist-cli` build manifest stamped from it, removed by the caller's `afterEach`. The class of `attachRunFixture.ts`.
  "src/__tests__/builtCheckoutFixture.ts": "dev-tooling",
  // The `profile words` verb-body tests' shared harness: `useWordsHomes()` mints one throwaway `mkdtempSync` state
  // home and one Claude home per case in a `beforeEach`, writes only a fixture chain link, pin record, empty chair
  // transcript and staged console turns beneath them, and removes both in the `afterEach` it registers. Test
  // support, the class of `registeredRowFake.ts` above — it moved here when the verb body's one test file was split.
  "src/__tests__/unit/cli/commands/profile/wordsRun/harness.ts": "dev-tooling",
  // The `proposal` register verb-body tests' shared harness: `tempHome()` mints one throwaway `mkdtempSync` state
  // home per use, writes only fixture register events beneath it, and every home it recorded is removed by the
  // `afterEach` that `useRegisterHomes()` registers. Test support, the class of `profile/wordsRun/harness.ts`
  // above — it moved here when `proposal/registerRun.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/proposal/registerRun/harness.ts": "dev-tooling",
  // The throwaway `mkdtempSync` home `sweep board`'s end-to-end tests share: board rows written into it and
  // the whole home removed by its own `removeHomes()`. Test support, the class of `recipeHome.ts` above.
  "src/__tests__/unit/sweep/boardRunFixture.ts": "dev-tooling",
  // Makes a throwaway `mkdtempSync` home with a `claude-accounts` directory, writes the accounts file the
  // spawn-store tests read into it, and removes it after. Test support, the class of `recipeHome.ts` above.
  "src/__tests__/unit/claude/spawnStoreFixtures.ts": "dev-tooling",
  // The salvage secrets-scan tests' shared harness: `useSalvageRepos()` mints a throwaway `mkdtempSync` destination
  // and working repository per case in a `beforeEach`, runs git in them through `gitInTemp`, `commit` writes the file
  // each case names under the working repository, every caller passing a plain file name, and both are removed in the
  // `afterEach` it registers. Test support, the
  // class of `tempGitRepo.ts` above — it moved here when
  // `worktree/salvageScan.test.ts` was split by behaviour.
  "src/__tests__/unit/worktree/salvageScan/harness.ts": "dev-tooling",
  // The worktree-reclaim tests' shared harness: `useReclaimDir()` mints a throwaway `mkdtempSync` directory per case in
  // a `beforeEach` and removes it in the `afterEach` it registers, and `seedRepo` writes a fixture repository beneath
  // it through `gitInTemp`. Test support, the class of `salvageScan/harness.ts` above — it moved here when the prune
  // reclaim tests were split by behaviour.
  "src/__tests__/unit/worktree/pruneReclaim/harness.ts": "dev-tooling",
  // The trash-reclaim tests' shared fixtures: `DELETE_NOW` is the delete seam those cases inject in place of the
  // governed delete, removing a throwaway directory the case minted under its own `mkdtempSync` root. Test support,
  // the class of `pruneReclaim/harness.ts` above — it moved here when `worktree/reclaimTrash.test.ts` was split.
  "src/__tests__/unit/worktree/reclaimTrashFixtures.ts": "dev-tooling",
  // The console-build reader tests' shared harness: `useConsoleBuildRoots()` mints a throwaway `mkdtempSync` checkout
  // root and cache root per case in a `beforeEach` and removes both in the `afterEach` it registers, and every seam
  // `read()` hands the reader is an in-memory fake over a plain `World`. Test support, the class of
  // `pruneReclaim/harness.ts` above — it moved here when `checkouts/consoleBuildRead.test.ts` was split by behaviour.
  "src/__tests__/unit/checkouts/consoleBuildRead/harness.ts": "dev-tooling",
  // The as-me drip shell tests' shared harness: mints throwaway `mkdtempSync` homes and removes them in its own
  // `removeFixtureDirs()`, which each drip test file registers with `afterEach`. Test support, the class of
  // `boardRunFixture.ts` above — it moved here, unchanged, when `dripShell.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/slack/dripShell/harness.ts": "dev-tooling",
  // The `--as bot` card-lane tests' shared harness: mints throwaway `mkdtempSync` homes and removes them in its own
  // `removeFixtureDirs()`, which each card-lane test file registers with `afterEach`. Test support, the class of
  // `dripShell/harness.ts` above — it moved here when `slack/run.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/slack/run/harness.ts": "dev-tooling",
  // The Slack wiring tests' shared harness: `freshHome()` mints one `mkdtempSync` home per case, removed by the
  // `afterEach` that `useFreshHomes()` registers, which deletes only the homes it recorded, and it writes the derived
  // roster only beneath that home and reaches no provider. Test support, the class of `slack/run/harness.ts` above —
  // it moved here when `slack/wiring.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/slack/wiring/harness.ts": "dev-tooling",
  // The `linear issue` command tests' shared harness: `tempHome()` mints one throwaway `mkdtempSync` home per case
  // and records it in a private list, removed by the `afterEach` that `useTempHomeCleanup()` registers, and every
  // Linear seam `harness()` builds is an in-memory fake that reaches no provider; the verb writes its issue ledger
  // only beneath that home. Test support, the class of `slack/run/harness.ts` above — it moved here when
  // `linear/run.test.ts` was split by describe.
  "src/__tests__/unit/cli/commands/linear/run/harness.ts": "dev-tooling",
  // The supervisor chain read tests' shared harness: writes chain journals, pins and Claude transcripts beneath one
  // throwaway scratch root under `tmpdir()`, and removes that root in `cleanScratch()`, which each chain test file
  // registers with `afterEach`; it reaches no provider. Test support, the class of `slack/run/harness.ts` above — it
  // moved here when `supervisor/chainRead.test.ts` was split by describe.
  "src/__tests__/unit/supervisor/chainReadHarness.ts": "dev-tooling",
  // The `turn dispatch` tests' shared harness: mints throwaway `mkdtempSync` homes, writes a brief, a decision and
  // a responders file into them, and removes them in its own `removeFixtureDirs()`, which each dispatch test file
  // registers with `afterEach`. Test support, the class of `slack/run/harness.ts` above — it moved here when
  // `turn/dispatch.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/turn/dispatch/harness.ts": "dev-tooling",
  // The `turn resume` tests' shared harness: mints throwaway `mkdtempSync` homes, writes a brief, an ask lifecycle
  // and a dispatch record into them, and registers each in `turn/dispatch/harness.ts`'s `fixtureDirs`, whose
  // `removeFixtureDirs()` each resume test file registers with `afterEach`. Test support, the class of the row
  // above — it moved here when `turn/resume.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/turn/resume/harness.ts": "dev-tooling",
  // The `turn answer` tests' shared harness: holds the throwaway `mkdtempSync` homes each test file mints in its own
  // `fixtureDirs`, and removes them in `removeFixtureDirs()`, which each such file registers with `afterEach`. Test
  // support, the class of `turn/dispatch/harness.ts` above — it moved here when the `turn answer` tests were split
  // by behaviour.
  "src/__tests__/unit/cli/commands/turn/run/harness.ts": "dev-tooling",
  // The `handover wake` tests' shared harness: mints a throwaway `mkdtempSync` home per case, writes board docs and
  // run journals only beneath it, and registers it in `turn/dispatch/harness.ts`'s `fixtureDirs`, whose
  // `removeFixtureDirs()` each wake test file registers with `afterEach`. Test support, the class of the `turn
  // resume` row above — it moved here when `handover/wakeRun.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/handover/wakeRun/harness.ts": "dev-tooling",
  // The `github enqueue` tests' shared harness: mints throwaway `mkdtempSync` homes and removes them in its own
  // `removeHomes()`, which each enqueue test file registers with `afterEach`. Test support, the class of
  // `dripShell/harness.ts` above — it moved here when `enqueueRun.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/github/enqueueRun/harness.ts": "dev-tooling",
  // The `github stack adopt --register-only` tests' shared harness: `tempHome()` mints one `mkdtempSync` home per
  // case, removed by the `afterEach` that `useTempHomes()` registers, and `harness()`'s `registerMember` writes the
  // real stack ledger into that home and nowhere else. Test support, the class of `enqueueRun/harness.ts` above —
  // it moved here when `stackAdoptRegistrationRun.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/github/stackAdoptRegistrationRun/harness.ts": "dev-tooling",
  // The `github stack push` run tests' shared harness: `tempHome()` mints one `mkdtempSync` home per case, removed by
  // the `afterEach` that `useTempHomes()` registers, and every Git and API edge `harness()` builds is a fake. Test
  // support, the class of `stackAdoptRegistrationRun/harness.ts` above — it moved here when `stackPushRun.test.ts`
  // was split by behaviour.
  "src/__tests__/unit/cli/commands/github/stackPushRun/harness.ts": "dev-tooling",
  // The `github push` run tests' shared harness: each case mints its own `mkdtempSync` home and pushes it onto
  // `fixtureDirs`, the `afterEach` that `useFixtureDirCleanup()` registers removes every one, and every Git, hold,
  // queue and door edge `harness()` builds is a recording fake. Test support, the class of `stackPushRun/harness.ts`
  // above — it moved here when `pushRun.test.ts` was split by describe.
  "src/__tests__/unit/cli/commands/github/pushRun/harness.ts": "dev-tooling",
  // The `gmail draft`/`gmail send` shell tests' shared harness: `withHome()` mints one `mkdtempSync` home per case
  // and removes that same home in its own `finally`, and every Gmail and door edge `depsFor()` builds is an in-memory
  // fake that reaches no provider. Test support, the class of `stackPushRun/harness.ts` above — it moved here when
  // `gmail/composeRun.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/gmail/composeRun/harness.ts": "dev-tooling",
  // The `notion page` run tests' shared harness: `tempHome()` mints one throwaway `mkdtempSync` home per use,
  // removed by the `afterEach` that `useTempHomes()` registers, and every Notion and door edge `harness()` builds is
  // an in-memory fake that reaches no provider. Test support, the class of `stackPushRun/harness.ts` above — it
  // moved here when `notion/pageRun.test.ts` was split by describe.
  "src/__tests__/unit/cli/commands/notion/pageRun/harness.ts": "dev-tooling",
  // The `refresh --source chatgpt` tests' shared harness: `tempDir()` mints one `mkdtempSync` directory per use,
  // removed by the `afterEach` that `useTempDirs()` registers, and `storedOf`/`takeAt` write only hand-built
  // synthetic export files into those directories. Test support, the class of `stackAdoptRegistrationRun/harness.ts`
  // above — it moved here when the chatgpt `ingest.test.ts` was split by behaviour.
  "src/__tests__/unit/corpus/chatgpt/ingest/harness.ts": "dev-tooling",
  // The chatgpt export-store tests' shared harness: `tempDir()` mints one `mkdtempSync` directory per use under the
  // test file's temp sandbox, removed by the `afterEach` that `useTempDirs()` registers, and `fakeZip` copies only
  // synthetic export files into those directories. Test support, the class of `ingest/harness.ts` above — it moved
  // here when the chatgpt `exportStore.test.ts` was split by behaviour.
  "src/__tests__/unit/corpus/chatgpt/exportStore/harness.ts": "dev-tooling",
  // The corpus compaction tests' shared harness: mints one `mkdtempSync` home per case, removed by the `afterEach`
  // that `useCompactHome()` registers, and writes only synthetic bronze window files into it. Test support, the
  // class of `exportStore/harness.ts` above — it moved here when compaction's one test file was split by behaviour.
  "src/__tests__/unit/corpus/compact/harness.ts": "dev-tooling",
  // The Cloudflare atlas sync tests' shared harness: mints throwaway `mkdtempSync` state homes and removes them
  // in its own `removeFixtureHomes()`, which each sync test file registers with `afterEach`. Test support, the
  // class of `dripShell/harness.ts` above — it moved here, unchanged in effect, when `sync.test.ts` was split.
  "src/__tests__/unit/atlas/cloudflare/sync/harness.ts": "dev-tooling",
  // The throwaway `mkdtempSync` home `session close-done`'s tests share: its session ledger and run journals
  // written into it, removed by `removeFixtureDirs`. Its `spawnedRow` records a ledger row and launches nothing. Test
  // support, the class of `recipeHome.ts` above.
  "src/__tests__/unit/cli/commands/session/closeDoneHarness.ts": "dev-tooling",
  // A parked run built in that same harness home through its `spawnedRow` ledger helper. Test support, as above.
  "src/__tests__/unit/cli/commands/session/closeDoneParkFixture.ts": "dev-tooling",
  // The `parseAnswerArm` tests' shared harness: `envGranting()` and `envWithoutGrant()` mint one `mkdtempSync` home
  // per use, the first writing one hatch grant under it and the second nothing, removed by the `afterEach` that
  // `useHomes()` registers. Test support, the class of `closeDoneHarness.ts` above — it moved here when
  // `outbound/assistant/parseAnswerArm.test.ts` was split by behaviour.
  "src/__tests__/unit/outbound/assistant/parseAnswerArm/harness.ts": "dev-tooling",
  // The `supervisor tick` tests' per-case temp directory: `useWorkdir()` mints a throwaway `mkdtempSync` directory
  // under the per-file temp root in a `beforeEach` and removes it in the `afterEach` it registers. Test support, the
  // class of `dripShell/harness.ts` above — it moved here when `tick.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/supervisor/tick/workdir.ts": "dev-tooling",
  // The card-landing tests' shared harness: `useCardLandHome()` mints one throwaway `mkdtempSync` state home per
  // case in a `beforeEach`, writes only fixture state under it (a landing reading, a staged ask), and removes it in
  // the `afterEach` it registers. Test support, the class of `workdir.ts` above — it moved here when
  // `cardLandApply.test.ts` was split by behaviour.
  "src/__tests__/unit/talk/cardLandApply/harness.ts": "dev-tooling",
  // The live turn poster tests' shared harness: `usePosterHome()` mints one throwaway `mkdtempSync` home per case in
  // a `beforeEach` and removes it in the `afterEach` it registers; its fake transport reaches no provider. Test
  // support, the class of `cardLandApply/harness.ts` above — it moved here when `poster.test.ts` was split by
  // behaviour.
  "src/__tests__/unit/live/turn/poster/harness.ts": "dev-tooling",
  // The lifecycle-reaction convergence tests' shared harness: `tempHome()` mints one throwaway `mkdtempSync` home per
  // case, removed by the `afterEach` that `useTempHomes()` registers, which deletes only the homes it recorded. Test
  // support, the class of `poster/harness.ts` above — it moved here when its one test file was split by behaviour.
  "src/__tests__/unit/live/turn/convergesLifecycleReact/harness.ts": "dev-tooling",
  // The Slack send-reservation tests' shared harness: `useSendReservationHome()` mints one throwaway `mkdtempSync`
  // home per case in a `beforeEach` and removes it in the `afterEach` it registers, and `seedSlot` writes only a
  // fixture slot record beneath that home. Test support, the class of `poster/harness.ts` above — it moved here when
  // `outbound/slack/sendReservation.test.ts` was split by behaviour.
  "src/__tests__/unit/outbound/slack/sendReservation/harness.ts": "dev-tooling",
  // The owned-delete tests' shared harness: `freshHome()` mints one throwaway `mkdtempSync` home per case, removed by
  // the `afterEach` that `useFreshHomes()` registers, and its fake transport reaches no provider. Test support, the
  // class of `sendReservation/harness.ts` above — it moved here when `deleteOwnedMessage`'s test file was split.
  "src/__tests__/unit/outbound/slack/deleteOwnedMessage/harness.ts": "dev-tooling",
  // The `readSlackThread` tests' shared harness: `tempRoot()` mints one `mkdtempSync` files root per read under the
  // test file's temp sandbox, removed by the `afterEach` that `useTempRoots()` registers, and its recording
  // downloader writes a stub file into that root and nothing else. Test support, the class of `poster/harness.ts`
  // above — it moved here when `live/slack/readThread.test.ts` was split by behaviour.
  "src/__tests__/unit/live/slack/readThread/harness.ts": "dev-tooling",
  // The same tests' shared harness: writes the seat's fixture files and the fake child's captures into the directory
  // `workdir.ts` minted, and nothing else; the directory is removed with the rest of the case's temp root.
  "src/__tests__/unit/cli/commands/supervisor/tick/harness.ts": "dev-tooling",
  // The supervisor-scratch verb tests' shared fake child launcher: writes a fake child's stdout and stderr to the
  // capture paths the verb under test handed it, inside that case's own temp root, and nothing else. Test support.
  "src/__tests__/unit/cli/commands/supervisor/scratchFakes.ts": "dev-tooling",
  // Writes the heavy `earlierToday` form the byte-cap cases render into the seat directory that harness minted, and
  // nothing else; the directory is removed with the rest of the case's temp root. Test support, the class of the
  // harness above.
  "src/__tests__/unit/cli/commands/supervisor/tick/renderSeams.ts": "dev-tooling",
  // The `hand` verb tests' shared harness: `freshHand()` mints a throwaway `mkdtempSync` home in each test file's
  // `beforeEach`, removed by that file's `afterEach`, and `stampAtNow` sets a liveness file's time inside it. Test
  // support, the class of `supervisor/tick/workdir.ts` above — it moved here when `verbs.test.ts` was split.
  "src/__tests__/unit/cli/commands/hand/verbs/harness.ts": "dev-tooling",
  // The `readSlackThreads` tests' shared fixtures: `home()` mints one throwaway `mkdtempSync` state home per case,
  // writes only a fixture Slack bronze window, members index and profile beneath it, and registers it in `homes`,
  // which each test file empties in its own `afterEach`. Test support, the class of `hand/verbs/harness.ts` above —
  // it moved here when `sessionStart/slackRead.test.ts` was split by behaviour.
  "src/__tests__/unit/sessionStart/slackRead/fixtures.ts": "dev-tooling",
  // The `profile words` tests' shared harness: `temp()` mints one `mkdtempSync` state or Claude home per use,
  // removed by the `afterEach` that `useTempDirs()` registers, and `seat`/`claudeHomeWith` write only a fixture
  // chain journal, pin record and transcripts beneath those homes. Test support, the class of
  // `sessionStart/slackRead/fixtures.ts` above — it moved here when `profile/supervisorWords.test.ts` was split.
  "src/__tests__/unit/profile/supervisorWords/harness.ts": "dev-tooling",
  // The voice-measure read and write tests' shared fixture: `voiceHome()` mints one throwaway `mkdtempSync` home per
  // case, writes only a fixture profile and Slack bronze beneath it, and records it for `removeVoiceHomes()`, which
  // each test file calls from its `afterEach` and which deletes only directories it recorded. Test support, the class
  // of `profile/supervisorWords/harness.ts` above.
  "src/__tests__/unit/profile/voiceMeasureFixture.ts": "dev-tooling",
  // The operation-lock tests' shared harness: `home()` mints one throwaway `mkdtempSync` home per case, removed by
  // the `afterEach` that `useTempDirs()` registers, which deletes only directories it recorded, and
  // `lockDirIn`/`lockFileIn` only read the lock a real acquire left beneath one. Test support, the class of
  // `profile/supervisorWords/harness.ts` above — it moved here when `admit/operationLock.test.ts` was split.
  "src/__tests__/unit/admit/operationLock/harness.ts": "dev-tooling",
  // The `applyRowEvent` round-trip tests' shared harness: `runsDir()` mints one `mkdtempSync` runs directory per use,
  // removed by the `afterEach` that `useRunsDirs()` registers, and `seed` writes only a synthetic run journal beneath
  // it. Test support, the class of `profile/supervisorWords/harness.ts` above — it moved here when
  // `handover/rowEvent.test.ts` was split by behaviour.
  "src/__tests__/unit/handover/rowEvent/harness.ts": "dev-tooling",
  // The GitHub read-seam tests' shared harness: `scratchHome()` mints one `mkdtempSync` state home per case,
  // removed by the `afterEach` that `useScratchHomes()` registers, which deletes only the homes it recorded, and
  // `publishClean` writes only a synthetic generation beneath a home passed explicitly. Test support, the class of
  // `profile/supervisorWords/harness.ts` above — it moved here when `atlas/github/readAdapter.test.ts` was split.
  "src/__tests__/unit/atlas/github/readAdapter/harness.ts": "dev-tooling",
  // The WorkOS sync round-trip tests' shared harness: `tempHome()` mints one `mkdtempSync` state home per case,
  // removed by the `afterEach` that `useTempHomes()` registers, which deletes only the homes it recorded, and its
  // fake transports reach no provider. Test support, the class of `profile/supervisorWords/harness.ts` above — it
  // moved here when `atlas/workos/syncRoundTrip.test.ts` was split by behaviour.
  "src/__tests__/unit/atlas/workos/syncRoundTrip/harness.ts": "dev-tooling",
  // The CrowdStrike read-seam tests' shared harness: `scratchHome()` mints one `mkdtempSync` state home per case,
  // removed by the `afterEach` that `useScratchHomes()` registers, which deletes only the homes it recorded, and
  // `publishClean` writes only a synthetic generation beneath a home passed explicitly. Test support, the class of
  // `profile/supervisorWords/harness.ts` above — it moved here when `atlas/crowdstrike/readAdapter.test.ts` was split.
  "src/__tests__/unit/atlas/crowdstrike/readAdapter/harness.ts": "dev-tooling",
  // The drip-sequence tests' shared harness: `freshHome()` mints one `mkdtempSync` home per case, removed by the
  // `afterEach` that `useFreshHomes()` registers, which deletes only the homes it recorded, and its recording send
  // seam reaches no provider. Test support, the class of `profile/supervisorWords/harness.ts` above — it moved here
  // when `slack/dripSequence.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/slack/dripSequence/harness.ts": "dev-tooling",
  // The high-stakes gate tests' shared harness: `freshHome()` mints one `mkdtempSync` home per case, removed by the
  // `afterEach` that `useFreshHomes()` registers, which deletes only the homes it recorded, and its fake deps record
  // every read and claim into lists and reach no provider. Test support, the class of
  // `profile/supervisorWords/harness.ts` above — it moved here when `slack/highStakesGate.test.ts` was split.
  "src/__tests__/unit/cli/commands/slack/highStakesGate/harness.ts": "dev-tooling",
  // The `cmux revive` tests' shared harness: `freshHome()` mints one `mkdtempSync` home per case, removed by the
  // `afterEach` that `useFreshHomes()` registers, which deletes only the homes it recorded, and its fake process
  // table, knock and restart reach no real cmux. Test support, the class of `profile/supervisorWords/harness.ts`
  // above — it moved here when `cmux/revive.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/commands/cmux/revive/harness.ts": "dev-tooling",
  // The workstreams candidate verbs' shared harness: `scratch()` mints one `mkdtempSync` home per case, removed by
  // `cleanupScratch()` from each suite's `afterEach`, and its one `writeFileSync` is a `candidates-put` input file
  // inside that home. Test support, the class of `profile/supervisorWords/harness.ts` above — it moved here when
  // `workstreamsCandidatesVerbs.test.ts` was split by behaviour.
  "src/__tests__/unit/cli/workstreamsCandidatesVerbsHarness.ts": "dev-tooling",
  // `turn freeze` writes ONE caller-named `--out` directory and nothing else: a redacted copy of an ask's
  // own record set, read out of $SLOPWEAVER_HOME and written wherever the operator asked. No external
  // surface is touched, and the destination is an argument rather than a discovered path — the same class
  // as `eval/privateArmRun.ts`'s `--out` report below.
  "src/cli/commands/turn/freeze.ts": "dev-tooling",
  // The profiler. `dev-tooling`, the same class as the gates it profiles: it spawns one gate, test lane or
  // `slopweaver` verb under V8's own `--cpu-prof`/`--heap-prof` — a LOCAL process, with the subject taken
  // from `dev lint`'s own registry or from an argv the operator typed, never from a provider. The
  // `mkdtempSync` profile directory is removed by a `finally` that names nothing a caller passed, and the
  // one `writeFileSync` is `.baselines/perf-baseline.json`, a committed repo-tree edit under `--record`
  // rather than a runtime effect — the same shape as the four `--rebaseline` ratchets below.
  "src/cli/commands/dev/profile.ts": "dev-tooling",
  // The CLI emit. `dev-tooling`, the same class as the profiler above it: a `git ls-files` READ of this
  // checkout, one spawn of the local `node_modules/.bin/esbuild`, one `writeFileSync` of the re-rooted
  // manifest into the caller-named `--out` directory, and one spawn of `node` on the entrypoint it just
  // emitted to prove the module graph resolves. Every one of the four is this repository and the binaries
  // that operate on it — no provider, no session, nothing under `$SLOPWEAVER_HOME`.
  "src/cli/commands/dev/build.ts": "dev-tooling",
  // `github lap`'s edges: a `git fetch` of the base and the pull request's head into refs the lap owns, a
  // detached `git worktree` of that head, a throwaway `postgres:17` container, the CI lanes themselves as
  // children in that worktree, and logs and a receipt under `$SLOPWEAVER_HOME/laps/`. The one provider write
  // the lap makes itself — the commit statuses — goes through `throughDoor` in `lapPhases.ts`, never from here.
  "src/cli/commands/github/lapShell.ts": "dev-tooling",
  // The CI lanes themselves, each a synchronous child in its own process group in the lap's worktree, its output
  // in its own log file under `$SLOPWEAVER_HOME/laps/`. Moved out of `lapShell.ts`, no provider.
  "src/cli/commands/github/lapStepProcess.ts": "dev-tooling",
  // The lap's spawns of the `slopweaver` hold, merge and release verbs, under one ceiling, each doored on its own.
  "src/cli/commands/github/lapVerb.ts": "dev-tooling",
  // The machine's one lap lock: a file under `$SLOPWEAVER_HOME/laps/`, created exclusively and removed only by
  // the lap whose nonce it carries. Local state, no provider.
  "src/cli/commands/github/lapLock.ts": "dev-tooling",
  // The lap seat: `$SLOPWEAVER_HOME/laps/seat.json`, written atomically by `github lap-seat set` and removed by
  // `clear`, naming the one run whose session may lap. Local state, no provider.
  "src/cli/commands/github/lapSeatStore.ts": "dev-tooling",
  // How the lap's own short commands run — `git fetch`/`worktree`/`diff` and `docker` — without a shell, in the
  // seat's environment less every `GIT_*` variable and every open hatch. No provider write.
  "src/cli/commands/github/lapProcess.ts": "dev-tooling",
  // A batch lap's simulated squash: one `git merge-tree --write-tree` read raw, because its conflicted exit 1
  // still carries the tree and paths `runLapCommand` would discard. Local objects only, never pushed.
  "src/cli/commands/github/lapBatchShell.ts": "dev-tooling",
  // The lap's throwaway `postgres:17` container on an ephemeral local port, labelled so the next lap removes an
  // orphan. Local state, no provider.
  "src/cli/commands/github/lapStore.ts": "dev-tooling",
  // The lap's detached checkout: a `git worktree add` of the head under the cache root's `lap-trees.noindex`, and
  // its removal, directory and registration both. This repository's own objects, no provider.
  "src/cli/commands/github/lapTree.ts": "dev-tooling",

  // The source list both halves of that emit read: one `git ls-files -z src` of this checkout, and a
  // `statSync` per listed file. It is the same class as the emit above it and exists as its own module
  // because the BUILT tree's staleness guard has to compute the identical list — a second copy is how the
  // guard and the emit would disagree about which files matter.
  "src/builtCli/sourceScan.ts": "dev-tooling",
  // `perf console`'s launcher floor: one spawn of this checkout's own `bin/slopweaver perf console --help`, quiet,
  // to time the launcher's start-up. No provider, no session, nothing it writes — the verb keeps the report itself.
  "src/consoleProfile/verbTiming.ts": "dev-tooling",

  // The build manifest's own lifecycle: one `rmSync` of `<out>/.slopweaver-build.json` before an emit and
  // one `writeFileSync` of it after a build that ran. Both are inside the caller's `--out` directory,
  // which the verb already refuses to place outside this checkout. Same class as the emit that calls it.
  "src/builtCli/stamp.ts": "dev-tooling",
  // The `post-merge`/`post-checkout` rebuild: one spawn of this checkout's own `node_modules/.bin/tsx` on
  // `src/cli/index.ts dev build`, taken only when a ref move changed a file the build reads. The launcher
  // is deliberately NOT what it spawns — the launcher routes to the built tree, which is the stale artifact
  // this is replacing. Same class as `src/checkouts/install.ts`'s `yarn install --immutable` beside it.
  "src/checkouts/refMoveBuildRun.ts": "dev-tooling",
  "src/devLint/agentDocSize.ts": "dev-tooling",
  "src/devLint/coverageRatchet.ts": "dev-tooling",
  // The worker thread `gateRunner.ts` runs one gate on: a single `spawnSync` of a local linter, joined
  // before the lap returns. `devLint.ts` itself no longer spawns anything and so no longer has a row here.
  // The reason this file exists at all is that the sync spawn is the one AGENTS.md rule 2 permits — see the
  // module's own header.
  "src/devLint/gateWorker.ts": "dev-tooling",
  // The drift half of the drizzle-migrations gate: copies `supabase/migrations` into a directory it made
  // itself with `mkdtempSync`, runs `drizzle-kit generate` into that copy, and the one `rmSync` removes
  // that copy and nothing a caller named. It reaches no database and touches nothing committed.
  "src/devLint/drizzleMigrationsRun.ts": "dev-tooling",
  // The duplicate-windows (clone) ratchet. `dev-tooling`, same as coverageRatchet.ts above it: `--rebaseline`
  // writes the committed floor file, a repo-tree edit rather than a runtime effect.
  "src/devLint/duplicateWindows.ts": "dev-tooling",
  // The file-size ratchet. `dev-tooling`, same as duplicateWindows.ts above it: `--rebaseline` writes the
  // committed floor file, a repo-tree edit rather than a runtime effect.
  "src/devLint/fileSizeRatchet.ts": "dev-tooling",
  // The base-commit reader both diff gates share. `dev-tooling`: it shells the LOCAL `git` binary for
  // `cat-file`, `show` and `diff` against a commit this repository already has. Reads only, starts no
  // session, and reaches no external boundary.
  "src/devLint/gitAtCommit.ts": "dev-tooling",
  // The help/flag opt-out gate. `dev-tooling`, same as its three siblings above: `--prune` writes the
  // committed offender list, a repo-tree edit rather than a runtime effect.
  "src/devLint/helpFlagOptOut.ts": "dev-tooling",
  // The @internal-exports ratchet. `dev-tooling`: shells out to the LOCAL `knip` binary (a dev tool, not an
  // external boundary) and `--rebaseline` writes the committed floor file, same as its two siblings above.
  "src/devLint/internalExports.ts": "dev-tooling",
  // The no-silent-fallback gate. Reads tracked sources and writes exactly one committed file,
  // its own `--rebaseline` debt list under `.baselines/` — the same dev-tooling shape `fileSizeRatchet.ts`
  // carries above, never a provider and never anything under `$SLOPWEAVER_HOME`.
  "src/devLint/noSilentFallback.ts": "dev-tooling",
  // The error-shape-threshold gate. The same shape again: sources in, one
  // committed `--rebaseline` debt list under `.baselines/` out, never a provider and never `$SLOPWEAVER_HOME`.
  "src/devLint/errorShapeThreshold.ts": "dev-tooling",
  // The naming-doctrine gate's vocabulary half (rule 11). The same shape: sources in, one committed
  // `--rebaseline` debt list under `.baselines/` out, never a provider and never `$SLOPWEAVER_HOME`.
  "src/devLint/namingDoctrineRun.ts": "dev-tooling",
  // The shared debt-list ratchet both of those gates and unnamed-failure-assertion
  // now run on. The write is the same one they each used to carry: one committed `--rebaseline` debt list
  // under `.baselines/`, named by the gate that asked, never a provider and never `$SLOPWEAVER_HOME`.
  "src/devLint/countRatchet.ts": "dev-tooling",
  // The named-object-params decision stream (TypeScript 7.1 flip acceptance). Both remove only the stream file
  // a caller NAMED for this run, outside the subject it judges: one clears an earlier run's file before the
  // scan, the other a stream written over types that then fail to compile. Never `$SLOPWEAVER_HOME`.
  "src/devLint/namedObjectParamsOracle.ts": "dev-tooling",
  "src/devLint/namedObjectParamsProgram.ts": "dev-tooling",
  "src/devLint/untestedModules.ts": "dev-tooling",
  "src/handover/commandProbe.ts": "dev-tooling",
} as const satisfies Readonly<Record<string, "dev-tooling">>;
