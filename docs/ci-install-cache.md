# The CI install cache, and what ci-offload-contract pins around it

Every job that installs the root project restores `node_modules` from a cache first. The parent is
[toolchain/ci-workflow.md](toolchain/ci-workflow.md#every-job-that-installs-the-root-project-restores-it-from-a-cache-first).

## The cache

MEASURED on the laps of the pull request that added it: `yarn install --immutable` took 0:41 in each of the
fourteen jobs that install the root project, about a third of a lap's runner-seconds, and with sixteen jobs the
pool queued them for about 1:10 behind each other (3s with ten). On a hit it is 0:10-0:13 to restore plus 0:10-0:12 to
install over. So each such job runs `actions/cache/restore` straight before `yarn install --immutable`, one
key over `.nvmrc`, `.yarnrc.yml`, `.yarn/plugins/`, `package.json`, `yarn.lock` and the portal stubs'
manifests behind a `v1` salt, with no `restore-keys`.

A cache entry is unsigned and holds the tools every later step runs, so **only `typecheck` writes one, and
only on a `push` to `main` that missed**, straight after the install. With no fallback key a miss restores
nothing, so every entry is one cold install on a trusted ref; a pull request or merge group reads `main`'s
entries and never writes its own, which could only be reused by itself and would spend the repository's
quota. The install over a hit checks resolution, not the restored bytes. Every job restores first except the three named in
`COLD_JOB_RUNS` (`build`, `site`, `desktop`), each of which may run only its pinned steps: which jobs use the root
project is named in a reviewed diff, never inferred from shell text. A restoring job runs no step in a
`working-directory` or job `defaults`, and neither it nor either cache step carries `continue-on-error`; a cold job runs its pinned steps exactly, in order. Every step before an install is a whole `SETUP_STEPS` entry, so no `shell` or `setup-node` input can reach it. The workflow keeps `on.push` exactly `{ branches: [main] }` (`SAVE_TRIGGER`) and the writer always saves, so the cache cannot quietly stop
being used. `ci-offload-contract` pins all of it (`src/devLint/ciDependencyCache.ts`).

```bash
slopweaver github ci-runs --branch any --event pull_request --runs 10 --steps
```

## What ci-offload-contract pins

Every offload worker opens with exactly `RUNNER_FACTS_STEP` (`src/devLint/ciRunnerFacts.ts`), which exits
non-zero off a GitHub-hosted runner or under the `RUNNER_FLOOR_MIB` memory floor, and runs in no `container`. Every job in every workflow file runs on exactly `RUNNER_SELECTOR`, so no workflow diff can pick a runner whose own environment runs first.
A worker's `needs` is pinned whole, since a skipped dependency skips the worker with it: `unit` needs
exactly its shards and every other worker needs nothing (`src/devLint/ciWorkerActions.ts`).
Every `env` in the workflow — its own, each job's and each step's — sets only a key in `ENV_KEYS`
(`src/devLint/ciEnvKeys.ts`), so no `BASH_ENV` or `NODE_OPTIONS` can change a pinned command before it runs.
Every setup step is a whole `SETUP_STEPS` entry, every input included and only an action's ref aside, and a
worker runs no `run` but those and its own commands, carrying only a name (`src/devLint/ciWorkerRuns.ts`).
Every `uses` in every file under `.github/workflows`, a job's reusable workflow included, is one of
`WORKFLOW_ACTIONS` (`src/devLint/ciWorkflowActions.ts`), `setup-node` carries no `cache` input, and only `ci.yml` may use the cache pair: GitHub scopes
an entry to a branch, not a workflow, so a second workflow saving the same key would be restored here.

Reading shell text lost every Codex round against this contract — a comment, a continuation, a name built at
run time, a custom `shell` — so each shape is compared whole instead. What stays outside it, stated: action
refs, what a pinned command's own script does, a non-worker's own commands after its install, the restored
bytes, a `run` step calling the cache service itself, what the runner label resolves to, and the cache service's availability.
