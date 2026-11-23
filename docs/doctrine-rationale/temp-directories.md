# The temp-directory backlog

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The full measurement behind `testing.md` § Temp-dir fixtures live in a per-file sandbox, moved here so the
always-on rule carries the rule and this carries the evidence.

MEASURED: the shared temp directory held **758,840** stale `slopweaver-*` directories, enough that a
plain `readdirSync` over it timed out and reddened `stagingDirCount()` in
`src/__tests__/subprocess/codex/snapshot.test.ts` for every session on the machine. At the count that forced
the sandbox it held **1,409,874** entries, and one `os.scandir` over it took **309.9
seconds**, blocking `slopweaver github push` outright through three unrelated 30-second timeouts, while the
same files against a clean `TMPDIR` passed in **19.33s**.

Every `mkdtempSync` call in the suites had been asked, in prose, to clean up after itself — count how many
that is with `grep -rc "mkdtempSync" src --include="*.ts" | grep __tests__`. **The prose is what produced the
backlog**, which is the whole argument for `setup-temp-root.ts` and the `globalSetup` sweep being mechanisms
rather than a convention.

**Why the run-level sweep lives in the MAIN process, and what the pid in the root's name buys.** MEASURED
while building `global-temp-root.ts`: a file whose tests are ALL skipped never runs its `afterAll` and leaves
an empty root per run, and a worker that dies mid-file leaves a full one — so an `afterAll` alone is not the
whole cleanup. A `process.on("exit")` inside the worker was tried first and does not fire, because Vitest's
forks pool kills its workers, which is why the sweep had to move up to the main process. It is one `rmSync`
of the pid-named parent and never a `readdir` of the shared temp directory: scanning that directory is the
309.9-second operation above, the one that started this whole incident. The pid is what makes a concurrent
vitest in another session untouchable by the sweep.
